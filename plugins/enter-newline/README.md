# enter-newline · 回车换行插件

一个 DeepSeek Harness（DSH）客户端插件：把输入框的**回车键从「发送」改成「插入换行」**。

- 默认：回车 = 换行（不再发送消息）
- 发送方式不变：Ctrl/⌘ + Enter、右下角发送按钮
- Shift + Enter 仍是换行
- 设置开关：**设置 → 通用设置 → 回车键**（可切回「回车发送」）

## 行为细节

- 手机（软键盘）同样生效：拦截时不会打断输入法合成，文字不会被清空。
- 拼音/中文输入法下，第一下回车是「提交拼音」（所有 App 都一样），第二下才是换行。
- 偏好保存在浏览器 localStorage（`dsh.enter-newline.behavior.v1`），重启后保留；多标签页自动同步。
- **浏览器要求**：换行依赖浏览器原生的 `beforeinput`（`InputEvent.inputType`）——现代 Chrome/Edge/Safari（≥2017）与 Firefox（≥87）都支持。更老的浏览器/部分嵌入式 WebView 不支持时，插件自动退化为「回车发送」（设置页会提示，开关置灰），不会出现「按回车没反应」。
- **与官方「忙碌时回车」的关系**：本插件只管「回车=发送还是换行」，官方「Composer Enter」管的是回答忙碌时的行为（排队/引导），两者独立、互不影响。开启本插件后，回答运行中想发送或引导请按 **Ctrl/⌘+Enter**（此时它走「加速提交/引导」路径）或点右下角发送按钮，而不是回车。
- 备注：本插件拦截后不调用 `preventDefault`，只阻止事件继续传播，因此不会取消手机输入法合成，也不会触发 `execCommand` 等已被废弃的路径。

## 更新记录

### v1.0.1（2026-10）

- 修复：不支持的浏览器（无 `InputEvent.inputType`/Firefox<87/老 Safari/部分 WebView）下回车会「完全没反应」——新增能力检测，自动退回「回车发送」并在设置页提示。
- 新增：偏好跨标签页同步（监听 `storage` 事件）。
- 修复：移除对 `[data-conversation-composer-overlay]`（轨迹视图覆层）的无效让行判断（该覆层渲染在卡片外，原先的 `querySelector` 永远查不到，属死代码）。
- 文案：设置行描述补充与官方「忙碌时回车」的区分、运行中发送/引导的使用方式。
- 版本号 1.0.0 → 1.0.1。

## 目录内容

| 文件 | 作用 |
|---|---|
| `package.json` | 包清单 + `dsh.bundle.patch` + `dsh.client` 声明 |
| `cordis.patch.yml` | Loader 补丁：插入 `enter-newline` 插件行 |
| `index.js` | Host 半部（空实现） |
| `client.js` | 客户端半部：回车拦截 + 设置行 |
| `locale/{zh,en}.json` | 插件管理页的显示文案 |
| `icon.svg` | 图标 |

## 安装

### 方式一：本地目录（最快，适合直接发给朋友）

把整个 `enter-newline` 目录放到对方机器上（例如 `/mnt/local/enter-newline`），然后在 DSH 的
**插件管理（Plugins）页面 → 添加插件** 里填该**绝对路径**；或在对方 DSH 终端里执行：

```bash
dsh plugin --profile web add /mnt/local/enter-newline
```

### 方式二：Git 仓库

把本目录推送到 GitHub/Gitee 等仓库，对方在「添加插件」里填仓库地址，或执行：

```bash
dsh plugin --profile web add https://github.com/<你>/enter-newline.git
```

### 方式三：npm 发布（像官方插件一样安装）

1. 编辑 `package.json`：
   - 删除 `"private": true`
   - 把 `"name": "@local/enter-newline"` 改成可发布的包名，如 `enter-newline` 或 `@<你的组织>/enter-newline`
2. 发布：`npm publish`（或 `pnpm publish`）
3. 对方安装：`dsh plugin --profile web add enter-newline`，或在「添加插件」里填包名

## 注意事项

- 插件以本机权限运行，只从可信来源安装。
- 本插件无依赖、不联网、不读文件；只监听输入框的回车键并在设置里放一个开关。
- 当前版本安装后不会自动更新：升级需先卸载再装新版。
- 适配 DSH 0.2.0-rc.2（2026-10 构建）；其他版本首次安装后请先验证「回车换行」和设置开关。
