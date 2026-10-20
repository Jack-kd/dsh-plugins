# @local/rea-tools —— REA 逆向工具链插件

把 **REA + Ghidra + JADX** 的逆向能力变成 DSH 原生工具：一键安装 + 原生二进制/APK 逆向。

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