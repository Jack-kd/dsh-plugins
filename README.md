# dsh-plugins

Jack-kd 的 DeepSeek Harness（DSH）插件仓库 —— monorepo 结构：**一个仓库放多个插件**，
每个插件是一个独立完整的 bundle，统一放在 `plugins/` 目录下。

---

## 📦 安装速查（点击展开插件详情）

<details>
<summary><b>▶ enter-newline · 回车换行</b>　<code>v1.0.1</code></summary>

> 把 DSH 输入框的回车键从「发送」改为「插入换行」；可在 **设置 → 通用设置 → 回车键** 切回「回车发送」。手机、电脑通用，不打断手机输入法。
>
> **v1.0.1**：不支持的浏览器（无原生 `beforeinput`）不再「按回车没反应」，自动退回回车发送并在设置页提示；偏好跨标签页同步；文案区分官方「忙碌时回车」。

**一条命令安装：**

```bash
dsh plugin --profile web add https://github.com/Jack-kd/dsh-plugins/releases/download/enter-newline-v1.0.1/enter-newline-plugin.tgz
```

**或者**：「插件管理 → 添加插件」粘贴下面地址，点安装：

```
https://github.com/Jack-kd/dsh-plugins/releases/download/enter-newline-v1.0.1/enter-newline-plugin.tgz
```

> 装完无需重启，到输入框按一下回车即可验证（拼音输入法第一下是提交拼音，第二下才换行，属正常现象）。
</details>

<details>
<summary><b>▶ retry-count · 请求重试次数</b>　<code>v2.0.8</code></summary>

> 修改模型请求重试上限（默认 5）。在 **设置 → 通用设置 → 模型请求重试次数** 输入次数（如 10）点修改，或 **插件管理 → 请求重试次数 → 配置** 里改，立即生效。支持 deepseek 与 pi-ai（日日新）提供商。
>
> **v2.0.8**：修复了改次数后 deepseek/pi-ai 重试策略不跟随的问题（app-boot/config-reload 信号 + 直读 settings user 段值源 + 干净上下文 setInterval 驱动执行，规避 HMR 事务 ALS 嵌套拒绝）。

**一条命令安装：**

```bash
dsh plugin --profile web add https://github.com/Jack-kd/dsh-plugins/releases/download/retry-count-v2.0.8/retry-count-plugin.tgz
```

**或者**：「插件管理 → 添加插件」粘贴下面地址，点安装：

```
https://github.com/Jack-kd/dsh-plugins/releases/download/retry-count-v2.0.8/retry-count-plugin.tgz
```

> 装完重启一次 App（让设置页入口出现）；之后改次数实时生效，无需再重启。卡顿重试提示会变成「已重试模型请求（1/10）」。
</details>

<details>
<summary><b>▶ chat-keeper-mobile · 对话管理（手机版）</b>　<code>v1.2.0</code></summary>

> 跨工作区对话总表、正文搜索、批量归档、可恢复删除（回收站），以及会话「…」菜单里的「删除会话」。入口：**设置 → 对话管理**（基于 Sky-lll27 的 DSH-chat-keeper 客户端适配手机布局，Host 能力一致）。

**一条命令安装：**

```bash
dsh plugin --profile web add https://github.com/Jack-kd/dsh-plugins/releases/download/chat-keeper-mobile-v1.2.0/chat-keeper-mobile-plugin.tgz
```

**或者**：「插件管理 → 添加插件」粘贴下面地址，点安装：

```
https://github.com/Jack-kd/dsh-plugins/releases/download/chat-keeper-mobile-v1.2.0/chat-keeper-mobile-plugin.tgz
```

> 装完重启一次 App（工具 + 删除/恢复接口生效）。删除默认进回收站，可 `conversation_restore` 恢复；正在对话的会话删除会中断它（确认后执行）。
</details>

<details>
<summary><b>▶ 加速器 · 下载加速（GitHub + 通用，合并版）</b>　<code>v2.7.0</code></summary>

