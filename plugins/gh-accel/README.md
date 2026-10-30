# 加速器 · 下载加速合并版（GitHub + 通用）

**gh-accel 与 dl-accel 合二为一**：一个插件同时负责 GitHub 与任意站点的下载/上传加速。

## v2.9.1 · 实用与容错加固（全面实测后修复）

在 v2.9.0 基础上全面实测发现并修复了几个真实问题：

- **direct 档不再被不可达直连卡死**：本地直连 github.com 常超时（15s+），旧版 direct 档下载候选把直连放最前，导致「已证明走不通的直连」先阻塞等待超时再落镜像（was ~36s）。现在只要竞速已选中可用镜像，直连只在最后兜底，direct 档同样 ~6s 完成。
- **mirror 档提速 8.5×**：旧实现「逐个串行探测 + early-exit」，冷缓存时若头部是死镜像要逐个踩满预算（was ~52s）。v2.9.1 让 mirror 档也走 **TTFB 竞速**（并行闪发、先到先得），~6s 即命中可用镜像。三档（smart/mirror/direct）现在都稳定 ~6s。
- **下载可即时取消**：外部 AbortSignal 现在**同步合并进每个在飞探针**（`AbortSignal.any`），并全程贯穿下载循环/重试——中途取消从「等 ~18s 超时」降到「~0.1s 立即中止」。
- **死路/404 快速收敛**：竞速对「探测全败」场合加了兜底秒表（不再等最后那条慢死镜像自然超时，24.9s→9s）；下载候选对 fallback 空洞收窄到单个兜底，404/坏 URL 从「疑似卡死」变为「20~27s 内明确报错」。
- **runProbe 诊断对齐 v2.9**：原 runProbe 仍用旧的带宽 `probe()`（本环境全显示 0KB/s、且等全部候选收齐 ~24s）。已改为 `probeTTFB` 并发测 TTFB，输出可达镜像的真实等效速度与选路建议。

> 修复后实测三档下载、多线程分段、clone/push、边界容错均正常（见发布说明）。

## v2.9.0 · 选路提速（TTFB 竞速 + 死镜像淘汰 + 连接复用）

针对「点击下载半天不动」的延迟主导场景（国内各节点 TTFB 实测 5~7s，带宽不是瓶颈）优化选路与连接，小文件下载实测 **~4.5× 提速**：

- **带宽测速 → TTFB 竞速（先到先得）**：旧版用 `Promise.allSettled` 并发测带宽、**等所有候选收齐**才选，最慢/超时的死镜像决定总耗时，慢到十几秒。v2.9.0 改为并发发起所有候选，**谁先返回有效响应头谁直接胜出**（Range=bytes=0-0 最小探测），其余探针立即收场。
- **果断淘汰死镜像**：连接失败/超时/4xx 的镜像在竞速中直接出局，不再拖满预算。浪费在等待上的时间归零。
- **获胜 socket 复用（关键提速点）**：探测用极小 Range 拿响应头后**同步排空 1 字节响应体**，让 socket 干净回到 keep-alive 池 → 后续真实下载**直接复用这条已建连接**（~0.2s），而不是再开一条冷连接再吃一遍 5~7s TTFB。此前小文件下载因此被拖到 26s，现在 ≈ 一次 TTFB（~6s）即完成。
- **竞速后立即 abort 其余探针**：免得死镜像的 TLS 握手一直占着 HTTP agent 的 socket，影响后续下载连接复用。
- **探测器超时改用 `AbortSignal.timeout`**：旧 `req.setTimeout` 在本环境定时不准、会提前 ~5s 触发杀掉连接（TTFB 5.4s+，全被误判为超时）。统一为可靠的中止信号，并把小文件探测预算从 2.5s 提到 ≥ 最大 TTFB，避免所有镜像在首字节到来前就被判超时误回退直连。
- **镜像清单换成实测按 TTFB 排序**（与「🛒 应用商店」共享结论），`gh.acmsz.top` 等实测可用的放前面。

> 说明：这些改进同时惠及 `smart`/`direct` 档；`mirror`/`direct` 显式档仍保留原语义。

## v2.8.0 · 公平比较（谁快选谁）

**默认档 `smart` 的阈值改为公平**：直连与镜像用**同一把尺子**（≥40 KB/s 即参与比较），**谁快选谁**。

- **旧版问题**：直连门槛 120 KB/s、镜像门槛 150 KB/s **不对称**——对直连放水、对镜像严苛。国内网络下「镜像其实更快但没到 150 门槛」的边界情况，会被直连抢走，导致走了慢路还没胶囊。
- **v2.8.0**：直连和镜像统一 **≥40 KB/s 就参与比较**（只挡死路），**测速快的直接胜出**：
  - 直连 150 / 镜像 160 → 选镜像（旧版错选直连）✅
  - 直连 200 / 镜像 180 → 选直连 ✅
  - 直连 30（死路）/ 镜像 200 → 选镜像 ✅
