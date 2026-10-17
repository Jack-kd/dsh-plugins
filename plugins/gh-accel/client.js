// gh-accel v2.3.0 客户端半体 —— 输入框上方「加速器加速中…」状态小框。
//
// 仅当会话投影 gh-accel.active === true（某次下载/克隆正走加速节点，或正在
// push 上传）时渲染；空闲、直连（国内不绕路）或完成时自动隐藏，不占位置、
// 不残留。样式全部走 --dsw-* 主题 token，深浅主题下自动适配。
// v2.3.0：新增实时速度/进度显示——左侧环形进度圈（中心呼吸灯点），右侧两行
// 文案：首行「⚡ 加速器加速中…」，次行小字号灰字显示速度与分式进度
// （下载态：↓ 速度 · 已完成/总量；拿不到总量时只显示速度；上传态：↑ 推送中…）。
// 速度/进度数据来自 host 端 /gh-accel/progress 只读端点（每 200ms 轮询，更顺滑）。

(() => {
  try {
    window.__ModuleLoader__.load({
      id: '@local/gh-accel',
      factory(require) {
        const React = require('react');
        const h = React.createElement;

        const inject = ['slots'];

        const CSS =
          // 呼吸光点（脉冲光晕）
          '@keyframes ghAccelPulse{0%,100%{box-shadow:0 0 2px var(--dsw-alias-state-success-primary);opacity:1}' +
          '50%{box-shadow:0 0 12px var(--dsw-alias-state-success-primary);opacity:.5}}' +
          // 底部滑入（出现时从上往下轻轻落位）
          '@keyframes ghAccelSlideIn{from{transform:translateY(6px);opacity:0}' +
          'to{transform:translateY(0);opacity:1}}' +
          // 不确定态：环形圈虚线缓慢旋转（拿不到总量时）
          '@keyframes ghAccelSpin{from{transform:rotate(0deg)}to{transform:rotate(360deg)}}';

        const WRAP_STYLE = {
          display: 'flex',
          justifyContent: 'center',
          width: '100%',
          paddingTop: '6px',
          paddingBottom: '2px',
          animation: 'ghAccelSlideIn .18s ease-out',
        };

        const CARD_STYLE = {
          display: 'inline-flex',
          alignItems: 'center',
          gap: '9px',
          width: 'fit-content',
          maxWidth: '92%',
          padding: '6px 14px 6px 10px',
          borderRadius: '999px',
          border: '1px solid color-mix(in srgb, var(--dsw-alias-state-success-primary) 55%, transparent)',
          background:
            'linear-gradient(180deg, color-mix(in srgb, var(--dsw-alias-state-success-primary) 18%, transparent), ' +
            'color-mix(in srgb, var(--dsw-alias-state-success-primary) 8%, transparent))',
          boxShadow: '0 2px 10px color-mix(in srgb, var(--dsw-alias-state-success-primary) 25%, transparent)',
          color: 'var(--dsw-alias-label-primary)',
          fontFamily: 'inherit',
          userSelect: 'none',
        };

        // 环形进度圈 + 中心呼吸灯点
        const RING_SIZE = 22;
        const RING_STROKE = 2.5;
        const RING_RADIUS = (RING_SIZE - RING_STROKE) / 2;
        const RING_CIRCUM = 2 * Math.PI * RING_RADIUS;

        // 字节 → 人类可读大小（自动 B/KB/MB/GB）
        function fmtBytes(n) {
          if (!Number.isFinite(n) || n <= 0) return '0B';
          const units = ['B', 'KB', 'MB', 'GB'];
          let i = 0;
          let v = n;
          while (v >= 1024 && i < units.length - 1) { v /= 1024; i++; }
          const rounded = v >= 10 ? Math.round(v) : Math.round(v * 10) / 10;
          return `${rounded}${units[i]}`;
        }

        function AccelBadge(props) {
          const useProjection = props.useProjection;
          const state = typeof useProjection === 'function'
            ? useProjection('gh-accel')
            : undefined;
          const active = Boolean(state && state.active);
          const direction = (state && state.direction) || 'download';

          // 实时速度/进度：轮询 host /gh-accel/progress
          const [progress, setProgress] = React.useState(null);
          // 环形圈平滑插值：真实进度每 200ms 才更新一格，用 rAF 每帧逼近目标，
          // 让「转圈 + 已下载/总量」视觉上连续丝滑，不看数据更新节奏。
          const [dispPct, setDispPct] = React.useState(0);
          React.useEffect(() => {
            if (!active || !progress || !(progress.totalB > 0)) { setDispPct(0); return; }
            const target = Math.min(100, (progress.doneB / progress.totalB) * 100);
            let raf = 0;
            const step = () => {
              setDispPct((p) => {
                const diff = target - p;
                if (Math.abs(diff) < 0.05) return target;
                return p + diff * 0.35;
              });
              raf = requestAnimationFrame(step);
            };
            raf = requestAnimationFrame(step);
            return () => cancelAnimationFrame(raf);
          }, [active, progress]);
          React.useEffect(() => {
            if (!active) { setProgress(null); return; }
            let stopped = false;
            let timer = null;
            const poll = async () => {
              let next = null;
              try {
                const res = await fetch('/gh-accel/progress', { headers: { accept: 'application/json' } });
                if (stopped) return;
                if (res.ok) {
                  const j = await res.json().catch(() => null);
                  if (j && Array.isArray(j.items)) {
                    // 取最近更新的 download 任务；upload 无字节数据则保持为空
                    const dl = j.items.filter((it) => it.dir === 'download')
                      .sort((a, b) => (b.ts || 0) - (a.ts || 0))[0];
                    next = dl || null;
                  }
                }
              } catch {
                next = null;
              } finally {
                if (!stopped) {
                  setProgress(next);
                  timer = setTimeout(poll, 200);
                }
              }
            };
            poll();
            return () => { stopped = true; if (timer) clearTimeout(timer); };
          }, [active]);

          // 只有正走加速节点下载/上传时才显示；空闲/直连/完成一律不渲染
          if (!active) return null;

          const hasProgress = Boolean(progress && progress.totalB > 0);
          // 用 rAF 插值后的平滑比例画环（视觉效果丝滑；无总量时认为无确定进度）
          const pct = hasProgress ? Math.min(100, dispPct) : 0;
          const ringDash = (pct / 100) * RING_CIRCUM;

          let line2 = null;
          if (direction === 'upload') {
            line2 = '↑ 推送中…';
          } else {
            // 下载态：速度（有则显示）+ 分式（拿到总量才显示）
            let speedText = null;
            if (progress) {
              if (progress.kbPerSec >= 1024) {
                speedText = `↓ ${(progress.kbPerSec / 1024).toFixed(1)} MB/s`;
              } else if (progress.kbPerSec > 0) {
                speedText = `↓ ${Math.round(progress.kbPerSec)} KB/s`;
              }
            }
            if (speedText && hasProgress) {
              line2 = `${speedText} · ${fmtBytes(progress.doneB)}/${fmtBytes(progress.totalB)}`;
            } else if (speedText) {
              line2 = speedText;
            } else if (hasProgress) {
              line2 = `↓ · ${fmtBytes(progress.doneB)}/${fmtBytes(progress.totalB)}`;
            } else {
              line2 = '↓ 下载中…';
            }
          }

          return h(
            'div',
            { style: WRAP_STYLE, role: 'status', 'aria-live': 'polite' },
            h('div', { style: CARD_STYLE, 'data-gh-accel': 'on', title: '加速器' },
              // 环形进度圈（中心嵌呼吸灯点）
              h('span', { style: { position: 'relative', width: RING_SIZE, height: RING_SIZE, flex: 'none', display: 'inline-flex' } },
                h('svg', {
                  width: RING_SIZE, height: RING_SIZE,
                  style: { transform: 'rotate(-90deg)' },
                },
                  h('circle', {
                    cx: RING_SIZE / 2, cy: RING_SIZE / 2, r: RING_RADIUS,
                    fill: 'none',
                    stroke: 'color-mix(in srgb, var(--dsw-alias-state-success-primary) 25%, transparent)',
                    strokeWidth: RING_STROKE,
                  }),
                  h('circle', {
                    cx: RING_SIZE / 2, cy: RING_SIZE / 2, r: RING_RADIUS,
                    fill: 'none',
                    stroke: 'var(--dsw-alias-state-success-primary)',
                    strokeWidth: RING_STROKE,
                    strokeLinecap: 'round',
                    strokeDasharray: hasProgress ? `${RING_CIRCUM} ${RING_CIRCUM}` : '2 4',
                    strokeDashoffset: hasProgress ? RING_CIRCUM - ringDash : 0,
                    style: hasProgress
                      ? { transition: 'stroke-dashoffset .12s linear' }
                      : { animation: 'ghAccelSpin 1.1s linear infinite', transformOrigin: 'center' },
                  })),
                h('span', {
                  style: {
                    position: 'absolute', inset: 0, margin: 'auto',
                    width: '7px', height: '7px', borderRadius: '50%',
                    background: 'var(--dsw-alias-state-success-primary)',
                    animation: 'ghAccelPulse 1.2s ease-in-out infinite',
                  },
                })),
              h('span', { style: { display: 'inline-flex', flexDirection: 'column', lineHeight: '16px', minWidth: 0 } },
                h('span', { style: { fontSize: '12px', fontWeight: 600, whiteSpace: 'nowrap' } }, '⚡ 加速器加速中…'),
                h('span', {
                  style: {
                    fontSize: '11px', fontWeight: 400,
                    color: 'var(--dsw-alias-label-secondary)',
                    whiteSpace: 'nowrap', marginTop: '1px',
                  },
                }, line2)),
            )
          );
        }

        function apply(ctx) {
          ctx.slots.inject('conversation.input.dock', () =>
            ctx.slots.register({
              name: 'conversation.input.dock',
              id: 'gh-accel',
              order: 35,
            }, AccelBadge)
          );
        }

        return {
          name: '@local/gh-accel',
          inject,
          apply,
        };
      }
    });
  } catch (err) {
    console.warn('[gh-accel] client runtime error:', err);
  }
})();