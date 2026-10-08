window.__ModuleLoader__.load({
  id: '@local/enter-newline',
  factory(require) {
    const React = require('react');
    const h = React.createElement;

    // ---- localization ----
    const NS = 'enter-newline';
    const STORAGE_KEY = 'dsh.enter-newline.behavior.v1';
    const DEFAULT_BEHAVIOR = 'newline'; // the point of the plugin: Enter = newline, not send

    const zh = {
      'row.title': '回车键',
      'row.description': '开启后按回车插入换行、不再发送；Ctrl/⌘+Enter 或右下角按钮仍可发送。回答运行中如需发送/引导也请用 Ctrl/⌘+Enter（与下方「忙碌时回车」设置互不影响）',
      'row.unsupported': '当前浏览器不支持回车原生换行（beforeinput），已自动恢复「回车发送」',
      'switch.on': '回车插入换行',
      'switch.off': '回车发送消息'
    };
    const en = {
      'row.title': 'Enter key',
      'row.description': 'When on, Enter inserts a line break instead of sending; Ctrl/⌘+Enter or the send button still sends. While a reply is running, use Ctrl/⌘+Enter to send or steer (independent of the Composer Enter row below)',
      'row.unsupported': 'This browser lacks native beforeinput support for Enter — interception is disabled (Enter sends)',
      'switch.on': 'Newline on Enter',
      'switch.off': 'Send on Enter'
    };

    // ---- native beforeinput support ----
    // Plain Enter must produce the line break through the browser's NATIVE
    // default action (beforeinput inputType insertParagraph/insertLineBreak):
    // the interception keeps the keydown away from the editor's own keymap,
    // so no document listener will ever insert the newline for us. Engines
    // predating InputEvent.inputType (pre-2017 Chrome/Safari, Firefox < 87,
    // some embedded WebViews) never fire a usable beforeinput for Enter —
    // there the key would do NOTHING (no send, no newline). Detect the API
    // and degrade to stock "send on Enter" there instead of swallowing keys.
    const BEFOREINPUT_SUPPORTED = typeof InputEvent === 'function' && 'inputType' in InputEvent.prototype;

    // ---- preference store (SnapshotStore-shaped, persisted in localStorage) ----
    function loadBehavior() {
      try {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (raw === 'send' || raw === 'newline') return raw;
      } catch (err) { /* storage unavailable: keep the default */ }
      return DEFAULT_BEHAVIOR;
    }
    function createPrefStore() {
      let value = loadBehavior();
      const listeners = new Set();
      // Other tabs share the same preference; `storage` fires only in tabs
      // that did NOT make the change, so every open tab converges.
      const onStorage = (event) => {
        if (event.key !== STORAGE_KEY) return;
        const next = event.newValue;
        if (next !== 'send' && next !== 'newline') return;
        if (next === value) return;
        value = next;
        for (const listener of listeners) listener();
      };
      window.addEventListener('storage', onStorage);
      return {
        getSnapshot: () => value,
        subscribe(listener) {
          listeners.add(listener);
          return () => { listeners.delete(listener); };
        },
        set(next) {
          if (next !== 'send' && next !== 'newline') return;
          if (next === value) return;
          value = next;
          try { localStorage.setItem(STORAGE_KEY, next); } catch (err) { /* ignore */ }
          for (const listener of listeners) listener();
        },
        dispose() {
          window.removeEventListener('storage', onStorage);
        }
      };
    }

    // ---- styles: host theme tokens only (EnterBehaviorRow / Switch look-alikes) ----
    // Bundle client modules are classic scripts: the bare `styles` closure
    // symbol does not exist there, so the CSS is injected through a guarded
    // style tag exactly like the shipped UI modules do.
    const CSS_TAG = '@local/enter-newline/row.css';
    const css = [
      '.enlbRow{border-bottom:.5px solid var(--dsw-alias-border-l2);align-items:center;gap:8px;padding:16px 0;display:flex}',
      '.enlbRowText{flex-direction:column;flex:1;gap:4px;min-width:0;padding-right:48px;display:flex}',
      '.enlbTitle{color:var(--dsw-alias-label-primary);font-size:14px;font-weight:400;line-height:22px}',
      '.enlbDesc{color:var(--dsw-alias-label-tertiary);font-size:12px;font-weight:400;line-height:18px}',
      '.enlbSwitch{box-sizing:border-box;position:relative;flex:0 0 auto;width:36px;height:20px;padding:2px;border:0;border-radius:999px;corner-shape:round;background:var(--dsw-alias-border-l3);cursor:pointer}',
      '.enlbSwitch[aria-checked="true"]{background:var(--dsw-alias-brand-primary)}',
      '.enlbSwitch:focus-visible{outline:var(--dsw-focus-ring-width) solid var(--dsw-focus-ring-color,var(--dsw-alias-state-business-primary));outline-offset:2px}',
      '.enlbThumb{display:block;width:16px;height:16px;border-radius:50%;corner-shape:round;background:var(--dsw-alias-label-primary-foreground);transition:transform 120ms ease}',
      '.enlbSwitch[aria-checked="false"] .enlbThumb{background:var(--dsw-alias-switch-thumb)}',
      '.enlbSwitch[aria-checked="true"] .enlbThumb{transform:translateX(16px)}'
    ].join('\n');
    if (typeof document !== 'undefined' && document.querySelector('style[data-plugin-css="' + CSS_TAG + '"]') === null) {
      const tag = document.createElement('style');
      tag.dataset.pluginCss = CSS_TAG;
      tag.textContent = css;
      document.head.appendChild(tag);
    }

    // ---- General-settings preference row ----
    function EnterBehaviorRow({ usePref, setPref, t }) {
      const pref = usePref((value) => value);
      const supported = BEFOREINPUT_SUPPORTED;
      // When the browser cannot deliver native beforeinput for Enter, the
      // interception is inactive (Enter keeps sending): show the effective
      // state and park the switch so the row never lies about behavior.
      const checked = supported ? pref === 'newline' : false;
      const desc = supported ? t('row.description') : t('row.description') + ' ' + t('row.unsupported');
      return h('div', { className: 'enlbRow' },
        h('div', { className: 'enlbRowText' },
          h('div', { className: 'enlbTitle' }, t('row.title')),
          h('div', { className: 'enlbDesc' }, desc)
        ),
        h('button', {
          type: 'button',
          role: 'switch',
          'aria-checked': checked,
          'aria-label': t(checked ? 'switch.on' : 'switch.off'),
          className: 'enlbSwitch',
          disabled: !supported,
          onClick: () => setPref(checked ? 'send' : 'newline')
        }, h('span', { className: 'enlbThumb' }))
      );
    }

    // ---- composer key interception ----
    function composerHost(target) {
      if (!(target instanceof Element)) return null;
      return target.closest('[data-composer-input]');
    }
    // A trigger menu (@ / / …) owns Enter while open: it must pick the
    // highlighted row, so interception yields to it. The trajectory overlay
    // ([data-conversation-composer-overlay]) renders OUTSIDE the composer
    // card and never holds the composer's focus, so it needs no guard here:
    // while it is open the keydown target is not inside [data-composer-input]
    // and this hook returns early anyway.
    function menuOpen(host) {
      const card = host.closest('[data-composer-card]');
      if (card === null) return false;
      return card.querySelector('[data-trigger-menu]') !== null;
    }
    // Mobile IME "return" keys arrive as composition-adjacent keydowns
    // (isComposing, or keyCode 229 even with isComposing=false). Any
    // preventDefault on those cancels the IME composition and discards the
    // text the user typed — the draft appears cleared. The watch below
    // mirrors the composer keymap's own guard (Safari-style late
    // compositionend); events in that window are never touched.
    let composing = false;
    let composingUntil = 0;
    function composingNow() {
      return composing || Date.now() < composingUntil;
    }
    function onCompositionStart() {
      composing = true;
    }
    function onCompositionEnd() {
      composing = false;
      composingUntil = Date.now() + 15;
    }

    function apply(ctx) {
      const pref = createPrefStore();

      ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'enter-newline: dictionaries');
      ctx.effect(() => () => pref.dispose(), 'enter-newline: preference store');

      // Document-level capture: runs before the composer's own keymap, so a
      // plain Enter never reaches the submit handler. The keymap submits
      // unconditionally once it sees the keydown, so the event is stopped
      // from propagating to the editor root — but deliberately NOT
      // preventDefault-ed: the browser then performs its native Enter
      // default (beforeinput insertParagraph/insertLineBreak) and the editor
      // inserts the line break itself. No execCommand, no synthetic events,
      // and nothing the mobile IME depends on is canceled.
      const onKeyDown = (event) => {
        if (!BEFOREINPUT_SUPPORTED) return; // no native newline path: keep stock send-on-Enter
        if (pref.getSnapshot() !== 'newline') return;
        if (event.key !== 'Enter') return;
        if (composingNow() || event.isComposing || event.keyCode === 229) return; // IME owns this key
        if (event.altKey || event.ctrlKey || event.metaKey) return; // Ctrl/⌘+Enter keeps sending (accelerated)
        if (event.shiftKey) return; // Shift+Enter already inserts a line break
        const host = composerHost(event.target);
        if (host === null) return;
        if (host.isContentEditable !== true) return; // inert / locked composer
        if (menuOpen(host)) return; // menu owns Enter
        event.stopPropagation();
      };
      document.addEventListener('compositionstart', onCompositionStart, true);
      document.addEventListener('compositionend', onCompositionEnd, true);
      document.addEventListener('keydown', onKeyDown, true);
      ctx.effect(() => () => {
        document.removeEventListener('keydown', onKeyDown, true);
        document.removeEventListener('compositionstart', onCompositionStart, true);
        document.removeEventListener('compositionend', onCompositionEnd, true);
      }, 'enter-newline: keydown + composition');

      ctx.slots.inject('settings.general.item', () => ctx.slots.register({
        name: 'settings.general.item',
        id: 'enter-newline',
        order: 18,
        locale: NS,
        inject: () => ({
          hooks: { pref },
          setPref: (next) => pref.set(next)
        })
      }, EnterBehaviorRow));
    }

    return { inject: ['slots', 'locale'], apply };
  }
});

