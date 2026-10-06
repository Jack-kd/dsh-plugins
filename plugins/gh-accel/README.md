# GitHub 下载加速插件（gh-accel）

让 DeepSeek Harness 里的助手在**下载/克隆 GitHub 项目时自动走加速镜像**，速度可提升数十倍
（实测：直连 ~12 KB/s → 镜像+多线程 ~700 KB/s）。

## 功能

安装并启用后自动生效：

1. **三个加速工具**（助手自动可用）：
   - `github_accel_download` — 下载 GitHub 任意文件（release 附件 / raw 文件 / 源码归档）。
     自动对直连与多个镜像逐条测速（每个 4 秒封顶）选最快路线；大文件按 Range 切片多线程并发下载，失败自动重试。
   - `github_accel_clone` — 加速 `git clone`（自动走最快镜像，可选浅克隆）。
   - `github_accel_push` — 推送代码时临时移除镜像改写、推完恢复（镜像只读，不能直接收 push）。
2. **全局自动配置**（幂等，尽力而为，失败不影响插件）：
   - `git config --global` 添加 insteadOf 改写：所有 `git clone/fetch https://github.com/...` 自动走加速镜像；
   - 写入 `~/.config/pip/pip.conf`：pip 换清华源（加速 Python 工具下载）。

## 安装（在目标机器上）

方式 A — 通过插件管理器安装本地目录：

1. 把 `gh-accel/` 目录拷到目标机器（任意位置）；
2. 在 DSH 的「设置 → 插件管理」里用「安装插件」指向该目录；或在会话里：
   `plugin_manager install_bundle`，target 填目录的绝对路径；
3. 安装即启用，立即生效（生效表现：助手工具列表出现 `github_accel_*` 三个工具）。

方式 B — 命令行（机器上有 dsh CLI）：

```bash
dsh plugin --profile <profile名> install /路径/gh-accel
```

卸载：插件管理里移除即可。全局 git/pip 配置**不会被自动撤销**（不破坏用户机器状态），
如需手动清理：

```bash
git config --global --unset-all url.https://ghfast.top/https://github.com/.insteadOf
rm -f ~/.config/pip/pip.conf
```

## 配置（可选，在插件行 config 里改）

| 字段 | 默认 | 说明 |
|---|---|---|
| `mirrors` | ghfast.top / gh-proxy.com / ghproxy.net | 镜像列表，失效可自行增删 |
| `threads` | 8 | 并发分片数（1–32） |
| `gitRewrite` | true | 是否配置 git 全局镜像改写（false 则只保留工具，不改全局） |
| `pipMirror` | pypi.tuna.tsinghua.edu.cn | pip 镜像地址 |

示例（cordis.patch.yml 里的行）：

```yaml
- id: gh-accel
  name: '@local/gh-accel'
  inject:
    - tools
  config:
    threads: 16
    mirrors:
      - https://ghfast.top/
      - https://gh-proxy.com/
```

## 工作原理

- 直连与镜像探测都是 4 秒硬预算，不会干等；慢速"细水长流"型服务器也会被截断。
- 大于 2 MB 的文件切成多段并发下载（HTTP Range，206 校验），下载完按序合并并校验大小。
- 镜像全部失效时自动回退直连或轮换尝试。
- git 改写只影响 `https://github.com/` 前缀；push 用 `github_accel_push` 或直接推原始地址。

## 备注

- 需要 Node.js ≥ 18（Harness 自带环境已满足）。
- 第三方镜像有公共时效性，个别时段可能变慢/限流——把新镜像加入 `mirrors` 即可。