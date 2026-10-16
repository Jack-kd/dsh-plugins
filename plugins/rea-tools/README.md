# @local/rea-tools —— REA 逆向工具链插件

把 **REA + Ghidra + JADX** 的逆向能力变成 DSH 原生工具：一键安装 + 原生二进制/APK 逆向。

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