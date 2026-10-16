# 加速器 · 下载加速合并版（GitHub + 通用）

**gh-accel 与 dl-accel 合二为一**：一个插件同时负责 GitHub 与任意站点的下载/上传加速。

## v2.5.1 · 修复显式 mirror 对 host 型镜像静默失效

**v2.5.1**：修复显式传 `mirror` 指向 **host 型镜像**（`registry.npmmirror.com`、`hf-mirror.com` 这类「替换 origin」的镜像）时**镜像静默不生效、悄悄回退直连**的问题。

### 现象

```
url_accel_download(url="https://registry.npmjs.org/typescript/-/typescript-5.6.3.tgz",
                   mirror="https://registry.npmmirror.com")
→ 返回「成功」，但路线显示 direct(fallback) —— 镜像根本没走，且不报任何错
```

### 根因

`lib.js` 里显式 `mirror` 被**硬编码为 prefix 样式**：

```js
const rule = mirror ? { style: 'prefix', mirrors: [mirror] } : matchRule(url, rules);
```

prefix 样式是把镜像地址**直接拼在原 URL 前面**，只适用于 GitHub 代理类镜像（如 `ghfast.top/`）。对 host 型镜像会拼出非法 URL：

```
https://registry.npmmirror.comhttps://registry.npmjs.org/typescript/...
                              ↑ 主机名被拼成了 "registry.npmmirror.comhttps:"
```

`pick()` 探针拿不到合格候选（带宽 0），于是回退 `direct(fallback)`——**不报错，但镜像未生效**，用户很难察觉。

### 修复

1. **样式自动识别**：新增 `inferMirrorStyle()`，显式 `mirror` 若命中内置/自定义规则里某个镜像（按归一化后比较，容忍尾斜杠），就沿用该规则的 `style`。于是 `npmmirror` / `hf-mirror` 会被正确识别为 host 型。
2. **新增 `mirrorStyle` 参数**：需要强制指定时，可传 `mirrorStyle: 'prefix' | 'host'` 覆盖自动识别。
3. 识别不到的镜像仍回退 `prefix`，**完全向后兼容** GitHub 代理类镜像的既有用法。

> 附带效果：`mirror` 参数现在对 host 型镜像也能正常工作了，不必再依赖 `rules` 配置。

## v2.5.0 · 修复显式指定 mirror 参数必失败

**v2.5.0**：修复 `github_accel_download` / `url_accel_download` 在**显式传 `mirror` 参数**时必然报错 `returned invalid output: value is not lossless JSON` 的问题。

根因在 `lib.js` 的 `summarize()`：`ruleMatched: rule ? rule.match : ''` —— 用 `mirror` 参数指定镜像时，`rule` 是构造出来的 `{ style, mirrors }`、**没有 `match` 字段**，于是 `ruleMatched` 变成 `undefined`。而工具 `output.schema` 声明该字段为 `string`，DSH 做 lossless JSON 校验时，`undefined` 字段在 `JSON.parse(JSON.stringify(...))` 后整个键会丢失 → 校验失败，**下载其实已经成功也会被判为无效**。

改为 `ruleMatched: (rule && rule.match) || ''` 后，该字段稳定为字符串，校验通过。不传 `mirror`（走规则命中或直连）的路径本来就有 `match`，行为不变。

## v2.4.0 · 修复状态小框不显示（真正根因）

**v2.4.0**：修复「⚡ 加速器加速中…」状态小框不显示的问题——**`package.json` 的 `exports` 需暴露 `"./client"` 键**（此前误写为 `"./client.js"`，DSH 客户端模块加载器按 `exports["./client"]` 查找，找不到就把该插件客户端整体丢弃）；同时 `index.js` 声明 `sessionProjections` 注入（与 DSH 对客户端投影送达的要求一致）。此前 v2.3.0 已移除不存在的 `@deepseek-ai/dsh-client-runtime` 注入。

> 更新记录：v2.1.0 首版为「⚫ 加速器加速下载中…」小胶囊；v2.2.0 重做为更醒目的圆角小框并换成「加速器加速中…」文案；v2.3.0 清理了幽灵注入；v2.4.0 修复 exports `"./client"` 缺失导致客户端模块不被加载的根本问题；v2.5.0 修复显式传 `mirror` 参数时 `ruleMatched` 为 `undefined` 触发 lossless JSON 校验失败的问题；v2.5.1 修复显式 `mirror` 对 host 型镜像（npmmirror/hf-mirror）被按 prefix 拼接而静默回退直连的问题，并新增 `mirrorStyle` 覆盖参数。

## 功能（5 个工具）

| 工具 | 用途 |
|---|---|
| `github_accel_download` | GitHub 文件（release / raw / 归档）加速下载，自动测速选最快镜像 + 多线程分段 |
| `github_accel_clone` | 加速 `git clone`（自动走镜像，可浅克隆） |
| `github_accel_push` | 推送代码时临时移除只读镜像改写、推完恢复 |
| `url_accel_download` | 任意非 GitHub 站点下载（规则驱动：HuggingFace / npm 等，可配置扩展） |
| `url_accel_probe` | 诊断某 URL 的选路：命中规则 + 各路线实测带宽 |

## 优选规则

- **GitHub 站内文件** → `github_accel_download`（专用路线，`url_accel_download` 会拒收 GitHub 直链）；
- **其他站点** → `url_accel_download`；
- `git clone` / `git pull` → **命令层自动**走镜像（git 全局 insteadOf）；
- `pip install` → **自动**走清华源。

## 内置默认规则

| 站点 | style | 镜像 |
|---|---|---|
| github.com / raw.githubusercontent.com / codeload.github.com | prefix | ghfast.top、github.geekery.cn、down.mxw.xx.kg、gh.monlor.com、js.jiangss.shop、github.mxw.qzz.io、gh.acmsz.top、ghproxy.felicity.land、gh-proxy.com、ghproxy.net |
| huggingface.co / hf.co | host | hf-mirror.com |
| registry.npmjs.org | host | registry.npmmirror.com |

## 配置（可选）

```yaml
- id: gh-accel
  name: '@local/gh-accel'
  inject:
    - tools
  config:
    threads: 8              # 并发分片数（1-32）
    mirrors: []             # 可选：整体替换 GitHub 镜像列表
    rules:                  # 可选：自定义站点规则（优先于内置默认）
      - match: 'gitlab\.com'
        style: 'host'
        mirrors: ['https://<你的gitlab镜像>']
    gitRewrite: true        # 是否配置 git 全局镜像改写
    pipMirror: 'https://pypi.tuna.tsinghua.edu.cn/simple'
```

## 安装

```bash
dsh plugin --profile web add https://github.com/Jack-kd/dsh-plugins/releases/download/v2.5.1/gh-accel-plugin.tgz
```

或「插件管理 → 添加插件」粘贴同一地址。

> **升级提示**：当前版本安装后不自动更新，升级需先卸载再装新版本。

## 安全说明

第三方镜像理论上可篡改内容；下载**可执行工具**后建议与官方校验和对比。国内服务器直连最优，规则只匹配境外站点域名，不会绕路。