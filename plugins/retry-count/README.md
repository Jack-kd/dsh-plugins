# retry-count · 请求重试次数插件

修改 DeepSeek Harness 的**模型请求重试次数**。默认重试上限是 5（提示「已重试模型请求（1/5）」），本插件可把它改成任意次数（如 10）。

## 用法（两个入口，任选其一）

**入口 A（设置页，最直观）**：**设置 → 通用设置 → 模型请求重试次数** → 输入次数（如 `10`）→ 点「修改」。

**入口 B（插件页）**：**插件管理（Plugins）→ 请求重试次数 → 配置** → 改「最大请求重试次数」→ 保存。

之后卡顿时提示会变成「已重试模型请求（1/10）…」。

> 输入 `0` = 失败不重试。范围 0–100。改动实时生效，无需重启。

## 原理

模型提供商的重试策略 `retryPolicy.maxRetries` 默认 5。本插件声明一个 volatile 配置字段
`maxRetries`，配置变更后通过两个信号触发同步：

1. **`settings/document-updated`（ns = retry-count）**：宿主在设置写入落盘并 reconcile 完成后发出，
   是最可靠的主信号；
2. **`loader/volatile-update`**：Loader 把 volatile 字段提交进运行引用时发出，作兜底。

收到信号后，本插件把 deepseek 两个提供商行（API Key 登录 / 账号登录）与 pi-ai 提供商行
（如 日日新/rry）下的每个提供商的 `retryPolicy.maxRetries` 同步为目标值，立即生效。

同步在独立串行队列里延迟执行，不会在触发写入的文件锁/reconcile 栈内嵌套编辑，避免与
HMR 全量 reconcile 竞争导致编辑被静默丢弃；目标值取自本插件 entry 的最新原始配置，
不依赖 volatile 引用是否已提交。

## 更新记录

- **v2.0.6**（2026-10）：彻底修复运行期不同步。实测本 build（0.2.0-rc.2）：
  `loader/volatile-update` 携带 `owner.fiber === fiber` 过滤器，而 ctx.on 监听器
  全部挂在根上下文，事件实际上送不到任何插件；`entry.options.config` 在写入后
  会滞后，不能作为运行时值源。v2.0.6 改为：主信号 `app-boot/config-reload`
  （每次 patch reconcile 完成即触发）+ 兜底 `settings/document-updated`；值源
  改读 settings 文档 user 段（直读 patch，写入即最新）；并加入同值跳过与
  失败冷却，防止自激循环。


- **v2.0.5**（2026-10）：修复「改次数后 deepseek/pi-ai 不跟随」——原实现只监听
  `loader/volatile-update`，部分 build 该事件不送达，或编辑与 HMR reconcile 竞争被丢弃；
  现改为双信号触发 + 串行延迟编辑，并直接读 entry 原始配置。升级后需重启一次 Harness。

## 安装

```bash
dsh plugin --profile web add /本地路径/plugins/retry-count
```

或在「插件管理 → 添加插件」里填本目录绝对路径。

## 说明

- 适配 DSH 0.2.0-rc.2（2026-10 构建）。
- 只改动提供商的重试上限（deepseek / pi-ai），不改请求内容、不联网。
