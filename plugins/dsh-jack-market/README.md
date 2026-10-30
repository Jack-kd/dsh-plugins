# dsh-jack-market

Jack-kd 的 DSH 插件市场：直接从本仓库浏览可安装的插件，并在 DSH 内一键安装（类似内置的「插件市场」）。

## 功能

- **浏览插件**：列出 `plugins/` 目录下当前发布的有效插件（与 README 安装速查一致），含版本号与简介。
- **已安装状态**：自动识别本地已安装的插件（按真实包名去 scope 比对），显示「已安装」，卡片单独列出「当前版本」与「最新版本」。v0.7.1 起区分**已安装**与**已启用**——装在磁盘但没进运行时的插件会显示「启用」按钮。
- **一键安装**：点「安装」即调用 `dsh plugin --profile web add <tgz-url>` 安装该插件，**装完自动启用**（v0.7.1）。
- **更新检测**：已安装的插件在仓库发布了更高版本时，按钮显示「更新」（蓝色），点击即重新安装升级到新版本。
- **废弃标注**：被其他插件合并的旧资源（如 `dl-accel` 已并入 `gh-accel`）会自动标注「已并入」，不再误导。

## 安装

```bash
dsh plugin --profile web add https://github.com/Jack-kd/dsh-plugins/releases/download/dsh-jack-market-v0.7.1/dsh-jack-market-plugin.tgz
```

## 使用

装完重启一次 App（让设置页入口出现），然后打开 **设置 → Jack 插件市场**。列出插件点「安装」即可一键安装；已安装的插件显示「已安装」，若仓库有新版本则显示蓝色「更新」按钮，点击即升级。

> **v0.7.1 装上即启用 + 深色模式按钮可读**
> - **「装完还要去插件页面手动启用一次」**（根因）：本市场走的是 `pnpm add`，而 pnpm 只写 `package.json` 的 `dependencies`（装到磁盘），**从不写 `dsh.profile.bundles`**（进运行时）。官方安装器装完会补一步 `selectBundle(name, true)`，本市场没有这一步，于是每个插件装完都停在「已安装但未启用」。
>   - 现在安装成功后自动把新包写进 `bundles`（复刻官方行为），并按「装前 vs 装后 dependencies 差集」精确定位包名（兼容 `@local/xxx`、`dsh-xxx`、`xxx` 三种命名）；
>   - 已装但未启用的历史插件，卡片按钮直接变成「启用」，点一下即可，无需去插件页面；
>   - 卡片会明确提示「未启用（点右侧「启用」后重启生效）」，不再用灰色「已安装」骗人。
> - **深色模式下「安装」两个字看不清**：按钮底色用 `--dsw-alias-brand-primary` 而文字写死 `#fff`。该 token 在深色主题下是**近白色**（#f9fafb），白字压白底，对比度只有 **1.05:1**（等于隐形）。
>   - 改为官方主按钮标准组合：底色 `--dsw-alias-button-primary-fill` + 文字 `--dsw-alias-label-primary-foreground`（随主题反色，深浅对比度 18.9:1 / 18.08:1）；
>   - 顺带修掉进度条（深色下用品牌色会变成近白条，几乎看不见）、阶段文字、成功/失败提示色的同类问题，深浅两套主题全部达到 WCAG AA。

> **v0.7.0 简介来源改为根 README**
> - **问题**：以前卡片上的「简介」取的是 Release 的版本更新说明（如「修复 xxx」），用户根本看不出这插件是干嘛的；
> - **修复**：改为**从仓库根 README 拉取每个插件段落的简介**（`<details>` 块里 summary 的一句话 + 正文第一段介绍）；
> - 卡片现在显示：插件名 + **一句话简介（summary）** + 完整介绍（intro）——如「视觉路由（给 Agent 看图）」+「给纯文本 Agent 一双眼睛…」；
> - 版本更新细节不再作为简介展示；README 无收录时回退到 release.body；
> - 同步给 README 里缺简介的插件（加速器 / 本插件）补了简介段，全仓库 9 个插件简介齐全。

