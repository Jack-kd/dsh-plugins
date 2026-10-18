# dsh-jack-market

Jack-kd 的 DSH 插件市场：直接从本仓库浏览可安装的插件，并在 DSH 内一键安装（类似内置的「插件市场」）。

## 功能

- **浏览插件**：列出 `plugins/` 目录下当前发布的有效插件（与 README 安装速查一致），含版本号与简介。
- **已安装状态**：自动识别本地已安装的插件（按真实包名去 scope 比对），显示「已安装」，卡片单独列出「当前版本」与「最新版本」。
- **一键安装**：点「安装」即调用 `dsh plugin --profile web add <tgz-url>` 安装该插件。
- **更新检测**：已安装的插件在仓库发布了更高版本时，按钮显示「更新」（蓝色），点击即重新安装升级到新版本。
- **废弃标注**：被其他插件合并的旧资源（如 `dl-accel` 已并入 `gh-accel`）会自动标注「已并入」，不再误导。

## 安装

```bash
dsh plugin --profile web add https://github.com/Jack-kd/dsh-plugins/releases/download/dsh-jack-market-v0.5.0/dsh-jack-market-plugin.tgz
```

## 使用

装完重启一次 App（让设置页入口出现），然后打开 **设置 → Jack 插件市场**。列出插件点「安装」即可一键安装；已安装的插件显示「已安装」，若仓库有新版本则显示蓝色「更新」按钮，点击即升级。

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