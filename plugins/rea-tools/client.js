// rea-tools 客户端半部 —— 环境安装弹窗 + 进度胶囊 + 详情面板 + 设置入口。
//
// 渲染面（slot）选择：
//   conversation.composer        弹窗/详情（官方 approval / user-questions 用同一插槽做"接管输入区"的卡片）
//   conversation.input.dock      进度胶囊（官方 goal、gh-accel 用同一插槽的窄条）
//   settings.general.item        设置页入口（初级版本装完后想升级，从这里找）
//
// 状态来源：宿主投影 'rea'（useProjection('rea')），不轮询。
// 动作来源：宿主会话命令，经 ctx.remote.commands.execute(sessionId, '/<cmd>') 调用。
//
// 样式：只用 --dsw-alias-* 主题 token，深浅主题自适应；不 require 任何 Harness 客户端包。

(() => {
  try {
    window.__ModuleLoader__.load({
      id: '@local/rea-tools',
      factory(require) {
        const React = require('react')
        const h = React.createElement

        // ---------------- 样式（全部走主题 token） ----------------
        const CSS = `
.reaOverlay{position:fixed;inset:0;z-index:60;display:flex;align-items:center;justify-content:center;
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
.reaPillBody{display:flex;flex-direction:column;gap:1px;min-width:0;line-height:1.25}
.reaPillMainRow{white-space:nowrap}
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
          childDesc: 'reaChildDesc', warn: 'reaWarn', remember: 'reaRemember', foot: 'reaFoot',
          btn: 'reaBtn', btnPrimary: 'reaBtnPrimary', btnGhost: 'reaBtnGhost', pill: 'reaPill',
          pillCard: 'reaPillCard', dot: 'reaDot', bar: 'reaBar', barIn: 'reaBarIn', stages: 'reaStages',
          pillBody: 'reaPillBody', pillMainRow: 'reaPillMainRow', pillTarget: 'reaPillTarget',
          stage: 'reaStage', stageDone: 'reaStageDone', stageIco: 'reaStageIco', stageName: 'reaStageName',
          stageMeta: 'reaStageMeta', log: 'reaLog', settingRow: 'reaSettingRow', settingText: 'reaSettingText',
          settingName: 'reaSettingName', settingDesc: 'reaSettingDesc', ok: 'reaOk',
        }

        // ---------------- 组件清单定义（数据驱动，便于联动） ----------------
        // v0.2.6：体积改成从投影的 `sizes`（host 侧 SIZES）读取，不再前端写死——
        // 旧版这里硬编码 148/50/41/543，与 install-manager.js 的 SIZES 重复，升级时易不一致。
        // 名称里的版本号同理从投影 `versions` 取（host 侧 VERSIONS）。
        const DEFAULT_SIZES = { jdk: 148, rea: 50, jadx: 41, ghidra: 543 }
        const itemDefs = (sizes, versions) => [
          { key: 'jdk', name: `JDK 21 (headless)`, mb: sizes.jdk, desc: 'Java 运行环境，JADX 与 rea 的运行前置' },
          { key: 'rea', name: `rea-agents ${versions.rea}`, mb: sizes.rea, desc: '提供 rea 命令与 7 个分析工具' },
          { key: 'jadx', name: `JADX 桥接 ${versions.jadx}`, mb: sizes.jadx, desc: 'APK 反编译引擎（DEX → Java）' },
          { key: 'ghidra', name: `Ghidra ${versions.ghidra}`, mb: sizes.ghidra, desc: '可选增强：伪代码反编译 / 汇编分析 / 调用关系；含 arm64 反编译器 1.8 MB（配套件，自动带上）' },
        ]
        const BASIC_KEYS = ['jdk', 'rea', 'jadx']
        const fmt = (mb) => (mb >= 1024 ? (mb / 1024).toFixed(2) + ' GB' : mb + ' MB')

        // ================= 安装弹窗 =================
        function InstallDialog({ state, onInstall, onDismiss }) {
          // v0.2.6：体积/版本从投影取（host 侧单一来源），缺失时用兜底值
          const sizes = (state && state.sizes) || DEFAULT_SIZES
          const versions = (state && state.versions) || { rea: '6.5.0', jadx: '0.7.1', ghidra: '12.1.4' }
          const ITEMS = React.useMemo(() => itemDefs(sizes, versions), [sizes, versions])
          // 视图状态：初级/升级；真实数据源是 4 个 checkbox
          const [picked, setPicked] = React.useState(() => ({ jdk: true, rea: true, jadx: true, ghidra: false }))
          const [remember, setRemember] = React.useState(true)

          const basicAll = BASIC_KEYS.every((k) => picked[k])
          const anyBasic = BASIC_KEYS.some((k) => picked[k])
          // 升级版本 = 初级三项 + Ghidra 全选
          const isFull = basicAll && picked.ghidra
          // v0.2.6 修复：初级三项**只能全选或全不选**。
          // 旧版允许「只勾 jdk」这种中间态，按钮仍显示 tier=basic，而 host 走
          // `--skip-ghidra` 会**装齐三项**——用户的选择是假的。
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
            const on = !!picked[item.key]
            return h('div', { key: item.key, className: S.child, onClick: (e) => { e.stopPropagation(); toggleChild(item.key) } },
              h('div', { className: S.check + (on ? ' ' + S.checkOn : '') }, on ? '✓' : ''),
              h('div', { className: S.childText },
                h('div', { className: S.childName }, item.name),
                h('div', { className: S.childDesc + (item.key === 'ghidra' ? ' ' + S.warn : '') }, item.desc)))
          }

          return h('div', { className: S.overlay, role: 'dialog', 'aria-modal': 'true' },
            h('div', { className: S.dialog },
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
                  sizeLabel: '~' + fmt(BASIC_KEYS.reduce((a, k) => a + sizes[k], 0)),
                  children: BASIC_KEYS.map((k) => childRow(ITEMS.find((i) => i.key === k))),
                }),

                // 升级版本（只显示 Ghidra，语义是"初级 + Ghidra"）
                group({
                  on: isFull,
                  onPick: pickFull,
                  name: '升级版本',
                  desc: '在初级版本之上，增加原生二进制逆向能力',
                  sizeLabel: '+' + fmt(sizes.ghidra) + '（共 ' + fmt(BASIC_KEYS.reduce((a, k) => a + sizes[k], 0) + sizes.ghidra) + '）',
                  children: [childRow(ITEMS.find((i) => i.key === 'ghidra'))],
                }),

                h('div', { className: S.remember, onClick: () => setRemember((v) => !v) },
                  h('div', { className: S.check + (remember ? ' ' + S.checkOn : '') }, remember ? '✓' : ''),
                  h('span', null, '记住我的选择，以后不再询问')),

                // v0.2.6：中间态明确说明（初级三项是固定组合，不能只选一部分）
                midState ? h('div', {
                  style: { fontSize: '12px', lineHeight: '18px', marginTop: '6px', color: 'var(--dsw-alias-state-warning-primary,#d98a00)' },
                }, '初级版本的三项（JDK / rea-agents / JADX）是固定组合，不能只选其中一部分；请整组勾选，或点上面「初级版本」自动补齐。') : null),

              h('div', { className: S.foot },
                h('button', {
                  className: S.btn + ' ' + S.btnPrimary,
                  disabled: !tier,
                  onClick: () => onInstall(tier, remember),
                }, tier ? '后台安装（' + fmt(totalMB) + '）' : '后台安装'),
                h('button', { className: S.btn + ' ' + S.btnGhost, onClick: onDismiss }, '稍后再说'))))
        }

        // ================= 进度详情面板 =================
        function ProgressPanel({ state, onCancelKeep, onCancelClean, onClose }) {
          const [askCancel, setAskCancel] = React.useState(false)
          const pct = Math.max(0, Math.min(100, state.percent || 0))
          // v0.2.6：兼容 ghidra-only（只装 Ghidra）——旧版只判断 'full'，
          // 导致 ghidra-only 安装时面板里根本不显示 Ghidra 阶段，进度列表是空的。
          const withGhidra = state.targetTier === 'full' || state.targetTier === 'ghidra-only'
          const onlyGhidra = state.targetTier === 'ghidra-only'
          const stages = [
            ...(onlyGhidra ? [] : [
              { key: 'jdk', name: 'JDK 21' }, { key: 'rea', name: 'rea-agents' },
              { key: 'jadx', name: 'JADX 桥接' },
            ]),
            ...(withGhidra ? [{ key: 'ghidra', name: 'Ghidra 12.1.4' }, { key: 'decompiler', name: 'arm64 反编译器' }] : []),
          ]
          const done = state.doneStages || []
          // v0.2.6：取消动作后**立即关闭确认框**（旧版点了保留/删除后 askCancel 仍为 true，
          // 按钮卡在确认态，用户以为没生效）
          const doCancel = (fn) => () => { setAskCancel(false); fn() }
          return h('div', { className: S.overlay, role: 'dialog', 'aria-modal': 'true' },
            h('div', { className: S.dialog },
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
        function ProgressPill({ state, onOpen, mode }) {
          if (!state) return null
          const installing = !!state.installing
          const active = !!state.active
          const justFinished = state.justFinished || null
          // v0.2.6：安装刚结束 → 显示一次性结果提示（旧版胶囊直接消失，用户不知道成没成）
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
            const label = state.activeLabel || '逆向分析'
            const target = state.activeTarget || null
            return h('div', { className: S.pill },
              h('div', { className: S.pillCard, role: 'status', 'aria-live': 'polite', title: 'REA 逆向工具正在工作: ' + (label || '') + (target ? ' · ' + target : '') },
                h('span', { className: S.dot }),
                h('div', { className: S.pillBody },
                  h('div', { className: S.pillMainRow }, 'REA · ' + label + '…'),
                  (target ? h('div', { className: S.pillTarget }, target) : null))))
          }
          const pct = Math.max(0, Math.min(100, state.percent || 0))
          return h('div', { className: S.pill },
            h('div', { className: S.pillCard, onClick: onOpen, role: 'status', 'aria-live': 'polite', title: '点击查看详情' },
              h('span', { className: S.dot }),
              h('span', null, '⚙ REA 环境准备中'),
              h('span', { className: S.bar }, h('span', { className: S.barIn, style: { width: pct + '%' } })),
              h('span', null, pct + '%')))
        }

        // ================= 设置页入口 =================
        function SettingsRow({ state, onOpen, onInstallFull, onInstallBasic }) {
          const tier = state ? state.tier : 'none'
          // v0.2.6：体积从投影取（host 单一来源），不再在本组件里写死 239/784/543
          const sizes = (state && state.sizes) || DEFAULT_SIZES
          const basicMB = (sizes.jdk || 0) + (sizes.rea || 0) + (sizes.jadx || 0)
          const fullMB = basicMB + (sizes.ghidra || 0)
          const installing = state && state.installing
          const [showDialog, setShowDialog] = React.useState(false)
          let status, desc, action = null
          if (installing) {
            status = '安装中 ' + (state.percent || 0) + '%'
            desc = state.stageLabel ? '正在下载 ' + state.stageLabel : '正在准备…'
            action = h('button', { className: S.btn + ' ' + S.btnGhost, onClick: onOpen }, '查看进度')
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
            // 未安装时点击整行弹出选择弹窗（初级/升级可选）
            action = h('button', { className: S.btn + ' ' + S.btnPrimary, onClick: (e) => { e.stopPropagation(); setShowDialog(true) } }, '安装环境')
          }
          return h('div', { className: S.settingRow, onClick: !installing && tier === 'none' ? () => setShowDialog(true) : undefined },
            h('div', { className: S.settingText },
              h('div', { className: S.settingName }, 'REA 逆向环境'),
              h('div', { className: S.settingDesc }, desc),
              h('div', {
                className: tier === 'full' && !installing ? S.ok : S.settingDesc,
                style: { marginTop: '2px' },
              }, '当前状态：' + status)),
            action,
            showDialog ? h(InstallDialogWrap, { state, onInstallFull, onInstallBasic, onClose: () => setShowDialog(false) }) : null)
        }

        // 设置页内弹出的安装选择弹窗（复用 InstallDialog，走设置行的动作）
        function InstallDialogWrap({ state, onInstallFull, onInstallBasic, onClose }) {
          return h(InstallDialog, {
            state,
            onInstall: (tier) => { onClose(); return tier === 'full' ? onInstallFull() : onInstallBasic() },
            onDismiss: () => { onClose(); return Promise.resolve() },
          })
        }

        // ================= 跨插槽共享的 UI 开关 =================
        // 胶囊（input.dock）、弹窗（composer）、详情（input.overlay）分属不同插槽，
        // 需要一个共享的小 store 让「点胶囊 → 开详情」生效，并触发重渲染。
        function makeStore() {
          let value = { dialog: false }
          const subs = new Set()
          return {
            get: () => value,
            set: (patch) => { value = { ...value, ...patch }; for (const f of subs) { try { f() } catch { /* 忽略 */ } } },
            subscribe: (f) => { subs.add(f); return () => subs.delete(f) },
          }
        }
        function useStore(store) {
          const [, force] = React.useState(0)
          React.useEffect(() => store.subscribe(() => force((n) => n + 1)), [store])
          return store.get()
        }

        // 无 props 插槽（settings.general.item）专用的投影读取 hook：
        // 经 sessions 服务拿到任意会话的 projection face，再订阅它。
        function makeProjectionHook(ctx) {
          return function useReaProjection() {
            const read = () => {
              try {
                const sessions = ctx.get('sessions')
                if (!sessions) return null
                const byId = sessions.list.getSnapshot().byId || {}
                const ids = Object.keys(byId)
                if (!ids.length) return null
                const main = ids.find((id) => (byId[id].retainedBy?.mainView ?? 0) > 0) || ids[0]
                const binding = sessions.binding(main)
                const face = binding?.session?.projections?.faceOf('rea')
                return face ? face.getSnapshot() : null
              } catch { return null }
            }
            const [snap, setSnap] = React.useState(read)
            React.useEffect(() => {
              let stop = null
              try {
                const sessions = ctx.get('sessions')
                const byId = sessions?.list?.getSnapshot()?.byId || {}
                const ids = Object.keys(byId)
                const main = ids.find((id) => (byId[id].retainedBy?.mainView ?? 0) > 0) || ids[0]
                const binding = main ? sessions.binding(main) : null
                const face = binding?.session?.projections?.faceOf('rea')
                if (face && typeof face.subscribe === 'function') stop = face.subscribe(() => setSnap(face.getSnapshot()))
              } catch { /* 无投影可用 */ }
              const t = setInterval(() => setSnap(read()), 1500)  // 兜底轻量刷新
              return () => { if (stop) stop(); clearInterval(t) }
            }, [])
            return snap
          }
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

          // 每个 session 一份 UI 开关状态
          //
          // v0.2.6：settings.general.item 是 root scope（没有 sessionId），而详情面板
          // 挂在 conversation.input.overlay（按 session 分）。若两者用不同 store，
          // 设置页点「查看进度」写的 dialog 标志到不了面板所在的 store → 点了没反应。
          // 修复：维护一个**全局「请求打开详情」标志**，任意 store 都能消费：
          // 设置页置位 → 当前可见会话的胶囊/面板读到后打开并清除。
          let globalOpenRequest = false
          const stores = new Map()
          const storeOf = (sessionId) => {
            const key = sessionId || '__root__'
            if (!stores.has(key)) stores.set(key, makeStore())
            return stores.get(key)
          }
          const requestOpenDetail = () => {
            globalOpenRequest = true
            // 让所有 store 重渲染，消费方（胶囊/面板）会读到并打开
            for (const s of stores.values()) s.set({})
            // 若还没建过任何 session store，兜底建一个 root 的
            if (stores.size === 0) storeOf('__root__').set({})
          }
          const consumeOpenRequest = () => {
            if (!globalOpenRequest) return false
            globalOpenRequest = false
            return true
          }

          // 找一个可用 session（settings 插槽是 root scope、拿不到 sessionId 时用）
          const anySessionId = () => {
            try {
              const sessions = ctx.get('sessions')
              if (!sessions) return undefined
              const byId = sessions.list.getSnapshot().byId || {}
              const ids = Object.keys(byId)
              if (ids.length === 0) return undefined
              // 优先挑有主视图占用的（通常是用户正开着的那个）
              const main = ids.find((id) => (byId[id].retainedBy?.mainView ?? 0) > 0)
              return main || ids[0]
            } catch { return undefined }
          }

          const runCommand = async (sessionId, line) => {
            const sid = sessionId || anySessionId()
            if (!sid) return { ok: false, error: { message: '当前没有可用会话' } }
            try {
              return await ctx.remote.commands.execute(sid, line, [])
            } catch (e) {
              return { ok: false, error: { message: e && e.message ? e.message : String(e) } }
            }
          }

          // ---------- 1) 安装弹窗（接管输入区）----------
          ctx.slots.inject('conversation.composer', () => ctx.slots.register({
            name: 'conversation.composer',
            id: 'rea-install-dialog',
            order: 40,
            inject: (sessionId) => {
              const store = storeOf(sessionId)
              return {
                reaStore: store,
                reaActions: {
                  // v0.2.6：接收 remember（旧版只收 tier，「记住我的选择」勾了也没用）
                  install: (tier, remember) => {
                    store.set({ dialog: false })
                    // remember=true 时 host 侧已默认写 dismissed=true；false 时清除
                    return runCommand(sessionId, (tier === 'full' ? '/rea-install-full' : '/rea-install-basic')
                      + (remember === false ? ' --no-remember' : ''))
                  },
                  dismiss: () => {
                    store.set({ dialog: false, dismissed: true })
                    return runCommand(sessionId, '/rea-dismiss')
                  },
                },
              }
            },
          }, (props) => {
            const proj = props.useProjection ? props.useProjection('rea') : null
            const local = useStore(props.reaStore)
            if (!proj || !proj.showDialog || local.dismissed) return null
            return h(InstallDialog, {
              state: proj,
              onInstall: (tier) => props.reaActions.install(tier),
              onDismiss: () => props.reaActions.dismiss(),
            })
          }))

          // ---------- 2) 进度胶囊 ----------
          ctx.slots.inject('conversation.input.dock', () => ctx.slots.register({
            name: 'conversation.input.dock',
            id: 'rea-progress',
            order: 36,
            inject: (sessionId) => ({
              reaStore: storeOf(sessionId),
            }),
          }, (props) => {
            const proj = props.useProjection ? props.useProjection('rea') : null
            const local = useStore(props.reaStore)
            // v0.2.6：消费设置页的「查看进度」全局请求
            const [, force] = React.useState(0)
            React.useEffect(() => {
              if (consumeOpenRequest()) {
                props.reaStore.set({ dialog: true })
                force((n) => n + 1)
              }
            })
            if (!proj || (!proj.installing && !proj.active && !proj.justFinished && !local.dialog)) return null
            return h(ProgressPill, {
              state: proj,
              onOpen: () => props.reaStore.set({ dialog: true }),
            })
          }))

          // ---------- 3) 详情面板 ----------
          ctx.slots.inject('conversation.input.overlay', () => ctx.slots.register({
            name: 'conversation.input.overlay',
            id: 'rea-progress-detail',
            order: 40,
            inject: (sessionId) => ({
              reaStore: storeOf(sessionId),
              reaActions: {
                close: () => storeOf(sessionId).set({ dialog: false }),
                cancelKeep: () => runCommand(sessionId, '/rea-cancel'),
                cancelClean: () => runCommand(sessionId, '/rea-cancel-clean'),
              },
            }),
          }, (props) => {
            const proj = props.useProjection ? props.useProjection('rea') : null
            const local = useStore(props.reaStore)
            // v0.2.6：消费设置页的「查看进度」全局请求（面板自带消费，不依赖胶囊先渲染）
            const [, force] = React.useState(0)
            React.useEffect(() => {
              if (consumeOpenRequest()) {
                props.reaStore.set({ dialog: true })
                force((n) => n + 1)
              }
            })
            if (!local.dialog) return null
            return h(ProgressPanel, {
              state: proj || {},
              onClose: () => props.reaActions.close(),
              onCancelKeep: () => props.reaActions.cancelKeep(),
              onCancelClean: () => props.reaActions.cancelClean(),
            })
          }))

          // ---------- 4) 设置页入口（初级 → 升级 的入口）----------
          // 注意：settings.general.item 是 root scope、**不传任何 props**，
          // 所以这里的数据与动作全部走自己的 inject face（见上方 host 文档说明）。
          ctx.slots.inject('settings.general.item', () => ctx.slots.register({
            name: 'settings.general.item',
            id: 'rea-environment',
            order: 30,
            inject: () => {
              // inject 在 root scope 下调用，sessionId 为空 → 用 anySessionId() 兜底
              const store = storeOf('__root__')
              return {
                reaStore: store,
                reaActions: {
                  installBasic: () => runCommand(undefined, '/rea-install-basic'),
                  installFull: () => runCommand(undefined, '/rea-install-full'),
                  // v0.2.6：打开进度详情面板（跨插槽：置全局请求 → 面板/胶囊消费）
                  openDetail: () => requestOpenDetail(),
                },
              }
            },
          }, (props) => {
            const useReaProjection = React.useMemo(() => makeProjectionHook(ctx), [])
            const proj = props && props.useProjection ? props.useProjection('rea') : useReaProjection()
            return h(SettingsRow, {
              state: proj,
              // v0.2.6：旧版是 `onOpen: () => {}` 空函数——「查看进度」按钮点了完全没反应。
              // 现在写入共享 store 的 dialog 标志，input.dock 胶囊随之渲染，点胶囊开详情面板。
              onOpen: () => { try { props.reaActions.openDetail() } catch { /* store 不可用 */ } },
              onInstallBasic: () => props.reaActions.installBasic(),
              onInstallFull: () => props.reaActions.installFull(),
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
