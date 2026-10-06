/**
 * Host half of the retry-count bundle.
 *
 * 职责：把「模型请求重试次数」变成可配置项，并同步到 deepseek 提供商的重试策略。
 *
 * - 本插件声明一个 volatile 配置字段 maxRetries（默认 5，与 deepseek 自带默认一致）；
 *   插件管理页会给本插件生成「配置」表单，用户输入次数保存即写入本插件配置。
 * - 配置变更有两个信号：
 *     1. `settings/document-updated`（ns === 'retry-count'）——宿主 dsh-settings 在
 *        文档写入落盘并 reconcile 完成后发出，是最可靠的「用户改了一次重试次数」信号；
 *     2. `loader/volatile-update`——Loader 把 volatile 字段提交进运行引用时发出，
 *        保留它兜底（部分 build 该事件可能不送达，但不依赖它）。
 *   收到信号后把 deepseek 两个提供商行（deepseek-official / deepseek-account）与
 *   pi-ai 提供商行（如 日日新/rry）的 retryPolicy.maxRetries 改为目标值。
 *
 * 同步实现要点：
 * - 所有同步跑在一条串行队列里，且从信号发出栈中延迟（setTimeout 0）再执行：
 *   触发写入本身会持有 profile patch 文件锁并跑 Loader reconcile，若在信号栈内
 *   直接嵌套 configEditor.edit，会与 HMR 配置文件监听触发的全量 reconcile 竞争
 *   同一把锁与 entry 状态，导致编辑被静默丢弃（表现为「改了不生效」）。
 * - 目标值取自本插件 entry 的原始配置（entry.options.config），不依赖 volatile
 *   引用是否已提交，保证读到的是用户最新写入的值。
 */
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

/**
 * 解析 dsh 运行时树里的包。profile 自己的 node_modules 只装被安装的 bundle，
 * 运行时包（schemastery 等）在 dsh 安装树里。Node 24 的 ESM 主进程拿不到
 * require.main，因此按候选根逐个探测（DSHBox 的标准挂载是 /opt/dshapp/runtime）。
 */
function runtimeRequire(id) {
  const require = createRequire(import.meta.url);
  const candidates = [];
  if (typeof process !== 'undefined') {
    if (process.cwd?.()) candidates.push(process.cwd());
    if (process.execPath) candidates.push(process.execPath);
  }
  candidates.push(
    '/opt/dshapp/runtime',
    '/opt/dshbox/runtime',
    '/opt/dsh/runtime',
    '/usr/local/lib/node_modules/@deepseek-ai',
  );
  for (const base of candidates) {
    try {
      return require(require.resolve(id, { paths: [base] }));
    } catch {
      /* try the next base */
    }
  }
  throw new Error(`retry-count: 找不到 dsh 运行时包 "${id}"（已尝试 ${candidates.join(', ')}）`);
}

const schemastery = runtimeRequire('@deepseek-ai/schemastery');
const z = schemastery.default ?? schemastery;

/** deepseek 两个提供商行的模块名（api-key 与账号登录各占一行，都会被同步）。 */
const DEEPSEEK_ENTRIES = new Set([
  '@deepseek-ai/dsh-llm-deepseek-api-key',
  '@deepseek-ai/dsh-llm-deepseek-account',
]);
/** pi-ai 提供商行（如 日日新/rry 走这一行，providers 字典里每个提供商一个 retryPolicy）。 */
const PI_AI_ENTRY = '@deepseek-ai/dsh-llm-pi-ai';

/** retryPolicy.maxRetries 缺省值（与 RetryPolicySchema 默认一致）。 */
const DEFAULT_MAX_RETRIES = 5;

/** 本插件自己的 entry id（patch id），用于 settings/document-updated 过滤。 */
const SELF_NS = 'retry-count';

export const name = '@local/retry-count';

export const inject = ['configEditor', 'settings'];