> **v2.7.0**：新增**下载优先策略 `prefer`**（三档：`mirror` 镜像优先/国内推荐 / `smart` 智能平衡/默认 / `direct` 直连优先/老行为）。`smart` 档镜像门槛 40→**150 KB/s**、直连门槛 200→**120 KB/s**、大文件测速 3.5s→5s；`mirror` 档按镜像历史速度排序后**命中即用**（最多测 4 个，不再 10 个全量并行）；新增镜像历史测速缓存（5 分钟）、小文件 2.5s 快速决策、失败自动切第二快镜像降级重试；`url_accel_probe` 新增 `prefer`+`suggestion` 策略建议输出。工具参数可临时指定 `prefer` 覆盖配置。
>
> **gh-accel 与 dl-accel 合二为一（v2.6.0）**：一个插件同时负责 GitHub 与任意站点的下载/上传加速。`github_accel_download`（GitHub 文件，自动测速选最快镜像 + 8 线程分段）、`github_accel_clone`（加速 clone）、`github_accel_push`（push 自动绕过只读镜像）、`url_accel_download`（任意非 GitHub 站点，规则驱动镜像：HuggingFace hf-mirror / npm npmmirror，可配置扩展）、`url_accel_probe`（选路诊断）。装好后自动配置 git 镜像改写、pip 清华源、**HF_ENDPOINT 与 npm registry 镜像**；GitHub 直链自动引导专用工具，国内服务器自动直连不绕路。实测比直连快数倍到数十倍。
>
> **v2.6.1**：胶囊**刷新更顺滑**——进度上报 400ms→200ms、前端轮询 500ms→200ms，环形进度圈新增 rAF 平滑插值（每帧逼近目标百分比）并缩短过渡时间，转圈与「已下载/总量」动画不再一格一格跳，连续丝滑（此前上传 push 仍为「↑ 推送中…」不确定态）。
>
> **v2.6.0**：「⚡ 加速器加速中…」胶囊升级**实时速度/进度显示**——左侧新增**环形进度圈**（SVG，中心保留呼吸灯点，随下载进度转圈填满；拿不到总量时圈环走虚线旋转不确定态）；右侧改两行，次行小字号灰字显示数据。**下载态**（download/url_download/clone）：`↓ 12.4 MB/s · 10MB/30MB`（增速 + 「已完成/总量」分式，拿不到总量只显示速度）；**上传态**（push）：`↑ 推送中…`（git push 不吐逐字节进度，无真实速度/大小，只给方向）。host 新增 `/gh-accel/progress` 只读端点（`lib.js` 每 ~400ms 上报字节，胶囊每 500ms 轮询）。
>
> **v2.5.2**：修复**「文件下载优选规则」系统提示从未注入**的问题——该提示此前**从未进入模型上下文**（实测会话记录：该串出现 40 次但 `system/message` 里 0 次，全部来自 AI 自身操作）。两处 bug 叠加且被 `catch {}` 静默吞掉：① `sc.section(...)` 用错上下文（`sc` 是内层作用域，应写 `sc.systemPrompt.section(...)`）；② `section()` 强制要求 `order` 为有限数字而未传（**只修 ① 仍会抛错**）。现两处都修好并把静默 catch 换成 `console.warn`。同时新增 **HF_ENDPOINT**（写 `process.env`——本环境 `bash -c` 不读任何 rc 文件，写 `.bashrc` 无效）与 **npm registry**（写 `~/.npmrc`）全局镜像，并修复 git `insteadOf` 每次启动重复累积的问题（改为先 `--unset-all` 再写，幂等）。
>
> **v2.5.1**：修复显式传 `mirror` 指向 **host 型镜像**（`registry.npmmirror.com`、`hf-mirror.com` 这类「替换 origin」的镜像）时**镜像静默不生效、悄悄回退直连**的问题。此前显式 `mirror` 被硬编码为 prefix 拼接，会把 host 型镜像拼成 `https://registry.npmmirror.comhttps://registry.npmjs.org/...` 这种非法主机名，探针拿不到合格候选就回退 `direct(fallback)`——**不报错但镜像没用上**。现新增 `inferMirrorStyle()` 按内置规则自动识别样式，并提供 `mirrorStyle: 'prefix' | 'host'` 参数供强制覆盖；识别不到时仍回退 prefix，GitHub 代理类镜像用法完全兼容。
>
> **v2.5.0**：修复**显式传 `mirror` 参数时必然失败**的问题（`github_accel_download` / `url_accel_download` 报 `returned invalid output: value is not lossless JSON`）。根因是 `summarize()` 里 `ruleMatched: rule ? rule.match : ''` —— 用 `mirror` 指定镜像时 `rule` 没有 `match` 字段，该值变成 `undefined`，而 schema 声明为 `string`，lossless JSON 校验时该键丢失导致**下载成功也被判为无效**；现改为 `(rule && rule.match) || ''`。
>
> **v2.2.0+ / v2.4.0**：下载/克隆走加速节点时，输入框上方浮出「⚡ 加速器加速中…」圆角状态小框（呼吸光点 + 滑入动画，深浅主题自适应），直连或完成时自动隐藏；v2.4.0 修复该小框不显示的问题（`exports` 补上 `"./client"` 键 —— 此前误写为 `"./client.js"` 导致 DSH 客户端模块加载器整体丢弃该插件的客户端）。