> **v0.6.5 修复：`api()` 剥掉 query 参数——「进度卡在启动中」的最终根因**
> - **现象**：点击安装后，进度条永远停在「启动中 10%」不动，切走页面再回来才发现已安装（host 日志其实显示 `install.final done` 成功）；
> - **排查过程**（2026-10-18，四轮日志实证）：
>   1. **日志 1**：`download.fail 下载超时 耗时=30266ms` → 直连 GitHub 下载超时 → v0.6.1 移植加速器多节点选路；
>   2. **日志 2**：安装成功但 `pnpm.stage installing→[object Object]` → v0.6.2 修复 classifyStage 对象被当 stage 存 + Progress 误判 done；
>   3. **日志 3**：`download.try` 只出现 direct（镜像被 bps=0 过滤）→ v0.6.3 修复候选不过滤；
>   4. **日志 4**：9 镜像 `ENOTFOUND ghfast.tophttps`（URL 拼接错）→ v0.6.4 修复 rewriteViaMirror 尾斜杠；
>   5. **但用户仍卡**：安装成功（日志 5 显示 done）而 UI 停在「启动中」——本机端到端模拟（模拟客户端 700ms 轮询）**通过**，说明 host 逻辑正常；
>   6. **最终定位**：`api()` 用 `new URL(relative, document.baseURI).pathname` 解析请求路径——**pathname 会剥掉 query 参数**！`/dsh-jack-market/task?key=retry-count` 变成 `/dsh-jack-market/task`（key 丢失）→ host 的 handleTask 收到空 key → 返回 `{stage:'idle'}` → 客户端轮询永远拿不到 done/failed → 停在「启动中」直到超时走「已安装检测」；
>   7. 对照：gh-accel 的胶囊轮询用 `fetch('/gh-accel/progress')` 绝对路径（无 query）所以正常；我们的 task 接口依赖 query 就暴露了这 bug；
> - **修复**：`api()` 改为直接返回绝对路径（保留 query），与 gh-accel 一致；
> - **验证**：`api('/dsh-jack-market/task?key=retry-count')` = `/dsh-jack-market/task?key=retry-count`（query 保留 ✅）；
> - **历史教训**（为什么反复修不好）：前面 4 个版本修的**下载层**问题（超时/节点/拼接）都真实存在且已修复，但「进度卡住」是**客户端请求层**的独立 bug——两者叠加导致每次看似修好下载后 UI 仍卡。任何一层不通，用户感知都是「卡住」。

> **v0.6.4 修复：镜像 URL 拼接错误（镜像全挂的根因）**
> - **审计日志实证**（2026-10-18 1118 日志）：9 个镜像全部 `getaddrinfo ENOTFOUND ghfast.tophttps`——**域名拼错了**；
> - **根因**：`rewriteViaMirror` 把镜像 base 的**尾斜杠删掉**后拼接，得到 `https://ghfast.tophttps://github.com/...`（域名变 `ghfast.tophttps`）→ 解析失败；
> - **修复**：保留 base 尾斜杠 → `https://ghfast.top/https://github.com/...`（标准 prefix 代理格式）；
> - 实测：`https://ghfast.top/https://github.com/...` 下载 9206B，sha256 正确（`a4b38495` = retry-count v2.0.8）。

> **v0.6.3 修复：下载节点被错误过滤（只剩直连兜底 → 直连失败就整体失败）**
> - **审计日志实证**（2026-10-18 1105 日志）：`download.try: direct(fallback)` 后 `download.nodeFail: socket hang up`——**只试了直连，没试任何镜像**；
> - **根因**：`pickFastest` 的 probe 把 bps=0 的镜像过滤掉了，候选只剩 `direct(fallback)`；而直连 redirect 到 `release-assets.githubusercontent.com` CDN 后 socket hang up → 没有别的节点可试 → 整体失败；
> - **修复**：下载候选 = 直连 + **全部 9 个镜像**（probe 只排序不过滤），逐个尝试、成功即停；
> - 实测（2026-10-18）：直连 redirect 后不通，**5 个镜像全部 0.6~1.4s 下载成功**。

