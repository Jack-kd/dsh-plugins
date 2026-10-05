# dsh-plugins

Jack-kd 的 DeepSeek Harness（DSH）插件仓库 —— monorepo 结构，**一个仓库存放多个插件**，
每个插件是一个独立完整的 bundle，放在 `plugins/` 目录下。

## 插件列表

| 插件 | 目录 | 说明 |
|---|---|---|
| enter-newline（回车换行） | [`plugins/enter-newline`](plugins/enter-newline) | 把输入框回车键从「发送」改为「插入换行」；可在 设置 → 通用设置 → 回车键 切换回「回车发送」 |

## 添加新插件

1. 在 `plugins/` 下新建一个目录（或复制 `enter-newline` 改）：
   ```
   plugins/<插件名>/
   ├── package.json        # 含 dsh.bundle.patch 和（如有客户端界面）dsh.client 声明
   ├── cordis.patch.yml    # Loader 补丁，插入插件行
   ├── index.js            # Host 半部
   ├── client.js           # （可选）客户端半部
   └── locale/ icon.svg    # （可选）显示文案与图标
   ```
2. `package.json` 的 `name` 用唯一包名（如 `@local/<插件名>` 或将来发布的真实包名）。
3. 每个插件的安装方式见其目录内 README。

## 安装这里的插件

本仓库根目录是 monorepo 元信息，**不是**一个可安装插件；安装请按单个插件来：

- **本地路径**（拿到仓库后最直接）：
  ```bash
  dsh plugin --profile web add /本地路径/dsh-plugins/plugins/enter-newline
  ```
  或在 DSH 的「插件管理 → 添加插件」里填该绝对路径。

- **npm 包名**（每个插件单独发布到 npm 后）：
  ```bash
  dsh plugin --profile web add <包名>
  ```

## 说明

- 适配 DSH 0.2.0-rc.2（2026-10 构建）；其他版本安装后请先验证功能。
- 插件以本机权限运行，只安装可信来源的插件。