**一条命令安装：**

```bash
dsh plugin --profile web add https://github.com/Jack-kd/dsh-plugins/releases/download/gh-accel-v2.7.0/gh-accel-plugin.tgz
```

**或者**：「插件管理 → 添加插件」粘贴下面地址，点安装：

```
https://github.com/Jack-kd/dsh-plugins/releases/download/gh-accel-v2.7.0/gh-accel-plugin.tgz
```

> 镜像（ghfast.top 等）是公共第三方服务、有失效风险；可在配置里用 `mirrors`/`rules` 自行增删站点规则。下载大文件建议指定绝对 `out` 路径。
>
> **升级提示**：当前版本安装后不自动更新，升级需先卸载再装新版本。
</details>

<details>
<summary><b>▶ rea-tools · REA 逆向工具链（一键安装 + 原生/APK 逆向）</b>　<code>v0.2.4</code></summary>

> 一键安装 **REA + Ghidra + JADX**（arm64 反编译器免编译、断点续传、zip 缓存、幂等），并提供 7 个逆向工具：`rea_install`（安装）、`rea_doctor`（就绪检查）、`rea_analyze`（二进制概览）、`rea_function`（函数伪代码，Ghidra）、`rea_inspect_apk` / `rea_inspect_apk_class` / `rea_inspect_apk_method`（APK 静态逆向，不运行目标代码）。已在 arm64 实测：NewPipe APK 7096 类，Manifest/类成员/方法反编译全部正常。
>
> **v0.2.4**：胶囊改为**两行**布局——第一行「REA · 操作名…」；第二行显示正在分析的目标文件名（从 `apk`/`path` 参数提取，灰色小字）；无文件参数的工具只显示一行。
>
> **v0.2.3**：rea 工具执行中的胶囊**显示具体操作名**，如「**REA · 分析 APK…**」「**REA · 反编译函数…**」「**REA · 分析二进制…**」；并发执行时显示最近一次操作。
>
> **v0.2.2**：任一个 `rea_*` 工具被实际调用时（如 `rea_inspect_apk`、`rea_analyze`），输入框上方显示「**REA 逆向中…**」胶囊（带呼吸光点），工具返回后自动消失——与「加速器」插件的下载状态小框同一套交互（事件驱动投影）。
>
> **v0.2.1**：设置页「REA 逆向环境」未安装时点击弹出**初级/升级选择弹窗**（「稍后再说」后也可返回设置页重选装）；已就绪文案统一为「**当前版本**」。
>
> **v0.2.0**：新增**环境准备弹窗 + 后台安装 + 进度展示**。首次打开新环境自动弹出「REA 逆向环境需要准备」，选 **初级版本**（JDK + rea-agents + JADX，APK 逆向，约 239 MB，含可逐项勾选）或 **升级版本**（+ Ghidra 12.1.4 原生二进制逆向，约 784 MB）；可在后台下载（不阻塞对话），输入框上方显示进度胶囊，点击看详情（百分比 / 阶段 / 当前源 / 日志），完成发提示。取消安装时弹窗让你选「保留已下载（续传）」或「删除」。设备提升为全部走镜像加速（ghfast.top 等）且超慢源自动中断。
>
> **状态机**：仅首次自动弹窗 → 后台装完不再弹；「稍后再说」仅在 **设置 → 通用 → REA 逆向环境** 里可装；中断/失败下次**静默续传**。初级装完可在设置页一键升级到升级版本。

**一条命令安装：**

```bash
dsh plugin --profile web add https://github.com/Jack-kd/dsh-plugins/releases/download/rea-tools-v0.2.4/rea-tools-plugin.tgz
```

**或者**：「插件管理 → 添加插件」粘贴下面地址，点安装：

```
https://github.com/Jack-kd/dsh-plugins/releases/download/rea-tools-v0.2.4/rea-tools-plugin.tgz
```