> **v0.6.2 修复：阶段判定 bug（进度卡住但实际已装的直接原因）**
> - **审计日志实证**（2026-10-18 1051 日志）：安装实际**成功**（下载 1.2s + pnpm 10.7s，`install.final done`），但日志显示 `pnpm.stage: installing→[object Object]`——阶段被序列化坏了；
> - **bug 1**：`classifyStage` 返回 `{stage, message}` 对象，但调用处把整个对象当 `stage` 存 → client 拿到的 `t.stage` 是 `[object Object]`，**永远不等于 `'done'`/`'idle'`** → 收尾判断不成立 → 进度条轮询到超时（实际已装好）；
> - **bug 2**：pnpm 的 `Progress: ... added 0` 行误判为 `done`（`added ` 关键词命中），阶段闪烁错乱；
> - **修复**：解构 stage/message 分别存储；`Progress:` 行一律归为「安装中」，只有 `Done in` / `Added N packages` 才算完成。

> **v0.6.1 移植加速器选路（下载不再卡死）**
> - **审计日志实证**（2026-10-18）：安装卡住的根因是**直连 `github.com/releases/download` 超时**（retry-count 9KB 都 30s 下不完，日志 `download.fail 下载超时 耗时=30266ms`）；
> - **修复**：把「加速器（gh-accel）」的多节点选路逻辑移植进来——并行测速直连 + 9 个加速镜像（ghfast.top / gh-proxy.com 等），选最快节点下载，失败自动降级到下一个；
> - 实测：直连 0 KB/s（不通），镜像 112ms 下载成功——安装不再卡 30 秒；
> - 下载审计新增 `download.try` / `download.nodeFail` / `download.done(via=...)` 记录实际走的节点。

> **v0.6.0 新增：审计日志导出（诊断「安装卡住」）**
> - 页面新增 **「📋 导出日志」按钮**：点击导出完整审计日志为 `.log` 文件；
> - host 端**持续记录**安装全过程（时间戳 + 相对毫秒）：请求到达、快照、下载开始/完成/失败（含耗时与字节）、pnpm spawn、每段 stdout/stderr、阶段变化、close 退出码、最终结果；
> - 用法：① 点安装 → ② 卡住 1 分钟 → ③ 点「📋 导出日志」→ 得到 `dsh-jack-market-YYYYMMDD-HHMM.log` → 发给我分析；
> - 日志含每个事件的精确时间线（`+1234ms`），能还原「卡在哪一步」。

> **v0.5.1 最终修复：改回「下载到稳定路径 → file: 引用」（实测验证）**
> - **v0.5.0 的教训**：URL 直加 `pnpm add <url>` 在**网络慢/CI 环境**下，pnpm 10.34.5 **不写 integrity** → `ERR_PNPM_MISSING_TARBALL_INTEGRITY` 反复失败（实测复现：删干净 lockfile 后 URL 直加仍失败、不写 integrity）；
> - **最终方案（实测通过）**：市场安装 = **下载 tgz 到 profile 下稳定路径**（`.dsh-market/pkgs/<key>-plugin.tgz`，不删除）→ **`pnpm add file:<稳定路径>`**（pnpm 对本地文件**永远写 integrity**、稳定成功）→ 失败时**快照恢复** package.json + lockfile；
> - 保留失败分类显示（integrity/network/not-found 等）+ 30 秒任务状态保留 + 客户端 idle 即收尾；
> - 进度条：下载中… X KB → 安装中 → ✓ 完成 / ✗ 失败+原因。

> **v0.5.0 重写安装流程（学官方 dsh-plugin-manager）**
> - **根因**（v0.4.3/0.4.4 的教训）：用「下载到本地 → `file:` 引用」绕开 pnpm 的 URL tarball integrity 坑，反而引入了临时路径被删 → `ENOENT`、lockfile 残留坏条目、进度卡住等一系列新问题；
> - **v0.5.0 改回官方做法**：直接 `pnpm add <url>`，安装前**快照 `package.json` + `pnpm-lock.yaml`**，失败后**恢复快照** + `pnpm install --frozen-lockfile` 按原 lockfile 重装——把 pnpm 写入的坏条目洗掉，**安装失败不污染后续安装**，重试永远干净；
> - 失败按官方分类显示具体原因：`integrity`（tarball 校验）/ `network` / `not-found` / `permission` / `timeout` 等；
> - 不再有「下载到本地」阶段（URL 直加，pnpm 自己下载），进度条：安装中 → ✓ 完成 / ✗ 失败+原因。

