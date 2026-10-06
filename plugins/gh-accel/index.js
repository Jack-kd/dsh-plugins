// gh-accel v2 — 合并版下载加速插件（gh-accel + dl-accel 合二为一）
// 工具:
//   github_accel_download / github_accel_clone / github_accel_push  (GitHub 路线)
//   url_accel_download / url_accel_probe                            (非 GitHub 通用路线)
// 激活后自动配置 git 全局镜像改写与 pip 清华源；注入「文件下载优选规则」系统提示。

import {
  runDownload,
  runProbe,
  runClone,
  runPush,
  setupGlobal,
  clampInt,
  DEFAULT_RULES,
} from './lib.js';

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

const cloneOutputSchema = {
  type: 'object',
  properties: {
    ok: { type: 'boolean' },
    dir: { type: 'string' },
    url: { type: 'string' },
    repoUrl: { type: 'string' },
    mirror: { type: 'string' },
    output: { type: 'string' },
  },
};

const pushOutputSchema = {
  type: 'object',
  properties: {
    ok: { type: 'boolean' },
    output: { type: 'string' },
    rewriteRestored: { type: 'boolean' },
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

const GITHUB_RE = /^https:\/\/(github\.com|raw\.githubusercontent\.com|codeload\.github\.com)\//i;

function downloadRender(args, v) {
  return textResult(
    `已完成: ${v.ok ? '成功' : '失败'}\n路径: ${v.path}\n大小: ${(v.bytes / 1048576).toFixed(1)} MB\n` +
    `用时: ${v.seconds}s  平均: ${v.kbPerSec} KB/s\n路线: ${v.via}\n命中规则: ${v.ruleMatched || '无（直连分段加速）'}`,
  );
}

export function apply(ctx, config = {}) {
  // 自定义规则优先于内置默认；config.mirrors 可整体替换 GitHub 规则镜像
  let rules = Array.isArray(config.rules) && config.rules.length
    ? [...config.rules, ...DEFAULT_RULES]
    : [...DEFAULT_RULES];
  const threads = clampInt(config.threads, 8, 32);
  if (Array.isArray(config.mirrors) && config.mirrors.length) {
    rules = rules.map((r) => (/github/.test(r.match) ? { ...r, mirrors: config.mirrors } : r));
  }

  ctx.effect(() => ctx.tools.register({
    name: 'github_accel_download',
    description:
      '从 GitHub 加速下载文件（release 附件 / raw 文件 / 源码归档）。' +
      '自动对直连与多个 GitHub 加速镜像并行测速（每个 3.5 秒封顶）选最快路线；大文件按 Range 切片多线程并发下载，失败自动重试。' +
      '下载 GitHub 站内文件时优先使用本工具（比直接 curl 快数倍到数十倍）。' +
      '参数: url 必须是 github.com / raw.githubusercontent.com / codeload.github.com 开头的 https 链接；out 建议绝对路径；' +
      'threads 并发分片数；mirror 可显式指定镜像 base 强制走它。',
    parameters: {
      type: 'object',
      properties: {
        url: { type: 'string', description: 'GitHub 文件链接' },
        out: { type: 'string', description: '保存路径（建议绝对路径）' },
        threads: { type: 'integer', description: '并发分片数，默认 8', default: 8 },
        mirror: { type: 'string', description: '可选：显式指定镜像 base，强制走该镜像' },
      },
      required: ['url'],
      additionalProperties: false,
    },
    timeoutMs: 600_000,
    output: { schema: downloadOutputSchema, render: downloadRender },
    async execute(args, exec) {
      const url = String(args.url || '').trim();
      if (!GITHUB_RE.test(url)) throw new Error('url 必须是 github.com / raw.githubusercontent.com / codeload.github.com 开头的 https 链接');
      if (exec.signal?.aborted) throw new Error('已取消');
      // threads 优先取调用参数，未传时回退插件配置（修复：之前参数被静默忽略）
      const t = clampInt(args.threads ?? threads, 8, 32);
      return runDownload(url, { out: args.out || undefined, threads: t, rules, mirror: args.mirror || null, signal: exec.signal });
    },
  }));

  ctx.effect(() => ctx.tools.register({
    name: 'github_accel_clone',
    description:
      '加速 git clone GitHub 仓库（自动走最快加速镜像，可浅克隆）。' +
      '克隆后 origin 保持为原始 GitHub 地址：拉取/更新自动经镜像加速，push 请使用 github_accel_push。',
    parameters: {
      type: 'object',
      properties: {
        url: { type: 'string', description: '仓库地址，如 https://github.com/user/repo' },
        dest: { type: 'string', description: '目标目录（缺省为仓库名）' },
        depth: { type: 'boolean', description: '浅克隆(--depth 1)，默认 true', default: true },
      },
      required: ['url'],
      additionalProperties: false,
    },
    timeoutMs: 600_000,
    output: { schema: cloneOutputSchema, render: (a, v) => uiSimple(v) },
    async execute(args, exec) {
      const url = String(args.url || '').trim();
      if (!/^https:\/\/(github\.com|raw\.githubusercontent\.com)\//.test(url)) {
        throw new Error('url 必须是 github.com 开头的 https 仓库地址');
      }
      return runClone(url, { dest: args.dest, depth: args.depth !== false, rules, signal: exec.signal });
    },
  }));

  if (config.gitRewrite !== false) {
    ctx.effect(() => ctx.tools.register({
      name: 'github_accel_push',
      description:
        '推送代码到 GitHub origin（加速镜像只读，推送期间临时移除全局 insteadOf 改写、推完恢复）。' +
        '用法：dir 为仓库目录（默认当前目录），remote 默认 origin，branch 可选。',
      parameters: {
        type: 'object',
        properties: {
          dir: { type: 'string', description: '仓库目录（缺省当前目录）' },
          remote: { type: 'string', description: '远端名，默认 origin', default: 'origin' },
          branch: { type: 'string', description: '可选分支名' },
        },
        additionalProperties: false,
      },
      timeoutMs: 300_000,
      output: {
        schema: pushOutputSchema,
        render: (a, v) => textResult(v.ok ? `推送成功\n${v.output || ''}` : `推送失败\n${v.output || ''}`),
      },
      async execute(args, exec) {
        return runPush({ dir: args.dir, remote: args.remote || 'origin', branch: args.branch, signal: exec.signal });
      },
    }));
  }

  ctx.effect(() => ctx.tools.register({
    name: 'url_accel_download',
    description:
      '从任意非 GitHub 的 URL 加速下载文件（规则驱动，跨站点通用）。' +
      '自动匹配内置/自定义镜像规则（HuggingFace hf-mirror、npm npmmirror 等，可在插件配置里给任意站点加镜像），' +
      '对直连与各镜像并行测速选最快；大文件按 Range 切片多线程并发下载，失败自动重试并校验大小。' +
      '注意: GitHub 站内文件请使用 github_accel_download（本工具会拒收 GitHub 直链）。' +
      '参数: url 为任意非 GitHub 的 https 链接；out 建议绝对路径；threads 并发分片数；mirror 可显式指定镜像 base。',
    parameters: {
      type: 'object',
      properties: {
        url: { type: 'string', description: '任意非 GitHub 的 https 下载链接' },
        out: { type: 'string', description: '保存路径（建议绝对路径）' },
        threads: { type: 'integer', description: '并发分片数，默认 8', default: 8 },
        mirror: { type: 'string', description: '可选：显式指定镜像 base，强制走该镜像' },
      },
      required: ['url'],
      additionalProperties: false,
    },
    timeoutMs: 600_000,
    output: { schema: downloadOutputSchema, render: downloadRender },
    async execute(args, exec) {
      const url = String(args.url || '').trim();
      if (!/^https?:\/\//i.test(url)) throw new Error('url 必须是 http(s) 链接');
      if (GITHUB_RE.test(url)) {
        throw new Error('GitHub 直链请使用 github_accel_download 工具（本插件的 GitHub 专用路线）');
      }
      if (exec.signal?.aborted) throw new Error('已取消');
      // threads 优先取调用参数，未传时回退插件配置（修复：之前参数被静默忽略）
      const t = clampInt(args.threads ?? threads, 8, 32);
      return runDownload(url, { out: args.out || undefined, threads: t, rules, mirror: args.mirror || null, signal: exec.signal });
    },
  }));

  ctx.effect(() => ctx.tools.register({
    name: 'url_accel_probe',
    description:
      '诊断某 URL 的下载选路：显示命中的镜像规则、直连与各镜像的实测带宽和 Range 支持（不下文件）。' +
      '用于测试/调整插件配置里的 rules/mirrors，或对比哪个节点当前最快。',
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
      render: (a, v) => textResult(
        `URL: ${v.url}\n命中规则: ${v.ruleMatched || '无（将走直连分段加速）'}\n` +
        v.routes.map((r) => `  ${r.via}  →  ${r.kbPerSec} KB/s  ${r.rangeOk ? 'Range✔' : ''}`).join('\n'),
      ),
    },
    async execute(args, exec) {
      const url = String(args.url || '').trim();
      if (!/^https?:\/\//i.test(url)) throw new Error('url 必须是 http(s) 链接');
      return runProbe(url, { rules, signal: exec.signal });
    },
  }));

  // 系统提示：文件下载优选规则（可选服务，缺失时静默跳过）
  try {
    ctx.inject(['systemPrompt'], (sc) => {
      ctx.effect(() => sc.section({
        name: 'gh-accel',
        text:
          '文件下载优选规则（gh-accel v2 已生效）：下载任意 URL 的大文件/工具时，' +
          'GitHub 站内文件一律用 github_accel_download（自动走加速镜像）；' +
          '其他任意站点用 url_accel_download（规则镜像 + 多线程）；git clone 用 github_accel_clone，push 用 github_accel_push；' +
          '需要对比选路时可先用 url_accel_probe。不要用 curl/wget 直连下载大文件（通常慢数倍）。',
      }));
    });
  } catch {
    /* systemPrompt 不可用时忽略 */
  }

  queueMicrotask(() => {
    setupGlobal({
      gitRewrite: config.gitRewrite !== false,
      pipMirror: config.pipMirror || 'https://pypi.tuna.tsinghua.edu.cn/simple',
    }).then((applied) => {
      console.log('[gh-accel] v2 全局配置已生效:', applied.join(', ') || '无');
    });
  });

  return () => {};
}

function uiSimple(v) {
  if (!v.ok) return textResult(`失败: ${v.output || ''}`);
  const lines = [
    `已完成克隆: ${v.dir}`,
    `origin 存储: ${v.url}（原始地址；git remote -v 显示镜像前缀是全局改写的正常显示，非存储异常）`,
    `本次加速镜像: ${v.mirror || '-'}`,
  ];
  if (v.output) lines.push(v.output);
  return textResult(lines.join('\n'));
}

export default apply;