> 首次打开自动弹窗选择版本后台安装；或在设置 → 通用 → REA 逆向环境 里安装；也可调 `rea_install` 工具。升级需先卸载再装新版本。
</details>

<details>
<summary><b>▶ our-free-model · 免费模型（免登录免 Key，多模型开箱即用）</b>　<code>v2.5.1</code></summary>

> 装上即用，无需登录、注册或填 API Key：DeepSeek V4.1 Flash、Kimi K3 等前沿模型直接出现在输入框的 **Our Free Model** 分组，免费不限量（上游为 OpenCode Zen / Kilo 公共网关）。另含 Kilo 免费池、EAC 协付渠道（桌面端）、13 个账号渠道（CodeArts/CodeBuddy/Qoder/TRAE/Gemini 等）、76 家聚合提供商（自带 Key 接入）、Token 压缩、命名降级链（combo）、本地 OpenAI/Anthropic 兼容网关与局域网转发、数据看板与运行日志，九页毛玻璃设置界面（**设置 → Our Free Model**）。第三方插件，作者 Ebony-Vinyl，MIT。
>
> **v2.5.1**：修复升级失败——升级清单与公告订阅新增国内可达的 `raw.githubusercontent.com` 代理镜像（镜像同样先解析为完整 commit SHA 再取件，签名与逐文件 SHA-256 校验照常）；修复 EAC 卡片小字显示 `org/` 前缀，服务端 EAC 渠道对外模型名改回 `opencode/...` 前缀，置顶 / NEW / 爆 / 高速 标签与 1M 上下文、思考档位全部生效。

**一条命令安装：**

```bash
dsh plugin --profile web add https://github.com/Jack-kd/dsh-plugins/releases/download/our-free-model-v2.5.1/our-free-model-plugin.tgz
```

**或者**：「插件管理 → 添加插件」粘贴下面地址，点安装：

```
https://github.com/Jack-kd/dsh-plugins/releases/download/our-free-model-v2.5.1/our-free-model-plugin.tgz
```

> 装完重启一次 App。模型可用性按你自己这台机器的网络出口实测，切换网络后可在设置页「重新探测可用性」。升级需先卸载再装新版本。
</details>

<details>
<summary><b>▶ dsh-plugin-wallpaper-engine · 壁纸引擎（把本地 Wallpaper Engine 壁纸放到对话背后）</b>　<code>v1.3.3</code></summary>

> 把本机 **Wallpaper Engine** 的场景、网页与视频壁纸渲染到 DSH 对话界面后方：Scene / Web 实时渲染（内置 WebWallGL 引擎）、Video 直接播放；配 iOS 风格液态玻璃、可调模糊 / 遮罩 / 描边 / 透明度、自定义字体与光标，贝壳整个设置窗口。不向 agent 注册任何工具、不注入提示文本，**不增加模型 token 开销**。需要宿主 DeepSeek Harness kernel ≥ 0.1.5（官方桌面版 / DSH Desktop ≥ 2.0.7）。
>
> **v1.3.3**：收录上游 dsh-wallpaper-engine 当前版本（原作者 elysia395，第三方收录）。

**一条命令安装：**

```bash
dsh plugin --profile web add https://github.com/Jack-kd/dsh-plugins/releases/download/dsh-plugin-wallpaper-engine-v1.3.3/dsh-plugin-wallpaper-engine-plugin.tgz
```

**或者**：「插件管理 → 添加插件」粘贴下面地址，点安装：

```
https://github.com/Jack-kd/dsh-plugins/releases/download/dsh-plugin-wallpaper-engine-v1.3.3/dsh-plugin-wallpaper-engine-plugin.tgz
```

> 装完需重启 Web，到 **设置 → Wallpaper Engine → 壁纸库** 选一张壁纸。前置是本地装有 Wallpaper Engine（Steam app 431960）。升级需先卸载再装新版本。
</details>

<details>
<summary><b>▶ dsh-vision-router · 视觉路由（给 Agent 看图）</b>　<code>v3.0.4</code></summary>

> 给 DeepSeek Harness 的**纯文本 Agent 一双眼睛**：内置免费视觉链 + 14 个深度视觉工具（`vision_describe` / `vision_detect` / `vision_ocr` / `vision_crop` / `vision_ground` / `vision_pixel_diff` / `vision_trace` / `vision_html_screenshot` / `vision_long_screenshot_ocr` 等），开箱免费、免 Key、无需 Python。想看图时开启输入框旁「👁 识图」，图片按普通工具调用轮处理。第三方插件，作者 ysr666，MIT。
>
> **v3.0.4**：通过 DSH `0.2.1-alpha.5` 的 Host/Chromium 精确校验；CI 供应链 Action 刷新。支持远程视觉 Provider（含默认免费 OVHcloud 兜底），可配严格纯本地模式。

