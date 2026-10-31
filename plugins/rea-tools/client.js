// rea-tools 客户端半部 —— 环境安装弹窗 + 进度胶囊 + 详情面板 + 设置入口。
//
// ── v0.2.8 关键修复（三个 bug 叠加，症状「弹窗不弹 / 按钮点了没反应」）─────
//  ① 旧版把安装弹窗注册在 `conversation.composer`。该插槽在 ui-conversation 里
//     声明为 **chain**（kind: 'chain'），而 SlotCore.register 对 chain 强制要求
//     `options.select`，缺了直接抛 `chain slot "conversation.composer" requires
//     options.select`。抛错发生在 `slots.inject` 的回调里，只进 console ——
//     注册整体不生效，所以「首次安装后重启不自动弹窗」。
//     现在改挂 `shell.overlay`（ui-layout 声明的 **list / root** 插槽），是官方
//     全屏浮层席位（plugin-manager 的 refresh toast、chat 的配额提示都用它），
//     既合法、又不会像 composer 那样抢走输入区。
//  ② 旧版每个按钮都走 `ctx.remote.commands.execute(sessionId, '/rea-install-*')`，
//     两个致命前提：**必须有一个可用会话**、且命令必须已注册。设置页是 root
//     作用域、拿不到 sessionId，`anySessionId()` 一旦返回 undefined 就直接
//     `{ ok:false }`；而所有失败都被 `try/catch` 吞成返回值，UI 完全没提示 ——
//     表现就是「点后台安装 / 稍后再说，一点反应都没有」。
//     现在状态与动作统一走宿主 HTTP 端点（`/rea-tools/state` 只读、
//     `/rea-tools/action` 写），**与会话完全解耦**，设置页和浮层共用一套。
//  ③ 设置页自己维护一份 `showDialog` 局部 state，与宿主的 showDialog 各自为政；
//     两套来源不同步，是「手动入口和自动弹窗行为不一致」的结构原因。
//     现在只有一个状态源（宿主 ui.showDialog），浮层直接按它渲染。
//
// 渲染面（slot）选择：
//   shell.overlay                安装弹窗 + 进度详情（全屏浮层，root 作用域）
//   conversation.input.dock      进度胶囊 / 工具工作状态（会话窄条）
//   settings.general.item        设置页入口
//
// 样式：只用 --dsw-alias-* 主题 token，深浅主题自适应；不 require 任何 Harness 客户端包。

