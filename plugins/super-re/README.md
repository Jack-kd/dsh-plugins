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

## 安装入口弹窗

首次准备逆向环境时，自动弹出**超级逆向环境需要准备**：

- **REA 板块**：初级版本（JDK + rea-agents + JADX + apktool） / 升级版本（+ Ghidra + 反编译器），radio 单选。
- **Craft 板块**：独立 checkbox，勾选后 REA 装完**串行**接着装 Craft Anything。
- **记住我的选择，以后不再询问**：勾选后不再弹窗。

后台安装的进度以胶囊形式显示在输入框上方（阶段 / 百分比 / 速度 / 日志），可随时取消。

## 安装

```bash
dsh plugin --profile web add https://github.com/Jack-kd/dsh-plugins/releases/download/super-re-v0.1.4/super-re-plugin.tgz
```

装完后首次准备环境弹窗即出现；也可在**设置 → 通用**里通过「安装超级逆向环境」重新打开。

## 说明

- **与 rea-tools 的关系**：super-re 接管 REA 安装入口（rea-tools 退居）。两者**不要同时装**——工具名 `rea_*` 相同会冲突；请用 super-re 作为统一入口。
- **与 rea-craft-mix 的关系**：super-re 负责「装环境」，rea-craft-mix 负责「装完后两套引擎的融合调度」。若你也要融合，可同时装 rea-craft-mix（它只探测、不装）。
- Craft Anything 走官方 GitHub Release（aarch64/x86_64 自适应，SHA256 校验），安装到 `/opt/craft-anything`，软链到 `/usr/local/bin`。
- 幂等：REA 与 Craft 均「已装就跳过」，不会重复下载覆盖。

## 协议

MIT