/** 最大模型请求重试次数（默认 5；0 = 失败不重试）。volatile 使配置变更走实时通道，不重启插件。 */
export const Config = z.object({
  maxRetries: z.number().step(1).min(0).max(100).default(5).description('最大请求重试次数').volatile(),
});

export function apply(ctx, config) {
  // 把本插件声明成可配置的 settings 命名空间，让插件管理页显示「配置」表单。
  ctx.inject(['settings'], (child) => {
    child.effect(() => child.settings.configure({ auto: false }, ctx.fiber), 'retry-count: settings presentation');
  });

  /**
   * 串行队列：provider 编辑共享 profile patch 文件锁与 Loader reconcile，
   * 队列保证一次只有一个同步在跑，且不在信号发出栈里执行。
   */
  let queue = Promise.resolve();
  const enqueue = (task) => {
    queue = queue.then(task, task);
    return queue;
  };

  /** 目标值：优先读本插件 entry 的最新原始配置，避免依赖 volatile 引用是否已提交。 */
  const readMaxRetries = (editor) => {
    try {
      const selfEntry = editor.entries().find((entry) => entry.options.id === SELF_NS);
      const raw = selfEntry?.options?.config?.maxRetries;
      if (typeof raw === 'number' && Number.isSafeInteger(raw)) return raw;
    } catch {
      /* fall through to the volatile ref */
    }
    try {
      return config.maxRetries.get();
    } catch {
      return DEFAULT_MAX_RETRIES;
    }
  };

  const sync = () => {
    const editor = ctx.get('configEditor');
    if (editor === undefined) return Promise.resolve();
    const maxRetries = readMaxRetries(editor);

    const targets = [];
    for (const entry of editor.entries()) {
      const entryName = entry.options.name;
      if (DEEPSEEK_ENTRIES.has(entryName) || entryName === PI_AI_ENTRY) targets.push(entry);
    }
    if (targets.length === 0) return Promise.resolve();

    return enqueue(async () => {
      for (const entry of targets) {
        try {
          await editor.edit(entry, (current, inherited) => {
            if (entry.options.name === PI_AI_ENTRY) {
              const providers = current.providers ?? inherited?.providers ?? {};
              let changed = false;
              const next = { ...providers };
              for (const [providerName, provider] of Object.entries(providers)) {
                const policy = provider?.retryPolicy;
                if (policy?.mode === 'always') continue;
                const effective = policy?.maxRetries ?? DEFAULT_MAX_RETRIES;
                if (effective === maxRetries) continue;
                next[providerName] = {
                  ...(typeof provider === 'object' && provider !== null ? provider : {}),
                  retryPolicy: {
                    mode: 'normal',
                    ...(typeof policy === 'object' && policy !== null ? policy : {}),
                    maxRetries,
                  },
                };
                changed = true;
              }
              return changed ? { ...current, providers: next } : current;
            }
            const policy = current.retryPolicy ?? inherited?.retryPolicy;
            if (policy?.mode === 'always') return current;
            const effective = policy?.maxRetries ?? DEFAULT_MAX_RETRIES;
            if (effective === maxRetries) return current;
            return {
              ...current,
              retryPolicy: {
                mode: 'normal',
                ...(typeof policy === 'object' && policy !== null ? policy : {}),
                maxRetries,
              },
            };
          });
        } catch (error) {
          ctx.logger.warn('[retry-count] 同步 %s 重试策略失败: %o', entry.options.name, error);
        }
      }
    });
  };

  // 启动时同步一次（应用新配置或插件重载后，把 providers 拉齐到当前值）。
  sync();

  // 信号 1：settings 文档更新（设置页/插件配置表单写入后发出）——最可靠。
  ctx.on('settings/document-updated', (ns) => {
    if (ns !== SELF_NS) return;
    setTimeout(sync, 0);
  });

  // 信号 2：Loader volatile 提交（部分 build 事件可能不送达，作兜底）。
  ctx.on('loader/volatile-update', () => {
    setTimeout(sync, 0);
  });
}
