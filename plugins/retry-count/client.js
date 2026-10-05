window.__ModuleLoader__.load({
  id: '@local/retry-count',
  factory(require) {
    const React = require('react');
    const h = React.createElement;

    const NS = 'retry-count';

    const zh = {
      'row.title': '模型请求重试次数',
      'row.description': '请求卡顿时的重试上限（当前 {current} 次，默认 5），修改后立即生效',
      'row.inputAria': '输入重试次数',
      'row.apply': '修改',
      'row.saving': '保存中…',
      'row.saved': '已生效',
      'row.fail': '保存失败，请重试',
      'row.invalid': '请输入 0–100 的整数'
    };
    const en = {
      'row.title': 'Model request retry count',
      'row.description': 'Max retries for a stalled request (currently {current}, default 5); takes effect immediately',
      'row.inputAria': 'Retry count',
      'row.apply': 'Apply',
      'row.saving': 'Saving…',
      'row.saved': 'Applied',
      'row.fail': 'Save failed, try again',
      'row.invalid': 'Enter an integer from 0 to 100'
    };

    // ---- styles: host theme tokens only ----
    const CSS_TAG = '@local/retry-count/row.css';
    const css = [
      '.rcRow{border-bottom:.5px solid var(--dsw-alias-border-l2);align-items:center;gap:8px;padding:16px 0;display:flex}',
      '.rcRowText{flex-direction:column;flex:1;gap:4px;min-width:0;padding-right:48px;display:flex}',
      '.rcTitle{color:var(--dsw-alias-label-primary);font-size:14px;font-weight:400;line-height:22px}',
      '.rcDesc{color:var(--dsw-alias-label-tertiary);font-size:12px;font-weight:400;line-height:18px}',
      '.rcControl{flex:none;align-items:center;gap:8px;display:flex}',
      '.rcInput{box-sizing:border-box;border:.5px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-module-platform);border-radius:var(--dsw-radius-md);width:88px;height:36px;color:var(--dsw-alias-label-primary);font:inherit;text-align:center;padding:0 8px;font-size:14px;line-height:22px}',
      '.rcInput:focus{outline:1px solid var(--dsw-focus-ring-color,var(--dsw-alias-state-business-primary));outline-offset:1px}',
      '.rcButton{border-radius:var(--dsw-radius-md);background:var(--dsw-alias-bg-module-platform);height:36px;color:var(--dsw-alias-label-primary);font:inherit;cursor:pointer;border:none;padding:0 14px;font-size:14px;line-height:22px}',
      '.rcButton:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover)}',
      '.rcButton:disabled{cursor:default;opacity:.5}',
      '.rcStatus{color:var(--dsw-alias-label-tertiary);font-size:12px;line-height:18px}'
    ].join('\n');
    if (typeof document !== 'undefined' && document.querySelector('style[data-plugin-css="' + CSS_TAG + '"]') === null) {
      const tag = document.createElement('style');
      tag.dataset.pluginCss = CSS_TAG;
      tag.textContent = css;
      document.head.appendChild(tag);
    }

    // ---- 设置 → 通用设置 行：输入次数 + 修改 ----
    function RetryCountRow({ useForm, applyRetry, t }) {
      const snapshot = useForm((state) => state);
      const current = Number(snapshot?.value?.maxRetries ?? 5);
      const [draft, setDraft] = React.useState(String(current));
      const [busy, setBusy] = React.useState(false);
      const [status, setStatus] = React.useState(null); // 'ok' | 'fail' | 'invalid' | null
      const [live, setLive] = React.useState(current);
      React.useEffect(() => {
        if (Number.isSafeInteger(snapshot?.value?.maxRetries)) setLive(Number(snapshot.value.maxRetries));
      }, [snapshot?.value?.maxRetries]);

      const submit = async () => {
        const value = Number(draft);
        if (!Number.isSafeInteger(value) || value < 0 || value > 100) {
          setStatus('invalid');
          return;
        }
        setBusy(true);
        setStatus(null);
        let ok = false;
        try {
          ok = await applyRetry(value);
        } catch (err) {
          ok = false;
        }
        setBusy(false);
        setStatus(ok ? 'ok' : 'fail');
      };

      return h('div', { className: 'rcRow' },
        h('div', { className: 'rcRowText' },
          h('div', { className: 'rcTitle' }, t('row.title')),
          h('div', { className: 'rcDesc' }, t('row.description', { current: String(live) }))
        ),
        h('div', { className: 'rcControl' },
          h('input', {
            type: 'number',
            className: 'rcInput',
            min: 0,
            max: 100,
            step: 1,
            value: draft,
            'aria-label': t('row.inputAria'),
            onChange: (event) => {
              setDraft(event.target.value);
              setStatus(null);
            },
            onKeyDown: (event) => {
              if (event.key === 'Enter') {
                event.preventDefault();
                submit();
              }
            }
          }),
          h('button', {
            type: 'button',
            className: 'rcButton',
            disabled: busy,
            onClick: submit
          }, t(busy ? 'row.saving' : 'row.apply')),
          status !== null ? h('span', { className: 'rcStatus' }, t('row.' + status)) : null
        )
      );
    }

    function apply(ctx) {
      ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'retry-count: dictionaries');
      const form = ctx.configForms.get(NS);

      ctx.slots.inject('settings.general.item', () => ctx.slots.register({
        name: 'settings.general.item',
        id: 'retry-count',
        order: 19,
        locale: NS,
        inject: () => ({
          hooks: { form },
          applyRetry: async (maxRetries) => {
            try {
              return await form.set('maxRetries', maxRetries);
            } catch (err) {
              return false;
            }
          }
        })
      }, RetryCountRow));
    }

    return { inject: ['slots', 'locale', 'configForms'], apply };
  }
});