- `mirror`（镜像优先）/ `direct`（直连优先）显式档保持原样，需要强制时可指定。

## v2.7.0 · 下载优先策略（prefer 三档）

新增**下载优先策略**配置，下载选路更聪明，国内网络提速明显：

- **`smart`（默认，智能平衡）**：镜像门槛从 40 KB/s 提到 **150 KB/s**（只有「明显快」的镜像才选）；直连门槛从 200 KB/s 降到 **120 KB/s**；大文件测速预算 **3.5s → 5s**，避免「直连忽快忽慢被误选」。
- **`mirror`（镜像优先，国内推荐）**：只要任一镜像测速达标（40 KB/s）就**命中即用**（early-exit），直连仅作 800 KB/s 强兜底；按历史实测速度给镜像排序，**每次最多只测前 4 个**，不再 10 个全量并行。
- **`direct`（直连优先）**：保持 v2.6 老行为（直连 200 KB/s 门槛）。

配套改进（三档都受益）：

- **镜像历史速度缓存**：进程内记住每个镜像最近一次实测带宽（5 分钟），下次下载**快的镜像先测**，慢镜像靠后；
- **小文件快速决策**：<4MB 文件用 2.5s 短探测，大文件才用 5s 测准，小下载不再等半天；
- **失败降级链**：选中路线分片失败时，自动切到「历史第二快镜像」整任务重试一次，不再直接失败；
- **probe 输出策略建议**：`url_accel_probe` 现在额外返回 `prefer` + `suggestion`（例如「建议 prefer=mirror：镜像 X 达 Y KB/s」），帮你判断当前网络该用哪档。

**用法**：

- 插件配置加 `prefer`（`smart` / `mirror` / `direct`，默认 `smart`）；
- 工具参数也可临时指定：`github_accel_download(url=..., prefer="mirror")` 或 `url_accel_download(..., prefer="mirror")`，单次覆盖配置。

> 安装：
> ```bash
> dsh plugin --profile web add https://github.com/Jack-kd/dsh-plugins/releases/download/gh-accel-v2.9.1/gh-accel-plugin.tgz
> ```

## v2.6.1 · 胶囊刷新更顺滑

把胶囊的数据刷新与动画从"一格一格跳"改成**连续丝滑**：

- **进度上报更快**：host `lib.js` 每 ~400ms → **200ms** 上报 `{doneB, totalB, kbPerSec}`。
- **前端轮询更快**：胶囊每 500ms → **200ms** 轮询 `/gh-accel/progress`。
- **环形圈平滑插值**：新增 rAF 每帧逼近目标百分比 + 过渡缩短到 `.12s linear`，转圈和「已下载/总量」进度动画连续不卡顿；不确定态（上传 / 无总量）仍走虚线旋转动画。
- 数据链路不变（host 内存表 + 同源只读端点），节奏更快、画面更顺。

> 安装：
> ```bash
> dsh plugin --profile web add https://github.com/Jack-kd/dsh-plugins/releases/download/gh-accel-v2.9.1/gh-accel-plugin.tgz
> ```

## v2.6.0 · 胶囊实时速度 / 进度显示（方案 A）

输入框上方「⚡ 加速器加速中…」状态小框升级，下载时能看到**实时速度**和**下载进度**：

- **左侧新增环形进度圈**（SVG）——中心保留呼吸灯点，外圈随下载进度转圈填满；拿不到总量时圈环走"虚线旋转不确定态"。
- **右侧改为两行**：首行「⚡ 加速器加速中…」；次行**小字号灰字**显示实时数据。
  - **下载态**（`github_accel_download`/`url_accel_download`/`clone`）：`↓ 12.4 MB/s · 10MB/30MB`（增速 + 「已完成/总量」分式）；源不给 Content-Length 时只显示速度，速度也拿不到时回退「↓ 下载中…」。
  - **上传态**（`github_accel_push`）：显示「↑ 推送中…」。git push 是子进程、不吐逐字节进度，拿不到真实上传速度/大小，故只给方向 + 圈环不确定态。
- **host 新增 `/gh-accel/progress` 只读端点**（同源校验防越权）：`lib.js` 下载时每 ~400ms 把 `{doneB, totalB, kbPerSec}` 写入内存表，胶囊每 500ms 轮询取最新速度/进度。
- 胶囊仍只在走加速节点下载/上传进行中显示，空闲、直连、完成自动隐藏。

> 安装：
> ```bash
> dsh plugin --profile web add https://github.com/Jack-kd/dsh-plugins/releases/download/gh-accel-v2.9.1/gh-accel-plugin.tgz
> ```

## v2.5.2 · 修复系统提示从未注入 + 补全 HF/npm 全局镜像

**v2.5.2** 修了三件事：

### 1. 「文件下载优选规则」系统提示**从未生效**（重要）

