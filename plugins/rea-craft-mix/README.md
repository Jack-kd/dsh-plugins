# rea-craft-mix

REA 与 Craft Anything 0.4.0 的**融合插件**——让两套逆向引擎在同一套工具命名空间下协同工作。

REA（JADX + Ghidra）擅长**深度反编译**（APK→Java、ELF→伪代码）；Craft Anything 拥有 **321 个跨格式逆向工具**（Android/原生/固件/抓包/数据库/游戏/JS 等）。本插件把它们统一调度，并让一端直接复用另一端的引擎。

## 能力分组

| 前缀 | 来源 | 说明 |
|---|---|---|
| `rea_*` | REA | APK/JAR 深度反编译、原生 ELF 伪代码 |
| `cad_*` | Craft Anything（精选薄壳） | triage / 原生函数伪代码 / 固件 / 抓包 / 数据库 / 游戏 / JS / Android 资源 |
| `mix_*` | 融合专用 | `mix_doctor` 统一引擎就绪检测、`mix_inject` 重跑路径注入、`mix_rebuild` REA分析→CA重建 |

## 环境配置（本插件的核心价值）

Craft Anything 默认**不会**自动扫到 REA 装好的引擎（Ghidra 例外，能自动发现）。本插件通过在调用 craft-anything 前执行：

```
craft-anything-cli settings-set --key engines.tools.jadx      --value "<REA的jadx jar路径>"
craft-anything-cli settings-set --key engines.ghidra.java_home --value "<REA的java路径>"
```

把 REA 的 JADX / Java 路径**注入**到 craft-anything 配置里，实现两端共享同一批引擎（`install-manager.js` 完成探测与注入，幂等）。

**探测路径假设**（可自行改 `install-manager.js` 的 `CANDIDATES`）：

| 引擎 | 默认路径 |
|---|---|
| REA | `rea`（PATH） |
| Craft Anything | `craft-anything-cli`（PATH） |
| Ghidra | `/opt/ghidra_12.1.4_PUBLIC` |
| JADX | `/opt/rea-install-kit/jadx-headless-mcp-0.7.1-all.jar` |
| Apktool | `/opt/rea-install-kit/apktool_2.9.3.jar`（可选，缺了不影响核心） |
| Java | `java`（PATH） |

## 安装

1. 分别装好 REA 与 Craft Anything（见各自主线）。
2. 用 `dsh plugin --profile web add` 安装本插件，或在 plugins 目录下引用源码。
3. 首次使用前调一次 `mix_doctor`，自动完成引擎探测 + 路径注入。

## 说明

- `cad_*` 工具在分析时统一附加 `--deep`，让 AI 真正读到代码 / 资源（clean-room 语义由用户显式关闭。）
- Craft Anything 完整 321 工具仍可通过其自带 MCP server 直接暴露；本插件精选其中最常用的一批做成原生工具，兼顾易用与轻量。

## 协议

MIT