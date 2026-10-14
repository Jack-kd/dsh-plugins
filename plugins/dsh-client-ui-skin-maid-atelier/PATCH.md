# 本地补丁说明（PATCH.md）

本目录下的 `lib/client.js` 包含两处**本地热补丁**，与上游
`Small-tailqwq/dsh-deep-whale`（maid-atelier v0.1.7）的发布产物不同。

## 补丁 v0.1.9（本仓库，当前）

在皮肤主样式 `<style>`（`maid-atelier.module.css`）注入之后，追加注入一份
`phone-settings-override.css` 样式，修复竖屏下设置弹窗不可用的问题。

### 修复背景

- 症状（v0.1.8 引入）：手机竖屏（≤700px）点开「设置」后页面变暗、菜单按钮
  点不动；横屏（>700px）反而正常。
- 根因：v0.1.8 的 override 把设置弹窗强制改回「宿主桌面横排双栏」——
  `flex-direction:row` + nav 固定 188px + content 挤剩余宽度。竖屏手机面板
  只有约 312–366px 宽，减去 188px 导航后 **content 只剩 124–178px**，设置
  内容被挤成窄条、按钮挤成一团点不到；而皮肤原生在 `≤640px` 本来就是
  **单列纵向**布局（顶部导航条 + content 占满剩余），因为横屏 >700px 时
  override 不生效、走皮肤原生全屏布局，宽度充足反而正常。
- 结论：v0.1.8 的补丁过犹不及，破坏了皮肤原生的窄屏纵向布局。

### 修复内容

新 override 在 ≤700px 时改用**单列纵向布局**，expire 掉 v0.1.8 的横排双栏：

- dialog：纵列、全宽卡片、固定高度带滚动，不再横排；
- nav：改为顶部横向导航条，内部菜单项按 `flex-wrap:wrap` 自动换行，高度
  有上限、可滚动；
- content（`nav+div`）：占满剩余高度、正常纵向滚动；
- 去掉 `[aria-modal='true']` 的透明玻璃 `::before` 磨砂层与
  `backdrop-filter`，保证不透明背景、可交互；
- 桌面端（>700px）不受影响，保持皮肤原生全屏样式。

## 历史补丁 v0.1.8（已被 v0.1.9 取代）

v0.1.8 的 override 曾在 ≤700px 强制恢复宿主桌面横排双栏（nav 188px +
content 挤压），该修复合入后反而导致竖屏设置不可点，已在 v0.1.9 重写。

## 同步 / 升级注意

- 已同步修改的两份文件必须保持一致：
  - `…/node_modules/@smalltailqwq/dsh-client-ui-skin-maid-atelier/lib/client.js`
    （实际被 DSH 服务给浏览器的 bundle）
  - 本目录 `lib/client.js`（工作区源码副本）
- **重新安装 / 升级该皮肤包后，需要重新应用本补丁**（文件会随包覆盖）。
- 回滚：`git checkout -- lib/client.js`（本目录），或使用已安装包目录里的
  `lib/client.js.bak`。
