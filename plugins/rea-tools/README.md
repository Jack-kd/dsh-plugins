# @local/rea-tools —— REA 逆向工具链插件

把 **REA + Ghidra + JADX** 的逆向能力变成 DSH 原生工具：一键安装 + 原生二进制/APK 逆向。

**v0.2.10**：**深度复查修复——消除选项状态泄漏 + 补全进度阶段覆盖**（全面重读了 install-manager.js / index.js / client.js / install-rea-ghidra.sh）：

- **`rea_install` 的 `--compile` / `--install-dir` 选项状态残留（真 bug）**：旧实现把这两个选项写进全局 `process.env`（`REA_FORCE_COMPILE` / `REA_INSTALL_DIR`）且**从不清除**。`process.env` 是进程级单例，于是用户某次用 `--compile` 装过后，之后再跑裸 `rea_install()` 仍会被残留值污染——**静默地改走源码编译 / 改安装目录**，用户毫无察觉。同理 `--skip-rea` 写的 `REA_SKIP_REA` 是**死代码**（脚本从不读它，`ghidra-only` 靠 tier → `--skip-rea` 参数正确工作）。现改为**把这三个选项直接作为第 5 个参数 `opts` 传给 `startInstall`**（`{compile, installDir}`），完全不碰全局环境变量，零残留；`doInstall`（命令/HTTP 路径）本就从没设过 env，行为不变。
- **x86_64 反编译器阶段漏标记（进度显示小瑕疵）**：`parseLine` 的反编译器阶段正则没覆盖脚本的 `x86_64 发布包自带反编译器，无需处理` 这行——x86_64 上反编译器是 GitHub 发布包自带的、无需下载，但该阶段既没 `setStage` 也没 `markDone`，进度分母里始终含这 2MB 而分子一直加不上，百分比会卡在 99%（直到「安装完成」才一次性到 100）。补上对 `x86_64…自带反编译器` 的识别：既正确设阶段（label「x86_64 反编译器（自带）」）、又直接 `markDone`。
- **`rea-agents` 版本号硬编码误导**：脚本用 `npm install --global rea-agents` 装**最新版**（从不钉死版本），而 UI 弹窗里却硬显示 `rea-agents 6.5.0`（`VERSIONS.rea` 常量）——实际装到的常是更高版（如 6.7.0），展示是错的。`rea` 这项现在**不再显示具体版本号**（JADX/Ghidra 是脚本钉死的版本，仍如实显示）。

**v0.2.9**：修复**「设置页点『安装环境』弹窗被设置页盖住，必须关掉设置页才能看到」**：

