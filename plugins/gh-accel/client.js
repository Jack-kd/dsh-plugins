// gh-accel v2.2.0 客户端半体 —— 输入框上方「加速器加速中…」状态小框。
//
// 仅当会话投影 gh-accel.active === true（某次下载/克隆正走加速节点：命中镜像
// 规则或显式指定 mirror）时渲染；空闲、直连（国内不绕路）或完成时自动隐藏，
// 不占位置、不残留。样式全部走 --dsw-* 主题 token，深浅主题下自动适配。
// v2.2.0：状态条重做为更醒目的圆角小框——呼吸光点 + ⚡ + 滑入动画。

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
          'to{transform:translateY(0);opacity:1}}';

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
          gap: '7px',
          width: 'fit-content',
          maxWidth: '92%',
          padding: '4px 14px 4px 10px',
          borderRadius: '999px',
          border: '1px solid color-mix(in srgb, var(--dsw-alias-state-success-primary) 55%, transparent)',
          background:
            'linear-gradient(180deg, color-mix(in srgb, var(--dsw-alias-state-success-primary) 18%, transparent), ' +
            'color-mix(in srgb, var(--dsw-alias-state-success-primary) 8%, transparent))',
          boxShadow: '0 2px 10px color-mix(in srgb, var(--dsw-alias-state-success-primary) 25%, transparent)',
          color: 'var(--dsw-alias-label-primary)',
          fontSize: '12px',
          lineHeight: '18px',
          fontWeight: 600,
          fontFamily: 'inherit',
          userSelect: 'none',
          whiteSpace: 'nowrap',
        };

        const DOT_STYLE = {
          width: '7px',
          height: '7px',
          borderRadius: '50%',
          background: 'var(--dsw-alias-state-success-primary)',
          flex: 'none',
          animation: 'ghAccelPulse 1.2s ease-in-out infinite',
        };

        function AccelBadge(props) {
          const useProjection = props.useProjection;
          const state = typeof useProjection === 'function'
            ? useProjection('gh-accel')
            : undefined;

          // 只有正走加速节点下载/克隆时才显示；空闲/直连/完成一律不渲染
          if (!state || !state.active) return null;

          return h(
            'div',
            { style: WRAP_STYLE, role: 'status', 'aria-live': 'polite' },
            h('div', { style: CARD_STYLE, 'data-gh-accel': 'on', title: '加速器' },
              h('span', { style: DOT_STYLE }),
              h('span', null, '⚡ 加速器加速中…'))
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