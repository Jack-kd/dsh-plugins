/**
 * Host half of the retry-count bundle.
 *
 * 职责：把「模型请求重试次数」变成可配置项，并同步到 deepseek 提供商的重试策略。
 *
 * - 本插件声明一个 volatile 配置字段 maxRetries（默认 5，与 deepseek 自带默认一致）；
 *   插件管理页会给本插件生成「配置」表单，用户输入次数保存即写入本插件配置。
 *
 * 配置变更信号（实测 DSH 0.2.0-rc.2 的行为，按可靠性排序）：
 *   1. `app-boot/config-reload` —— 每次 profile patch reconcile 完成（含设置写入、
 *      插件自身编辑、HMR 全量 reconcile）后由根上下文发出，无过滤器，能稳定送达插件；
 *   2. `settings/document-updated`（ns === 'retry-count'）—— 设置写入/describe 检测到
 *      文档变化时发出，送达同样可靠但时机可能滞后；
 *   3. `loader/volatile-update` —— Loader 提交 volatile 字段时发出，但该事件携带
 *      `owner.fiber === fiber` 过滤器，而本 build 的 ctx.on 监听器全部挂在根上下文
 *      （根 fiber ≠ 条目 fiber），因此实际上送不到任何插件监听器；保留仅为兼容未来 build。
 *
 * 值源（实测 entry.options.config 在写入后会滞后，不能作为运行时值源）：
 *   1. settings 文档的 user 段（直读 profile patch，写入即最新，是用户意图的权威值）；
 *   2. volatile 引用 config.maxRetries.get()（写入时同步提交）；
 *   3. entry.options.config（回退）。
 *
 * 编辑失败的主因（v2.0.7 修复）：configEditor.edit 会把写盘+reconcile 包进
 * `hmr.runExclusive` 排他事务，而 `runExclusive` 对嵌套调用是直接拒绝
 * （"HMR transactions cannot be nested"）而非排队。设置写入自身的编辑与 HMR
 * 配置监听触发的全量 reconcile 会持有事务数秒，插件在这期间发起的编辑全部被拒。
 * 因此同步对「HMR 忙碌」错误做短间隔重试（600ms，上限 40 次），其余错误才走失败冷却。
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

/** 失败冷却：一次同步失败后，此毫秒数内不再重试（防止失败与 reconcile 事件互相放大）。 */
const FAIL_RETRY_COOLDOWN_MS = 5000;

/** HMR 排他事务忙碌时的错误标记：configEditor.edit 在 HMR 事务内嵌套调用会被直接拒绝。 */
const HMR_BUSY_MESSAGE = 'HMR transactions cannot be nested';
/** HMR 忙碌时的重试间隔与上限（写入本身持有事务通常几百毫秒到一两秒）。 */
const HMR_RETRY_DELAY_MS = 600;
const HMR_RETRY_MAX = 40;

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

  /**
   * 目标值（用户意图的权威值）：
   * 优先读 settings 文档 user 段（直读 profile patch，写入即最新）；
   * 回退 volatile 引用（写入时同步提交）；最后回退 entry 原始配置。
   */
  const readMaxRetries = (editor) => {
    try {
      const descriptors = ctx.settings?.describe ? ctx.settings.describe() : [];
      const self = descriptors.find((descriptor) => descriptor.ns === SELF_NS);
      const user = self?.user?.maxRetries;
      if (typeof user === 'number' && Number.isSafeInteger(user)) return user;
      const live = self?.value?.maxRetries;
      if (typeof live === 'number' && Number.isSafeInteger(live)) return live;
    } catch {
      /* fall through */
    }
    try {
      return config.maxRetries.get();
    } catch {
      /* fall through */
    }
    try {
      const selfEntry = editor.entries().find((entry) => entry.options.id === SELF_NS);
      const raw = selfEntry?.options?.config?.maxRetries;
      if (typeof raw === 'number' && Number.isSafeInteger(raw)) return raw;
    } catch {
      /* fall through */
    }
    return DEFAULT_MAX_RETRIES;
  };

  /** 最近一次成功同步的目标值；同值事件直接跳过（断自激循环）。 */
  let lastSynced = null;
  /** 最近一次同步失败的时间戳：仅失败后进入冷却，成功路径不受限。 */
  let lastFailedAt = 0;
  /** HMR 忙碌重试状态：同一时间只挂一个重试定时器，并对总重试次数设上限。 */
  let retryPending = false;
  let retryCount = 0;
  const scheduleRetry = () => {
    if (retryPending) return;
    retryPending = true;
    setTimeout(() => {
      retryPending = false;
      retryCount += 1;
      if (retryCount <= HMR_RETRY_MAX) {
        sync();
      } else {
        ctx.logger.warn('[retry-count] HMR 忙碌重试已达上限，放弃本轮同步');
      }
    }, HMR_RETRY_DELAY_MS);
  };

  const sync = () => {
    const editor = ctx.get('configEditor');
    if (editor === undefined) return Promise.resolve();
    const maxRetries = readMaxRetries(editor);
    if (maxRetries === lastSynced) return Promise.resolve();
    if (Date.now() - lastFailedAt < FAIL_RETRY_COOLDOWN_MS) return Promise.resolve();

    const targets = [];
    for (const entry of editor.entries()) {
      const entryName = entry.options.name;
      if (DEEPSEEK_ENTRIES.has(entryName) || entryName === PI_AI_ENTRY) targets.push(entry);
    }
    if (targets.length === 0) return Promise.resolve();

    return enqueue(async () => {
      let allOk = true;
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
          if (String(error?.message ?? error).includes(HMR_BUSY_MESSAGE)) {
            // 触发写入的 HMR 排他事务还在运行：稍后重试整轮，不视为失败。
            ctx.logger.debug('[retry-count] HMR 忙碌，稍后重试同步（%s）', entry.options.name);
            scheduleRetry();
            return;
          }
          allOk = false;
          lastFailedAt = Date.now();
          ctx.logger.warn('[retry-count] 同步 %s 重试策略失败: %o', entry.options.name, error);
        }
      }
      if (allOk) {
        lastSynced = maxRetries;
        retryCount = 0;
      }
    });
  };

  // 启动时同步一次（应用新配置或插件重载后，把 providers 拉齐到当前值）。
  sync();

  // 信号 1：profile patch reconcile 完成（设置写入、插件自身编辑、HMR 全量）——最及时可靠。
  ctx.on('app-boot/config-reload', () => {
    setTimeout(sync, 0);
  });

  // 信号 2：settings 文档更新（设置页/插件配置表单写入或 describe 检测到变化时发出）。
  ctx.on('settings/document-updated', (ns) => {
    if (ns !== SELF_NS) return;
    setTimeout(sync, 0);
  });

  // 信号 3：Loader volatile 提交（本 build 事件送达受限，保留以兼容未来 build）。
  ctx.on('loader/volatile-update', () => {
    setTimeout(sync, 0);
  });
}