- **根因**：安装弹窗挂在 `shell.overlay` 全屏浮层，而该容器自身 `z-index` 仅 **20**（`ui-layout` 的 `.pI_x6G_overlayLayer`），并且它**会形成独立的层叠上下文（stacking context）**——弹窗内部哪怕把 `z-index` 设成 60，也被锁在这层低 z-index 上下文里出不去。而 DSH 的设置页抽屉是**更高层的独立浮层**，于是弹窗被压在设置页之下，表现为「得先关掉设置页才看得到弹窗」。
- **修复**：弹窗改用 **`React.createPortal` 直接渲染到 `document.body` 顶层**，z-index 提到 9999——**彻底脱离 shell.overlay 那层低 z-index 容器**的层级束缚，无论设置页是多高的浮层都能悬浮在其之上。进度详情面板（同一套 overlay）也一并修复。
- 兼容保护：若运行时 `ReactDOM.createPortal` 不可用则自动回退到原渲染方式，不崩。
- **「稍后再说」关闭前文案闪变**：点「稍后再说 / 保留 / 删除」这类非安装动作时，`busy` 标志也被置 `true`，导致弹窗关闭前一帧「后台安装…」误变成「正在启动…」。现在这些动作走新增的 `noBusy` 分支，**不触碰 busy 状态**（`busy` 只保留给真正会启动安装/下载的 install 动作，用于禁用防重复提交），软按钮文案不再闪变。
- **弹窗关闭不顺手 / 系统返回键关不掉**：在 DSHA（`com.dsh.client`）这类**原生壳内嵌 WebView** 里，系统返回手势由 App 壳的 `onBackPressed` 接管（用来切换页面/回到工作区），返回键不会作为 `popstate` 传给壳内网页——所以插件侧无法用「系统返回」可靠地关掉网页内弹窗。现改为**更自然、不依赖系统返回的关闭方式**：① **点弹窗/面板外的遮罩空白处即可关闭**（Android 用户最习惯的手势）；② 「稍后再说」等关闭按钮**同步立刻收起 UI**（不再等网络往返，杜绝「点了没反应/卡住」）。进度详情面板同理：点面板外可收起，且不取消安装。
- **安装进度胶囊大改（双进度条 + 速度 + 当前工具名 + 顺滑动画）**：此前胶囊只有一条总进度条，下载多个工具时看起来「忽 1%、忽 64%」像在倒退。现在改成：① **当前正在下载的那个工具**有一条进度条（细/绿色，工具内 0→100 顺滑递增）；② **总进度**（跨全部工具按体积加权）一条进度条（粗/蓝色）；③ 顶部显示**当前下载的工具名**；④ 底部显示**已下载体积 + 实时下载速度**（KB/s/MB/s，1.5s 采样、平滑平均，不突变）。进度条宽度带 CSS 过渡动画，不再跳大段。安装中客户端 1s 轮询刷新，保证进度和速度跟手。
- **修复「Ghidra 装完却显示未安装/提示『升级到升级版本』」**：**根因**是解压分支 bug——系统**没有 `unzip`** 时脚本走 `jar xf` 分支，且它在 `INSTALL_DIR` 目录**内部**解压；而 Ghidra zip 的顶层目录本身就是 `ghidra_12.1.4_PUBLIC/`，于是解压出 `INSTALL_DIR/ghidra_12.1.4_PUBLIC/` 的**嵌套目录**，`Ghidra/application.properties` 落进内层，探测路径找不到 → 判定「没装 Ghidra」→ UI 一直显示「升级到升级版本」。现改为**无论 unzip 还是 jar 都先解压到临时根目录，再把内容展平搬到位**（含罕见双嵌套的自动展平兜底），并以 `application.properties` 是否就位做硬校验，杜绝错位后静默误判。
- **下载加速接入 gh-accel？——实测后回退**：曾尝试把 GitHub 大文件（Ghidra/JADX/反编译器）下载接入 `@local/gh-accel` 的多线程 Range 分片（新增 `download-accel.mjs` 桥、让 `download_resume` 优先进它、失败回退 curl）。但**实际对比测速**：脚本原生 `ghfast.top` 镜像 + 单线程 curl 下 JADX 40MB 稳定 **14~30s（≈2.9MB/s）** 成功；而 gh-accel 多线程（8 分片）**167s 仍失败**（分片被源 hold 住、降级也失败、文件未落盘）——多线程 Range 分片对当前环境这类加速源支持不完整。**结论：在这里接入 gh-accel 反而更慢且失败，因此回退，保留原生 ghfast 单线程下载。**（记录在此供日后网络环境变化时参考，勿盲目重引入。）

**v0.2.8**：修复**「首启不自动弹窗」+「设置页安装按钮点了没反应」**（三个 bug 叠加）：

1. **弹窗永远不出现（根因）**：旧版把安装弹窗注册在 `conversation.composer`。该插槽在 `ui-conversation` 里声明为 **chain**（`kind: 'chain'`），而 `SlotCore.register` 对 chain **强制要求 `options.select`**，缺了直接抛 `chain slot "conversation.composer" requires options.select`。抛错发生在 `slots.inject` 的回调里，**只进 console** —— 注册整体不生效，所以「装完重启该自动弹窗却没弹」。
   现在改挂 `shell.overlay`（`ui-layout` 声明的 **list / root** 插槽，官方全屏浮层席位，插件的 refresh toast、chat 的配额提示都用它），既合法、也不会像 composer 那样抢走输入区。
2. **按钮点了没反应（根因）**：所有按钮都走 `ctx.remote.commands.execute(sessionId, '/rea-install-*')`，有两个硬前提——**必须有一个可用会话**、且命令已注册。设置页是 root 作用域、拿不到 sessionId，`anySessionId()` 一旦返回 `undefined` 就直接 `{ ok:false }`；而**所有失败都被 `try/catch` 吞成返回值，UI 完全没提示**。
   现在状态与动作统一走宿主新增的两个 HTTP 端点（`GET /rea-tools/state`、`POST /rea-tools/action`，同源校验 + 固定 action 白名单），**与会话完全解耦**，设置页和浮层共用一套；动作失败一定在弹窗里显示红字原因，不再静默。
3. **「记住我的选择」永远是假的**：命令 handler 收到的是 **invocation 对象**（`{ commandId, agent, rawInput, attachments, signal }`），旧版却当字符串做 `/--no-remember/.test(argsRaw)` → 恒为 `false`，取消勾选也照样写 `dismissed=true`。现在从 `invocation.rawInput` 取，实测「勾选 → 写入 dismissed」「取消勾选 → 不写入」两条都正确。

