# 插件 UI / 提示框 开发提示词（含五条铁律）

> 写「输入框上方提示框」（如「执行中」「加速器加速中…」）这类带客户端 UI 的插件时，先过一遍这里，一次做对。

---

## 一、五条铁律

| # | 铁律 | 出错后果 |
|---|---|---|
| 1 | **`package.json` 的 `exports` 必须有 `"./client"` 键**（值指向 client.js）——是 `"./client"`，不是 `"./client.js"` | DSH 客户端加载器按 `exports["./client"]` 查找，找不到就**静默丢弃整个客户端**（服务端全正常、浏览器端什么都没有、无任何报错） |
| 2 | **`dsh.client` 不要乱写 `inject`** | 如 `"inject": ["@deepseek-ai/dsh-client-runtime"]`（模块不存在）→ 客户端加载失败。不写，或只写确定存在的官方模块 id（如 `dsh-client-locale`、`dsh-client-ui-slots`） |
| 3 | **client.js 用 `window.__ModuleLoader__.load({ id: 包名, factory(require){...} })`**，输入框上方挂 `ctx.slots.inject('conversation.input.dock', ...)` | 插槽名写错则 UI 无处渲染 |
| 4 | **状态提示用投影驱动，`index.js` 顶部必须 `export const inject = ['tools', 'sessionProjections']`** | 不声明 `sessionProjections`，客户端 `useProjection(key)` 收不到状态，提示框永远 `return null` |
| 5 | **装完必须刷新页面/重启 App 才看到 UI** | 服务端工具即时生效；客户端模块要刷新（新 boot 清单）才下发 |

---

## 二、骨架代码

**package.json 关键字段：**
```json
{
  "name": "dsh-my-plugin",
  "type": "module",
  "main": "./index.js",
  "exports": {
    ".": "./index.js",
    "./client": "./client.js",
    "./package.json": "./package.json"
  },
  "dsh": {
    "bundle": { "patch": "./cordis.patch.yml" },
    "client": { "platform": "web", "immediately": true }
  }
}
```

**client.js（提示框）：**
```js
window.__ModuleLoader__.load({
  id: "dsh-my-plugin",                // 必须 = package.json 的 name
  factory(require) {
    const React = require('react');
    const h = React.createElement;
    const inject = ['slots'];

    function MyBadge(props) {
      const state = typeof props.useProjection === 'function' ? props.useProjection('my-status') : undefined;
      if (!state || !state.active) return null;              // 空闲/完成自动隐藏
      return h('div', { style: { display:'flex', justifyContent:'center', width:'100%' } },
        h('div', { style: { padding:'4px 14px', borderRadius:'999px',
          border:'1px solid var(--dsw-alias-state-success-primary)',
          background:'color-mix(in srgb, var(--dsw-alias-state-success-primary) 15%, transparent)',
          color:'var(--dsw-alias-label-primary)', fontSize:'12px', fontWeight:600 } },
          '⚡ 我的插件执行中…'));
    }

    function apply(ctx) {
      ctx.slots.inject('conversation.input.dock', () =>
        ctx.slots.register({ name: 'conversation.input.dock', id: 'my-plugin-badge', order: 31 }, MyBadge));
    }
    return { name: 'dsh-my-plugin', inject, apply };
  }
});
```

**index.js（投影注册，控制显隐）：**
```js
export const inject = ['tools', 'sessionProjections'];

const projections = ctx.get('sessionProjections');
if (projections !== undefined) {
  ctx.effect(() => projections.register({
    key: 'my-status',
    stateVersion: 1,
    stateSchema: { parse: v => v },
    init: () => ({ active: false }),
    apply: (s, e) => e.type === 'tool/call' ? { active: true }
      : e.type === 'tool/result' ? { active: false } : s,
    wire: { viewSchema: { parse: v => v }, view: s => ({ active: s.active }) },
  }, '我的插件状态投影'));
}
```

**cordis.patch.yml：**
```yaml
- insert:
    - id: dsh-my-plugin
      name: dsh-my-plugin
```

---

## 三、可粘贴提示词（写「输入框上方的框」UI）

> 我要为 DeepSeek Harness 写一个带客户端 UI 的插件：一个显示在输入框上方的状态提示框（执行中/忙碌时出现，空闲自动隐藏）。请严格按 DSH 插件规范一次做对：
> 1. 文件：index.js（服务端）、client.js（客户端）、cordis.patch.yml、package.json，包名 `dsh-my-plugin`；
> 2. package.json 的 `exports` **必须有 `"./client"` 键**（指向 client.js，**不是** `"./client.js"`）；`dsh.client` 写 `{"platform":"web","immediately":true}`，**不要**写 `inject`；
> 3. client.js 用 `window.__ModuleLoader__.load({id: 包名, factory(require){...}})`，`require('react')`，`apply(ctx)` 里 `ctx.slots.inject('conversation.input.dock', ...)` 注册组件，样式用 `--dsw-*` token；
> 4. 状态由投影驱动：index.js 里 `export const inject = ['tools','sessionProjections']`，用 `ctx.get('sessionProjections').register(...)` 注册投影（key 自定，wire.view 输出 `{active}`）；client.js 组件里 `props.useProjection('<key>')`，`!active` 就 `return null`；
> 5. 交付成内容在 `package/` 下的 tgz；提醒用户装完**刷新页面/重启 App** 才显示 UI。
> 生成完成后自查这四点：exports 键名、dsh.client、inject、投影注册。

---

## 四、坑与排查（血泪史）

1. **`exports` 键名 `"./client.js"` vs `"./client"`** —— gh-accel v2.1.0–v2.3.0 状态条从不显示，服务端一切正常、无任何报错，最终就是这一处键名。
2. **幽灵 `inject`** —— `@deepseek-ai/dsh-client-runtime` 不存在，写了必挂。
3. **二分排查法**：UI 不显示时，先让 UI **无条件渲染**确认「客户端模块已加载」；再改回条件渲染确认「投影状态已送达」。两步分开测。
4. **别过早归咎平台** —— 一度误判"手机版 DSH 不支持第三方客户端插件"，实际只是包写错；对照能正常显示 UI 的插件（如 dsh-infinite-gen-5）逐字段 diff 即可定位。

---

*UI 开发提示词（gh-accel v2.4.0 修复过程沉淀）。*