插件一直声称"注入文件下载优选规则系统提示"，但该提示**从来没进过模型上下文**。解压真实会话记录可证：`"文件下载优选规则"` 在会话里出现 40 次，**全部来自 AI 自己的调查操作**（读源码 / 推理 / 敲命令），`system/message`（真正送达模型的系统提示）里 **0 次**。

两处 bug 叠加，且都被 `catch {}` 静默吞掉，所以表面完全正常：

```js
ctx.inject(['systemPrompt'], (sc) => {
  ctx.effect(() => sc.section({ ... }));   // ✘ 错 1：sc 是内层作用域上下文，没有 section()
});                                        // ✘ 错 2：section() 强制要求 order 为有限数字，未传
```

- **错 1**：`inject` 回调参数 `sc` 是内层作用域上下文，`section()` 挂在它自己的 `systemPrompt` 上，必须写 `sc.systemPrompt.section(...)`。写成 `sc.section` 会抛 `sc.section is not a function`。
- **错 2**：`SystemPromptProjection.section()` 会校验 `order` 必须是有限数字，缺省会抛 `prompt section "gh-accel" order must be a finite number`。

**只修错 1 不够**——修完仍会因为缺 `order` 抛错。现改为 `sc.systemPrompt.section({ name, order: getSectionOrder('MCP_SERVERS') + 1, text })`，并把静默 `catch {}` 换成 `console.warn`，避免同类问题再次潜伏。

> 影响：修复前"自动走加速节点"只靠**工具描述诱导**；修复后系统提示会明确要求模型优先使用加速工具、不要用 curl/wget 直连。可靠性有实质提升。

### 2. 新增 HF_ENDPOINT 与 npm registry 全局镜像

此前 `setupGlobal()` 只配置 git 与 pip，HuggingFace / npm 命令不会自动走镜像。现补齐：

| 通道 | 配置方式 |
|---|---|
| HuggingFace | `process.env.HF_ENDPOINT = https://hf-mirror.com` |
| npm | 写用户级 `~/.npmrc` 的 `registry=https://registry.npmmirror.com` |

> **为什么 HF 要写 `process.env` 而不是 `~/.bashrc`**：本环境的 bash 工具是 DSH 进程的子进程，且 `bash -c` **不读取任何 rc 文件**（`.bashrc` / `.profile` / `/etc/profile.d` 实测均无效）。因此必须直接写进本进程 `process.env`，后续由 DSH 派生的命令才能继承到。

### 3. 修复 git insteadOf 重复累积

早期实现每次启动都 `git config --global --add`，导致 `~/.gitconfig` 里同一条 `insteadOf` 反复累积（实测已出现 2 条）。现改为先 `--unset-all` 再写一条，幂等。

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

> 更新记录：v2.6.1 胶囊刷新更顺滑（进度上报 400ms→200ms、前端轮询 500ms→200ms，环形圈 rAF 平滑插值 + 过渡缩短，转圈与分式进度动画连续丝滑）；v2.6.0 胶囊新增实时速度/进度显示（左侧环形进度圈 + 中心呼吸灯，下载态显示「↓ 速度 · 已完成/总量」，上传 push 显示「↑ 推送中…」，host 新增 `/gh-accel/progress` 只读端点，lib.js 每 ~400ms 上报字节）；v2.1.0 首版为「⚫ 加速器加速下载中…」小胶囊；v2.2.0 重做为更醒目的圆角小框并换成「加速器加速中…」文案；v2.3.0 清理了幽灵注入；v2.4.0 修复 exports `"./client"` 缺失导致客户端模块不被加载的根本问题；v2.5.0 修复显式传 `mirror` 参数时 `ruleMatched` 为 `undefined` 触发 lossless JSON 校验失败的问题；v2.5.1 修复显式 `mirror` 对 host 型镜像（npmmirror/hf-mirror）被按 prefix 拼接而静默回退直连的问题，并新增 `mirrorStyle` 覆盖参数；v2.5.2 修复「文件下载优选规则」系统提示从未注入的问题（`sc.section` 用错内层上下文 + 缺 `section` 必需的 `order`，两处错误被静默吞掉），新增 HF_ENDPOINT / npm registry 全局镜像，并修复 git insteadOf 重复累积。

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
    hfMirror: 'https://hf-mirror.com'              # v2.5.2：写 process.env.HF_ENDPOINT；传 null 可关闭
    npmMirror: 'https://registry.npmmirror.com'    # v2.5.2：写用户级 ~/.npmrc；传 null 可关闭
```

## 安装

```bash
dsh plugin --profile web add https://github.com/Jack-kd/dsh-plugins/releases/download/gh-accel-v2.9.1/gh-accel-plugin.tgz
```

或「插件管理 → 添加插件」粘贴同一地址。

> **升级提示**：当前版本安装后不自动更新，升级需先卸载再装新版本。

## 安全说明

第三方镜像理论上可篡改内容；下载**可执行工具**后建议与官方校验和对比。国内服务器直连最优，规则只匹配境外站点域名，不会绕路。