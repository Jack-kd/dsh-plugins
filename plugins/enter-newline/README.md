# enter-newline · 回车换行插件

一个 DeepSeek Harness（DSH）客户端插件：把输入框的**回车键从「发送」改成「插入换行」**。

- 默认：回车 = 换行（不再发送消息）
- 发送方式不变：Ctrl/⌘ + Enter、右下角发送按钮
- Shift + Enter 仍是换行
- 设置开关：**设置 → 通用设置 → 回车键**（可切回「回车发送」）

## 行为细节

- 手机（软键盘）同样生效：拦截时不会打断输入法合成，文字不会被清空。
- 拼音/中文输入法下，第一下回车是「提交拼音」（所有 App 都一样），第二下才是换行。
- 偏好保存在浏览器 localStorage（`dsh.enter-newline.behavior.v1`），重启后保留。

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