> 顺带修掉的结构性问题：设置页曾自维护一份 `showDialog` 局部 state，与宿主状态各自为政；现在**只有一个状态源**（宿主实时计算的 `showDialog`），自动弹窗与手动入口行为一致。

**v0.2.7**：新增**「逆向分析优选规则」系统提示**——与加速器的「文件下载优选规则」同一套注入机制。现在 AI 遇到用户要求「分析/逆向/反编译」时会**确定地**调 rea 工具：
- APK（.apk）→ `rea_inspect_apk` 系列（包名/权限/类/方法，静态）
- 原生二进制（.so / ELF / 可执行）→ `rea_analyze`（概览）或 `rea_function`（指定函数反编译）
- 环境未装 → 提示先 `rea_install`
- 规避了 gh-accel 踩过的两个注入坑（section 作用域 + order 必填），失败会显式告警

**v0.2.6**：**深度审查修复（UI + 后端）**，共 9 项：

**UI 层**
- **安装弹窗复选框「假选择」**：旧版允许只勾 JDK/rea/JADX 其中一项，按钮仍按 `tier=basic` 提交，而 host 走 `--skip-ghidra` 会**装齐三项**——用户的选择等于没生效。现在中间态直接禁用安装并给出说明（三项是固定组合）。
- **设置页「查看进度」点了没反应**：`onOpen` 是空函数 `() => {}`。现在置全局「打开详情」请求，胶囊/面板跨插槽消费（`settings.general.item` 是 root scope，与会话级 store 不互通，旧版即使写了标志也到不了面板）。
- **「记住我的选择」无效**：`onInstall(tier, remember)` 传了但 `reaActions.install(tier)` 只收一个参数。现在透传 `--no-remember`，host 侧按需写 `dismissed`。
- **ghidra-only 时进度面板阶段为空**：旧版只判断 `targetTier === 'full'`，漏了 `ghidra-only`，面板里不显示 Ghidra 阶段。已补齐。
- **安装完成毫无提示**：胶囊直接消失，用户不知道成没成。现在结束后显示 15 秒「✓ REA 逆向环境已就绪」/「✗ 安装失败：原因」。
- **取消确认框点了不关**：点「保留/删除」后 `askCancel` 仍为 true，按钮卡在确认态。已修复。

**后端层**
- **ghidra-only 进度分母错**：脚本 `--skip-rea` 仍会装 JDK，但 `computePercent` 只算 `[ghidra, decompiler]`，导致百分比虚高。已改为 `[jdk, ghidra, decompiler]`。
- **版本号/体积硬编码散落 4 处**：`12.1.4`/`0.7.1`/`20260921` 分别在 `PATHS`、index.js `ENV_DEFAULTS`、client.js `ITEMS` 里重复写死，升级时极易漏改。现在集中到 `VERSIONS` 常量，`PATHS` 由它生成，client 从投影 `versions`/`sizes` 读取。
- **死代码清理**：`INSTALL_SCRIPT` 在 `rea_install` 改后台后已无人使用，删除。

**v0.2.5**：一轮健壮性修复，解决「装了很久看不到进度 / 卡住 / 取消不干净」：

- **进度卡住（最重要）**：旧实现靠正则解析 curl 的进度行，但脚本用 `2>/dev/null` 把 curl 输出（含错误信息）全丢了 → 进度永远 0。现改为**每 1.5 秒轮询输出文件大小**算进度（已下载 MB / 阶段总量），并让脚本用 `--no-progress-meter` 保留真正的错误输出（404/超时/证书失败不再被吞）。
- **`stageMB` 反复清零**：同阶段多行日志都会触发阶段切换逻辑，导致进度被反复重置。现在只在阶段**真的变化**时清零。
- **`rea_install` 改后台非阻塞**：旧工具同步阻塞 1200 秒，543MB 下载正好卡超时临界点（超时即 kill、下载中断），与「安装不占用工具调用」的设计自相矛盾。现在改为启动后台安装后立即返回，进度看胶囊或 `rea_status`。
- **取消安装杀整棵进程树**：spawn 加 `detached`，取消时用 `process.kill(-pid)` 带走 curl/tar/apt/npm 子进程；旧版只 kill bash，子进程变孤儿继续占带宽写文件。
- **修复失败后无限续传**：`resumable` 现在要求「无 lastError + 失败次数 < 3」，并累计 `failCount`；旧版进程崩溃时 `installing` 残留 true，下次启动又自动续传 → 再失败 → 死循环。
- **新增磁盘空间预检**：下载前检查 `/var/cache`（≥900MB）与 `/opt`（≥500MB）可用空间，不足直接给明确提示，避免下到一半失败还留坏缓存。
- **`rea_doctor` 不再吞真崩溃**：`tolerateExit` 从裸 `; true` 改为记录退出码，信号终止（OOM/段错误）会提示输出可能不完整。
- **自检文件移到插件目录**：原来写 `/tmp/rea-plugin-selfcheck.json`，重启即丢且多用户冲突。

