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

### ▶ dsh-client-ui-skin-maid-atelier · 深海女仆工坊皮肤

> 鲸鱼娘女仆、深海蓝蕾丝与 Q 版侧栏 —— 把 DSH 变成女仆工坊（第三方皮肤，作者 Small-tailqwq，MIT 代码许可；美术素材保留版权、非商用、需署名，随包 LICENSE/NOTICE 保留）。

**一条命令安装：**

```bash
dsh plugin --profile web add https://github.com/Jack-kd/dsh-plugins/releases/download/v1.3.0/dsh-client-ui-skin-maid-atelier-plugin.tgz
```

**或者**：「插件管理 → 添加插件」粘贴下面地址，点安装：

```
https://github.com/Jack-kd/dsh-plugins/releases/download/v1.3.0/dsh-client-ui-skin-maid-atelier-plugin.tgz
```

> 皮肤类插件通常与官方/其他皮肤互斥；安装后若界面异常，先停用其他皮肤类插件。

### ▶ gh-accel · GitHub 下载加速

> 让 Harness 下载/克隆 GitHub 项目自动走加速镜像：`github_accel_download`（release 附件 / raw 文件 / 源码归档，自动对直连与多个镜像逐条测速选最快路线，大文件 8 线程分段并发下载）、`github_accel_clone`（加速 clone）、`github_accel_push`（push 时自动绕过只读镜像）。装好后自动配置 git 全局镜像改写与 pip 清华源，实测比直连快 50–70 倍。

**一条命令安装：**

```bash
dsh plugin --profile web add https://github.com/Jack-kd/dsh-plugins/releases/download/v1.4.0/gh-accel-plugin.tgz
```

**或者**：「插件管理 → 添加插件」粘贴下面地址，点安装：

```
https://github.com/Jack-kd/dsh-plugins/releases/download/v1.4.0/gh-accel-plugin.tgz
```

> 镜像（ghfast.top / gh-proxy.com / ghproxy.net）是公共第三方服务、有失效风险；可在插件配置的 `mirrors` 列表里自行增删。下载大文件建议指定绝对 `out` 路径。

### ▶ dl-accel · 通用下载加速（非 GitHub）

> 任意 URL（非 GitHub）下载加速：规则驱动自动走镜像（内置 HuggingFace hf-mirror / npm npmmirror，可在插件配置的 `rules` 里给**任意站点**加镜像）+ 多线程分段下载、失败自动重试、大小校验。与 gh-accel 分工：**GitHub 站内文件走 gh-accel，其他站点走 dl-accel**（`url_accel_download` 收到 GitHub 直链会自动引导改用 `github_accel_download`）。

**一条命令安装：**

```bash
dsh plugin --profile web add https://github.com/Jack-kd/dsh-plugins/releases/download/v1.5.0/dl-accel-plugin.tgz
```

**或者**：「插件管理 → 添加插件」粘贴下面地址，点安装：

```
https://github.com/Jack-kd/dsh-plugins/releases/download/v1.5.0/dl-accel-plugin.tgz
```

> 新装环境一次生效；若同一会话里刚装过旧版本，需重启一次 Harness 让插件模块重新加载。规则格式：`{ match: 正则, style: "prefix"|"host", mirrors: [镜像base...] }`。

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
    ├── chat-keeper-mobile/          ← 对话管理（手机版）插件
    ├── dsh-client-ui-skin-maid-atelier/ ← 女仆工坊皮肤（第三方）
    ├── gh-accel/            ← GitHub 下载加速插件
    └── dl-accel/            ← 通用下载加速插件（非 GitHub）
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
