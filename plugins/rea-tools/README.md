# @local/rea-tools —— REA 逆向工具链插件

把 **REA + Ghidra + JADX** 的逆向能力变成 DSH 原生工具：一键安装 + 原生二进制/APK 逆向。

## 工具清单

| 工具 | 作用 |
|---|---|
| `rea_install` | 安装/更新 REA+Ghidra+JADX（幂等，3–5 分钟） |
| `rea_doctor` | 就绪检查 |
| `rea_analyze` | 原生二进制/应用整体概览 |
| `rea_function` | 单函数伪代码（Ghidra） |
| `rea_inspect_apk` | APK 包信息/权限/Manifest |
| `rea_inspect_apk_class` | APK 类成员清单 |
| `rea_inspect_apk_method` | APK 方法反编译 |

## 原理

薄胶水层：插件只做「参数校验 → 调 `rea` 命令行 → 整理输出」。
环境变量（GHIDRA_INSTALL_DIR / JAVA_HOME / REA_JADX_MCP_JAR）在子进程环境显式设置，
不依赖 .bashrc 或外部包装脚本。分析均为静态（不运行目标代码）。

## 依赖

- `@deepseek-ai/dsh-tools`（工具注册，由 DSH 提供）
- 首次使用前调 `rea_install`（自动下载 Ghidra 543MB，断点续传）

## 自检

注册成功会写 `/tmp/rea-plugin-selfcheck.json`（registered/total/failed）。