(() => {
  try {
    window.__ModuleLoader__.load({
      id: '@local/rea-tools',
      factory(require) {
        const React = require('react')
        const h = React.createElement
        // react-dom（用于 Portal 把弹窗挂到 body 顶层）。若某环境不可 require，
        // 退化为 null，后续走「不 Portal 的原渲染」路径，绝不因 require 抛错拖垮整个插件。
        let ReactDOM = null
        try { ReactDOM = require('react-dom') } catch { /* 无 react-dom，回退到原渲染 */ }

        // ---------------- 样式（全部走主题 token） ----------------
        const CSS = `
.reaOverlay{position:fixed;inset:0;z-index:9999;display:flex;align-items:center;justify-content:center;
  background:color-mix(in srgb,var(--dsw-alias-bg-base) 62%,transparent);padding:16px;animation:reaFade .15s ease-out}
.reaDialog{width:100%;max-width:560px;max-height:88vh;overflow:auto;border-radius:var(--dsw-radius-xl,16px);
  background:var(--dsw-specific-input-major,var(--dsw-alias-bg-module-platform));color:var(--dsw-alias-label-primary);
  box-shadow:var(--dsw-elevation-panel,0 12px 40px rgba(0,0,0,.35));border:1px solid var(--dsw-alias-border-l2-darkmode-thin,transparent);
  animation:reaPop .18s ease-out}
@keyframes reaFade{from{opacity:0}to{opacity:1}}
@keyframes reaPop{from{transform:translateY(8px) scale(.99);opacity:0}to{transform:none;opacity:1}}
.reaHead{padding:20px 22px 6px}
.reaTitle{margin:0;font-size:16px;font-weight:600;line-height:22px}
.reaSub{margin:6px 0 0;font-size:13px;line-height:20px;color:var(--dsw-alias-label-tertiary)}
.reaBody{padding:8px 22px 4px}
.reaGroup{border:1px solid var(--dsw-alias-border-l4);border-radius:var(--dsw-radius-lg,12px);margin:10px 0;overflow:hidden;
  transition:border-color .12s,background-color .12s}
.reaGroupOn{border-color:var(--dsw-alias-state-business-primary);background:color-mix(in srgb,var(--dsw-alias-state-business-primary) 6%,transparent)}
.reaGroupHead{display:flex;align-items:center;gap:10px;padding:12px 14px;cursor:pointer;user-select:none}
.reaRadio{flex:none;width:16px;height:16px;border-radius:50%;border:1.5px solid var(--dsw-alias-border-l4);position:relative}
.reaRadioOn{border-color:var(--dsw-alias-state-business-primary)}
.reaRadioOn:after{content:"";position:absolute;inset:3px;border-radius:50%;background:var(--dsw-alias-state-business-primary)}
.reaGroupText{flex:1;min-width:0}
.reaGroupName{font-size:14px;font-weight:600;line-height:20px}
.reaGroupDesc{font-size:12px;line-height:18px;color:var(--dsw-alias-label-tertiary);margin-top:2px}
.reaSize{flex:none;font-size:12px;color:var(--dsw-alias-label-secondary);white-space:nowrap}
.reaChildren{padding:0 14px 10px 40px;display:flex;flex-direction:column;gap:8px}
.reaChild{display:flex;align-items:flex-start;gap:9px;cursor:pointer}
.reaCheck{flex:none;width:15px;height:15px;margin-top:2px;border-radius:4px;border:1.5px solid var(--dsw-alias-border-l4);
  display:grid;place-items:center;font-size:10px;color:var(--dsw-alias-label-primary-foreground)}
.reaCheckOn{background:var(--dsw-alias-state-business-primary);border-color:var(--dsw-alias-state-business-primary)}
.reaChildText{flex:1;min-width:0}
.reaChildName{font-size:13px;line-height:19px;font-weight:500}
.reaChildDesc{font-size:11.5px;line-height:17px;color:var(--dsw-alias-label-tertiary)}
.reaWarn{color:var(--dsw-alias-state-warning-primary,#d98a00)}
.reaRemember{display:flex;align-items:center;gap:8px;margin:14px 0 2px;font-size:13px;cursor:pointer;
  color:var(--dsw-alias-label-secondary)}
.reaErr{margin:10px 0 0;padding:8px 11px;border-radius:var(--dsw-radius-md,8px);font-size:12px;line-height:18px;
  color:var(--dsw-alias-state-error-primary,#c00);
  background:color-mix(in srgb,var(--dsw-alias-state-error-primary,#c00) 10%,transparent)}
.reaFoot{display:flex;justify-content:flex-end;gap:10px;padding:14px 22px 20px}
.reaBtn{font:inherit;font-size:13px;font-weight:500;line-height:20px;padding:8px 16px;border-radius:var(--dsw-radius-md,8px);
  cursor:pointer;border:1px solid transparent;transition:background-color .12s,opacity .12s}
.reaBtnPrimary{background:var(--dsw-alias-state-business-primary);color:var(--dsw-alias-label-primary-foreground)}
.reaBtnGhost{background:transparent;color:var(--dsw-alias-label-secondary);border-color:var(--dsw-alias-border-l4)}
.reaBtn:hover{opacity:.88}
.reaBtn:disabled{opacity:.5;cursor:default}
.reaPill{display:flex;justify-content:center;width:100%;padding:6px 0 2px}
.reaPillCard{display:inline-flex;align-items:center;gap:8px;max-width:92%;padding:5px 14px 5px 10px;border-radius:999px;
  border:1px solid color-mix(in srgb,var(--dsw-alias-state-business-primary) 55%,transparent);
  background:linear-gradient(180deg,color-mix(in srgb,var(--dsw-alias-state-business-primary) 18%,transparent),
  color-mix(in srgb,var(--dsw-alias-state-business-primary) 8%,transparent));
  color:var(--dsw-alias-label-primary);font-size:12px;line-height:18px;font-weight:600;cursor:pointer;user-select:none;
  white-space:nowrap;overflow:hidden}
.reaDot{width:7px;height:7px;border-radius:50%;background:var(--dsw-alias-state-business-primary);flex:none;
  animation:reaPulse 1.2s ease-in-out infinite}
@keyframes reaPulse{0%,100%{opacity:1;box-shadow:0 0 2px var(--dsw-alias-state-business-primary)}
  50%{opacity:.5;box-shadow:0 0 10px var(--dsw-alias-state-business-primary)}}
.reaBar{flex:1;min-width:40px;height:4px;border-radius:2px;background:var(--dsw-alias-bg-overlay);overflow:hidden}
.reaBarIn{height:100%;background:var(--dsw-alias-state-business-primary);transition:width .3s ease}
/* 胶囊双进度条：当前工具条(更细、高亮)与总进度条(较粗)。宽度变化带过渡，避免跳动。 */
.reaPillBody{display:flex;flex-direction:column;gap:1px;min-width:0;line-height:1.25}
.reaPillMainRow{white-space:nowrap}
.reaPillTitleRow{display:flex;align-items:center;gap:6px;min-width:0}
.reaPillStageName{font-weight:600;font-size:11px;color:var(--dsw-alias-state-business-primary,#1668dc);
  white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:120px}
.reaPillBarRow{display:flex;align-items:center;gap:7px;min-width:0}
.reaPillBarRow .reaPillBarInner{flex:1;min-width:70px;height:4px;border-radius:2px;background:var(--dsw-alias-bg-overlay);overflow:hidden}
.reaPillBarInner .reaPillBarIn{height:100%;border-radius:2px;transition:width .4s ease}
.reaPillBarInner.reaPillBarTotal{height:6px}
.reaPillBarInner.reaPillBarTotal .reaPillBarIn{background:var(--dsw-alias-state-business-primary,#1668dc)}
.reaPillBarInner.reaPillBarStage{height:4px}
.reaPillBarInner.reaPillBarStage .reaPillBarIn{background:var(--dsw-alias-state-success-primary,#2ea043)}
/* 当前工具阶段若无字节进度(jdk/rea 是 apt/npm 装、无下载文件) → 用不确定动画跑马灯 */
.reaPillBarInner.reaPillBarStage .reaPillBarIn.reaIndet{
  width:36%!important;animation:reaIndet 1.1s ease-in-out infinite;
  background:linear-gradient(90deg,transparent,var(--dsw-alias-state-success-primary,#2ea043),transparent)}
@keyframes reaIndet{0%{transform:translateX(-110%)}55%{transform:translateX(0)}100%{transform:translateX(300%)}}
.reaPillPct{flex:none;font-size:11px;font-variant-numeric:tabular-nums;color:var(--dsw-alias-label-secondary);min-width:34px;text-align:right}
.reaPillMeta{font-size:11px;color:var(--dsw-alias-label-tertiary);white-space:nowrap;
  overflow:hidden;text-overflow:ellipsis;font-variant-numeric:tabular-nums}
.reaPillTarget{font-size:11px;font-weight:500;color:var(--dsw-alias-label-tertiary);white-space:nowrap;
  overflow:hidden;text-overflow:ellipsis;max-width:180px}
.reaStages{margin:8px 0 0;display:flex;flex-direction:column;gap:7px}
.reaStage{display:flex;align-items:center;gap:9px;font-size:12.5px;line-height:18px}
.reaStageIco{flex:none;width:15px;text-align:center;color:var(--dsw-alias-label-tertiary)}
.reaStageDone .reaStageIco{color:var(--dsw-alias-state-success-primary,#2ea043)}
.reaStageName{flex:1;min-width:0}
.reaStageMeta{flex:none;font-size:11.5px;color:var(--dsw-alias-label-tertiary)}
.reaLog{margin:10px 0 0;padding:9px 11px;border-radius:var(--dsw-radius-md,8px);background:var(--dsw-alias-bg-overlay);
  font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:11px;line-height:16px;
  color:var(--dsw-alias-label-secondary);max-height:132px;overflow:auto;white-space:pre-wrap;word-break:break-all}
.reaSettingRow{display:flex;align-items:center;gap:12px;padding:12px 0}
.reaSettingText{flex:1;min-width:0}
.reaSettingName{font-size:14px;line-height:20px;font-weight:500}
.reaSettingDesc{font-size:12px;line-height:18px;color:var(--dsw-alias-label-tertiary);margin-top:2px}
.reaOk{color:var(--dsw-alias-state-success-primary,#2ea043);font-size:13px}
        `

        const S = {
          overlay: 'reaOverlay', dialog: 'reaDialog', head: 'reaHead', title: 'reaTitle', sub: 'reaSub',
          body: 'reaBody', group: 'reaGroup', groupOn: 'reaGroupOn', groupHead: 'reaGroupHead',
          radio: 'reaRadio', radioOn: 'reaRadioOn', groupText: 'reaGroupText', groupName: 'reaGroupName',
          groupDesc: 'reaGroupDesc', size: 'reaSize', children: 'reaChildren', child: 'reaChild',
          check: 'reaCheck', checkOn: 'reaCheckOn', childText: 'reaChildText', childName: 'reaChildName',
          childDesc: 'reaChildDesc', warn: 'reaWarn', remember: 'reaRemember', err: 'reaErr', foot: 'reaFoot',
          btn: 'reaBtn', btnPrimary: 'reaBtnPrimary', btnGhost: 'reaBtnGhost', pill: 'reaPill',
          pillCard: 'reaPillCard', dot: 'reaDot', bar: 'reaBar', barIn: 'reaBarIn', stages: 'reaStages',
          pillBody: 'reaPillBody', pillMainRow: 'reaPillMainRow', pillTarget: 'reaPillTarget',
          stage: 'reaStage', stageDone: 'reaStageDone', stageIco: 'reaStageIco', stageName: 'reaStageName',
          stageMeta: 'reaStageMeta', log: 'reaLog', settingRow: 'reaSettingRow', settingText: 'reaSettingText',
          settingName: 'reaSettingName', settingDesc: 'reaSettingDesc', ok: 'reaOk',
          pillTitleRow: 'reaPillTitleRow', pillStageName: 'reaPillStageName', pillBarRow: 'reaPillBarRow',
          pillBarInner: 'reaPillBarInner', pillBarTotal: 'reaPillBarTotal', pillBarStage: 'reaPillBarStage',
          pillBarIn: 'reaPillBarIn', pillPct: 'reaPillPct', pillMeta: 'reaPillMeta',
          indet: 'reaIndet',
        }

        // ---------------- 组件清单定义（数据驱动，便于联动） ----------------
        // 体积/版本从宿主 `/rea-tools/state` 的 sizes/versions 读取（单一来源），
        // 缺失时用下面的兜底值，避免前端与 install-manager.js 的 SIZES/VERSIONS 各写一套。
        const DEFAULT_SIZES = { jdk: 148, rea: 50, jadx: 41, ghidra: 543 }
        const DEFAULT_VERSIONS = { rea: '6.5.0', jadx: '0.7.1', ghidra: '12.1.4' }
        const itemDefs = (sizes, versions) => [
          { key: 'jdk', name: 'JDK 21 (headless)', mb: sizes.jdk, desc: 'Java 运行环境，JADX 与 rea 的运行前置' },
          { key: 'rea', name: 'rea-agents', mb: sizes.rea, desc: '提供 rea 命令与 7 个分析工具' },
          { key: 'jadx', name: `JADX 桥接 ${versions.jadx}`, mb: sizes.jadx, desc: 'APK 反编译引擎（DEX → Java）' },
          { key: 'ghidra', name: `Ghidra ${versions.ghidra}`, mb: sizes.ghidra, desc: '可选增强：伪代码反编译 / 汇编分析 / 调用关系；含 arm64 反编译器 1.8 MB（配套件，自动带上）' },
        ]
        const BASIC_KEYS = ['jdk', 'rea', 'jadx']
        const fmt = (mb) => (mb >= 1024 ? (mb / 1024).toFixed(2) + ' GB' : mb + ' MB')

        // ================= 宿主状态源（HTTP，不依赖会话） =================
        // 为什么不用 sessionProjections：设置页是 root 作用域、没有 sessionId，
        // 浮层（shell.overlay）同样是 root 作用域，拿不到 useProjection。
        // 旧版为此写了 `makeProjectionHook`，靠 `ctx.get('sessions')` 猜一个会话 +
        // 1.5s 轮询兜底，既脆弱又慢；现在改成宿主直接暴露只读状态端点。
        function createStateSource() {
          let snap = null
          let lastText = ''
          let timer = null
          let disposed = false
          const subs = new Set()
          const emit = () => { for (const f of [...subs]) { try { f() } catch { /* 忽略单个订阅者 */ } } }

          const fetchOnce = async () => {
            try {
              const res = await fetch('/rea-tools/state', {
                cache: 'no-store',
                headers: { accept: 'application/json' },
              })
              if (!res.ok) return snap
              const text = await res.text()
              // 只在内容真的变化时才 emit，避免「每 1s 无意义重渲染」
              if (text !== lastText) {
                lastText = text
                snap = JSON.parse(text)
                emit()
              }
            } catch { /* 网络异常：保留上一份快照，不打断 UI */ }
            return snap
          }

          const loop = async () => {
            if (disposed) return
            const cur = await fetchOnce()
            if (disposed) return
            // 安装中 / 待弹窗 → 1s 跟随进度；其余空闲状态 5s 一次轻量 GET 即可。
            const fast = cur && (cur.installing || cur.showDialog)
            timer = setTimeout(loop, fast ? 1000 : 5000)
          }

          return {
            get: () => snap,
            subscribe(fn) {
              subs.add(fn)
              if (subs.size === 1 && !timer && !disposed) loop()
              return () => {
                subs.delete(fn)
                if (subs.size === 0 && timer) { clearTimeout(timer); timer = null }
              }
            },
            /** 动作后立刻刷新一次（不等定时器） */
            refresh: fetchOnce,
            dispose() {
              disposed = true
              subs.clear()
              if (timer) { clearTimeout(timer); timer = null }
            },
          }
        }

        /** 发一个动作给宿主；返回 { ok, text }，失败一定有可读文案。 */
        async function postAction(payload) {
          try {
            const res = await fetch('/rea-tools/action', {
              method: 'POST',
              headers: { 'content-type': 'application/json', accept: 'application/json' },
              body: JSON.stringify(payload || {}),
            })
            let data = null
            try { data = await res.json() } catch { data = null }
            if (!res.ok) {
              return { ok: false, text: (data && (data.error || data.text)) || `HTTP ${res.status}` }
            }
            if (!data) return { ok: false, text: '宿主返回空响应' }
            if (data.ok === false) return { ok: false, text: data.text || data.error || '操作失败' }
            return { ok: true, text: data.text || '' }
          } catch (e) {
            return { ok: false, text: '无法连接宿主：' + (e && e.message ? e.message : String(e)) }
          }
        }

        // ================= 订阅小工具（不用 useSyncExternalStore，保持与仓库其它插件一致） =================
        function useSource(source) {
          const [, force] = React.useState(0)
          React.useEffect(() => source.subscribe(() => force((n) => n + 1)), [source])
          return source.get()
        }

        // ================= 安装弹窗 =================
        function InstallDialog({ state, busy, error, onInstall, onDismiss }) {
          const sizes = (state && state.sizes) || DEFAULT_SIZES
          const versions = (state && state.versions) || DEFAULT_VERSIONS
          const ITEMS = React.useMemo(() => itemDefs(sizes, versions), [sizes, versions])
          // 视图状态：初级/升级；真实数据源是 4 个 checkbox
          const [picked, setPicked] = React.useState(() => ({ jdk: true, rea: true, jadx: true, ghidra: false }))
          const [remember, setRemember] = React.useState(true)

          const basicAll = BASIC_KEYS.every((k) => picked[k])
          const anyBasic = BASIC_KEYS.some((k) => picked[k])
          // 升级版本 = 初级三项 + Ghidra 全选
          const isFull = basicAll && picked.ghidra
          // 初级三项**只能全选或全不选**：旧版允许「只勾 jdk」这种中间态，按钮仍显示
          // tier=basic，而宿主走 --skip-ghidra 会装齐三项 —— 用户的选择是假的。
          // 现在中间态直接禁用安装并给出说明，不欺骗用户。
          const midState = anyBasic && !basicAll

          const toggleChild = (k) => setPicked((p) => ({ ...p, [k]: !p[k] }))
          const pickBasic = () => setPicked({ jdk: true, rea: true, jadx: true, ghidra: false })
          const pickFull = () => setPicked({ jdk: true, rea: true, jadx: true, ghidra: true })

          const chosen = ITEMS.filter((i) => picked[i.key])
          const totalMB = chosen.reduce((a, i) => a + i.mb, 0)
          const tier = midState ? null : (isFull ? 'full' : (anyBasic ? 'basic' : null))

          const group = (opts) => {
            const on = opts.on
            return h('div', { className: S.group + (on ? ' ' + S.groupOn : '') },
              h('div', { className: S.groupHead, onClick: opts.onPick },
                h('div', { className: S.radio + (on ? ' ' + S.radioOn : '') }),
                h('div', { className: S.groupText },
                  h('div', { className: S.groupName }, opts.name),
                  h('div', { className: S.groupDesc }, opts.desc)),
                h('div', { className: S.size }, opts.sizeLabel)),
              opts.children ? h('div', { className: S.children }, opts.children) : null)
          }

          const childRow = (item) => {
            if (!item) return null
            const on = !!picked[item.key]
            return h('div', { key: item.key, className: S.child, onClick: (e) => { e.stopPropagation(); toggleChild(item.key) } },
              h('div', { className: S.check + (on ? ' ' + S.checkOn : '') }, on ? '✓' : ''),
              h('div', { className: S.childText },
                h('div', { className: S.childName }, item.name),
                h('div', { className: S.childDesc + (item.key === 'ghidra' ? ' ' + S.warn : '') }, item.desc)))
          }

          return h('div',
            // 点遮罩(弹窗外空白区域)也关闭弹窗 —— Android 上最自然的关闭方式，
            // 不依赖系统返回键。
            { className: S.overlay, role: 'dialog', 'aria-modal': 'true', onClick: onDismiss },
            h('div', { className: S.dialog, onClick: (e) => e.stopPropagation() },
              h('div', { className: S.head },
                h('h2', { className: S.title }, '⚙ REA 逆向环境需要准备'),
                h('p', { className: S.sub },
                  '为了分析安装包 / 原生二进制，需要先准备逆向环境。可后台下载，不影响你继续对话。')),
              h('div', { className: S.body },
                h('div', { style: { fontSize: '13px', fontWeight: 600, margin: '4px 0 0' } }, '请选择需要下载的环境'),

                // 初级版本
                group({
                  on: anyBasic && !isFull ? true : basicAll && !picked.ghidra,
                  onPick: pickBasic,
                  name: '初级版本',
                  desc: '支持：APK 逆向分析（包名 / 权限 / 类 / 方法）',
                  sizeLabel: '~' + fmt(BASIC_KEYS.reduce((a, k) => a + (sizes[k] || 0), 0)),
                  children: BASIC_KEYS.map((k) => childRow(ITEMS.find((i) => i.key === k))),
                }),

                // 升级版本（只显示 Ghidra，语义是"初级 + Ghidra"）
                group({
                  on: isFull,
                  onPick: pickFull,
                  name: '升级版本',
                  desc: '在初级版本之上，增加原生二进制逆向能力',
                  sizeLabel: '+' + fmt(sizes.ghidra) + '（共 ' + fmt(BASIC_KEYS.reduce((a, k) => a + (sizes[k] || 0), 0) + (sizes.ghidra || 0)) + '）',
                  children: [childRow(ITEMS.find((i) => i.key === 'ghidra'))],
                }),

                h('div', { className: S.remember, onClick: () => setRemember((v) => !v) },
                  h('div', { className: S.check + (remember ? ' ' + S.checkOn : '') }, remember ? '✓' : ''),
                  h('span', null, '记住我的选择，以后不再询问')),

                // 中间态明确说明（初级三项是固定组合，不能只选一部分）
                midState ? h('div', {
                  style: { fontSize: '12px', lineHeight: '18px', marginTop: '6px', color: 'var(--dsw-alias-state-warning-primary,#d98a00)' },
                }, '初级版本的三项（JDK / rea-agents / JADX）是固定组合，不能只选其中一部分；请整组勾选，或点上面「初级版本」自动补齐。') : null,

                // v0.2.8：动作失败必须让用户看见（旧版失败被 catch 吞掉，等于没反应）
                error ? h('div', { className: S.err }, error) : null),

              h('div', { className: S.foot },
                h('button', {
                  className: S.btn + ' ' + S.btnPrimary,
                  disabled: !tier || busy,
                  onClick: () => onInstall(tier, remember),
                }, busy ? '正在启动…' : (tier ? '后台安装（' + fmt(totalMB) + '）' : '后台安装')),
                h('button', {
                  className: S.btn + ' ' + S.btnGhost,
                  disabled: busy,
                  onClick: onDismiss,
                }, '稍后再说'))))
        }

        // ================= 进度详情面板 =================
        function ProgressPanel({ state, onCancelKeep, onCancelClean, onClose }) {
          const [askCancel, setAskCancel] = React.useState(false)
          const pct = Math.max(0, Math.min(100, (state && state.percent) || 0))
          // 兼容 ghidra-only（只装 Ghidra）——旧版只判断 'full'，
          // 导致 ghidra-only 安装时面板里根本不显示 Ghidra 阶段，进度列表是空的。
          const withGhidra = state.targetTier === 'full' || state.targetTier === 'ghidra-only'
          const onlyGhidra = state.targetTier === 'ghidra-only'
          const stages = [
            ...(onlyGhidra ? [] : [
              { key: 'jdk', name: 'JDK 21' }, { key: 'rea', name: 'rea-agents' },
              { key: 'jadx', name: 'JADX 桥接' },
            ]),
            ...(withGhidra ? [{ key: 'ghidra', name: 'Ghidra ' + ((state.versions && state.versions.ghidra) || DEFAULT_VERSIONS.ghidra) }, { key: 'decompiler', name: 'arm64 反编译器' }] : []),
          ]
          const done = state.doneStages || []
          // 取消动作后**立即关闭确认框**（旧版点了保留/删除后 askCancel 仍为 true，
          // 按钮卡在确认态，用户以为没生效）
          const doCancel = (fn) => () => { setAskCancel(false); fn() }
          return h('div',
            // 点遮罩(面板外空白)关闭详情面板(同步、不取消安装)，行为一致且自然。
            { className: S.overlay, role: 'dialog', 'aria-modal': 'true', onClick: onClose },
            h('div', { className: S.dialog, onClick: (e) => e.stopPropagation() },
              h('div', { className: S.head },
                h('h2', { className: S.title }, '⚙ REA 逆向环境 · 安装进度'),
                h('p', { className: S.sub },
                  (state.installing ? '正在后台安装' : '安装已结束')
                  + (state.stageLabel ? ' · ' + state.stageLabel : '')
                  + (state.doneMB ? ' · ' + fmt(state.doneMB) + ' / ' + fmt(state.totalMB || 0) : ''))),
              h('div', { className: S.body },
                h('div', { className: S.bar, style: { height: '6px' } },
                  h('div', { className: S.barIn, style: { width: pct + '%' } })),
                h('div', { style: { fontSize: '12px', color: 'var(--dsw-alias-label-secondary)', marginTop: '6px' } },
                  pct + '%' + (state.source ? ' · 当前源 ' + String(state.source).replace(/^https?:\/\//, '').split('/')[0] : '')),
                h('div', { className: S.stages }, stages.map((s) => {
                  const isDone = done.includes(s.key)
                  const isCur = state.stageLabel && s.name.indexOf(String(state.stageLabel).split(' ')[0]) === 0
                  return h('div', { key: s.key, className: S.stage + (isDone ? ' ' + S.stageDone : '') },
                    h('div', { className: S.stageIco }, isDone ? '✔' : (isCur ? '⟳' : '○')),
                    h('div', { className: S.stageName }, s.name),
                    h('div', { className: S.stageMeta }, isDone ? '已完成' : (isCur ? '进行中' : '等待中')))
                })),
                state.logTail && state.logTail.length
                  ? h('div', { className: S.log }, state.logTail.slice(-12).join('\n'))
                  : null,
                state.lastError ? h('div', { className: S.err }, state.lastError) : null,
                askCancel ? h('div', {
                  style: {
                    marginTop: '12px', padding: '12px', borderRadius: 'var(--dsw-radius-md,8px)',
                    background: 'var(--dsw-alias-bg-overlay)', fontSize: '13px', lineHeight: '20px',
                  },
                },
                  h('div', { style: { fontWeight: 600, marginBottom: '8px' } }, '取消安装'),
                  h('div', { style: { color: 'var(--dsw-alias-label-secondary)', marginBottom: '10px' } },
                    '已下载的部分怎么处理？'),
                  h('div', { style: { display: 'flex', gap: '8px' } },
                    h('button', { className: S.btn + ' ' + S.btnGhost, onClick: doCancel(onCancelKeep) }, '保留（下次可续传）'),
                    h('button', { className: S.btn + ' ' + S.btnGhost, onClick: doCancel(onCancelClean) }, '删除已下载'))) : null),
              h('div', { className: S.foot },
                state.installing && !askCancel
                  ? h('button', { className: S.btn + ' ' + S.btnGhost, onClick: () => setAskCancel(true) }, '取消安装')
                  : null,
                h('button', { className: S.btn + ' ' + S.btnPrimary, onClick: onClose }, '关闭'))))
        }

        // ================= 进度胶囊 =================
        function ProgressPill({ state, activity, onOpen }) {
          const installing = !!(state && state.installing)
          const active = !!(activity && activity.active)
          const justFinished = (state && state.justFinished) || null
          // 安装刚结束 → 显示一次性结果提示（旧版胶囊直接消失，用户不知道成没成）
          if (!installing && justFinished) {
            return h('div', { className: S.pill },
              h('div', {
                className: S.pillCard,
                role: 'status',
                'aria-live': 'polite',
                title: state.finishText || '',
                onClick: onOpen,
                style: {
                  borderColor: justFinished === 'success'
                    ? 'var(--dsw-alias-state-success-primary,#2ea043)'
                    : 'var(--dsw-alias-state-error-primary,#c00)',
                },
              },
                h('span', {
                  className: S.dot,
                  style: {
                    background: justFinished === 'success'
                      ? 'var(--dsw-alias-state-success-primary,#2ea043)'
                      : 'var(--dsw-alias-state-error-primary,#c00)',
                    animation: 'none',
                  },
                }),
                h('span', null, (justFinished === 'success' ? '✓ ' : '✗ ') + (state.finishText || '安装已结束'))))
          }
          // 仅在：安装中 / 有 rea 工具正在执行 时显示
          if (!installing && !active) return null
          if (active) {
            // 工具执行中的胶囊：第一行操作名 + 光点，第二行目标文件名
            const label = activity.activeLabel || '逆向分析'
            const target = activity.activeTarget || null
            return h('div', { className: S.pill },
              h('div', { className: S.pillCard, role: 'status', 'aria-live': 'polite', title: 'REA 逆向工具正在工作: ' + (label || '') + (target ? ' · ' + target : '') },
                h('span', { className: S.dot }),
                h('div', { className: S.pillBody },
                  h('div', { className: S.pillMainRow }, 'REA · ' + label + '…'),
                  (target ? h('div', { className: S.pillTarget }, target) : null))))
          }
          const pct = Math.max(0, Math.min(100, (state && state.percent) || 0))
          // 当前工具(阶段)进度：只有 jadx/ghidra 有可 stat 的下载文件能算字节百分比；
          // jdk(apt)/rea(npm) 无下载文件 → stageProgressible=false → 显示跑马灯动画。
          const stageMB = (state && state.stageMB) || 0
          const stageTotal = (state && state.stageTotalMB) || 0
          const stageProgressible = !!(state && state.stageProgressible)
          const stagePct = stageProgressible && stageTotal
            ? Math.min(100, Math.round((stageMB / stageTotal) * 100)) : 0
          const stageName = (state && state.stageLabel) || '准备环境'
          // 已下完工具数 / 总工具数（按目标层级）
          const doneStages = Array.isArray(state && state.doneStages) ? state.doneStages : []
          const tierKey = (state && state.targetTier) || 'basic'
          const TIER_KEYS = {
            basic: ['jdk', 'rea', 'jadx'],
            full: ['jdk', 'rea', 'jadx', 'ghidra', 'decompiler'],
            'ghidra-only': ['jdk', 'ghidra', 'decompiler'],
          }
          const tierTools = TIER_KEYS[tierKey] || TIER_KEYS.basic
          const doneCount = tierTools.filter((k) => doneStages.includes(k)).length
          const toolsPct = Math.round((doneCount / tierTools.length) * 100)
          const totalMB = (state && state.totalMB) || 0
          const doneMB = (state && state.doneMB) || 0
          // 下载速度：KB/s → 友好字符串（MB/s 或 KB/s）
          const kbps = (state && state.speedKBps) || 0
          const speedText = kbps <= 0 ? null : (kbps >= 1024
            ? (kbps / 1024).toFixed(1) + ' MB/s'
            : Math.max(1, Math.round(kbps)) + ' KB/s')
          return h('div', { className: S.pill },
            h('div', { className: S.pillCard, onClick: onOpen, role: 'status', 'aria-live': 'polite',
              title: '正在下载 ' + stageName + ' · 已下完 ' + doneCount + '/' + tierTools.length + ' 个工具 · 总进度 ' + pct + '%' },
              h('div', { className: S.pillBody },
                // 标题行：光点 + 标题 + 当前工具名
                h('div', { className: S.pillTitleRow },
                  h('span', { className: S.dot }),
                  h('span', null, '⚙ 正在下载'),
                  h('span', { className: S.pillStageName }, stageName)),
                // 当前工具进度条（细·绿）：有字节进度则百分比，否则跑马灯动画
                h('div', { className: S.pillBarRow },
                  h('div', { className: S.pillBarInner + ' ' + S.pillBarStage },
                    h('div', { className: S.pillBarIn + (stageProgressible || stageTotal <= 0 ? '' : ' ' + S.indet),
                      style: stageProgressible && stageTotal > 0 ? { width: stagePct + '%' } : (stageTotal > 0 ? {} : { width: '0%' }) })),
                  h('span', { className: S.pillPct }, stageProgressible && stageTotal > 0 ? stagePct + '%' : '…')),
                // 已下完工具数条（粗·蓝）：N/M 个工具
                h('div', { className: S.pillBarRow },
                  h('div', { className: S.pillBarInner + ' ' + S.pillBarTotal },
                    h('div', { className: S.pillBarIn, style: { width: toolsPct + '%' } })),
                  h('span', { className: S.pillPct }, doneCount + '/' + tierTools.length)),
                // 底部元信息：已下载体积 + 下载速度
                speedText ? h('div', { className: S.pillMeta },
                  '已下载 ' + fmt(doneMB || stageMB) + ' / ' + fmt(totalMB || stageTotal) + ' MB · ' + speedText)
                  : null)))
        }

        // ================= 设置页入口 =================
        function SettingsRow({ state, onOpenDialog, onOpenDetail, onInstallFull, onInstallBasic }) {
          const tier = (state && state.tier) || 'none'
          const sizes = (state && state.sizes) || DEFAULT_SIZES
          const basicMB = (sizes.jdk || 0) + (sizes.rea || 0) + (sizes.jadx || 0)
          const fullMB = basicMB + (sizes.ghidra || 0)
          const installing = !!(state && state.installing)
          let status, desc, action = null
          if (installing) {
            status = '安装中 ' + ((state && state.percent) || 0) + '%'
            desc = (state && state.stageLabel) ? '正在下载 ' + state.stageLabel : '正在准备…'
            action = h('button', { className: S.btn + ' ' + S.btnGhost, onClick: onOpenDetail }, '查看进度')
          } else if (tier === 'full') {
            status = '已就绪'
            desc = '当前版本：APK 逆向 + 原生二进制逆向'
          } else if (tier === 'basic') {
            status = '初级版本'
            desc = '仅 APK 逆向。如需原生二进制逆向，可升级安装 Ghidra（+' + (sizes.ghidra || 543) + ' MB）'
            action = h('button', { className: S.btn + ' ' + S.btnPrimary, onClick: onInstallFull }, '升级到升级版本')
          } else if (tier === 'partial') {
            status = '未完成'
            desc = '上次安装未完成，可继续（已下载部分会复用）'
            action = h('button', { className: S.btn + ' ' + S.btnPrimary, onClick: onInstallBasic }, '继续安装')
          } else {
            status = '未安装'
            desc = '初级版本约 ' + basicMB + ' MB（APK 逆向）；升级版本约 ' + fullMB + ' MB（增加原生二进制逆向）'
            action = h('button', { className: S.btn + ' ' + S.btnPrimary, onClick: onOpenDialog }, '安装环境')
          }
          return h('div', { className: S.settingRow },
            h('div', { className: S.settingText },
              h('div', { className: S.settingName }, 'REA 逆向环境'),
              h('div', { className: S.settingDesc }, desc),
              h('div', {
                className: tier === 'full' && !installing ? S.ok : S.settingDesc,
                style: { marginTop: '2px' },
              }, '当前状态：' + status)),
            action)
        }

        // ================= 插件主体 =================
        function apply(ctx) {
          // 样式注入（随 effect 清理）
          ctx.effect(() => {
            const el = document.createElement('style')
            el.setAttribute('data-rea-tools', '')
            el.textContent = CSS
            document.head.appendChild(el)
            return () => { try { el.remove() } catch { /* 已移除 */ } }
          }, 'rea-tools: styles')

          // 唯一的宿主状态源（全插件共用一份轮询，避免设置页/浮层各拉一条）
          const source = createStateSource()
          ctx.effect(() => () => source.dispose(), 'rea-tools: state source')

          // 跨插槽 UI 开关：浮层（shell.overlay）与设置页共享「详情面板是否展开」。
          // 这个 store 是 root 级（不按 session 分），因为两个入口都是 root 作用域。
          let uiState = { detail: false, dialog: false, error: null, busy: false }
          const uiSubs = new Set()
          const push = (patch) => {
            uiState = { ...uiState, ...patch }
            for (const fn of [...uiSubs]) { try { fn() } catch { /* 忽略 */ } }
          }
          const useUiState = () => {
            const [, force] = React.useState(0)
            React.useEffect(() => {
              const fn = () => force((n) => n + 1)
              uiSubs.add(fn)
              return () => uiSubs.delete(fn)
            }, [])
            return uiState
          }

          // 统一的动作执行：失败一定写进 uiState.error（不再静默）
          // opts.noBusy=true 时不改 busy —— 用于「稍后再说 / 保留 / 删除 / 关闭」这类
          // 非安装动作。它们若也置 busy，会瞬间把「后台安装…」按成「正在启动…」，
          // 造成弹窗关闭前一帧的文案闪烁。
          const runAction = async (payload, okPatch, opts) => {
            if (!(opts && opts.noBusy)) push({ busy: true, error: null })
            const r = await postAction(payload)
            if (r.ok) {
              if (!(opts && opts.noBusy)) push({ busy: false })
              push(okPatch || {})
            } else {
              if (!(opts && opts.noBusy)) push({ busy: false })
              push({ error: r.text || '操作失败' })
            }
            await source.refresh()
            return r
          }

          const install = (tier, remember) => runAction(
            { action: 'install', tier: tier === 'full' ? 'full' : 'basic', remember: remember !== false },
            { dialog: false },
          )
          // 「稍后再说」/ 点遮罩关闭：立即同步把 UI 关掉（不依赖网络往返，保证弹窗
          // 必消失、不会因 HTTP 失败而卡住），再在后台通知服务端，不阻塞 UI。
          const dismiss = () => {
            push({ dialog: false, detail: false })
            postAction({ action: 'dismiss' }).catch(() => {})
          }
          const cancelKeep = () => runAction({ action: 'cancel' }, null, { noBusy: true })
          const cancelClean = () => runAction({ action: 'cancel-clean' }, null, { noBusy: true })

          // ---------- 1) 安装弹窗 + 进度详情（全屏浮层，root 作用域）----------
          // 注册在 shell.overlay 而不是 conversation.composer：后者是 chain 插槽，
          // 必须提供 select()（否则 register 抛错，弹窗永远不出现），且会抢输入区。
          ctx.slots.inject('shell.overlay', () => ctx.slots.register({
            name: 'shell.overlay',
            id: 'rea-install-overlay',
            order: 40,
          }, function ReaOverlay() {
            const state = useSource(source)
            const ui = useUiState()
            // 系统返回键关闭弹窗：弹窗可见时压一条 history 记录并监听 popstate，
            // 这样 Android/WebView 的返回键(或浏览器后退)会触发 popstate → 关弹窗，
            // 而不是直接作用到底层页面/退出应用。
            const visible = !!(state && (ui.detail || ui.dialog || !!state.showDialog))
            const REA_BACK_KEY = 'rea-tools-back'
            React.useEffect(() => {
              if (!visible) return undefined
              const lenBefore = window.history.length
              // 压入弹窗标记位，让返回键先"命中"这个记录而非底层页面
              window.history.pushState(Object.assign({}, window.history.state, { [REA_BACK_KEY]: true }), '')
              try { console.log('[rea-tools] dialog visible, history.length=' + lenBefore + '->' + window.history.length) } catch { /* ignore */ }
              const onPop = () => {
                // 返回触发：移除监听防重入。
                window.removeEventListener('popstate', onPop)
                try { console.log('[rea-tools] popstate fired, closing overlay') } catch { /* ignore */ }
                // 同步关闭弹窗，不依赖异步 HTTP —— 弹窗必须「立即」从屏幕上消失。
                // （dismiss 走 HTTP，若等它回来再关会有可见延迟；且这里仅需关掉 UI。）

                push({ detail: false, dialog: false })
                // 后台通知服务端「弹窗已被关闭」，不阻塞 UI，失败忽略。
                postAction({ action: 'dismiss' }).catch(() => {})
              }
              window.addEventListener('popstate', onPop)
              return () => {
                window.removeEventListener('popstate', onPop)
                // 弹窗因按钮正常关闭时，把压入的标记位回退掉，避免在 history 里残留
                if (history.state && history.state[REA_BACK_KEY]) history.back()
              }
            }, [visible, ui.detail])
            if (!state) return null
            // 详情面板优先（用户主动点的），否则按宿主 showDialog 自动弹窗
            let content
            if (ui.detail) {
              content = h(ProgressPanel, {
                state,
                onClose: () => push({ detail: false }),
                onCancelKeep: cancelKeep,
                onCancelClean: cancelClean,
              })
            } else {
              const wantDialog = ui.dialog || !!state.showDialog
              if (wantDialog) {
                content = h(InstallDialog, {
                  state,
                  busy: ui.busy,
                  error: ui.error,
                  onInstall: (tier, remember) => install(tier, remember),
                  onDismiss: dismiss,
                })
              }
            }
            // Portal 到 document.body：shell.overlay 容器自身 z-index 仅 20，
            // 而 DSH 设置页抽屉是更高层的独立浮层——弹窗若留在 overlay 容器里，
            // 会因父层 stacking context 被设置页盖住，必须「关掉设置页才能看到」。
            // 用 React Portal 直接挂 body 顶层 + 高 z-index，即可始终悬浮在设置页之上。
            if (content == null) return null
            return ReactDOM && typeof ReactDOM.createPortal === 'function'
              ? ReactDOM.createPortal(content, document.body)
              : content
          }))

          // ---------- 2) 进度胶囊 / 工具工作状态 ----------
          ctx.slots.inject('conversation.input.dock', () => ctx.slots.register({
            name: 'conversation.input.dock',
            id: 'rea-progress',
            order: 36,
          }, function ReaPill(props) {
            const state = useSource(source)
            // 工具执行中的活动态来自会话投影（这部分与会话相关，保持投影驱动）
            const activity = props && typeof props.useProjection === 'function'
              ? props.useProjection('rea')
              : null
            if (!state && !activity) return null
            return h(ProgressPill, {
              state: state || {},
              activity: activity || {},
              onOpen: () => push({ detail: true }),
            })
          }))

          // ---------- 3) 设置页入口 ----------
          // settings.general.item 是 root 作用域、不传 props，因此这里只用 HTTP 状态源 +
          // 共享 store，不再依赖「猜一个可用会话」的 makeProjectionHook。
          ctx.slots.inject('settings.general.item', () => ctx.slots.register({
            name: 'settings.general.item',
            id: 'rea-environment',
            order: 30,
          }, function ReaSettingsItem() {
            const state = useSource(source)
            return h(SettingsRow, {
              state: state || {},
              onOpenDialog: () => push({ dialog: true, error: null }),
              onOpenDetail: () => push({ detail: true }),
              // 初级 → 升级：直接装 full（保留 remember=true，与设置页语义一致）
              onInstallFull: () => install('full', true),
              onInstallBasic: () => install('basic', true),
            })
          }))
        }

        return { name: '@local/rea-tools', inject: ['slots'], apply }
      },
    })
  } catch (err) {
    console.warn('[rea-tools] client runtime error:', err)
  }
})()
