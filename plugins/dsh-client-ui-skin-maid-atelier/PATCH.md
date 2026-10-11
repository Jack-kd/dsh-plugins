# 本地补丁说明（PATCH.md）

本目录下的 `lib/client.js` 包含一处**本地热补丁**，与上游
`Small-tailqwq/dsh-deep-whale`（maid-atelier v0.1.7）的发布产物不同。

## 补丁内容

在皮肤主样式 `<style>`（`maid-atelier.module.css`）注入之后，追加注入一份
`phone-settings-override.css` 样式：

- 仅当 `@media (max-width: 700px)`（手机竖屏）且设置弹窗打开
  （`data-maid-settings-open`）时生效；
- 把皮肤对「设置」弹窗的全屏化重排（`width:100dvw / height:100dvh /
  max-height:none / border-radius:0 / 背景透明 + backdrop-filter 磨砂
  ::before / 侧栏导航改横向网格）恢复为宿主默认的居中卡片与纵向导航；
- 桌面端（>700px）不受影响，皮肤原有的全屏设置样式保持不变。

## 修复背景

- 症状：手机竖屏下安装并启用「深海女仆工坊」皮肤后，「设置」弹窗能打开但
  呈现空白/卡死。
- 原因：皮肤的 `data-maid-settings-open` 规则把设置弹窗强制改为全屏磨砂
  透明层，并重构其导航为横向网格；该叠层与宿主默认设置卡片布局冲突，
  在手机 WebView 上导致内容不可见/渲染卡顿。

## 同步 / 升级注意

- 已同步修改的两份文件必须保持一致：
  - `…/node_modules/@smalltailqwq/dsh-client-ui-skin-maid-atelier/lib/client.js`
    （实际被 DSH 服务给浏览器的 bundle）
  - 本目录 `lib/client.js`（工作区源码副本）
- **重新安装 / 升级该皮肤包后，需要重新应用本补丁**（文件会随包覆盖）。
- 回滚：`git checkout -- lib/client.js`（本目录），或使用已安装包目录里的
  `lib/client.js.bak`。
