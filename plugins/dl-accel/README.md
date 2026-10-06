# dl-accel · 通用 URL 下载加速（非 GitHub）

让 DeepSeek Harness 里的助手**从任意 URL 下载文件时自动走最快路线**（镜像 + 多线程分段）。

**优选规则**：GitHub 站内文件 → 用 [gh-accel](https://github.com/Jack-kd/dsh-plugins/releases/download/v1.4.0/gh-accel-plugin.tgz) 专用路线；
**非 GitHub 的任意站点** → 用本插件（内置 HuggingFace / npm 镜像，可在配置里给任意站点加镜像）。

## 功能

1. **`url_accel_download`** — 规则驱动下载任意 https 文件（GitHub 直链会拒收并引导改用 `github_accel_download`）：
   - 自动匹配规则（正则）→ 直连 + 该规则所有镜像**并行测速**（每个 3.5 秒封顶）选最快；
   - ≥4MB 大文件按 Range 切片多线程并发下载，失败自动重试并校验大小；
   - `mirror` 参数可显式强制走某个镜像。
2. **`url_accel_probe`** — 诊断某 URL 的选路：命中规则、每条路线实测带宽与 Range 支持。
3. 系统提示注入「文件下载优选规则」：GitHub → `github_accel_download`，其他 → `url_accel_download`。

## 规则格式（配置 `rules`）

```yaml
- id: dl-accel
  name: '@local/dl-accel'
  inject: [tools]
  config:
    threads: 8
    rules:
      - match: 'gitlab\.com'
        style: 'host'                 # 把原URL的域名换成镜像域名
        mirrors: ['https://<你的gitlab镜像>']
      - match: 'example\.com/download'
        style: 'prefix'               # 新URL = 镜像 + 原URL
        mirrors: ['https://<代理前缀>/']
```

- `match`：正则字符串，作用于完整 URL；
- `style`：`prefix`（镜像=前缀，gh 代理类）或 `host`（镜像=替换域名）；
- **自定义规则优先于内置默认**（可覆盖 GitHub 等站点的镜像）。
- 不写 `rules` 时只用内置默认规则；无规则命中的站点走**直连 + 多线程分段加速**，依然比单线程快。

## 内置默认规则

| 站点 | 规则 | 镜像 |
|---|---|---|
| huggingface.co / hf.co | host | hf-mirror.com |
| registry.npmjs.org | host | registry.npmmirror.com |

> GitHub 直链不在此表：由 gh-accel 插件负责（见上文优选规则）。

## 安装

```bash
dsh plugin --profile web add https://github.com/Jack-kd/dsh-plugins/releases/download/v1.5.0/dl-accel-plugin.tgz
```

或「插件管理 → 添加插件」粘贴同一地址。

## 安全说明

第三方镜像理论上可篡改内容；下载**可执行工具**后建议与官方校验和对比。关键站点可以只写自己信任的镜像。