**一条命令安装：**

```bash
dsh plugin --profile web add https://github.com/Jack-kd/dsh-plugins/releases/download/dsh-vision-router-v3.0.4/dsh-vision-router-plugin.tgz
```

**或者**：「插件管理 → 添加插件」粘贴下面地址，点安装：

```
https://github.com/Jack-kd/dsh-plugins/releases/download/dsh-vision-router-v3.0.4/dsh-vision-router-plugin.tgz
```

> ⚠️ 默认数据会出网（云端识图会发给供应商，新装默认开启 OVHcloud 免费兜底）；涉密/受限材料请先切到「严格纯本地」。装完重启一次 App。升级需先卸载再装新版本。
>
> 🟢 **开箱即用**：像素级视觉工具所需的 **sharp 已打包为固定依赖**，装完自动安装、无需额外配置；本地 OCR（`tesseract`）装上即走离线识别（README 收录版本为"完全体"打包）。
> ⬜ 仅 1 项可选前置：**`vision_html_screenshot`（HTML→截图）需要系统有 Chrome/Chromium**。它不受插件 `dsh install` 控制（系统级浏览器，Ubuntu 24 的 chromium 是 snap 壳），需手动装浏览器或在选单里指向已有浏览器；无浏览器时该单一工具不可用，其余视觉能力不受影响。
</details>

<details>
<summary><b>▶ dsh-jack-market · 插件市场（本仓库一键装）</b>　<code>v0.5.0</code></summary>

> **v0.5.0**：重写安装流程（学官方 dsh-plugin-manager）——改回**直接 `pnpm add <url>`**（不再 file: 本地引用绕路），安装前**快照 package.json + lockfile**，失败后**恢复快照 + frozen-lockfile 重装**洗掉坏条目，失败不污染后续安装；失败按官方分类显示原因（integrity/network/not-found 等）。
>
> **v0.4.4**：修复进度卡住——v0.4.3 的下载目标是随机临时目录且装后删除，pnpm 长期引用导致重复安装 `ENOENT`、进度条卡到超时；改为 **profile 下稳定路径**（`.dsh-market/pkgs/`）不删除，任务状态保留 30 秒，客户端以实际安装结果收尾。
>
> **v0.4.3**：根治安装失败——pnpm 对 URL 直加 tgz 在 lockfile 不写 integrity（`ERR_PNPM_MISSING_TARBALL_INTEGRITY` 的根因）；市场安装改为**先下载到本地再用 `file:` 引用安装**，lockfile 条目稳定，下载阶段实时显示 KB 数。
>
> **v0.4.2**：修复安装卡在「启动中」——`dsh plugin add` 内部是 pnpm，失败输出 `ERR_PNPM_*` 未被识别导致 UI 停在 10%；新增 pnpm 错误识别（`ERR_PNPM_`/`MISSING_TARBALL`/`lockfile`）、`Progress:` 下载中识别、3 分钟超时兜底，失败立即显示原因。
>
> **v0.4.1**：新增**安装实时进度反馈**——点击「安装 / 更新」后立即显示进度条（下载中 → 校验中 → 安装中 → ✓ 完成），host 端采集 `dsh plugin add` 子进程输出自动归类阶段；失败时立即显示具体原因，不再干等 120 秒超时。
>
> **v0.4.0**：修复带前缀 tag（如 `our-free-model-v2.5.1`）时版本号解析出错（界面曾显示 `vour-free-model-v2.5.1`、更新检测失效）；修复 `dsh-our-free-model` 等「包名与目录名不一致」的插件永远显示「未安装」；移除失效的 `dl-accel` 已并入提示；新增 GitHub API 60 秒缓存避免匿名限流刷新失败。
>
> **v0.3.2**：版本显示调整——卡片单独列出「当前版本」与「最新版本」，更清晰。
>
> **v0.3.1**：新增「更新」检测——已安装插件若仓库发了更高版本，按钮显示蓝色「更新」，点击即升级。
>
> 直接在 DSH 里浏览并一键安装本仓库的所有插件（类似内置的「插件市场」）。列出 `plugins/` 目录下当前发布的插件，自动识别已安装状态（按真实包名去 scope 与 `dsh-` 前缀），点「安装」即调 `dsh plugin add` 安装；已安装且仓库有新版时显示「更新」。
>
> 入口：**设置 → Jack 插件市场**。

