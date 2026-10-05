/**
 * Host half of the retry-count bundle.
 *
 * 职责：把「模型请求重试次数」变成可配置项，并同步到 deepseek 提供商的重试策略。
 *
 * - 本插件声明一个 volatile 配置字段 maxRetries（默认 5，与 deepseek 自带默认一致）；
 *   插件管理页会给本插件生成「配置」表单，用户输入次数保存即写入本插件配置。
 * - 配置变更走 Loader 的 volatile 通道（loader/volatile-update），本插件监听后把
 *   deepseek 两个提供商行（deepseek-official / deepseek-account）的 retryPolicy.maxRetries
 *   改为目标值；deepseek 适配器收到 volatile 更新后会实时重注册，重试上限立刻生效。
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

  const sync = () => {
    const editor = ctx.get('configEditor');
    if (editor === undefined) return;
    const maxRetries = config.maxRetries.get();
    for (const entry of editor.entries()) {
      const entryName = entry.options.name;
      if (DEEPSEEK_ENTRIES.has(entryName)) {
        editor.edit(entry, (current, inherited) => {
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
        }).catch((error) => {
          ctx.logger.warn('[retry-count] 同步 deepseek 重试策略失败: %o', error);
        });
      } else if (entryName === PI_AI_ENTRY) {
        editor.edit(entry, (current, inherited) => {
          const providers = current.providers ?? inherited?.providers ?? {};
          let changed = false;
          const next = { ...providers };
          for (const [name, provider] of Object.entries(providers)) {
            const policy = provider?.retryPolicy;
            if (policy?.mode === 'always') continue;
            const effective = policy?.maxRetries ?? DEFAULT_MAX_RETRIES;
            if (effective === maxRetries) continue;
            next[name] = {
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
        }).catch((error) => {
          ctx.logger.warn('[retry-count] 同步 pi-ai 重试策略失败: %o', error);
        });
      }
    }
  };

  sync();
  ctx.on('loader/volatile-update', sync);
}
