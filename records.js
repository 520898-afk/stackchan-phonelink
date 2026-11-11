/* 手术记录（手术步骤）/ 知情同意书风险条款：先网络后本地知识库；手机本地保存，电脑在线时自动同步一份 .md 到电脑。 */
(function (root) {
  'use strict';

  const Notes = (typeof module !== 'undefined' && module.exports)
    ? require('./notes.js')
    : (root.PhoneLinkNotes || {});

  const DB_NAME = 'stackchan-phonelink-docs';
  const STORE = 'docs';
  const LS_KEY = 'stackchan.phonelink.docs';
  const MAX_DOCS = 100;          // 本机最多保留份数（超出先删最早的已同步文书）
  const SYNC_MIN_INTERVAL_MS = 30000;
  const SYNC_TOOL = 'save_medical_doc';
  const KIND_TITLES = {
    op_record: '手术记录（手术步骤）',
    consent_surgery: '知情同意书风险条款（手术）',
    consent_injection: '知情同意书风险条款（注射）',
  };
  const DEFAULT_ORDER = {
    op_record: ['术式', '流程', '麻醉', '设计', '切口', '操作', '缝合', '包扎'],
    consent_surgery: ['告知', '一般', '麻醉', '特有', '严重', '效果'],
    consent_injection: ['告知', '一般', '麻醉', '特有', '严重', '效果'],
  };

  function $(id) { return (typeof document !== 'undefined') ? document.getElementById(id) : null; }
  function escapeHtml(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  // ---------- 云函数查询 ----------
  async function query(procedure, action, fetchFn) {
    const cfg = Notes.getCfg ? Notes.getCfg() : { url: '', code: '' };
    if (!cfg.url || !cfg.code) {
      return { ok: false, offline_config: true, procedure: procedure, error: '尚未配置云函数地址或访问码，请先在「医美助手设置」里填写。' };
    }
    const f = fetchFn || root.fetch;
    const resp = await f(cfg.url.replace(/\/$/, ''), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Access-Code': cfg.code },
      body: JSON.stringify({ procedure: procedure, action: action }),
    });
    let data;
    try { data = await resp.json(); } catch (e) { return { ok: false, procedure: procedure, error: '云函数返回了无法解析的内容（HTTP ' + resp.status + '）。' }; }
    if (!data || typeof data !== 'object') return { ok: false, procedure: procedure, error: '云函数返回格式不对。' };
    data.procedure = data.procedure || procedure;
    if (!resp.ok && !data.card_text) return { ok: false, procedure: procedure, error: data.error || ('查询失败（HTTP ' + resp.status + '）。') };
    return data;
  }

  // ---------- 渲染与 Markdown ----------
  function citeParts(it) {
    const s = it.source || {};
    const parts = [];
    if (s.tier) parts.push(s.tier);
    parts.push(it.quote || '摘要');
    if (it.lang === 'en') parts.push('英文来源');
    return parts;
  }
  function orderOf(data) {
    return (data.section_order && data.section_order.length) ? data.section_order : (DEFAULT_ORDER[data.doc_type || data.action] || Object.keys(data.sections || {}));
  }
  function localLines(local) {
    if (!local) return [];
    const out = ['## 本地知识库', ''];
    if (!local.available) out.push((Notes.LOCAL_UNAVAILABLE || '本地知识库这次查不到，只有网络结果') + '（' + String(local.reason || '原因未知').replace(/[。.\s]+$/, '') + '）。');
    else if (!local.items.length) out.push('本地知识库没有找到「' + (local.keywords || []).join('、') + '」相关资料。');
    else local.items.forEach(it => {
      out.push('- ' + (it.excerpt || '（无摘录）'));
      out.push('  - 来源：本地知识库' + (it.filename ? ' · ' + it.filename : '') + (it.id != null ? ' · #' + it.id : ''));
    });
    out.push('');
    return out;
  }

  function toMarkdown(data, createdAt) {
    const kind = data.doc_type || data.action;
    const lines = ['# ' + (data.procedure || '') + ' · ' + (KIND_TITLES[kind] || '医疗文书'), ''];
    if (createdAt) lines.push('整理时间：' + new Date(createdAt).toLocaleString('zh-CN', { hour12: false }), '');
    if (data.disclaimer) lines.push('> ' + data.disclaimer, '');
    if (!data.ok && (data.message || data.error)) lines.push(data.message || data.error, '');
    const titles = data.section_titles || {};
    orderOf(data).forEach(key => {
      const items = (data.sections || {})[key] || [];
      if (!items.length) return;
      lines.push('## ' + (titles[key] || key), '');
      items.forEach(it => {
        const s = it.source || {};
        const tech = it.technique ? '［' + it.technique + '］' : '';
        lines.push('- ' + tech + it.text);
        lines.push('  - 来源：' + (s.url ? '[' + (s.site || s.name || '来源') + '](' + s.url + ')' : (s.site || s.name || '来源')) + ' · ' + citeParts(it).join(' · '));
      });
      lines.push('');
    });
    const sources = data.sources || [];
    if (sources.length) {
      lines.push('## 来源', '');
      sources.forEach((s, i) => lines.push((i + 1) + '. ' + (s.name || '（无标题）') + (s.site ? ' — ' + s.site : '') + (s.tier ? '（' + s.tier + '）' : '') + (s.url ? ' ' + s.url : '')));
      lines.push('');
    }
    return lines.concat(localLines(data.local)).join('\n').replace(/\n{3,}/g, '\n\n').trim() + '\n';
  }

  function renderHtml(data) {
    let html = '';
    if (data.disclaimer) html += '<p class="warn">' + escapeHtml(data.disclaimer) + '</p>';
    if (!data.ok && (data.message || data.error)) html += '<p>' + escapeHtml(data.message || data.error) + '</p>';
    const titles = data.section_titles || {};
    orderOf(data).forEach(key => {
      const items = (data.sections || {})[key] || [];
      if (!items.length) return;
      html += '<h3 class="notes-h">' + escapeHtml(titles[key] || key) + '</h3><ul class="notes-list">';
      items.forEach(it => {
        const s = it.source || {};
        const label = escapeHtml(s.site || s.name || '来源');
        const cite = s.url ? '<a href="' + escapeHtml(s.url) + '" target="_blank" rel="noreferrer">' + label + '</a>' : label;
        const tech = it.technique ? '<span class="mut">［' + escapeHtml(it.technique) + '］</span>' : '';
        html += '<li>' + tech + escapeHtml(it.text) + '<div class="mut">来源：' + cite + ' · ' + escapeHtml(citeParts(it).join(' · ')) + '</div></li>';
      });
      html += '</ul>';
    });
    const sources = data.sources || [];
    if (sources.length) {
      html += '<h3 class="notes-h">来源</h3><ol class="notes-src">';
      sources.forEach(s => {
        const label = escapeHtml((s.name || '（无标题）') + (s.site ? ' — ' + s.site : '') + (s.tier ? '（' + s.tier + '）' : ''));
        html += s.url ? '<li><a href="' + escapeHtml(s.url) + '" target="_blank" rel="noreferrer">' + label + '</a></li>' : '<li>' + label + '</li>';
      });
      html += '</ol>';
    }
    if (data.local) {
      const local = data.local;
      html += '<h3 class="notes-h">本地知识库</h3>';
      if (!local.available) {
        html += '<p class="mut">' + escapeHtml((Notes.LOCAL_UNAVAILABLE || '本地知识库这次查不到，只有网络结果') + '（' + String(local.reason || '原因未知').replace(/[。.\s]+$/, '') + '）。') + '</p>';
      } else if (!local.items.length) {
        html += '<p class="mut">' + escapeHtml('本地知识库没有找到「' + (local.keywords || []).join('、') + '」相关资料。') + '</p>';
      } else {
        html += '<ul class="notes-list">';
        local.items.forEach(it => {
          html += '<li>' + escapeHtml(it.excerpt || '（无摘录）') + '<div class="mut">来源：本地知识库' + escapeHtml((it.filename ? ' · ' + it.filename : '') + (it.id != null ? ' · #' + it.id : '')) + '</div></li>';
        });
        html += '</ul>';
      }
    }
    return html;
  }

  // ---------- 本机存储（IndexedDB，失败退回 localStorage） ----------
  function lsStore(ls) {
    const read = () => { try { return JSON.parse(ls.getItem(LS_KEY) || '[]'); } catch (e) { return []; } };
    const write = list => ls.setItem(LS_KEY, JSON.stringify(list));
    return {
      kind: 'localStorage',
      async all() { return read(); },
      async put(doc) { const l = read().filter(d => d.id !== doc.id); l.push(doc); write(l); },
      async remove(id) { write(read().filter(d => d.id !== id)); },
    };
  }
  function idbStore(idb) {
    let dbp = null;
    function open() {
      if (dbp) return dbp;
      dbp = new Promise((resolve, reject) => {
        const req = idb.open(DB_NAME, 1);
        req.onupgradeneeded = () => { const db = req.result; if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: 'id' }); };
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      });
      return dbp;
    }
    function tx(mode, fn) {
      return open().then(db => new Promise((resolve, reject) => {
        const t = db.transaction(STORE, mode);
        const st = t.objectStore(STORE);
        const r = fn(st);
        t.oncomplete = () => resolve(r && r.result);
        t.onerror = () => reject(t.error);
      }));
    }
    return {
      kind: 'IndexedDB',
      all() { return tx('readonly', st => st.getAll()).then(x => x || []); },
      put(doc) { return tx('readwrite', st => st.put(doc)); },
      remove(id) { return tx('readwrite', st => st.delete(id)); },
    };
  }
  let store = null;
  function getStore() {
    if (store) return store;
    if (root.indexedDB) {
      const idb = idbStore(root.indexedDB);
      const ls = root.localStorage ? lsStore(root.localStorage) : null;
      // 有些环境（隐私模式）IndexedDB 打开失败：改用 localStorage。
      store = {
        kind: 'IndexedDB',
        all() { return idb.all().catch(() => { store = ls; return ls ? ls.all() : []; }); },
        put(doc) { return idb.put(doc).catch(() => { store = ls; return ls && ls.put(doc); }); },
        remove(id) { return idb.remove(id).catch(() => { store = ls; return ls && ls.remove(id); }); },
      };
    } else if (root.localStorage) {
      store = lsStore(root.localStorage);
    }
    return store;
  }
  function setStore(s) { store = s; }

  function newId(now) {
    const rnd = Math.random().toString(36).slice(2, 10).padEnd(8, '0');
    return 'doc-' + Number(now).toString(36) + '-' + rnd;
  }

  async function listDocs() {
    const s = getStore();
    if (!s) return [];
    const list = await s.all();
    return list.slice().sort((a, b) => b.created_at - a.created_at);
  }

  async function prune() {
    const s = getStore();
    const list = (await s.all()).slice().sort((a, b) => a.created_at - b.created_at);
    let over = list.length - MAX_DOCS;
    if (over <= 0) return 0;
    const victims = list.filter(d => d.synced_to_mac).slice(0, over);
    if (victims.length < over) victims.push(...list.filter(d => !d.synced_to_mac).slice(0, over - victims.length));
    for (const d of victims) await s.remove(d.id);
    return victims.length;
  }

  async function saveDoc(data, now) {
    const s = getStore();
    if (!s) return { ok: false, error: '这个浏览器不能本地保存。' };
    const at = now || Date.now();
    const kind = data.doc_type || data.action;
    if (!KIND_TITLES[kind]) return { ok: false, error: '文书类型不对。' };
    const doc = {
      id: newId(at), kind: kind, procedure: data.procedure || '', created_at: at,
      title: (data.procedure || '') + ' · ' + KIND_TITLES[kind],
      markdown: toMarkdown(data, at), data: data, synced_to_mac: false,
    };
    await s.put(doc);
    const pruned = await prune();
    return { ok: true, doc: doc, pruned: pruned, storage: s.kind };
  }

  // ---------- 电脑同步（汇聚服务在线且本页在前台时） ----------
  function parseSaveResult(res) {
    if (!res || res.ok === false) return { ok: false, stop: true, reason: (res && res.reason) || '汇聚服务没有响应。' };
    const t = res.content && res.content[0] && res.content[0].text;
    let p = null;
    try { p = JSON.parse(t || 'null'); } catch (e) {}
    if (!p) return { ok: false, stop: true, reason: '电脑端返回格式不对。' };
    if (p.success) return { ok: true, file: p.file || '', already: !!p.already };
    const stop = p.error === 'folder_missing';
    return { ok: false, stop: stop, reason: p.message || p.error || '电脑端保存失败。' };
  }

  let callTool = null;
  let syncing = false;
  let lastSyncAt = 0;
  function setCallTool(fn) { callTool = typeof fn === 'function' ? fn : null; }

  async function syncPending(opts) {
    opts = opts || {};
    if (!callTool) return { ok: false, reason: '没有配置家里电脑汇聚服务。', synced: 0 };
    if (syncing) return { ok: false, reason: '正在同步。', synced: 0 };
    const nowMs = opts.now || Date.now();
    if (!opts.force && nowMs - lastSyncAt < SYNC_MIN_INTERVAL_MS) return { ok: true, skipped: true, synced: 0 };
    syncing = true;
    lastSyncAt = nowMs;
    let synced = 0;
    let reason = '';
    try {
      const s = getStore();
      const pending = (await s.all()).filter(d => !d.synced_to_mac).sort((a, b) => a.created_at - b.created_at);
      for (const d of pending) {
        let r;
        try {
          r = parseSaveResult(await callTool(SYNC_TOOL, { id: d.id, kind: d.kind, procedure: d.procedure, created_at: d.created_at, markdown: d.markdown }, 10000));
        } catch (e) { r = { ok: false, stop: true, reason: '连接家里电脑失败。' }; }
        if (r.ok) {
          d.synced_to_mac = true; d.synced_at = nowMs; d.mac_file = r.file;
          await s.put(d);
          synced++;
        } else {
          reason = r.reason;
          if (r.stop) break;
        }
      }
      return { ok: !reason, synced: synced, pending: pending.length - synced, reason: reason };
    } finally {
      syncing = false;
    }
  }

  // ---------- 页面 ----------
  let current = null;
  function setHint(text) { if ($('recHint')) $('recHint').textContent = text; }

  function showResult(data, opts) {
    opts = opts || {};
    const box = $('recResult');
    if (!box) return;
    const kind = data.doc_type || data.action;
    $('recResultTitle').textContent = '「' + (data.procedure || '') + '」' + (KIND_TITLES[kind] || '') + (opts.fromSaved ? '（已保存）' : '');
    $('recResultBody').innerHTML = renderHtml(data);
    box.style.display = 'block';
    box.classList.add('lit');
    if ($('recSaveBtn')) $('recSaveBtn').style.display = opts.fromSaved ? 'none' : '';
    current = { data: data, md: opts.md || toMarkdown(data, opts.createdAt || Date.now()) };
    if (opts.scroll !== false && box.scrollIntoView) box.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }

  async function renderSaved() {
    const el = $('recSavedList');
    if (!el) return;
    const list = await listDocs();
    if (!list.length) { el.innerHTML = '<p class="mut">还没有保存的文书。</p>'; return; }
    el.innerHTML = list.map(d => {
      const t = new Date(d.created_at).toLocaleString('zh-CN', { hour12: false });
      const st = d.synced_to_mac ? '已同步到电脑' : '待同步到电脑';
      return '<button type="button" class="hist-item" data-doc="' + escapeHtml(d.id) + '">' + escapeHtml(d.title) +
        '<span class="mut">  ' + escapeHtml(t + ' · ' + st) + '</span></button>';
    }).join('');
  }

  function downloadMd(name, md) {
    const blob = new Blob([md], { type: 'text/markdown;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = name.replace(/[\\/:*?"<>|\s]+/g, '_') + '.md';
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
  }

  async function run(procedure, action) {
    const v = Notes.validateProcedure ? Notes.validateProcedure(procedure) : { ok: !!procedure, procedure: procedure };
    if (!v.ok) { setHint(v.error); return null; }
    setHint('正在专业网站检索「' + v.procedure + '」…');
    let data;
    try { data = await query(v.procedure, action); } catch (e) { data = { ok: false, procedure: v.procedure, error: '网络异常，请稍后重试。' }; }
    if (!data.doc_type && !data.action) data.action = action === 'op_record' ? 'op_record' : (action === 'consent_injection' ? 'consent_injection' : 'consent_surgery');
    showResult(data);
    if (data.offline_config) { setHint(data.error); return data; }
    setHint('网络结果已显示，正在查本地知识库…');
    try { data.local = Notes.searchLocal ? await Notes.searchLocal(data) : null; } catch (e) { data.local = { available: false, reason: '连接家里电脑失败。', items: [] }; }
    showResult(data, { scroll: false });
    setHint(data.ok ? '已整理。点「保存」存到本机；电脑在线时会自动同步一份。' : (data.message || data.error || '资料不足。'));
    return data;
  }

  function bind() {
    const go = (inputId, actionFn) => {
      const v = $(inputId) ? $(inputId).value : '';
      run(v, actionFn());
    };
    const consentAction = () => {
      const el = (typeof document !== 'undefined') && document.querySelector('input[name="consentType"]:checked');
      return el ? el.value : 'consent';
    };
    if ($('recSearchBtn')) $('recSearchBtn').onclick = () => go('recInput', () => 'op_record');
    if ($('consentSearchBtn')) $('consentSearchBtn').onclick = () => go('consentInput', consentAction);
    ['recInput', 'consentInput'].forEach(id => {
      if ($(id)) $(id).addEventListener('keydown', ev => {
        if (ev.key === 'Enter') { ev.preventDefault(); id === 'recInput' ? go(id, () => 'op_record') : go(id, consentAction); }
      });
    });
    if ($('recSaveBtn')) $('recSaveBtn').onclick = async () => {
      if (!current || !current.data) return;
      const r = await saveDoc(current.data);
      if (!r.ok) { setHint(r.error); return; }
      setHint('已保存到本机（' + r.storage + '）' + (r.pruned ? '，已删除最早的 ' + r.pruned + ' 份' : '') + '。电脑在线时会自动同步一份。');
      if ($('recSaveBtn')) $('recSaveBtn').style.display = 'none';
      await renderSaved();
      const s = await syncPending({ force: true });
      if (s.synced) { setHint('已保存到本机，并同步到电脑。'); await renderSaved(); }
    };
    if ($('recCopyBtn')) $('recCopyBtn').onclick = async () => {
      if (!current) return;
      let ok = false;
      try { if (root.navigator && root.navigator.clipboard) { await root.navigator.clipboard.writeText(current.md); ok = true; } } catch (e) {}
      if (!ok) {
        try {
          const ta = document.createElement('textarea');
          ta.value = current.md; ta.setAttribute('readonly', ''); ta.style.position = 'fixed'; ta.style.left = '-9999px';
          document.body.appendChild(ta); ta.select(); ok = document.execCommand('copy'); ta.remove();
        } catch (e) {}
      }
      setHint(ok ? '已复制。' : '复制失败，请长按全文手动复制。');
    };
    if ($('recShareBtn')) $('recShareBtn').onclick = async () => {
      if (!current) return;
      if (root.navigator && root.navigator.share) {
        try { await root.navigator.share({ title: (current.data.procedure || '') + ' · 医疗文书', text: current.md }); setHint('已打开系统分享。'); return; }
        catch (e) { if (e && e.name === 'AbortError') { setHint('已取消分享。'); return; } }
      }
      setHint('当前环境不支持分享，请用「导出 .md」或「复制」。');
    };
    if ($('recExportBtn')) $('recExportBtn').onclick = () => {
      if (!current) return;
      downloadMd((current.data.procedure || '文书') + '_' + (KIND_TITLES[current.data.doc_type || current.data.action] || ''), current.md);
      setHint('已导出 .md 文件（iPhone 上在「文件」App 里）。');
    };
    if ($('recCloseBtn')) $('recCloseBtn').onclick = () => { const b = $('recResult'); if (b) { b.style.display = 'none'; b.classList.remove('lit'); } };
    if ($('recSyncBtn')) $('recSyncBtn').onclick = async () => {
      const s = await syncPending({ force: true });
      if ($('recSyncShow')) $('recSyncShow').textContent = s.ok ? ('同步完成：本次 ' + s.synced + ' 份。') : ('这次没同步：' + s.reason);
      await renderSaved();
    };
    const list = $('recSavedList');
    if (list) list.addEventListener('click', async ev => {
      const btn = ev.target.closest('[data-doc]');
      if (!btn) return;
      const d = (await listDocs()).find(x => x.id === btn.getAttribute('data-doc'));
      if (d) showResult(d.data, { fromSaved: true, md: d.markdown, createdAt: d.created_at });
    });
    renderSaved();
  }

  // 汇聚服务可达时由 app.js 调用；页面不在前台时 iOS 不会运行，回到前台后再同步。
  async function onHubReachable() {
    const r = await syncPending();
    if (r.synced) {
      if ($('recSyncShow')) $('recSyncShow').textContent = '已自动同步 ' + r.synced + ' 份到电脑。';
      renderSaved();
    } else if (r.reason && $('recSyncShow') && !r.skipped) {
      $('recSyncShow').textContent = '电脑同步未完成：' + r.reason;
    }
    return r;
  }

  const api = {
    MAX_DOCS, SYNC_TOOL, KIND_TITLES, query, toMarkdown, renderHtml, saveDoc, listDocs, prune, syncPending,
    setCallTool, setStore, lsStore, parseSaveResult, newId, bind, run, onHubReachable,
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.PhoneLinkRecords = api;
})(typeof self !== 'undefined' ? self : this);
