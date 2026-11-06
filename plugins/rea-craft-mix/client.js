// rea-craft-mix 客户端半部 —— 引擎状态面板 + 设置入口。
//
// 相对 rea-tools 简化（本插件引擎都已存在本地，无需安装弹窗）：
//   提供一个「设置 → 通用 → 引擎」入口，点击打开浮层显示 mix_doctor 的探测结果，
//   并带「重跑注入」按钮，把 REA 引擎路径重新同步进 craft-anything。
//
// 状态源走宿主 HTTP 端点（/rea-craft-mix/state 只读、/rea-craft-mix/action 写），
// 与会话解耦（同 rea-tools 的做法，避免设置页拿不到 sessionId 的问题）。

(() => {
  try {
    window.__ModuleLoader__.load({
      id: '@local/rea-craft-mix',
      factory(require) {
        const React = require('react')
        const h = React.createElement
        let ReactDOM = null
        try { ReactDOM = require('react-dom') } catch { /* 无 react-dom，回退到原渲染 */ }

        const CSS = `
.mixOverlay{position:fixed;inset:0;z-index:9998;display:flex;align-items:flex-start;justify-content:center;
  background:color-mix(in srgb,var(--dsw-alias-bg-base) 55%,transparent);padding:48px 16px;animation:mixFade .15s ease-out}
.mixPanel{width:100%;max-width:600px;max-height:82vh;overflow:auto;border-radius:var(--dsw-radius-xl,16px);
  background:var(--dsw-specific-input-major,var(--dsw-alias-bg-module-platform));color:var(--dsw-alias-label-primary);
  box-shadow:var(--dsw-elevation-panel,0 12px 40px rgba(0,0,0,.35));border:1px solid var(--dsw-alias-border-l2-darkmode-thin,transparent);
  padding:20px 22px;animation:mixPop .18s ease-out}
@keyframes mixFade{from{opacity:0}to{opacity:1}}
@keyframes mixPop{from{transform:translateY(8px) scale(.99);opacity:0}to{transform:none;opacity:1}}
.mixTitle{margin:0 0 4px;font-size:16px;font-weight:600}
.mixSub{margin:0 0 14px;font-size:13px;color:var(--dsw-alias-label-tertiary)}
.mixRow{display:flex;align-items:center;gap:10px;padding:8px 0;border-bottom:1px solid var(--dsw-alias-border-l4);font-size:13px}
.mixRow:last-child{border-bottom:none}
.mixDot{flex:none;width:9px;height:9px;border-radius:50%}
.mixDotOn{background:var(--dsw-alias-state-success,var(--dsw-alias-state-business-primary))}
.mixDotOff{background:var(--dsw-alias-state-danger,var(--dsw-alias-state-critical,#e5484d))}
.mixName{flex:1;min-width:0;word-break:break-all;color:var(--dsw-alias-label-secondary)}
.mixVal{font-family:var(--dsw-font-mono,monospace);font-size:12px;color:var(--dsw-alias-label-tertiary);text-align:right;max-width:55%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.mixBtnRow{display:flex;gap:10px;margin-top:16px;justify-content:flex-end}
.mixBtn{padding:8px 14px;border-radius:var(--dsw-radius-md,10px);border:1px solid var(--dsw-alias-border-l4);
  background:var(--dsw-alias-bg-module,hsl(0 0% 100%));color:var(--dsw-alias-label-primary);font-size:13px;cursor:pointer}
.mixBtn:disabled{opacity:.5;cursor:default}
.mixBtnPrimary{background:var(--dsw-alias-state-business-primary);border-color:transparent;color:#fff}
.mixError{margin-top:12px;padding:10px;border-radius:8px;background:color-mix(in srgb,var(--dsw-alias-state-danger,#e5484d) 10%,transparent);font-size:12px;color:var(--dsw-alias-label-primary);white-space:pre-wrap}`

        function injectStyle() {
          let el = document.getElementById('mix-style')
          if (!el) { el = document.createElement('style'); el.id = 'mix-style'; document.head.appendChild(el) }
          el.textContent = CSS
        }

        // 状态浮层组件
        function StatusPanel({ state, onClose, onInject }) {
          const rows = state && state.engines
            ? ['reaCli', 'craftCli', 'ghidra', 'jadx', 'apktool', 'java'].map((k) => {
                const v = state.engines[k]
                return h('div', { key: k, className: 'mixRow' },
                  h('span', { className: 'mixDot ' + (v ? 'mixDotOn' : 'mixDotOff') }),
                  h('span', { className: 'mixName' }, k),
                  h('span', { className: 'mixVal' }, v || '未找到'))
              })
            : [h('div', { key: 'l', className: 'mixRow' }, h('span', { className: 'mixName' }, '加载状态中…'))]
          return h('div', { className: 'mixOverlay', onClick: (e) => { if (e.target === e.currentTarget) onClose() } },
            h('div', { className: 'mixPanel' },
              h('h3', { className: 'mixTitle' }, 'rea-craft-mix 引擎状态'),
              h('p', { className: 'mixSub' }, 'REA（JADX+Ghidra）与 Craft Anything（321 工具）融合引擎。绿色=就绪，红色=未找到。'),
              ...rows,
              state && state.status && state.status.ok === false
                ? h('div', { className: 'mixError', key: 'err' }, JSON.stringify(state.status, null, 2))
                : null,
              h('div', { className: 'mixBtnRow', key: 'btn' },
                h('button', { className: 'mixBtn mixBtnPrimary', disabled: !state || state.loading, onClick: onInject },
                  state && state.loading ? '注入中…' : '重跑注入（同步 REA → CA）'),
                h('button', { className: 'mixBtn', onClick: onClose }, '关闭')),
            ))
        }

        let styleInjected = false

        return {
          name: '@local/rea-craft-mix',
          inject: ['slots'],
          apply(ctx) {
            if (!styleInjected) { try { injectStyle() } catch {} ; styleInjected = true }

            const state = { loading: false, open: false, engines: null, status: null, error: null }

            // 从 host 读取状态
            async function loadState() {
              state.loading = true
              try {
                const res = await fetch('/rea-craft-mix/state')
                const d = await res.json()
                state.engines = d.engines
                state.status = d.status
                state.error = null
              } catch (err) {
                state.error = String(err && err.message)
              } finally {
                state.loading = false
                emit()
              }
            }

            // 重跑注入
            async function runInject() {
              state.loading = true; emit()
              try {
                await fetch('/rea-craft-mix/action', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ action: 'inject' }) })
                await loadState()
              } catch (err) {
                state.error = String(err && err.message); state.loading = false; emit()
              }
            }

            const listeners = new Set()
            function subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn) }
            function emit() { listeners.forEach((fn) => { try { fn() } catch {} }) }

            // 设置页入口
            try {
              ctx.slots.inject('settings.general.item', () => ctx.slots.register({
                name: 'settings.general.item', id: 'reacraft-environment', order: 31,
              }, function MixSettingsItem() {
                const [, force] = React.useState(0)
                React.useEffect(() => {
                  return subscribe(() => force((n) => n + 1))
                }, [])
                return h('div', {
                  style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 0', borderBottom: '1px solid var(--dsw-alias-border-l4)' },
                },
                  h('div', null,
                    h('div', { style: { fontSize: 14, fontWeight: 600 } }, 'REA × Craft Anything 融合引擎'),
                    h('div', { style: { fontSize: 12, color: 'var(--dsw-alias-label-tertiary)', marginTop: 2 } },
                      state.loading ? '检查中…' : '查看融合引擎状态 / 重跑路径注入')),
                  h('button', { className: 'mixBtn', onClick: (e) => { e.preventDefault(); state.open = true; loadState(); emit() } }, '查看'),
                )
              }))
            } catch (e) { console.warn('[rea-craft-mix] 设置入口注入失败:', e && e.message) }

            // 浮层（root）
            try {
              ctx.slots.inject('shell.overlay', () => ctx.slots.register({
                name: 'shell.overlay', id: 'reacraft-status-overlay', order: 30,
              }, function MixOverlaySlot() {
                const [, force] = React.useState(0)
                React.useEffect(() => subscribe(() => force((n) => n + 1)), [])
                if (!state.open) return null
                return ReactDOM
                  ? ReactDOM.createPortal(
                      h(StatusPanel, { state, onClose: () => { state.open = false; emit() }, onInject: runInject }),
                      document.body)
                  : h(StatusPanel, { state, onClose: () => { state.open = false; emit() }, onInject: runInject })
              }))
            } catch (e) { console.warn('[rea-craft-mix] 浮层注册失败:', e && e.message) }
          },
        }
      },
    })
  } catch (err) {
    console.warn('[rea-craft-mix] client runtime error:', err)
  }
})()