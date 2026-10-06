// gh-accel — DeepSeek Harness 插件：GitHub 下载/上传加速
// 激活后：
//   1) 注册 github_accel_download / github_accel_clone / github_accel_push 三个工具
//   2) 自动配置 git 全局 insteadOf（clone/fetch 走加速镜像）与 pip 清华源

import {
  runDownload,
  runClone,
  runPush,
  setupGlobal,
  clampInt,
  DEFAULT_MIRRORS,
  GIT_REWRITE_KEY,
} from './lib.js';

export const inject = ['tools'];

function textResult(text) {
  return [{ type: 'text', text }];
}

function uiSummary(args, v) {
  const lines = [
    `已完成: ${v.ok ? '成功' : '失败'}`,
    `路径: ${v.path ?? v.dir ?? '-'}`,
    `大小: ${v.bytes ? (v.bytes / 1048576).toFixed(1) + ' MB' : '-'}`,
    `用时: ${v.seconds ?? '-'}s  平均: ${v.kbPerSec ?? '-'} KB/s  路线: ${v.via ?? '-'}`,
  ];
  return textResult(lines.join('\n'));
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
  },
};

const cloneOutputSchema = {
  type: 'object',
  properties: {
    ok: { type: 'boolean' },
    dir: { type: 'string' },
    url: { type: 'string' },
    repoUrl: { type: 'string' },
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

export function apply(ctx, config = {}) {
  const mirrors = Array.isArray(config.mirrors) && config.mirrors.length ? config.mirrors : DEFAULT_MIRRORS;
  const threads = clampInt(config.threads, 8, 32);
  const gitRewrite = config.gitRewrite !== false;

  ctx.effect(() => ctx.tools.register({
    name: 'github_accel_download',
    description:
      '从 GitHub 加速下载文件（release 附件 / raw 文件 / 源码归档 / 任意 github.com 直链）。' +
      '自动对直连与多个加速镜像逐条测速（每个 4 秒封顶），选最快路线；大文件按 Range 切片多线程并发下载，失败自动重试。' +
      '当需要下载 GitHub 上的文件、release 包、raw 单文件时优先使用本工具（比直接 curl 快数倍到数十倍）。' +
      '参数: url 必须是以 https://github.com/ 或 https://raw.githubusercontent.com/ 或 https://codeload.github.com/ 开头的地址；' +
      'out 建议传绝对路径（默认当前进程目录），threads 为并发切片数，mirror=true 跳过直连强制走镜像。',
    parameters: {
      type: 'object',
      properties: {
        url: { type: 'string', description: 'GitHub 文件链接（github.com / raw.githubusercontent.com / codeload.github.com）' },
        out: { type: 'string', description: '保存路径（建议绝对路径；缺省用 URL 文件名）' },
        threads: { type: 'integer', description: '并发分片数，默认 8', default: 8 },
        mirror: { type: 'boolean', description: 'true 时强制走镜像、跳过直连测速', default: false },
      },
      required: ['url'],
      additionalProperties: false,
    },
    timeoutMs: 600_000,
    output: {
      schema: downloadOutputSchema,
      render: (args, value) => uiSummary(args, value),
    },
    async execute(args, exec) {
      const url = String(args.url || '').trim();
      if (!/^https:\/\/(github\.com|raw\.githubusercontent\.com|codeload\.github\.com)\//.test(url)) {
        throw new Error('url 必须是 github.com / raw.githubusercontent.com / codeload.github.com 开头的 https 链接');
      }
      if (exec.signal?.aborted) throw new Error('已取消');
      return runDownload(url, {
        out: args.out || undefined,
        threads,
        forceMirror: args.mirror === true,
        mirrors,
        signal: exec.signal,
      });
    },
  }));

  ctx.effect(() => ctx.tools.register({
    name: 'github_accel_clone',
    description:
      '加速 git clone GitHub 仓库（自动走最快加速镜像，可浅克隆）。' +
      '克隆后 origin 保持为原始 GitHub 地址：拉取/更新自动经镜像加速，push 请使用 github_accel_push 或显式 push 到原始地址。',
    parameters: {
      type: 'object',
      properties: {
        url: { type: 'string', description: '仓库地址，如 https://github.com/user/repo 或 .../repo.git' },
        dest: { type: 'string', description: '目标目录（缺省为仓库名）' },
        depth: { type: 'boolean', description: '浅克隆(--depth 1)，默认 true', default: true },
      },
      required: ['url'],
      additionalProperties: false,
    },
    timeoutMs: 600_000,
    output: {
      schema: cloneOutputSchema,
      render: (args, value) => uiSummary(args, value),
    },
    async execute(args, exec) {
      const url = String(args.url || '').trim();
      if (!/^https:\/\/(github\.com|raw\.githubusercontent\.com)\//.test(url)) {
        throw new Error('url 必须是 github.com 开头的 https 仓库地址');
      }
      return runClone(url, { dest: args.dest, depth: args.depth !== false, mirrors, signal: exec.signal });
    },
  }));

  if (gitRewrite) {
    ctx.effect(() => ctx.tools.register({
      name: 'github_accel_push',
      description:
        '推送代码到 GitHub origin（在加速镜像改写规则下正常执行 git push）。' +
        '原理：推送期间临时移除 git 全局 insteadOf 加速改写（镜像为只读、不能接收 push），完成后恢复。' +
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
        render: (args, value) => textResult(value.ok ? `推送成功\n${value.output || ''}` : `推送失败\n${value.output || ''}`),
      },
      async execute(args, exec) {
        return runPush({ dir: args.dir, remote: args.remote || 'origin', branch: args.branch, signal: exec.signal });
      },
    }));
  }

  // 引导 AI 优先使用加速工具（systemPrompt 为可选服务，缺失时静默跳过）
  try {
    ctx.inject(['systemPrompt'], (sc) => {
      ctx.effect(() => sc.section({
        name: 'gh-accel',
        text:
          'GitHub 资源获取指引（gh-accel 加速插件已生效）：' +
          '克隆/拉取 GitHub 仓库直接使用 git 即可（全局已自动改写加速镜像）；' +
          '下载 GitHub 上的单文件（release 附件、raw 文件、源码归档）一律使用 github_accel_download 工具，' +
          '不要用 curl/wget 直连 github.com 或 raw.githubusercontent.com（直连极慢且常超时）；' +
          '向 GitHub 推送代码使用 github_accel_push。',
      }));
    });
  } catch {
    /* systemPrompt 不可用时忽略 */
  }

  // 全局自动配置（幂等，尽力而为，失败不影响插件运行）
  queueMicrotask(() => {
    setupGlobal({
      gitRewrite,
      pipMirror: config.pipMirror || 'https://pypi.tuna.tsinghua.edu.cn/simple',
    }).then((applied) => {
      console.log('[gh-accel] 全局加速配置已生效:', applied.join(', ') || '无');
    });
  });

  return () => {
    // 不在此处撤销全局配置：卸载插件不破坏用户机器状态
  };
}

export default apply;