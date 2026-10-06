# 加速器 · 下载加速合并版（GitHub + 通用）

**gh-accel 与 dl-accel 合二为一**：一个插件同时负责 GitHub 与任意站点的下载/上传加速。

## 功能（5 个工具）

| 工具 | 用途 |
|---|---|
| `github_accel_download` | GitHub 文件（release / raw / 归档）加速下载，自动测速选最快镜像 + 多线程分段 |
| `github_accel_clone` | 加速 `git clone`（自动走镜像，可浅克隆） |
| `github_accel_push` | 推送代码时临时移除只读镜像改写、推完恢复 |
| `url_accel_download` | 任意非 GitHub 站点下载（规则驱动：HuggingFace / npm 等，可配置扩展） |
| `url_accel_probe` | 诊断某 URL 的选路：命中规则 + 各路线实测带宽 |

## 优选规则

- **GitHub 站内文件** → `github_accel_download`（专用路线，`url_accel_download` 会拒收 GitHub 直链）；
- **其他站点** → `url_accel_download`；
- `git clone` / `git pull` → **命令层自动**走镜像（git 全局 insteadOf）；
- `pip install` → **自动**走清华源。

## 内置默认规则

| 站点 | style | 镜像 |
|---|---|---|
| github.com / raw.githubusercontent.com / codeload.github.com | prefix | ghfast.top、github.geekery.cn、down.mxw.xx.kg、gh.monlor.com、js.jiangss.shop、github.mxw.qzz.io、gh.acmsz.top、ghproxy.felicity.land、gh-proxy.com、ghproxy.net |
| huggingface.co / hf.co | host | hf-mirror.com |
| registry.npmjs.org | host | registry.npmmirror.com |

## 配置（可选）

```yaml
- id: gh-accel
  name: '@local/gh-accel'
  inject:
    - tools
  config:
    threads: 8              # 并发分片数（1-32）
    mirrors: []             # 可选：整体替换 GitHub 镜像列表
    rules:                  # 可选：自定义站点规则（优先于内置默认）
      - match: 'gitlab\.com'
        style: 'host'
        mirrors: ['https://<你的gitlab镜像>']
    gitRewrite: true        # 是否配置 git 全局镜像改写
    pipMirror: 'https://pypi.tuna.tsinghua.edu.cn/simple'
```

## 安装

```bash
dsh plugin --profile web add https://github.com/Jack-kd/dsh-plugins/releases/download/v2.0.1/gh-accel-plugin.tgz
```

或「插件管理 → 添加插件」粘贴同一地址。

## 安全说明

第三方镜像理论上可篡改内容；下载**可执行工具**后建议与官方校验和对比。国内服务器直连最优，规则只匹配境外站点域名，不会绕路。