**一条命令安装：**

```bash
dsh plugin --profile web add https://github.com/Jack-kd/dsh-plugins/releases/download/dsh-jack-market-v0.5.0/dsh-jack-market-plugin.tgz
```

**或者**：「插件管理 → 添加插件」粘贴下面地址，点安装：

```
https://github.com/Jack-kd/dsh-plugins/releases/download/dsh-jack-market-v0.5.0/dsh-jack-market-plugin.tgz
```

> 装完重启一次 App（让设置页入口出现）；之后打开 **设置 → Jack 插件市场** 即可浏览和安装本仓库的插件。
> **升级提示**：升级需先卸载再装新版本。
</details>

<!--

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
新插件占位模板（作者添加新插件时复制下面这段，把「新插件名/一句话说明/安装地址」改掉，
作为一条 <details> 折叠块插到上面的速查列表末尾，即最后一个 </details> 之后）：
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

<details>
<summary><b>▶ 新插件名 · 一句话说明</b></summary>

> 详细说明：它解决什么问题、在哪设置、有没有注意事项。

**一条命令安装：**

```bash
dsh plugin --profile web add <npm包名 或 https://.../xxx.tgz>
```

**或者**：「插件管理 → 添加插件」粘贴下面地址，点安装：

```
<npm包名 或 https://.../xxx.tgz>
```
</details>

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
-->

---

## 📁 仓库结构

```
dsh-plugins/
├── package.json          ← 仓库元信息（不是插件）
├── pnpm-workspace.yaml   ← 声明 plugins/* 为工作区
├── README.md             ← 本文件：插件速查 + 作者指南
└── plugins/
    ├── enter-newline/       ← 回车换行插件
    ├── retry-count/         ← 请求重试次数插件
    ├── chat-keeper-mobile/          ← 对话管理（手机版）插件
    ├── gh-accel/            ← 下载加速（GitHub + 通用，合并版）
    ├── rea-tools/           ← REA 逆向工具链（安装 + 原生/APK 逆向）
    ├── our-free-model/      ← 免费模型（免登录免 Key，第三方收录）
    ├── dsh-plugin-wallpaper-engine/ ← 壁纸引擎（本地 Wallpaper Engine 壁纸，第三方收录）
    ├── dsh-vision-router/   ← 视觉路由（给 Agent 看图，免 Key，第三方收录）
    └── dsh-jack-market/     ← 插件市场（本仓库一键安装）
```

## ✏️ 添加新插件（作者）

> 📘 规范速查：
> - [docs/插件同步规范.md](docs/插件同步规范.md) —— 更新/上传插件到本仓库：README、Releases 全流程 + 「把插件同步到我的仓库，同步规范看…」提示词
> - [docs/插件UI开发提示词.md](docs/插件UI开发提示词.md) —— 带客户端 UI（输入框上方提示框）的插件：五条铁律（尤其 `exports` 的 `"./client"` 键）+ 骨架 + 提示词

1. 在 `plugins/` 下新建目录（可复制 `enter-newline` 再改）：
   ```
   plugins/<插件名>/
   ├── package.json        # 含 dsh.bundle.patch 和（如有界面）dsh.client 声明
   ├── cordis.patch.yml    # Loader 补丁，插入插件行
   ├── index.js            # Host 半部
   ├── client.js           # （可选）客户端半部
   └── locale/ icon.svg    # （可选）显示文案与图标
   ```
2. `package.json` 的 `name` 用唯一包名（如 `@local/<插件名>`，发布 npm 时再改真实包名并去掉 `private`）。
3. 把插件目录打成内容在根的 tgz，传到本仓库的 **Releases**，然后把「安装速查」区加上这个插件的复制块（模板见上方注释）。
4. 提交推送：`git add -A && git commit -m "add: <插件名>" && git push`

## ℹ️ 说明

- 适配 DSH 0.2.0-rc.2（2026-10 构建）；其他版本安装后请先验证功能。
- 插件以本机权限运行，只安装可信来源的插件。
- 当前版本安装后不自动更新；升级需先卸载再装新版本。
