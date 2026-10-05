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
      'row.description': '开启后按回车插入换行，不再发送消息；Ctrl/⌘+Enter 仍可发送',
      'switch.on': '回车插入换行',
      'switch.off': '回车发送消息'
    };
    const en = {
      'row.title': 'Enter key',
      'row.description': 'When on, Enter inserts a line break instead of sending; Ctrl/⌘+Enter still sends',
      'switch.on': 'Newline on Enter',
      'switch.off': 'Send on Enter'
    };

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
      const checked = pref === 'newline';
      return h('div', { className: 'enlbRow' },
        h('div', { className: 'enlbRowText' },
          h('div', { className: 'enlbTitle' }, t('row.title')),
          h('div', { className: 'enlbDesc' }, t('row.description'))
        ),
        h('button', {
          type: 'button',
          role: 'switch',
          'aria-checked': checked,
          'aria-label': t(checked ? 'switch.on' : 'switch.off'),
          className: 'enlbSwitch',
          onClick: () => setPref(checked ? 'send' : 'newline')
        }, h('span', { className: 'enlbThumb' }))
      );
    }

    // ---- composer key interception ----
    function composerHost(target) {
      if (!(target instanceof Element)) return null;
      return target.closest('[data-composer-input]');
    }
    // A trigger menu (@ / / …) or the command overlay owns Enter while open:
    // it must pick the highlighted row, so interception yields to it.
    function menuOpen(host) {
      const card = host.closest('[data-composer-card]');
      if (card === null) return false;
      return card.querySelector('[data-trigger-menu], [data-conversation-composer-overlay]') !== null;
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

      // Document-level capture: runs before the composer's own keymap, so a
      // plain Enter never reaches the submit handler. The keymap submits
      // unconditionally once it sees the keydown, so the event is stopped
      // from propagating to the editor root — but deliberately NOT
      // preventDefault-ed: the browser then performs its native Enter
      // default (beforeinput insertParagraph/insertLineBreak) and the editor
      // inserts the line break itself. No execCommand, no synthetic events,
      // and nothing the mobile IME depends on is canceled.
      const onKeyDown = (event) => {
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