> **v0.4.4 修复：安装进度卡住 / 重复安装 ENOENT**
> - 根因：v0.4.3 把 tgz 下载到**随机临时目录**（`/tmp/jm-dl-XXX`）且安装后删除，但 pnpm 把该路径写进 lockfile 长期引用——文件被删后下次 `pnpm add` 报 `ENOENT`；且任务状态 5 秒就被清除，客户端轮询拿到 `idle` 后无法判定结果，进度条一直卡到超时；
> - 修复：下载目标改为 **profile 目录下稳定路径**（`.dsh-market/pkgs/<key>-plugin.tgz`），**不删除**，pnpm 引用长期有效；
> - 任务结束状态保留 **30 秒**（此前 5 秒太短），客户端能稳定轮询到 `done/failed`；
> - 客户端轮询到 `idle` 即停止，并以「实际是否已安装」收尾（装了显示成功，没装显示超时）——不再卡 3 分钟。

> **v0.4.3 根治：安装改为「先下载到本地 → file 引用」，彻底解决 pnpm integrity 校验失败**
> - 根因：pnpm 对「直接从 URL 添加的 tgz」在 lockfile 里**不写 integrity 字段**，安装时必报 `ERR_PNPM_MISSING_TARBALL_INTEGRITY`（pnpm 已知坑）——这就是为什么「第一次能装、之后更新必失败」；
> - 修复：市场安装**先下载 tgz 到本地，再用 `pnpm add file:...` 安装**（pnpm 对本地文件写 integrity），lockfile 条目稳定；
> - 下载阶段实时显示「下载中… X KB」，安装阶段独立显示，不再两个阶段叠在一起；
> - 下载失败立即标红（网络超时/HTTP 错误）。

> **v0.4.2 修复：安装卡在「启动中」不动的 bug**
> - 根因：`dsh plugin add` 内部是 pnpm，失败时输出 `ERR_PNPM_*`，而旧版分类器没识别这些关键词 → 安装其实失败了，UI 却一直显示「启动中 10%」；
> - 修复：分类器新增 `ERR_PNPM_` / `MISSING_TARBALL` / `lockfile` / `cannot install` 等 pnpm 错误识别，**失败立即标红并显示具体原因**；
> - 新增 `Progress:` 行识别为「下载中」，进度不再停留在「启动中」；
> - 新增 3 分钟超时兜底：超时未完成自动标失败，杜绝永久卡住。

> **v0.4.1 新增：安装实时进度反馈**
> - 点击「安装 / 更新」后**立即显示进度条**，阶段实时更新（下载中 → 校验中 → 安装中 → ✓ 完成）；
> - host 端采集 `dsh plugin add` 子进程的 stdout/stderr，按内容自动归类阶段；
> - 失败时**立即显示具体原因**（如网络错误、校验失败、退出码），不再干等 120 秒超时；
> - 成功显示「✓ 安装成功，重启 App 后生效」，按钮恢复可点。

> **v0.4.0 修复**：
> - 修复带前缀 tag（如 `our-free-model-v2.5.1`）时版本号解析出错，界面显示 `vour-free-model-v2.5.1` 且更新检测失效；
> - 修复 `dsh-our-free-model` 等「包名与目录名不一致」的插件永远显示「未安装」；
> - 移除失效的 `dl-accel` 已并入提示（该目录早已不在仓库）；
> - 新增 GitHub API 60 秒缓存，避免匿名限流（60 次/小时）导致刷新失败。

> **升级提示**：当前版本安装后不自动更新，升级需先卸载再装新版本。升级需先卸载当前版本，再装新版本。