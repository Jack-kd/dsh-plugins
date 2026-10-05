window.__ModuleLoader__.load({
  id: '@local/chat-keeper-mobile',
  factory(require) {
    const React = require('react');
    const h = React.createElement;

    const NS = 'chat-keeper-mobile';

    // ---- 文案（基于 DSH-chat-keeper，入口改为设置页）----
    const zh = {
      title: '对话管理',
      statsLine: '共 {count} 个会话 · {running} 运行中 · {archived} 已归档',
      selectAll: '全选',
      selectedCount: '已选 {count} 项',
      archive: '归档',
      unarchive: '取消归档',
      deleteSelected: '删除所选',
      restore: '恢复最近一批',
      clearSelection: '清除',
      refresh: '刷新',
      filterAll: '全部时间',
      filterOlder7: '7 天前的',
      filterOlder30: '30 天前的',
      filterOlder90: '90 天前的',
      filteredCount: '符合条件 {count} 个',
      showArchived: '显示已归档',
      trashTitle: '回收站：{count} 批',
      trashEmpty: '回收站：空',
      trashUnavailable: '回收站：读不到镜像（{message}）',
      listRefreshed: '列表已刷新',
      batchLine: '{batch} · {count} 个 · {size} KB',
      colTitle: '标题',
      colWorkspace: '工作区',
      colUpdated: '最近活动',
      archivedBadge: '已归档',
      ungrouped: '未分组',
      empty: '暂无会话',
      loading: '加载中…',
      statusRunning: '运行中',
      statusPending: '等待交互',
      statusDone: '已完成未读',
      statusIdle: '空闲',
      statusRunningShort: '运行中',
      justNow: '刚刚',
      minutesAgo: '{n} 分钟前',
      hoursAgo: '{n} 小时前',
      daysAgo: '{n} 天前',
      stopArchiveTitle: '停止并归档？',
      stopArchiveBody: '{count} 个会话仍有工作在进行；归档会先停止它们。',
      stopAndArchive: '停止并归档',
      cancel: '取消',
      runningWork: '仍有工作：{activity}',
      archivedToast: '已归档',
      unarchivedToast: '已取消归档',
      batchFailedToast: '{count} 项失败',
      actionFailedToast: '操作失败：{message}',
      hostOnlyHint: '删除与恢复是磁盘操作，只能由系统完成：点按钮会复制指令，粘贴到输入框发送即可。',
      pasteHint: '粘贴到输入框发送。',
      copiedDeleteHint: '已复制 {count} 个对话的删除指令。',
      copiedRestoreHint: '已复制恢复指令。',
      searchPlaceholder: '搜索对话正文…',
      searchHits: '命中 {count} 个对话',
      searchMore: '还有更多命中，建议用更具体的关键词',
      searchNoHits: '没有匹配的对话',
      searchFailed: '搜索失败：{message}',
      searchCopy: '复制结果',
      copiedHitsHint: '已复制 {count} 条搜索结果。',
      purgeBin: '清空回收站',
      purgeHint: '永久删除全部批次——不可恢复。',
      copiedPurgeHint: '已复制清空指令（{count} 批，永久删除）。',
      copyFailed: '无法访问剪贴板，请手动选择文本。',
      tapHint: '点卡片打开会话；勾选后可从底部批量操作',
      deleteCheckTitle: '删除这些对话？',
      deleteCheckBody: '将移入回收站，可恢复。正在运行的会话不会被删除。',
      deleteRunningBody: '其中 {count} 个正在对话，删除会中断它们。确定删除？',
      deleteGo: '删除',
      deleteOk: '已删除 {count} 个对话（进回收站）',
      deleteRefused: '{count} 个正在运行的会话无法删除',
      restoreOk: '已从回收站恢复最近一批',
      restoreFail: '恢复失败：{message}',
      purgeOk: '已清空回收站（共 {count} 批）',
      purgeFail: '清空失败：{message}',
      opFailed: '操作失败：{message}',
      menuDelete: '删除会话',
      menuDeleteBody: '删除「{name}」？将移入回收站，可恢复。',
      menuDeleteRunningBody: '「{name}」正在对话，删除会中断它。确定删除？',
      menuDeleted: '已删除「{name}」',
      menuDeleteFailed: '删除失败：{message}',
      menuDeleteNotFound: '未找到该会话（可能已删除或编号不匹配）'
    };
    const en = {
      title: 'Conversation Manager',
      statsLine: '{count} conversations · {running} running · {archived} archived',
      selectAll: 'Select all',
      selectedCount: '{count} selected',
      archive: 'Archive',
      unarchive: 'Unarchive',
      deleteSelected: 'Delete selected',
      restore: 'Restore last batch',
      clearSelection: 'Clear',
      refresh: 'Refresh',
      filterAll: 'All time',
      filterOlder7: 'Older than 7 days',
      filterOlder30: 'Older than 30 days',
      filterOlder90: 'Older than 90 days',
      filteredCount: '{count} matching',
      showArchived: 'Show archived',
      trashTitle: 'Recycle bin: {count} batch(es)',
      trashEmpty: 'Recycle bin: empty',
      trashUnavailable: 'Recycle bin: unreadable ({message})',
      listRefreshed: 'List refreshed',
      batchLine: '{batch} · {count} item(s) · {size} KB',
      colTitle: 'Title',
      colWorkspace: 'Workspace',
      colUpdated: 'Last activity',
      archivedBadge: 'archived',
      ungrouped: 'Ungrouped',
      empty: 'No conversations yet',
      loading: 'Loading…',
      statusRunning: 'Running',
      statusPending: 'Waiting for interaction',
      statusDone: 'Finished, unread',
      statusIdle: 'Idle',
      statusRunningShort: 'Running',
      justNow: 'just now',
      minutesAgo: '{n}m ago',
      hoursAgo: '{n}h ago',
      daysAgo: '{n}d ago',
      stopArchiveTitle: 'Stop and archive?',
      stopArchiveBody: '{count} conversation(s) still have work running; archiving stops it first.',
      stopAndArchive: 'Stop and archive',
      cancel: 'Cancel',
      runningWork: 'Still running: {activity}',
      archivedToast: 'Archived',
      unarchivedToast: 'Unarchived',
      batchFailedToast: '{count} failed',
      actionFailedToast: 'Failed: {message}',
      hostOnlyHint: 'Delete and restore are disk operations the host can perform: the button copies an instruction — paste it into the input box and send.',
      pasteHint: 'Paste it into the input box and send.',
      copiedDeleteHint: 'Copied the delete instruction for {count} conversation(s).',
      copiedRestoreHint: 'Copied the restore instruction.',
      searchPlaceholder: 'Search conversation text…',
      searchHits: '{count} conversation(s) matched',
      searchMore: 'More matches exist — try a more specific phrase',
      searchNoHits: 'No matching conversation',
      searchFailed: 'Search failed: {message}',
      searchCopy: 'Copy results',
      copiedHitsHint: 'Copied {count} search result(s).',
      purgeBin: 'Empty recycle bin',
      purgeHint: 'Permanently erases every batch — this cannot be undone.',
      copiedPurgeHint: 'Copied the instruction to permanently erase {count} batch(es).',
      copyFailed: 'Could not access the clipboard — select the text manually.',
      tapHint: 'Tap a card to open the conversation; check boxes then use the bottom bar.',
      deleteCheckTitle: 'Delete these conversations?',
      deleteCheckBody: 'They move to the recycle bin and can be restored. Running conversations are skipped.',
      deleteRunningBody: '{count} of them are running right now; deleting will interrupt them. Delete anyway?',
      deleteGo: 'Delete',
      deleteOk: 'Deleted {count} conversation(s) (moved to recycle bin)',
      deleteRefused: '{count} running conversation(s) could not be deleted',
      restoreOk: 'Restored the latest batch from the recycle bin',
      restoreFail: 'Restore failed: {message}',
      purgeOk: 'Emptied the recycle bin ({count} batch(es))',
      purgeFail: 'Purge failed: {message}',
      opFailed: 'Action failed: {message}',
      menuDelete: 'Delete conversation',
      menuDeleteBody: 'Delete “{name}”? It moves to the recycle bin and can be restored.',
      menuDeleteRunningBody: '“{name}” is running right now; deleting will interrupt it. Delete anyway?',
      menuDeleted: 'Deleted “{name}”',
      menuDeleteFailed: 'Delete failed: {message}',
      menuDeleteNotFound: 'Conversation not found (already deleted or id mismatch)'
    };

    // ---- 样式：手机友好卡片布局（仅用主题 token）----
    const STYLE_TAG_ID = '@local/chat-keeper-mobile/style';
    const CSS = [
      '.ckm-root{display:flex;flex-direction:column;gap:12px;padding:2px 0 96px}',
      '.ckm-head{flex-direction:column;gap:2px;display:flex}',
      '.ckm-title{color:var(--dsw-alias-label-primary);font-size:18px;font-weight:600;line-height:26px}',
      '.ckm-stats{color:var(--dsw-alias-label-tertiary);font-size:12px;line-height:18px}',
      '.ckm-toolbar{flex-wrap:wrap;align-items:center;gap:8px;display:flex}',
      '.ckm-chip{border-radius:999px;background:var(--dsw-alias-bg-module-platform);border:.5px solid var(--dsw-alias-border-l2);height:30px;color:var(--dsw-alias-label-secondary);font:inherit;cursor:pointer;padding:0 12px;font-size:12px;line-height:18px}',
      '.ckm-chip-on{background:var(--dsw-alias-state-business-primary);border-color:transparent;color:#fff}',
      '.ckm-flex{flex:1}',
      '.ckm-search{box-sizing:border-box;border:.5px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-module-platform);border-radius:12px;width:100%;height:38px;color:var(--dsw-alias-label-primary);font:inherit;padding:0 12px;font-size:14px;line-height:22px}',
      '.ckm-hit-head{display:flex;gap:8px;padding:10px 12px;border-radius:12px;background:var(--dsw-alias-bg-layer-1);border:.5px solid var(--dsw-alias-border-l2);margin-bottom:6px}',
      '.ckm-hit-title{flex:1;min-width:0;overflow:hidden;font-size:13px;text-overflow:ellipsis;white-space:nowrap}',
      '.ckm-hit-snippet{color:var(--dsw-alias-label-secondary);font-size:12px;line-height:18px;margin:0 12px 10px}',
      '.ckm-hit-snippet mark{background:var(--dsw-alias-state-warn-faint,var(--dsw-alias-interactive-bg-hover));color:inherit;border-radius:3px}',
      '.ckm-list{flex-direction:column;gap:8px;display:flex}',
      '.ckm-card{box-sizing:border-box;border-radius:16px;background:var(--dsw-alias-bg-layer-1);border:.5px solid var(--dsw-alias-border-l2);align-items:center;gap:10px;padding:12px 12px;display:flex;cursor:pointer}',
      '.ckm-card:active{background:var(--dsw-alias-interactive-bg-hover)}',
      '.ckm-check{flex:none;width:22px;height:22px;accent-color:var(--dsw-alias-state-business-primary)}',
      '.ckm-main{flex:1;min-width:0;flex-direction:column;gap:3px;display:flex}',
      '.ckm-name{color:var(--dsw-alias-label-primary);font-size:14px;font-weight:500;line-height:20px;overflow:hidden;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical}',
      '.ckm-meta{color:var(--dsw-alias-label-tertiary);font-size:12px;line-height:16px;gap:6px;min-width:0;align-items:center;display:flex}',
      '.ckm-badge{border-radius:999px;background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-secondary);flex:none;padding:1px 8px;font-size:11px;line-height:16px}',
      '.ckm-dot{flex:none;width:8px;height:8px;border-radius:999px;background:var(--dsw-alias-label-caption)}',
      '.ckm-dot-run{background:var(--dsw-alias-state-success-primary)}',
      '.ckm-dot-wait{background:var(--dsw-alias-state-warn-primary)}',
      '.ckm-dot-done{background:var(--dsw-alias-state-info-primary,var(--dsw-alias-state-business-primary))}',
      '.ckm-bar{position:sticky;bottom:10px;border-radius:16px;background:var(--dsw-alias-bg-module-platform);border:.5px solid var(--dsw-alias-border-l2);box-shadow:var(--dsw-elevation-soft);box-sizing:border-box;flex-wrap:wrap;align-items:center;gap:8px;padding:10px 12px;display:flex}',
      '.ckm-btn{border-radius:var(--dsw-radius-md);background:var(--dsw-alias-bg-module-platform);border:.5px solid var(--dsw-alias-border-l2);height:34px;color:var(--dsw-alias-label-primary);font:inherit;cursor:pointer;padding:0 12px;font-size:13px;line-height:20px}',
      '.ckm-btn:disabled{opacity:.5;cursor:default}',
      '.ckm-btn-primary{background:var(--dsw-alias-state-business-primary);border-color:transparent;color:#fff}',
      '.ckm-btn-danger{color:#fff;background:var(--dsw-alias-state-error-primary);border-color:transparent}',
      '.ckm-note{color:var(--dsw-alias-label-tertiary);font-size:12px;line-height:18px;margin-top:-4px}',
      '.ckm-trash{border-radius:16px;background:var(--dsw-alias-bg-module-platform);border:.5px solid var(--dsw-alias-border-l2);flex-direction:column;gap:8px;padding:12px;display:flex}',
      '.ckm-empty{color:var(--dsw-alias-label-tertiary);text-align:center;padding:28px 0;font-size:13px}',
      '.ckm-toast{border-radius:12px;background:var(--dsw-alias-bg-overlay);color:var(--dsw-alias-label-primary);box-shadow:var(--dsw-elevation-soft);padding:10px 14px;font-size:13px;line-height:18px}',
      '.ckm-overlay{position:fixed;inset:0;z-index:2147483400;background:rgba(0,0,0,.45);flex-direction:column;justify-content:center;align-items:center;padding:24px;display:flex}',
      '.ckmMenuItem{box-sizing:border-box;display:block;width:100%;border:0;background:transparent;color:var(--dsw-alias-label-primary);text-align:left;font:inherit;padding:8px 14px;font-size:13px;line-height:20px;cursor:pointer;border-radius:8px}',
      '.ckmMenuItem:hover{background:var(--dsw-alias-interactive-bg-hover)}',
      '.ckmMenuItem:focus-visible{outline:1px solid var(--dsw-focus-ring-color,var(--dsw-alias-state-business-primary));outline-offset:-1px}',
      '.ckmMenuItem-danger{color:var(--dsw-alias-state-error-primary)}',
      '.ckm-dialog{box-sizing:border-box;border-radius:20px;background:var(--dsw-alias-bg-overlay);color:var(--dsw-alias-label-primary);width:100%;max-width:340px;flex-direction:column;gap:12px;padding:18px;display:flex}',
      '.ckm-dialog h3{margin:0;font-size:16px;font-weight:600}',
      '.ckm-dialog p{margin:0;color:var(--dsw-alias-label-secondary);font-size:13px;line-height:20px}',
      '.ckm-row{flex-wrap:wrap;gap:8px;justify-content:flex-end;display:flex}'
    ].join('\n');

    // ---- 常量与助手（与上游 DSH-chat-keeper 一致）----
    const TRASH_MIRROR_PATH = '.dsh-conversation-manager/trash.json';
    const SHOW_ARCHIVED_KEY = 'dsh-conversation-manager/show-archived';
    const TIME_FILTERS = [
      { days: 0, key: 'filterAll' },
      { days: 7, key: 'filterOlder7' },
      { days: 30, key: 'filterOlder30' },
      { days: 90, key: 'filterOlder90' }
    ];

    async function copyText(text) {
      try {
        if (typeof navigator !== 'undefined' && navigator.clipboard !== void 0) {
          await navigator.clipboard.writeText(text);
          return true;
        }
      } catch { /* fall through */ }
      try {
        const area = document.createElement('textarea');
        area.value = text;
        area.setAttribute('readonly', '');
        area.style.position = 'fixed';
        area.style.left = '-9999px';
        document.body.appendChild(area);
        area.select();
        const ok = document.execCommand('copy');
        area.remove();
        return ok;
      } catch {
        return false;
      }
    }

    function relativeTime(at, now, t) {
      if (at === void 0 || at === null || at <= 0) return '';
      const diff = Math.max(0, now - at);
      const m = Math.floor(diff / 60000);
      if (m < 1) return t('justNow');
      if (m < 60) return t('minutesAgo', { n: String(m) });
      const hh = Math.floor(m / 60);
      if (hh < 24) return t('hoursAgo', { n: String(hh) });
      return t('daysAgo', { n: String(Math.floor(hh / 24)) });
    }

    function highlightSnippet(text, query) {
      const q = (query ?? '').trim();
      if (q === '' || typeof text !== 'string') return text;
      const at = text.toLowerCase().indexOf(q.toLowerCase());
      if (at < 0) return text;
      return h(React.Fragment, null,
        text.slice(0, at),
        h('mark', null, text.slice(at, at + q.length)),
        text.slice(at + q.length)
      );
    }

    function StatusDot({ status, t }) {
      const mode = status === void 0 ? 'idle' : status.mode ?? 'idle';
      const cls = mode === 'running' ? 'ckm-dot ckm-dot-run' : mode === 'pending' ? 'ckm-dot ckm-dot-wait' : mode === 'done' ? 'ckm-dot ckm-dot-done' : 'ckm-dot';
      return h('span', { className: cls, title: t('status' + mode.charAt(0).toUpperCase() + mode.slice(1)) });
    }

    // ---- 主面板 ----
    function ManagerPage({ t, useSessions, useSessionStatus, useWorkspaces, openSession, setArchived, refreshSessions, searchContent, readTrashMirror, deleteSessions, restoreLatest, purgeBin }) {
      const listState = useSessions((s) => s);
      const statusMap = useSessionStatus((s) => s);
      const workspaces = useWorkspaces((w) => w);

      const archivedSet = React.useMemo(() => new Set(workspaces?.archivedSessionIds ?? []), [workspaces?.archivedSessionIds]);
      const workspaceOf = React.useMemo(() => {
        const map = new Map();
        for (const ws of workspaces?.items ?? []) for (const sid of ws.sessionIds ?? []) if (!map.has(sid)) map.set(sid, ws);
        return map;
      }, [workspaces?.items]);
      const workspaceTitleOf = (id) => workspaceOf.get(id)?.title ?? t('ungrouped');

      const [selected, setSelected] = React.useState(new Set());
      const [stopConfirm, setStopConfirm] = React.useState(null);
      const [deleteConfirm, setDeleteConfirm] = React.useState(null);
      const [purgeConfirm, setPurgeConfirm] = React.useState(false);
      const [notice, setNotice] = React.useState(null);
      const [now, setNow] = React.useState(() => Date.now());
      const [olderThan, setOlderThan] = React.useState(0);
      const [trash, setTrash] = React.useState(null);
      const [trashError, setTrashError] = React.useState(null);
      const [trashBusy, setTrashBusy] = React.useState(false);
      const [showArchived, setShowArchivedState] = React.useState(() => {
        try { return window.localStorage.getItem(SHOW_ARCHIVED_KEY) !== 'false'; } catch { return true; }
      });
      const setShowArchived = (next) => {
        setShowArchivedState(next);
        try { window.localStorage.setItem(SHOW_ARCHIVED_KEY, String(next)); } catch { /* ignore */ }
      };
      const [query, setQuery] = React.useState('');
      const [searchBusy, setSearchBusy] = React.useState(false);
      const [hits, setHits] = React.useState([]);
      const [hitsHasMore, setHitsHasMore] = React.useState(false);
      const [searchError, setSearchError] = React.useState(null);

      React.useEffect(() => {
        const timer = setInterval(() => setNow(Date.now()), 30000);
        return () => clearInterval(timer);
      }, []);
      React.useEffect(() => {
        if (notice === null) return;
        const timer = setTimeout(() => setNotice(null), 4200);
        return () => clearTimeout(timer);
      }, [notice]);

      const rows = React.useMemo(() => {
        const byId = listState?.byId ?? {};
        const ids = listState?.ids ?? [];
        const out = [];
        const seen = new Set();
        const add = (row) => {
          if (!row || seen.has(row.id)) return;
          seen.add(row.id);
          out.push(row);
        };
        for (const id of ids) add(byId[id]);
        for (const row of Object.values(byId)) add(row);
        const cutoff = olderThan === 0 ? 0 : now - olderThan * 864e5;
        return out
          .filter((row) => !row.blank && row.origin !== 'subagent')
          .filter((row) => showArchived || !archivedSet.has(row.id))
          .filter((row) => cutoff === 0 || (row.updatedAt ?? 0) < cutoff)
          .sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0));
      }, [listState, olderThan, now, showArchived, archivedSet]);

      React.useEffect(() => {
        const visible = new Set(rows.map((row) => row.id));
        setSelected((prev) => {
          let changed = false;
          const next = new Set();
          for (const id of prev) if (visible.has(id)) next.add(id);
          else changed = true;
          return changed ? next : prev;
        });
      }, [rows]);

      const stats = React.useMemo(() => {
        const counted = Object.values(listState?.byId ?? {}).filter((row) => !row.blank && row.origin !== 'subagent');
        return {
          total: counted.length,
          running: counted.filter((row) => statusMap.get(row.id)?.running === true).length,
          archived: counted.filter((row) => archivedSet.has(row.id)).length
        };
      }, [listState, statusMap, archivedSet]);

      const showNotice = (text) => setNotice(text);
      const toggleCheck = (id) => {
        setSelected((prev) => {
          const next = new Set(prev);
          if (next.has(id)) next.delete(id);
          else next.add(id);
          return next;
        });
      };
      const toggleAll = () => {
        setSelected((prev) => (prev.size === rows.length ? new Set() : new Set(rows.map((row) => row.id))));
      };

      const archiveMany = async (ids, archived, stopActivity = false) => {
        const active = [];
        const summaries = [];
        let failed = 0;
        for (const id of ids) {
          const res = await setArchived(id, archived, stopActivity);
          if (res.ok) continue;
          if (!stopActivity && res.code === 'workspace/session-active') {
            active.push(id);
            if (res.activity !== void 0) summaries.push(res.activity);
          } else failed += 1;
        }
        if (active.length > 0) {
          const activity = [...new Set(summaries)].join(' · ');
          setStopConfirm(activity === '' ? { ids: active } : { ids: active, activity });
          return;
        }
        if (failed > 0) {
          showNotice(t('batchFailedToast', { count: failed }));
          return;
        }
        showNotice(archived ? t('archivedToast') : t('unarchivedToast'));
        setSelected(new Set());
      };

      const doDelete = async () => {
        if (deleteConfirm === null) return;
        const ids = deleteConfirm.ids;
        const running = deleteConfirm.running > 0;
        setDeleteConfirm(null);
        const res = await deleteSessions(ids, running);
        if (!res.ok) {
          showNotice(t('opFailed', { message: res.message ?? '' }));
          return;
        }
        setSelected(new Set());
        await refreshAll();
        const refused = (res.refusedLive ?? []).length;
        const main = t('deleteOk', { count: String(res.deleted?.length ?? ids.length) });
        showNotice(refused > 0 ? main + ' · ' + t('deleteRefused', { count: String(refused) }) : main);
      };
      const doRestore = async () => {
        const res = await restoreLatest();
        if (!res.ok) showNotice(t('restoreFail', { message: res.message ?? '' }));
        else {
          await refreshAll();
          showNotice(t('restoreOk'));
        }
      };
      const doPurge = async () => {
        if (purgeConfirm === null) return;
        setPurgeConfirm(null);
        const res = await purgeBin();
        if (!res.ok) showNotice(t('purgeFail', { message: res.message ?? '' }));
        else {
          await refreshAll();
          showNotice(t('purgeOk', { count: String(res.purged ?? 0) }));
        }
      };

      const loadTrash = async () => {
        const candidates = [...(listState?.ids ?? [])];
        if (candidates.length === 0) {
          setTrash(null);
          setTrashError(t('trashUnavailable', { message: 'no session' }));
          setTrashBusy(false);
          return;
        }
        setTrashBusy(true);
        setTrashError(null);
        try {
          const raced = await Promise.race([
            readTrashMirror(candidates),
            new Promise((resolve) => setTimeout(() => resolve({ ok: false, message: 'timed out after 6000ms' }), 6000))
          ]);
          if (!raced.ok) {
            setTrash(null);
            setTrashError(raced.message ?? raced.code ?? 'read failed');
          } else {
            try {
              setTrash(JSON.parse(raced.text ?? ''));
              setTrashError(null);
            } catch {
              setTrash(null);
              setTrashError('invalid mirror JSON');
            }
          }
        } catch (error) {
          setTrash(null);
          setTrashError(String(error?.message ?? error));
        }
        setTrashBusy(false);
      };

      const refreshAll = async () => {
        const list = await refreshSessions();
        await loadTrash();
        if (!list.ok) showNotice(t('actionFailedToast', { message: list.message ?? '' }));
        else showNotice(t('listRefreshed'));
      };

      React.useEffect(() => {
        loadTrash();
        refreshSessions();
        // eslint-disable-next-line react-hooks/exhaustive-deps
      }, []);

      const trimmedQuery = query.trim();

      React.useEffect(() => {
        if (trimmedQuery === '') {
          setHits([]);
          setHitsHasMore(false);
          setSearchError(null);
          return;
        }
        let cancelled = false;
        setSearchBusy(true);
        const timer = setTimeout(async () => {
          try {
            const result = await searchContent(trimmedQuery, new AbortController().signal);
            if (cancelled) return;
            if (!result.ok) {
              setHits([]);
              setHitsHasMore(false);
              setSearchError(result.message ?? result.code ?? 'search failed');
            } else {
              setHits(result.hits ?? []);
              setHitsHasMore(result.hasMore === true);
              setSearchError(null);
            }
          } catch (error) {
            if (!cancelled) setSearchError(String(error?.message ?? error));
          } finally {
            if (!cancelled) setSearchBusy(false);
          }
        }, 400);
        return () => {
          cancelled = true;
          clearTimeout(timer);
        };
      }, [trimmedQuery, searchContent]);

      const copyHits = async () => {
        const text = hits.map((hit) => `${hit.sessionId}${hit.snippet === void 0 ? '' : '\t' + hit.snippet}`).join('\n');
        const ok = await copyText(text);
        showNotice(ok ? t('copiedHitsHint', { count: hits.length }) : t('copyFailed'));
      };

      const decided = rows.filter((row) => selected.has(row.id));
      const selectedRunning = decided.filter((row) => statusMap.get(row.id)?.running === true).length;
      const showSearch = trimmedQuery !== '';

      return h('div', { className: 'ckm-root' },
        // 头部
        h('div', { className: 'ckm-head' },
          h('div', { className: 'ckm-title' }, t('title')),
          h('div', { className: 'ckm-stats' }, t('statsLine', { count: String(stats.total), running: String(stats.running), archived: String(stats.archived) }))
        ),
        // 工具行
        h('div', { className: 'ckm-toolbar' },
          TIME_FILTERS.map((f) => h('button', {
            key: f.key,
            type: 'button',
            className: 'ckm-chip' + (olderThan === f.days ? ' ckm-chip-on' : ''),
            onClick: () => setOlderThan(f.days)
          }, t(f.key))),
          h('button', {
            key: 'arch',
            type: 'button',
            className: 'ckm-chip' + (showArchived ? ' ckm-chip-on' : ''),
            onClick: () => setShowArchived(!showArchived)
          }, t('showArchived')),
          h('span', { className: 'ckm-flex' }),
          h('button', { key: 'refresh', type: 'button', className: 'ckm-chip', onClick: refreshAll }, t('refresh'))
        ),
        // 搜索
        h('input', {
          type: 'search',
          className: 'ckm-search',
          placeholder: t('searchPlaceholder'),
          value: query,
          onChange: (event) => setQuery(event.target.value)
        }),
        searchError !== null ? h('div', { className: 'ckm-note' }, t('searchFailed', { message: searchError })) : null,
        searchBusy ? h('div', { className: 'ckm-note' }, t('loading')) : null,

        showSearch && !searchBusy && searchError === null ? h('div', null,
          h('div', { className: 'ckm-toolbar' },
            h('span', { className: 'ckm-note' }, t('searchHits', { count: String(hits.length) })),
            hitsHasMore ? h('span', { className: 'ckm-note' }, t('searchMore')) : null,
            h('span', { className: 'ckm-flex' }),
            h('button', { type: 'button', className: 'ckm-btn', onClick: copyHits }, t('searchCopy'))
          ),
          hits.length === 0 ? h('div', { className: 'ckm-empty' }, t('searchNoHits')) : hits.map((hit) => {
            const row = listState?.byId?.[hit.sessionId];
            return h('div', { key: hit.sessionId, className: 'ckm-hit-head', onClick: () => { const res = openSession(hit.sessionId); if (!res.ok) showNotice(t('actionFailedToast', { message: res.message ?? '' })); } },
              h(StatusDot, { status: statusMap.get(hit.sessionId), t }),
              h('span', { className: 'ckm-hit-title' }, row?.displayTitle ?? row?.title ?? hit.sessionId),
              h('span', { className: 'ckm-badge' }, workspaceTitleOf(hit.sessionId)),
              row?.archived ? h('span', { className: 'ckm-badge' }, t('archivedBadge')) : null
            );
          })
        ) : null,

        // 会话卡片
        showSearch ? null : rows.length === 0 ? h('div', { className: 'ckm-empty' }, listState?.phase !== 'ready' ? t('loading') : t('empty')) : h('div', { className: 'ckm-list' },
          rows.map((row) => h('div', {
            key: row.id,
            className: 'ckm-card',
            onClick: () => {
              const res = openSession(row.id);
              if (!res.ok) showNotice(t('actionFailedToast', { message: res.message ?? '' }));
            }
          },
            h('input', {
              type: 'checkbox',
              className: 'ckm-check',
              checked: selected.has(row.id),
              'aria-label': row.displayTitle ?? row.title ?? row.id,
              onClick: (event) => event.stopPropagation(),
              onChange: () => toggleCheck(row.id)
            }),
            h('div', { className: 'ckm-main' },
              h('div', { className: 'ckm-name' }, row.displayTitle ?? row.title ?? row.id),
              h('div', { className: 'ckm-meta' },
                h(StatusDot, { status: statusMap.get(row.id), t }),
                h('span', null, workspaceTitleOf(row.id)),
                h('span', null, relativeTime(row.updatedAt, now, t)),
                archivedSet.has(row.id) ? h('span', { className: 'ckm-badge' }, t('archivedBadge')) : null
              )
            )
          ))
        ),

        // 底部操作条（有选中时）
        selected.size > 0 ? h('div', { className: 'ckm-bar' },
          h('span', { className: 'ckm-note' }, t('selectedCount', { count: String(selected.size) })),
          h('button', { type: 'button', className: 'ckm-btn', onClick: toggleAll }, t('selectAll')),
          h('button', { type: 'button', className: 'ckm-btn', onClick: () => archiveMany([...selected], true) }, t('archive')),
          h('button', { type: 'button', className: 'ckm-btn', onClick: () => archiveMany([...selected], false) }, t('unarchive')),
          h('button', {
            type: 'button',
            className: 'ckm-btn ckm-btn-danger',
            onClick: () => setDeleteConfirm({
              ids: [...selected],
              running: selectedRunning
            })
          }, t('deleteSelected')),
          h('button', { type: 'button', className: 'ckm-btn', onClick: () => setSelected(new Set()) }, t('clearSelection'))
        ) : null,

        // 回收站
        h('div', { className: 'ckm-trash' },
          h('span', { className: 'ckm-note' },
            trash === null ? (trashBusy ? t('loading') : trashError !== null ? t('trashUnavailable', { message: trashError }) : t('trashEmpty')) : trash.count > 0 ? t('trashTitle', { count: String(trash.count) }) : t('trashEmpty')
          ),
          h('div', { className: 'ckm-row' },
            h('button', { type: 'button', className: 'ckm-btn', onClick: doRestore }, t('restore')),
            h('button', { type: 'button', className: 'ckm-btn ckm-btn-danger', onClick: () => setPurgeConfirm(true), disabled: (trash?.count ?? 0) === 0 }, t('purgeBin'))
          ),
          trash !== null && Array.isArray(trash.batches) && trash.batches.length > 0
            ? trash.batches.map((b) => h('div', { key: String(b?.batch ?? b?.id ?? ''), className: 'ckm-note' }, t('batchLine', { batch: String(b?.batch ?? b?.id ?? ''), count: String(b?.count ?? 0), size: String(Math.round((b?.size ?? 0) / 1024)) })))
            : null,
          h('div', { className: 'ckm-note' }, t('hostOnlyHint'))
        ),

        notice !== null ? h('div', { className: 'ckm-toast' }, notice) : null,

        // 停止并归档确认
        stopConfirm !== null ? h('div', { className: 'ckm-overlay', onClick: () => setStopConfirm(null) },
          h('div', { className: 'ckm-dialog', onClick: (event) => event.stopPropagation() },
            h('h3', null, t('stopArchiveTitle')),
            h('p', null, stopConfirm.activity !== void 0 ? t('runningWork', { activity: stopConfirm.activity }) : t('stopArchiveBody', { count: String(stopConfirm.ids.length) })),
            h('div', { className: 'ckm-row' },
              h('button', { type: 'button', className: 'ckm-btn', onClick: () => setStopConfirm(null) }, t('cancel')),
              h('button', {
                type: 'button',
                className: 'ckm-btn ckm-btn-primary',
                onClick: () => {
                  const ids = stopConfirm.ids;
                  setStopConfirm(null);
                  archiveMany(ids, true, true);
                }
              }, t('stopAndArchive'))
            )
          )
        ) : null,

        // 删除确认（直接删除，进回收站可恢复）
        deleteConfirm !== null ? h('div', { className: 'ckm-overlay', onClick: () => setDeleteConfirm(null) },
          h('div', { className: 'ckm-dialog', onClick: (event) => event.stopPropagation() },
            h('h3', null, t('deleteCheckTitle')),
            h('p', null, deleteConfirm.running > 0 ? t('deleteRunningBody', { count: String(deleteConfirm.running) }) : t('deleteCheckBody', { count: String(deleteConfirm.ids.length) })),
            h('div', { className: 'ckm-row' },
              h('button', { type: 'button', className: 'ckm-btn', onClick: () => setDeleteConfirm(null) }, t('cancel')),
              h('button', { type: 'button', className: 'ckm-btn ckm-btn-danger', onClick: doDelete }, t('deleteGo'))
            )
          )
        ) : null,

        // 清空回收站确认（不可恢复）
        purgeConfirm ? h('div', { className: 'ckm-overlay', onClick: () => setPurgeConfirm(false) },
          h('div', { className: 'ckm-dialog', onClick: (event) => event.stopPropagation() },
            h('h3', null, t('purgeBin')),
            h('p', null, t('purgeHint')),
            h('div', { className: 'ckm-row' },
              h('button', { type: 'button', className: 'ckm-btn', onClick: () => setPurgeConfirm(false) }, t('cancel')),
              h('button', { type: 'button', className: 'ckm-btn ckm-btn-danger', onClick: doPurge }, t('deleteGo'))
            )
          )
        ) : null,

        h('div', { className: 'ckm-note' }, t('tapHint'))
      );
    }

// ---- 会话「…」菜单：删除会话（确认弹窗放 shell.overlay，独立于菜单存活）----
let menuDeleteTarget = null;
const menuDeleteListeners = new Set();
function setMenuDeleteTarget(target) {
  menuDeleteTarget = target;
  for (const listener of menuDeleteListeners) listener();
}
const menuDeleteStore = {
  getSnapshot: () => menuDeleteTarget,
  subscribe(listener) {
    menuDeleteListeners.add(listener);
    return () => { menuDeleteListeners.delete(listener); };
  }
};

function DeleteSessionMenuItem({ sessionId, displayTitle, useMenuOpenState, useSessionStatus, t, setMenuDeleteTarget }) {
  const [, setMenuOpen] = useMenuOpenState();
  const running = useSessionStatus((s) => (s?.get ? s.get(sessionId)?.running === true : false));
  return h('button', {
    type: 'button',
    role: 'menuitem',
    className: 'ckmMenuItem ckmMenuItem-danger',
    onClick: () => {
      setMenuOpen(false);
      setMenuDeleteTarget({ sessionId, title: displayTitle || sessionId, running: running === true });
    }
  }, t('menuDelete'));
}

    // ---- 挂载 ----
    function apply(ctx) {
      if (typeof document !== 'undefined' && document.querySelector(`style[data-plugin-css="${STYLE_TAG_ID}"]`) === null) {
        const tag = document.createElement('style');
        tag.dataset.pluginCss = STYLE_TAG_ID;
        tag.textContent = CSS;
        document.head.appendChild(tag);
      }
      ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'chat-keeper-mobile: dictionaries');

      const t = ctx.locale.bind(NS);
      const sessions = ctx.get('sessions');
      const workspaces = ctx.get('workspaces');
      const uiWorkspace = () => ctx.get('uiWorkspace');

      const face = {
        openSession(id) {
          const service = uiWorkspace();
          if (service === void 0) return { ok: false, message: 'uiWorkspace service is unavailable' };
          try {
            service.openSession(id);
            return { ok: true };
          } catch (error) {
            return { ok: false, message: String(error?.message ?? error) };
          }
        },
        async setArchived(id, archived, stopActivity = false) {
          try {
            if (archived) await workspaces.archiveSession(id, stopActivity ? { stopActivity: true } : {});
            else await workspaces.unarchiveSession(id);
            return { ok: true };
          } catch (error) {
            return { ok: false, code: error?.rpcError?.code ?? error?.code, message: error?.rpcError?.message ?? error?.message ?? String(error), activity: error?.activity };
          }
        },
        // 直接删除 / 恢复 / 清空：走本插件 Host 的 HTTP 接口（复用同一套磁盘逻辑）。
        // 注意：face 的方法会被组件解构后裸调用，绝不能依赖 `this`。
        async postAction(path, payload) {
          try {
            const response = await fetch(path, {
              method: 'POST',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify(payload ?? {})
            });
            const data = await response.json().catch(() => null);
            if (!response.ok) return { ok: false, status: response.status, raw: data, message: (data && data.message) || `HTTP ${String(response.status)}` };
            return { ok: data?.ok !== false, ...(data ?? {}) };
          } catch (error) {
            return { ok: false, message: String(error?.message ?? error) };
          }
        },
        deleteSessions: async (sessionIds, includeRunning = false) => {
          const response = await fetch('/chat-keeper-mobile/delete', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ sessionIds, includeRunning: !!includeRunning })
          });
          const data = await response.json().catch(() => null);
          if (!response.ok) return { ok: false, status: response.status, raw: data, message: (data && data.message) || `HTTP ${String(response.status)}` };
          return { ok: data?.ok !== false, ...(data ?? {}) };
        },
        restoreLatest: async () => {
          const response = await fetch('/chat-keeper-mobile/restore', { method: 'POST' });
          const data = await response.json().catch(() => null);
          if (!response.ok) return { ok: false, status: response.status, raw: data, message: (data && data.message) || `HTTP ${String(response.status)}` };
          return { ok: data?.ok !== false, ...(data ?? {}) };
        },
        purgeBin: async () => {
          const response = await fetch('/chat-keeper-mobile/purge', { method: 'POST' });
          const data = await response.json().catch(() => null);
          if (!response.ok) return { ok: false, status: response.status, raw: data, message: (data && data.message) || `HTTP ${String(response.status)}` };
          return { ok: data?.ok !== false, ...(data ?? {}) };
        },
        async refreshSessions() {
          try {
            await sessions.refresh();
            return { ok: true };
          } catch (error) {
            return { ok: false, message: String(error?.message ?? error) };
          }
        },
        async searchContent(query, signal) {
          const clean = query.trim();
          if (clean === '') return { ok: true, hits: [], hasMore: false };
          try {
            const result = await sessions.search(clean, signal);
            if (!result?.ok) return { ok: false, hits: [], hasMore: false, code: result?.error?.code, message: result?.error?.message ?? 'search failed' };
            return {
              ok: true,
              hits: (result.value?.items ?? []).map((item) => ({
                sessionId: String(item?.sessionId ?? ''),
                snippet: typeof item?.snippet === 'string' ? String(item.snippet) : void 0
              })).filter((hit) => hit.sessionId !== ''),
              hasMore: result.value?.hasMore === true
            };
          } catch (error) {
            return { ok: false, hits: [], hasMore: false, code: error?.rpcError?.code ?? error?.code, message: error?.rpcError?.message ?? error?.message ?? String(error) };
          }
        },
        async readTrashMirror(ids) {
          const read = ctx.remote?.workspaceFiles?.read;
          if (typeof read !== 'function') return { ok: false, message: 'workspaceFiles remote is unavailable', tried: 0 };
          const candidates = [...new Set(ids)].slice(0, 12);
          let last = { ok: false, message: 'no candidate session id', tried: 0 };
          let tried = 0;
          for (const id of candidates) {
            tried += 1;
            try {
              const result = await read(id, TRASH_MIRROR_PATH, {}, new AbortController().signal);
              if (result?.ok === true) return { ok: true, text: String(result.value?.text ?? ''), tried };
              last = { ok: false, code: result?.error?.code, message: result?.error?.message ?? 'read failed', tried };
            } catch (error) {
              last = { ok: false, message: String(error?.message ?? error), tried };
            }
          }
          return { ...last, tried };
        }
      };

      ctx.slots.inject('settings.section', () => ctx.slots.register({
        name: 'settings.section',
        id: 'chat-keeper-mobile',
        order: 30,
        locale: NS,
        label: () => t('title'),
        inject: () => face
      }, ManagerPage));

      // 会话「…」菜单：删除会话
      ctx.slots.inject('sidebar.workspaces.session.menu.item', () => ctx.slots.register({
        name: 'sidebar.workspaces.session.menu.item',
        id: 'chat-keeper-mobile.delete',
        order: 500,
        locale: NS,
        inject: () => ({ setMenuDeleteTarget })
      }, DeleteSessionMenuItem));

      // 删除确认弹窗：直接挂到 document.body，任何页面都在最上层（不走 shell.overlay 槽位）。
      let dialogEl = null;
      const hideDialog = () => {
        if (dialogEl !== null) dialogEl.style.display = 'none';
      };
      const ensureDialog = () => {
        if (dialogEl !== null) return dialogEl;
        const overlay = document.createElement('div');
        overlay.className = 'ckm-overlay';
        overlay.style.display = 'none';
        const box = document.createElement('div');
        box.className = 'ckm-dialog';
        const title = document.createElement('h3');
        const body = document.createElement('p');
        const row = document.createElement('div');
        row.className = 'ckm-row';
        const cancel = document.createElement('button');
        cancel.type = 'button';
        cancel.className = 'ckm-btn';
        cancel.textContent = t('cancel');
        const go = document.createElement('button');
        go.type = 'button';
        go.className = 'ckm-btn ckm-btn-danger';
        go.textContent = t('deleteGo');
        row.append(cancel, go);
        box.append(title, body, row);
        overlay.appendChild(box);
        overlay.addEventListener('click', (event) => {
          if (event.target === overlay) hideDialog();
        });
        cancel.addEventListener('click', hideDialog);
        document.body.appendChild(overlay);
        dialogEl = overlay;
        return overlay;
      };
      const unsubscribeMenuDelete = menuDeleteStore.subscribe(() => {
        const target = menuDeleteStore.getSnapshot();
        const overlay = ensureDialog();
        if (target === null) {
          overlay.style.display = 'none';
          return;
        }
        const title = overlay.firstChild.firstChild;
        const body = overlay.firstChild.childNodes[1];
        const buttons = overlay.firstChild.lastChild;
        title.textContent = t('menuDelete');
        body.textContent = target.running === true
          ? t('menuDeleteRunningBody', { name: target.title })
          : t('menuDeleteBody', { name: target.title });
        buttons.lastChild.disabled = false;
        buttons.lastChild.onclick = async () => {
          buttons.lastChild.disabled = true;
          let res;
          try {
            res = await face.deleteSessions([target.sessionId], true);
          } catch (error) {
            body.textContent = t('menuDeleteFailed', { message: String(error?.message ?? error) });
            buttons.lastChild.disabled = false;
            return;
          }
          if (!res.ok) {
            const detail = (res.message ?? '') + (res.status !== void 0 ? ' (HTTP ' + String(res.status) + ')' : '') + ' · id=' + String(target.sessionId);
            body.textContent = t('menuDeleteFailed', { message: detail });
            buttons.lastChild.disabled = false;
            return;
          }
          const deleted = (res.deleted ?? []).length;
          const notFound = (res.notFound ?? []).length;
          if (deleted > 0) {
            body.textContent = t('menuDeleted', { name: target.title });
            try { await face.refreshSessions(); } catch { /* 列表刷新失败不阻断提示 */ }
          } else if (notFound > 0) {
            body.textContent = t('menuDeleteNotFound');
          } else {
            body.textContent = t('menuDeleteFailed', { message: 'refused' });
          }
          window.setTimeout(() => { overlay.style.display = 'none'; }, 2200);
        };
        overlay.style.display = 'flex';
      });
      ctx.effect(() => () => {
        unsubscribeMenuDelete();
        if (dialogEl !== null) {
          dialogEl.remove();
          dialogEl = null;
        }
      }, 'chat-keeper-mobile: menu delete dialog');
    }

    return { inject: ['slots', 'locale', 'remote', 'remote.workspaceFiles', 'sessions', 'workspaces'], apply };
  }
});