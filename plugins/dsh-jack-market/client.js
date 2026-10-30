window.__ModuleLoader__.load({
  id: 'dsh-jack-market',
  factory(require) {
    const React = require('react');
    const { useState, useEffect, useCallback } = React;
    const h = React.createElement;

    const NS = 'dsh-jack-market';

    /** Resolve an API path to an absolute URL. DSH web 挂载在根路径（gh-accel
     * 的 `/gh-accel/progress` 绝对路径轮询正常工作），直接返回绝对路径。
     * 注意：**不能用 `new URL(...).pathname` 解析**——pathname 会剥掉 query
     * 参数（v0.6.3 的坑：`/task?key=x` 变成 `/task`，host 拿不到 key 返回 idle，
     * 客户端一直停在「启动中」）。 */
    function api(path) {
      const p = String(path || '');
      return p.startsWith('/') ? p : `/${p}`;
    }

    /** Fetch JSON from one of our routes. */
    async function fetchJson(path) {
      const res = await fetch(api(path), { cache: 'no-store' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return res.json();
    }

    const cardStyle = {
      background: 'var(--dsw-alias-bg-layer-1, #fff)',
      border: '1px solid var(--dsw-alias-border-l1, #ddd)',
      borderRadius: '8px',
      padding: '12px 14px',
      marginBottom: '10px',
    };
    const rowStyle = {
      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      gap: '12px',
    };
    const titleStyle = {
      color: 'var(--dsw-alias-label-primary, #111)',
      fontWeight: 600, fontSize: '14px', margin: 0,
    };
    const metaStyle = {
      color: 'var(--dsw-alias-label-secondary, #666)',
      fontSize: '12px', margin: '4px 0 0 0',
    };
    const btnBase = {
      padding: '6px 14px', borderRadius: '6px', fontSize: '13px',
      border: 'none', cursor: 'pointer', flexShrink: 0, whiteSpace: 'nowrap',
    };
    const progressTrack = {
      width: '100%', height: '6px', borderRadius: '3px',
      background: 'var(--dsw-alias-bg-layer-2, #eee)', marginTop: '8px',
      overflow: 'hidden',
    };
    const progressFill = {
      height: '100%', borderRadius: '3px',
      // 进度条是**图形**，用 state-business-primary（浅 #4176e6 / 深 #7aaaff），
      // 而不是 brand-primary：后者在深色主题下是近白色，进度条会几乎看不见。
      background: 'var(--dsw-alias-state-business-primary, #4176e6)',
      transition: 'width .3s ease',
    };
    // 阶段 → 进度百分比（估算：下载 15-75%，校验 80%，安装 90%，完成/失败 100%）
    const stagePct = { running: 10, downloading: 40, verifying: 75, installing: 88, done: 100, failed: 100 };
    const stageLabel = {
      running: '启动中…', downloading: '下载中…', verifying: '校验中…',
      installing: '安装中…', done: '安装成功 ✓', failed: '安装失败 ✗',
    };
    // v0.7.1 深色模式：这些值全部是**文字色**，必须随主题自适应。
    //
    // 旧版把 `--dsw-alias-brand-primary` 当文字色：该 token 在浅色主题下是近黑
    // （#0f1115）、深色主题下是近白（#f9fafb）。它同时被当**底色**用（按钮、
    // 进度条），于是「底色 + 字色」永远是同色系 → 深浅切换总有一边糊掉。
    //
    // 现在分开：
    //   * 底色 → `--dsw-alias-button-primary-fill`（按钮）/ `state-business-primary`（进度条）
    //   * 字色 → `label-primary-foreground`（按钮内）/ `state-business-primary`（进度文字）
    //
    // 成功绿单独处理：主题的 `state-success-primary` 深浅两套都是 #22c55e，
    // 在浅色白底上只有 2.28:1（不达 AA）。这里用 color-mix 与主题的
    // label-primary 混合 50% —— 浅色主题下压深成 #186b3a（6.56:1），
    // 深色主题下混入近白只略微提亮（仍 ≥6:1），两套都达标。
    const doneGreen = 'color-mix(in srgb, var(--dsw-alias-state-success-primary, #22c55e) 50%, var(--dsw-alias-label-primary, #0f1115))';
    const stageColor = {
      running: 'var(--dsw-alias-label-secondary, #666)',
      downloading: 'var(--dsw-alias-state-business-primary, #4176e6)',
      verifying: 'var(--dsw-alias-state-business-primary, #4176e6)',
      installing: 'var(--dsw-alias-state-business-primary, #4176e6)',
      done: doneGreen,
      failed: 'var(--dsw-alias-state-error-primary, #ec1313)',
    };

    function compareVersions(a, b) {
      const na = String(a || '').split('.').map(Number);
      const nb = String(b || '').split('.').map(Number);
      const len = Math.max(na.length, nb.length);
      for (let i = 0; i < len; i++) {
        const la = na[i] || 0;
        const lb = nb[i] || 0;
        if (la > lb) return 1;
        if (la < lb) return -1;
      }
      return 0;
    }

    /** Normalize a dependency name to a set of candidate market keys, so
     * "已安装" detection works even when the npm package name differs from
     * the repo directory name. Handles three forms:
     *   - npm scope:  "@local/gh-accel" → "gh-accel"
     *   - dsh prefix: "dsh-our-free-model" → { "dsh-our-free-model", "our-free-model" }
     *                (both kept: the market key may or may not carry dsh-)
     *   - plain:      "dsh-jack-market" → { "dsh-jack-market", "jack-market" }
     * A plugin is considered installed when any candidate equals the market key. */
    function keyCandidates(name) {
      const bare = String(name || '').replace(/^@[^/]+\//, '');
      const set = new Set([bare]);
      if (bare.startsWith('dsh-')) set.add(bare.slice(4));
      return [...set];
    }

    function PluginCard({ plugin, installedMap, enabledMap, busy, task, onInstall, onEnable }) {
      const installedVersion = installedMap ? installedMap.get(plugin.key) : undefined;
      const installedLocal = installedVersion !== undefined;
      // v0.7.1：区分「装到磁盘」与「已启用（在 bundles 里）」。
      // 旧版只看 dependencies，「装好了但没进运行时」会显示灰色「已安装」，
      // 用户以为能用，实际功能根本没加载 —— 这就是「装完还要手动启用」。
      const enabledLocal = installedLocal && (!enabledMap || enabledMap.has(plugin.key));
      const superseded = !!plugin.supersededBy;
      const installable = plugin.installable !== false && !!plugin.url;
      const version = plugin.version || plugin.tag || '';
      const hasUpdate = installedLocal && version && plugin.version && compareVersions(plugin.version, installedVersion) > 0;
      // 任务状态：running/done/failed 时显示进度反馈
      const activeTask = task && (task.running || task.stage === 'done' || task.stage === 'failed');
      let btnLabel = installedLocal
        ? (hasUpdate ? '更新' : (enabledLocal ? '已安装' : '启用'))
        : (busy ? '安装中…' : '安装');
      let btnDisabled = installedLocal
        ? (!hasUpdate && enabledLocal) || busy
        : (busy || (!superseded && !installable));
      if (!installedLocal && superseded) btnLabel = `已并入 ${plugin.supersededBy}`;
      else if (!installedLocal && !superseded && !installable) btnLabel = '未发布包';
      // Blue accent for actions that actually do something (install / update / enable).
      //
      // v0.7.1 深色模式修复：文字颜色**绝对不能硬编码 `#fff`**。
      // `--dsw-alias-brand-primary` 在深色主题下会变成 near-white
      // （浅色主题是 #0f1115，深色主题是 #f9fafb），硬编码白字落在近白底上
      // 对比度只有 1.05:1 —— 等于白字写白底，完全看不清「安装」两个字。
      // 官方主按钮的标准组合是
      //   background: var(--dsw-alias-button-primary-fill)
      //   color:      var(--dsw-alias-label-primary-foreground)
      // 后者在深浅两套主题下自动反色（浅=#fff 配深底，深=#0f1115 配近白底，
      // 对比度 18.9:1 / 18.08:1），这才是随主题走的写法。
      const brandFill = 'var(--dsw-alias-button-primary-fill, var(--dsw-alias-brand-primary, #247bbf))';
      const brandFg = 'var(--dsw-alias-label-primary-foreground, #fff)';
      const idleGray = 'var(--dsw-alias-state-idle-primary, #ccc)';
      const active = busy || (installedLocal && (hasUpdate || !enabledLocal)) || (!installedLocal && !superseded && installable);
      // 进度反馈渲染（阶段文字 + 进度条 + 失败原因）
      let feedback = null;
      if (activeTask) {
        const pct = stagePct[task.stage] || 10;
        const label = stageLabel[task.stage] || '进行中…';
        const color = stageColor[task.stage] || 'var(--dsw-alias-label-secondary, #666)';
        const isFail = task.stage === 'failed';
        const isDone = task.stage === 'done';
        if (isDone) {
          feedback = h('p', {
            style: { ...metaStyle, marginTop: 6, color: stageColor.done },
          }, '✓ 安装成功，重启 App 后生效');
        } else {
          feedback = h('div', { style: { marginTop: 8 } },
            h('div', {
              style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 2 },
            },
              h('span', { style: { ...metaStyle, color, margin: 0 } }, label),
              h('span', { style: { ...metaStyle, margin: 0 } }, `${pct}%`),
            ),
            h('div', { style: progressTrack },
              h('div', {
                style: {
                  ...progressFill,
                  width: `${pct}%`,
                  background: isFail ? stageColor.failed : undefined,
                },
              }),
            ),
            (isFail && task.message) ? h('p', {
              style: { ...metaStyle, marginTop: 6, color: stageColor.failed, wordBreak: 'break-all' },
            }, String(task.message).slice(0, 240)) : null,
          );
        }
      }
      return h('div', { style: cardStyle },
        h('div', { style: rowStyle },
          h('div', { style: { minWidth: 0 } },
            h('p', { style: titleStyle }, plugin.key,
              version ? h('span', { style: { fontWeight: 400, color: 'var(--dsw-alias-label-secondary, #666)', marginLeft: 6, fontSize: 12 } }, `v${version}`) : null),
            // v0.7.0：一句话简介（README summary）——用户一眼知道这插件干嘛的
            plugin.summary ? h('p', { style: { ...metaStyle, fontWeight: 500, marginTop: 2 } }, plugin.summary) : null,
            installedVersion
              ? h('p', { style: metaStyle },
                  `当前版本：v${installedVersion}`
                  + (enabledLocal
                      ? ''
                      : '　·　未启用（点右侧「启用」后重启生效）'))
              : null,
            plugin.version
              ? h('p', { style: metaStyle }, `最新版本：v${plugin.version}${plugin.publishedAt ? `　·　${new Date(plugin.publishedAt).toLocaleDateString()}` : ''}`)
              : null,
          ),
          h('button', {
            style: {
              ...btnBase,
              background: active ? brandFill : idleGray,
              // 主按钮用 label-primary-foreground（随主题反色）；禁用态用二级标签色，
              // 两者都是 token，不再出现写死的 #fff / #666。
              color: active ? brandFg : 'var(--dsw-alias-label-secondary, #666)',
            },
            disabled: btnDisabled,
            onClick: (e) => {
              e.preventDefault();
              // 已安装但未启用 → 走启用接口；其余（安装/更新）走安装接口。
              if (installedLocal && !hasUpdate && !enabledLocal) { if (onEnable) onEnable(plugin); return; }
              if (onInstall) onInstall(plugin);
            },
          }, btnLabel),
        ),
        (superseded && !installedLocal) && h('p', {
          style: { ...metaStyle, marginTop: 4, color: 'var(--dsw-alias-state-idle-primary,#888)' },
        }, `此插件已并入 ${plugin.supersededBy}，无需单独安装；请安装 ${plugin.supersededBy} 即可。`),
        feedback,
        plugin.note && h('div', {
          style: { ...metaStyle, marginTop: 8, whiteSpace: 'pre-wrap', wordBreak: 'break-word', maxHeight: 90, overflow: 'hidden' },
        }, plugin.note.slice(0, 500)),
      );
    }

    function Market({ ownerProps }) {
      const [plugins, setPlugins] = useState([]);
      const [installedMap, setInstalledMap] = useState(new Map());
      // v0.7.1：已启用的市场 key 集合（来自 bundles），用来区分「已安装」与「已启用」
      const [enabledMap, setEnabledMap] = useState(new Set());
      const [busyKey, setBusyKey] = useState(null);
      const [tasks, setTasks] = useState(new Map()); // key -> task
      const [error, setError] = useState('');
      const [loading, setLoading] = useState(true);

      const load = useCallback(async () => {
        setLoading(true); setError('');
        try {
          const [list, inst] = await Promise.all([
            fetchJson('/dsh-jack-market/plugins'),
            fetchJson('/dsh-jack-market/installed'),
          ]);
          setPlugins(Array.isArray(list.plugins) ? list.plugins : []);
          const deps = Array.isArray(inst.installed) ? inst.installed : [];
          // Each dep is { name, version, enabled }. Build a map key -> installed version,
          // stripping any scope to the final segment (e.g. "@local/enter-newline"
          // matches the market key "enter-newline").
          const map = new Map();
          const onSet = new Set();
          for (const d of deps) {
            const name = typeof d === 'string' ? d : (d && d.name);
            const ver = typeof d === 'object' && d ? (d.version || '') : '';
            const isOn = typeof d === 'object' && d ? d.enabled !== false : true;
            if (typeof name === 'string') {
              for (const cand of keyCandidates(name)) {
                // Keep the highest version seen for the same candidate.
                if (!map.has(cand) || compareVersions(ver, map.get(cand)) > 0) map.set(cand, ver || '');
                if (isOn) onSet.add(cand);
              }
            }
          }
          setInstalledMap(map);
          setEnabledMap(onSet);
        } catch (e) {
          setError(String(e && e.message || e));
        } finally {
          setLoading(false);
        }
      }, []);

      useEffect(() => { load(); }, [load]);

      // v0.7.1：已安装但未启用 → 一键写入 bundles（历史遗留插件用）
      const enable = useCallback(async (plugin) => {
        setBusyKey(plugin.key); setError('');
        setTasks((prev) => new Map(prev).set(plugin.key, { stage: 'installing', message: '正在启用…', running: true }));
        try {
          const res = await fetch(api('/dsh-jack-market/enable'), {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ name: plugin.depName || plugin.key }),
          });
          const j = await res.json().catch(() => ({}));
          if (!res.ok || j.ok === false) throw new Error((j && (j.error || j.message)) || `HTTP ${res.status}`);
          setTasks((prev) => new Map(prev).set(plugin.key, {
            stage: 'done', message: (j && j.message) || '已启用，重启 App 后生效', running: false,
          }));
          await load();
        } catch (e) {
          const msg = String(e && e.message || e);
          setError(msg);
          setTasks((prev) => new Map(prev).set(plugin.key, { stage: 'failed', message: msg, running: false }));
        } finally {
          setBusyKey(null);
        }
      }, [load]);

      const install = useCallback(async (plugin) => {
        setBusyKey(plugin.key); setError('');
        // 立即显示「启动中…」，让用户立刻有反馈
        setTasks((prev) => new Map(prev).set(plugin.key, { stage: 'running', message: '启动中…', running: true }));
        try {
          const res = await fetch(api('/dsh-jack-market/install'), {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ url: plugin.url, key: plugin.key, version: plugin.version }),
          });
          if (!res.ok) {
            const j = await res.json().catch(() => ({}));
            throw new Error((j && j.error) || `HTTP ${res.status}`);
          }
          // 轮询 /task 获取实时进度，直到任务结束（done/failed）或超时。
          const deadline = Date.now() + 180000; // 3 分钟兜底
          let finalTask = null;
          while (Date.now() < deadline) {
            await new Promise((r) => setTimeout(r, 700));
            try {
              const t = await fetchJson(`/dsh-jack-market/task?key=${encodeURIComponent(plugin.key)}`);
              if (t && t.stage) {
                // idle = host 任务已清理（安装已结束但状态可能刚被删）→ 停止轮询
                if (t.stage === 'idle') { finalTask = null; break; }
                setTasks((prev) => new Map(prev).set(plugin.key, t));
                finalTask = t;
                if (t.stage === 'done' || t.stage === 'failed') break;
              }
            } catch { /* transient */ }
          }
          // 收尾判定：
          //   - 轮询到 done → 成功
          //   - 轮询到 failed → 失败（保留任务状态供展示）
          //   - 轮询到 idle / 超时 → 以「实际是否已安装」为准：装了即成功，否则超时
          if (finalTask && finalTask.stage === 'done') {
            setTasks((prev) => new Map(prev).set(plugin.key, { stage: 'done', message: '安装成功', running: false }));
          } else if (finalTask && finalTask.stage === 'failed') {
            // 保留 host 的失败状态（含原因）
          } else {
            const inst = await fetchJson('/dsh-jack-market/installed').catch(() => ({ installed: [] }));
            const deps = inst.installed || [];
            const hit = deps.some((d) => {
              const n = typeof d === 'string' ? d : (d && d.name);
              return typeof n === 'string' && keyCandidates(n).includes(plugin.key);
            });
            if (hit) {
              setTasks((prev) => new Map(prev).set(plugin.key, { stage: 'done', message: '安装成功', running: false }));
            } else {
              setTasks((prev) => new Map(prev).set(plugin.key, { stage: 'failed', message: '安装超时或失败，请重试或查看 pnpm 日志', running: false }));
            }
          }
          await load();
        } catch (e) {
          setError(String(e && e.message || e));
          setTasks((prev) => {
            const next = new Map(prev);
            next.set(plugin.key, { stage: 'failed', message: String((e && e.message) || e), running: false });
            return next;
          });
        } finally {
          setBusyKey(null);
        }
      }, [load]);

      const rootStyle = { padding: '16px 4px', fontFamily: 'system-ui, sans-serif' };

      // 导出审计日志：拉取 /log 文本并下载为文件（供诊断「安装卡住」等隐蔽问题）
      const [exportState, setExportState] = useState({ busy: false, msg: '' });
      const exportLog = useCallback(async () => {
        setExportState({ busy: true, msg: '' });
        try {
          const res = await fetch(api('/dsh-jack-market/log'), { cache: 'no-store' });
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          const text = await res.text();
          // 浏览器下载：Blob + 临时 a[download]
          const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
          const urlObj = URL.createObjectURL(blob);
          const a = document.createElement('a');
          const now = new Date();
          const stamp = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}-${String(now.getHours()).padStart(2, '0')}${String(now.getMinutes()).padStart(2, '0')}`;
          a.href = urlObj;
          a.download = `dsh-jack-market-${stamp}.log`;
          document.body.appendChild(a);
          a.click();
          document.body.removeChild(a);
          URL.revokeObjectURL(urlObj);
          setExportState({ busy: false, msg: `已导出（${text.split('\n').length} 行）` });
        } catch (e) {
          setExportState({ busy: false, msg: `导出失败: ${String((e && e.message) || e)}` });
        }
      }, []);

      return h('div', { style: rootStyle },
        h('h3', {
          style: { color: 'var(--dsw-alias-label-primary,#111)', margin: '0 0 4px 0', fontSize: '17px' },
        }, 'Jack-kd 插件市场'),
        h('p', { style: { ...metaStyle, fontSize: 12, marginBottom: 14 } },
          `来自 GitHub 仓库 Jack-kd/dsh-plugins · ${plugins.length} 个插件`),
        h('div', { style: { marginBottom: 12, display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' } },
          h('button', {
            style: { ...btnBase, background: 'var(--dsw-alias-bg-layer-2,#eee)', color: 'var(--dsw-alias-label-primary,#111)' },
            onClick: () => load(),
          }, '刷新'),
          h('button', {
            style: { ...btnBase, background: exportState.busy ? 'var(--dsw-alias-state-idle-primary,#ccc)' : 'var(--dsw-alias-bg-layer-2,#eee)', color: 'var(--dsw-alias-label-primary,#111)' },
            disabled: exportState.busy,
            onClick: () => exportLog(),
          }, exportState.busy ? '导出中…' : '📋 导出日志'),
          exportState.msg && h('span', { style: { ...metaStyle, fontSize: 11 } }, exportState.msg)),
        error && h('div', {
          style: { color: 'var(--dsw-alias-state-error-primary,#c00)', fontSize: '13px', margin: '8px 0', padding: '8px', background: 'var(--dsw-alias-bg-layer-1,#fff)', borderRadius: 6 },
        }, String(error)),
        loading && h('p', { style: metaStyle }, '加载中…'),
        !loading && plugins.length === 0 && !error && h('p', { style: metaStyle }, '没有可用的插件。'),
        plugins.map((plugin) => h(PluginCard, {
          key: plugin.key,
          plugin,
          installedMap,
          enabledMap,
          busy: busyKey === plugin.key,
          task: tasks.get(plugin.key),
          onInstall: install,
          onEnable: enable,
        })),
        h('p', {
          style: {
            ...metaStyle, marginTop: 12, fontSize: 11, color: 'var(--dsw-alias-label-secondary,#999)',
          },
        }, '提示：安装后需重启 App 让插件生效（同官方的“升级需先卸载再装新版本”规则）。'),
      );
    }

    return {
      inject: ['slots'],
      apply(ctx) {
        const register = () => {
          const off = ctx.slots.register({
            name: 'settings.section',
            id: NS,
            order: 65,
            label: () => 'Jack 插件市场',
            locale: NS,
            inject: () => ({ t: () => '' }),
          }, (ownerProps = {}) => h(Market, { ownerProps }));
          return typeof off === 'function' ? off : () => {};
        };
        ctx.slots.inject('settings.section', () => { register(); });
      },
    };
  },
});