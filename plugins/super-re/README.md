# super-re · 超级逆向

**统一环境安装入口**——一个弹窗装齐 REA 逆向环境（JADX + Ghidra + apktool），**可选**勾选 Craft Anything（321 个跨格式工具）。

自带**环境配置弹窗**（REA 板块 + Craft 板块），后台下载不阻塞对话，进度实时可见，失败可重试，装完自动就绪。

> 相比 rea-tools 只装 REA：super-re 把 **REA**（安装包 / 原生二进制逆向）和 **Craft Anything**（可选：APK/原生/固件/抓包/数据库/游戏/JS）**整合进同一个安装入口**。REA 板块与 rea-tools 一致；craft 板块勾选后，REA 装完自动接 craft 安装。

## 能力分组

| 板块 | 来源 | 说明 |
|---|---|---|
| `super_setup` | 本插件入口 | 一键安装「REA + 可选 Craft」：`--tier` basic/full、`--craft`，与弹窗行为一致 |
| REA 逆向环境 | rea-tools 同款 | JADX（APK→Java）、Ghidra（ELF→伪代码）、apktool（解包/回编）、rea-agents |
| Craft Anything | [storytold/craft-anything](https://github.com/storytold/craft-anything) | 可选 · 321 个跨格式工具 |
| `craft_*` 工具壳 | 本插件 | 把 Craft Anything 包装成 DSH 原生工具（通用桥 + 精选入口），胶囊显示 `Craft · …` |

## Craft 工具壳（`craft_*`）

> v0.1.6 起，super-re 把 Craft Anything 的 **CLI** 包装成 DSH 原生工具，AI 可直接调用，工具执行时输入框上方胶囊显示 **`Craft · 操作名…`**（不再误标 REA）。

**调制方式**：每个 `craft_*` 工具内部 spawn `craft-anything-cli --deep …`（Deep 模式，能读原目标）。craft-anything 走 `/opt/craft-anything/bin/craft-anything-cli`（可用环境变量 `CRAFT_ANYTHING_CLI` 覆盖）。

### 工具清单

| 工具 | 说明 | 依赖 |
|---|---|---|
| `craft_call` | **通用桥**：调任意一个 Craft 工具（321 个）。`tool` 传工具名、`args` 传 JSON 参数 | craft 已装 |
| `craft_doctor` | 检查安装 / 引擎 / MCP 服务器就绪 | craft 已装 |
| `craft_capabilities` | 列出支持的工具集与每个引擎是否就绪 | craft 已装 |
| `craft_commands` | 列出每一个 Craft 工具及用途 | craft 已装 |
| `craft_triage` | 打开一个文件快速审视（无需先建 target） | craft 已装 |
| `craft_targets` / `craft_target_open` / `craft_target_close` | 管理 Craft 目标（target）清单 | craft 已装 |
| `craft_rebuild_start` | 照着一个目标（网站 URL / 文件）重建一个新工程 | craft 已装 **+ 需配置 AI backend** |

> 说明：craft-anything 按 **stdio 子命令逐个 spawn** 调用，target 会话不跨进程保持，因此 `craft_target_*` + 依赖 target 的深度分析是"单命令自足"的才顺手。真正要长会话全量 321 工具，可把 `/opt/craft-anything/bin/craft-anything-cli mcp` 当成一个 stdio MCP server 注册（DSH 有 `@deepseek-ai/dsh-mcp-client`）——那会注册成 `mcp__craft__…` 工具，与本插件的 `craft_*` 并存。

### 已知边界（实测）

- **APK 逆向优先用 REA/JADX**：craft-anything 0.4.0 对现代 APK 的 ZIP 对齐扩展字段解析有 bug（`ZIP truncated: extra field header`），`android-*` 工具读不了真实 APK；`core_target_open` 也因此在 APK 上报 `not_supported`。真正的 APK→Java/方法反编译请走 `rea_inspect_apk_*`。craft 的强项是**跨格式**：WebAssembly、智能合约（EVM/sBPF）、固件、游戏档案（Unreal/Unity/IL2CPP）、网络抓包、无线电解码等。
- **`craft_rebuild_start`（重建工程）需要 AI backend**：craft 要用一个 coding-agent 来研究目标并重建。当前环境未配时 `ai list` 为空、`builder:null`。要启用：`craft-anything-cli ai add --kind openai_compatible --model … --key-env … <name>`（如 DeepSeek 的 OpenAI 兼容端点），再 `ai builder <name>`。未配前调用 `craft_rebuild_start` 会因缺 backend 而无法真正重建。
- **清洁室/深读**：craft 默认 Clean room 不读原目标；本插件统一加 `--deep` 开启深读。若某些工具仍需你本地授权（如 `consent_required`），是 craft 的安全策略，可自行改 Settings。

## 安装入口弹窗

首次准备逆向环境时，自动弹出**超级逆向环境需要准备**：

- **REA 板块**：初级版本（JDK + rea-agents + JADX + apktool） / 升级版本（+ Ghidra + 反编译器），radio 单选。
- **Craft 板块**：独立 checkbox，勾选后 REA 装完**串行**接着装 Craft Anything。
- **记住我的选择，以后不再询问**：勾选后不再弹窗。

后台安装的进度以胶囊形式显示在输入框上方（阶段 / 百分比 / 速度 / 日志），可随时取消。

## 安装

```bash
dsh plugin --profile web add https://github.com/Jack-kd/dsh-plugins/releases/download/super-re-v0.1.6/super-re-plugin.tgz
```

装完后首次准备环境弹窗即出现；也可在**设置 → 通用**里通过「安装超级逆向环境」重新打开。

## 说明

- **与 rea-tools 的关系**：super-re 接管 REA 安装入口（rea-tools 退居）。两者**不要同时装**——工具名 `rea_*` 相同会冲突；请用 super-re 作为统一入口。
- **rea-craft-mix 已并入**：原来的融合插件 rea-craft-mix 已删除，其 craft 侧能力由本插件的 `craft_*` 工具壳承接（super-re 直接用 craft-anything 的 CLI，不必再装一个融合插件）。
- Craft Anything 走官方 GitHub Release（aarch64/x86_64 自适应，SHA256 校验），安装到 `/opt/craft-anything`，软链到 `/usr/local/bin`。
- 幂等：REA 与 Craft 均「已装就跳过」，不会重复下载覆盖。

## 协议

MIT
