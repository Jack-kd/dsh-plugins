# dsh-jack-market

Jack-kd 的 DSH 插件市场：直接从本仓库浏览可安装的插件，并在 DSH 内一键安装（类似内置的「插件市场」）。

## 功能

- **浏览插件**：列出 `plugins/` 目录下当前发布的有效插件（与 README 安装速查一致），含版本号与简介。
- **已安装状态**：自动识别本地已安装的插件（按真实包名去 scope 比对），显示「已安装」。
- **一键安装**：点「安装」即调用 `dsh plugin --profile web add <tgz-url>` 安装该插件。
- **废弃标注**：被其他插件合并的旧资源（如 `dl-accel` 已并入 `gh-accel`）会自动标注「已并入」，不再误导。

## 安装

```bash
dsh plugin --profile web add https://github.com/Jack-kd/dsh-plugins/releases/download/v0.3.0/dsh-jack-market-plugin.tgz
```

## 使用

装完重启一次 App（让设置页入口出现），然后打开 **设置 → Jack 插件市场**。列出插件，点「安装」即可一键安装；已安装的插件会显示「已安装」。

> **升级提示**：当前版本安装后不自动更新，升级需先卸载再装新版本。升级需先卸载当前版本，再装新版本。