**v0.2.4**：胶囊布局改为**两行**——第一行「REA · 操作名…」，第二行显示正在分析的目标文件名（从 `apk` / `path` 参数提取 basename，灰色小字，超出省略）；无文件参数的工具（如 `rea_doctor`）只显示一行。

**v0.2.3**：rea 工具执行中的胶囊**显示具体操作名**，如「**REA · 分析 APK…**」「**REA · 反编译函数…**」「**REA · 分析二进制…**」，并发执行时显示最近一次操作。

**v0.2.2**：任一个 `rea_*` 工具（如 `rea_inspect_apk`、`rea_analyze`）被实际调用时，输入框上方显示「**REA 逆向中…**」胶囊（带呼吸光点），工具返回后自动消失——和「加速器」插件的下载状态小框同一套交互。

**v0.2.1**：设置页「REA 逆向环境」未安装时点击会**弹出初级/升级选择弹窗**（与首次弹窗一致），方便「稍后再说」后再装；已就绪文案改为「**当前版本**：APK 逆向 + 原生二进制逆向」。

**v0.2.0**：新增**环境准备弹窗与后台安装**。首次打开新环境自动弹出「REA 逆向环境需要准备」，
可选 **初级版本**（JDK + rea-agents + JADX，APK 逆向，约 239 MB）或 **升级版本**（+ Ghidra 12.1.4，
原生二进制逆向，约 784 MB）；选择后可**后台安装**（不阻塞对话），输入框上方实时显示进度胶囊，
点击可看详细阶段/百分比/当前源；完成发送提示。设置 → 通用 → REA 逆向环境 提供重新安装/升级入口
（初级装完可在那里一键升级到升级版本）。取消安装时会弹窗让你选择「保留已下载（下次续传）」还是「删除」。

## 工具清单

| 工具 | 作用 |
|---|---|
| `rea_install` | 安装/更新 REA+Ghidra+JADX（幂等，后台） |
| `rea_doctor` | 就绪检查 |
| `rea_analyze` | 原生二进制/应用整体概览 |
| `rea_function` | 单函数伪代码（Ghidra） |
| `rea_inspect_apk` | APK 包信息/权限/Manifest |
| `rea_inspect_apk_class` | APK 类成员清单 |
| `rea_inspect_apk_method` | APK 方法反编译 |
| `rea_status` | 查询环境状态 / 进度 / 是否已装 |

## 原理

薄胶水层：插件只做「参数校验 → 调 `rea` 命令行 → 整理输出」。
环境变量（GHIDRA_INSTALL_DIR / JAVA_HOME / REA_JADX_MCP_JAR）在子进程环境显式设置，
不依赖 .bashrc 或外部包装脚本。分析均为静态（不运行目标代码）。

安装脚本（`install-rea-ghidra.sh`）走**镜像优先 + 超慢自动中断**策略：大文件优先从 ghfast.top
等加速镜像下载（实测 473 KB/s），直连慢源自动 `--speed-limit` 中断；全部断点续传。

## 依赖

- `@deepseek-ai/dsh-tools`（工具注册，由 DSH 提供）
- `@deepseek-ai/dsh-client-ui-conversation` / `@deepseek-ai/dsh-client-ui-settings-general`（客户端插槽，由 DSH 提供）
- 首次使用自动弹窗后台安装（可选初级/升级版本）；也可手动调 `rea_install`

## 状态机

- 首次（tier=none 且未忽略）：自动弹窗，选版本后台安装，完成后不重复弹。
- 「稍后再说」：仅在设置 → 通用 → REA 逆向环境 里可装。
- 中断/失败：下次进入**静默续传**（不弹窗），已下载部分复用。
- 取消：弹窗选择「保留已下载」或「删除已下载」。

## 自检

注册成功会写 `/tmp/rea-plugin-selfcheck.json`（registered/total/failed）。