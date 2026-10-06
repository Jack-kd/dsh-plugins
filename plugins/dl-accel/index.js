// dl-accel — DeepSeek Harness 插件：通用 URL 下载加速（可在配置里给任意站点加镜像规则）
// 激活后：
//   1) 注册 url_accel_download（规则驱动下载：GitHub/HuggingFace/npm 等自动走镜像 + 多线程分段）
//     与 url_accel_probe（诊断选路）
//   2) 注入一条系统提示引导 AI 优先使用本工具
// 规则可配（config.rules 优先于内置默认）：{ match: 正则字符串, style: 'prefix'|'host', mirrors: [base...] }

import { runDownload, runProbe, clampInt, DEFAULT_RULES } from './lib.js';

export const inject = ['tools'];

function textResult(text) {
  return [{ type: 'text', text }];
}

const downloadOutputSchema = {
  type: 'object',
  properties: {
    ok: { type: 'boolean' },
    path: { type: 'string' },
    bytes: { type: 'number' },
    seconds: { type: 'number' },
    kbPerSec: { type: 'number' },
    via: { type: 'string' },
    ruleMatched: { type: 'string' },
  },
};

const probeOutputSchema = {
  type: 'object',
  properties: {
    url: { type: 'string' },
    ruleMatched: { type: 'string' },
    routes: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          via: { type: 'string' },
          kbPerSec: { type: 'number' },
          rangeOk: { type: 'boolean' },
        },
      },
    },
  },
};

export function apply(ctx, config = {}) {
  // 自定义规则优先于内置默认（可覆盖 GitHub 等站点的镜像选择）
  const rules = Array.isArray(config.rules) && config.rules.length
    ? [...config.rules, ...DEFAULT_RULES]
    : DEFAULT_RULES;
  const threads = clampInt(config.threads, 8, 32);

  ctx.effect(() => ctx.tools.register({
    name: 'url_accel_download',
    description:
      '从任意非 GitHub 的 URL 加速下载文件（跨站点通用，规则驱动）。自动匹配内置/自定义镜像规则' +
      '（HuggingFace hf-mirror、npm npmmirror 等，可在插件配置里加任意站点），对直连与各镜像并行测速选最快；' +
      '大文件按 Range 切片多线程并发下载，失败自动重试并校验大小。' +
      '注意: GitHub 站内文件请使用 github_accel_download 工具（gh-accel 专用路线），本工具会拒收。' +
      '参数: url 为任意非 GitHub 的 https 下载链接；out 建议绝对路径；threads 并发分片数；mirror 可显式指定镜像 base 强制走它。' +
      '安全: 第三方镜像可能被篡改，关键二进制下载后请自行与官方校验和对比。',
    parameters: {
      type: 'object',
      properties: {
        url: { type: 'string', description: '任意 https 下载链接' },
        out: { type: 'string', description: '保存路径（建议绝对路径；缺省用 URL 文件名）' },
        threads: { type: 'integer', description: '并发分片数，默认 8', default: 8 },
        mirror: { type: 'string', description: '可选：显式指定镜像 base（如 https://ghfast.top/），强制走该镜像' },
      },
      required: ['url'],
      additionalProperties: false,
    },
    timeoutMs: 600_000,
    output: {
      schema: downloadOutputSchema,
      render: (args, v) => textResult(
        `已完成: ${v.ok ? '成功' : '失败'}\n路径: ${v.path}\n大小: ${(v.bytes / 1048576).toFixed(1)} MB\n` +
        `用时: ${v.seconds}s  平均: ${v.kbPerSec} KB/s\n路线: ${v.via}\n命中规则: ${v.ruleMatched ?? '无（直连分段加速）'}`,
      ),
    },
    async execute(args, exec) {
      const url = String(args.url || '').trim();
      if (!/^https?:\/\//i.test(url)) throw new Error('url 必须是 http(s) 链接');
      // 优选规则: GitHub 直链走 gh-accel 专用路线，本工具拒收并引导
      if (/^https:\/\/(github\.com|raw\.githubusercontent\.com|codeload\.github\.com)\//i.test(url)) {
        throw new Error('GitHub 直链请使用 github_accel_download 工具（gh-accel 插件专用 GitHub 加速路线）');
      }
      if (exec.signal?.aborted) throw new Error('已取消');
      return runDownload(url, {
        out: args.out || undefined,
        threads,
        rules,
        mirror: args.mirror || null,
        signal: exec.signal,
      });
    },
  }));

  ctx.effect(() => ctx.tools.register({
    name: 'url_accel_probe',
    description:
      '诊断某 URL 的下载选路：显示命中的镜像规则、直连与各镜像的实测带宽与 Range 支持（不下文件）。' +
      '用于测试/调整插件配置里的 rules 是否生效，或对比哪个镜像当前最快。',
    parameters: {
      type: 'object',
      properties: {
        url: { type: 'string', description: '任意 https 下载链接' },
      },
      required: ['url'],
      additionalProperties: false,
    },
    timeoutMs: 60_000,
    output: {
      schema: probeOutputSchema,
      render: (args, v) => textResult(
        `URL: ${v.url}\n命中规则: ${v.ruleMatched ?? '无（将走直连分段加速）'}\n` +
        v.routes.map((r) => `  ${r.via}  →  ${r.kbPerSec} KB/s  ${r.rangeOk ? 'Range✔' : 'Range✘'}`).join('\n'),
      ),
    },
    async execute(args, exec) {
      const url = String(args.url || '').trim();
      if (!/^https?:\/\//i.test(url)) throw new Error('url 必须是 http(s) 链接');
      return runProbe(url, { rules, signal: exec.signal });
    },
  }));

  // 引导 AI 优先使用本工具（systemPrompt 为可选服务，缺失时静默跳过）
  try {
    ctx.inject(['systemPrompt'], (sc) => {
      ctx.effect(() => sc.section({
        name: 'dl-accel',
        text:
          '文件下载优选规则（dl-accel 已生效）：下载任意 URL 的大文件/工具时，' +
          'GitHub 站内文件一律用 github_accel_download（gh-accel 插件），其他任意站点用 url_accel_download（dl-accel，自动镜像+多线程）；' +
          '需要对比选路时可先用 url_accel_probe。不要用 curl/wget 直连下载大文件（通常慢数倍）。',
      }));
    });
  } catch {
    /* systemPrompt 不可用时忽略 */
  }

  queueMicrotask(() => {
    console.log(`[dl-accel] 已激活: ${rules.length} 条规则, 默认 ${threads} 线程`);
  });

  return () => {};
}

export default apply;