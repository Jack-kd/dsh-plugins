// gh-accel v2 客户端半体 —— 输入框上方「加速器加速下载中…」状态条。
//
// 只渲染两种情况之外的一个瞬态：会话投影 gh-accel.active === true
// （即某个下载正走加速节点：命中镜像规则或显式指定 mirror）。
// 空闲 / 直连 / 下载完成时一律 return null，不占位置、不显示。
// 样式全部走 --dsw-* 主题 token，深浅主题下自动适配。

(() => {
  try {
    window.__ModuleLoader__.load({
      id: '@local/gh-accel',
      factory(require) {
        const React = require('react');
        const h = React.createElement;

        const inject = ['slots'];

        const CSS =
          '@keyframes ghAccelPulse{0%,100%{box-shadow:0 0 2px var(--dsw-alias-state-success-primary);opacity:1}' +
          '50%{box-shadow:0 0 14px var(--dsw-alias-state-success-primary);opacity:.55}}';

        const WRAP_STYLE = { display: 'flex', justifyContent: 'center', width: '100%' };
        const BADGE_STYLE = {
          display: 'inline-flex',
          alignItems: 'center',
          gap: '6px',
          width: 'fit-content',
          padding: '3px 10px',
          borderRadius: '6px',
          border: '1px solid color-mix(in srgb, var(--dsw-alias-state-success-primary) 45%, transparent)',
          background: 'color-mix(in srgb, var(--dsw-alias-state-success-primary) 12%, transparent)',
          color: 'var(--dsw-alias-label-primary)',
          fontSize: '11px',
          lineHeight: '16px',
          fontFamily: 'inherit',
          userSelect: 'none',
          whiteSpace: 'nowrap',
        };
        const DOT_STYLE = {
          width: '6px',
          height: '6px',
          borderRadius: '50%',
          background: 'var(--dsw-alias-state-success-primary)',
          flex: 'none',
        };

        function AccelBadge(props) {
          const useProjection = props.useProjection;
          const state = typeof useProjection === 'function'
            ? useProjection('gh-accel')
            : undefined;

          // 只有正走加速节点下载时才显示；空闲/直连/完成一律不渲染
          if (!state || !state.active) return null;

          return h(
            'div',
            { style: WRAP_STYLE },
            h('div', { style: BADGE_STYLE, 'data-gh-accel': 'on', title: '加速器' },
              h('span', {
                style: Object.assign({}, DOT_STYLE, {
                  animation: 'ghAccelPulse 1.2s ease-in-out infinite',
                }),
              }),
              h('span', null, '加速器加速下载中…'))
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