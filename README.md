# dsh-plugins

Jack-kd 的 DeepSeek Harness（DSH）插件仓库 —— monorepo 结构：**一个仓库放多个插件**，
每个插件是一个独立完整的 bundle，统一放在 `plugins/` 目录下。

---

## 📦 安装速查（看中哪个直接复制）

### ▶ enter-newline · 回车换行

> 把 DSH 输入框的回车键从「发送」改为「插入换行」；可在 **设置 → 通用设置 → 回车键** 切回「回车发送」。手机、电脑通用，不打断手机输入法。

**一条命令安装：**

```bash
dsh plugin --profile web add https://github.com/Jack-kd/dsh-plugins/releases/download/v1.0.0/enter-newline-plugin.tgz
```

**或者**：「插件管理 → 添加插件」粘贴下面地址，点安装：

```
https://github.com/Jack-kd/dsh-plugins/releases/download/v1.0.0/enter-newline-plugin.tgz
```

> 装完无需重启，到输入框按一下回车即可验证（拼音输入法第一下是提交拼音，第二下才换行，属正常现象）。

### ▶ retry-count · 请求重试次数

> 修改模型请求重试上限（默认 5）。在 **设置 → 通用设置 → 模型请求重试次数** 输入次数（如 10）点修改，或 **插件管理 → 请求重试次数 → 配置** 里改，立即生效。支持 deepseek 与 pi-ai（日日新）提供商。

**一条命令安装：**

```bash
dsh plugin --profile web add https://github.com/Jack-kd/dsh-plugins/releases/download/v1.1.0/retry-count-plugin.tgz
```

**或者**：「插件管理 → 添加插件」粘贴下面地址，点安装：

```
https://github.com/Jack-kd/dsh-plugins/releases/download/v1.1.0/retry-count-plugin.tgz
```

> 装完重启一次 App（让设置页入口出现）；之后改次数实时生效，无需再重启。卡顿重试提示会变成「已重试模型请求（1/10）」。

### ▶ chat-keeper-mobile · 对话管理（手机版）

> 跨工作区对话总表、正文搜索、批量归档、可恢复删除（回收站），以及会话「…」菜单里的「删除会话」。入口：**设置 → 对话管理**（基于 Sky-lll27 的 DSH-chat-keeper 客户端适配手机布局，Host 能力一致）。

**一条命令安装：**

```bash
dsh plugin --profile web add https://github.com/Jack-kd/dsh-plugins/releases/download/v1.2.0/chat-keeper-mobile-plugin.tgz
```

**或者**：「插件管理 → 添加插件」粘贴下面地址，点安装：

```
https://github.com/Jack-kd/dsh-plugins/releases/download/v1.2.0/chat-keeper-mobile-plugin.tgz
```

> 装完重启一次 App（工具 + 删除/恢复接口生效）。删除默认进回收站，可 `conversation_restore` 恢复；正在对话的会话删除会中断它（确认后执行）。

<!--
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
新插件占位模板（作者添加新插件时复制下面这段，把「新插件名/一句话说明/安装地址」改掉，
插到上面的速查列表里；不要放进 HTML 注释里，直接贴在列表末尾即可）：
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

### ▶ 新插件名 · 一句话说明

> 详细说明：它解决什么问题、在哪设置、有没有注意事项。

**一条命令安装：**

```bash
dsh plugin --profile web add <npm包名 或 https://.../xxx.tgz>
```

**或者**：「插件管理 → 添加插件」粘贴：`<npm包名 或 https://.../xxx.tgz>`

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
    └── chat-keeper-mobile/  ← 对话管理（手机版）插件
```

## ✏️ 添加新插件（作者）

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
