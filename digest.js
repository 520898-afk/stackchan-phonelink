/* 医美新知：今日条目可「存到手机」；回家电脑开机且本页在前台时再同步到电脑，不自动入库。 */
(function (root) {
  'use strict';

  const KEY = 'stackchan.phonelink.digestSaved';
  const MAX = 100;
  const SYNC_TOOL = 'save_medical_doc';
  const KIND = 'yimei_digest';
  const DIGEST_URL = 'yimei-digest.json';
  const SYNC_MIN_INTERVAL_MS = 30000;

  function $(id) { return document.getElementById(id); }

  function escapeHtml(s) {
    return String(s || '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  function storage() {
    try { if (typeof localStorage !== 'undefined') return localStorage; } catch (e) {}
    return null;
  }

  function read() {
    const ls = storage();
    if (!ls) return [];
    try {
      const list = JSON.parse(ls.getItem(KEY) || '[]');
      return Array.isArray(list) ? list : [];
    } catch (e) { return []; }
  }

  function write(list) {
    const ls = storage();
    if (!ls) return;
    ls.setItem(KEY, JSON.stringify(list));
  }

  function newId(now) {
    const rnd = Math.random().toString(36).slice(2, 10).padEnd(8, '0');
    return 'dig-' + Number(now).toString(36) + '-' + rnd;
  }

  function normalizeItem(raw) {
    raw = raw || {};
    return {
      title: String(raw.title || '').trim(),
      url: String(raw.url || raw.link || '').trim(),
      summary: String(raw.summary || raw.note || '').trim(),
      worth: String(raw.worth || raw.collect || '').trim(),
      source: String(raw.source || '').trim(),
    };
  }

  function validateUrl(url) {
    if (!url) return null;
    try {
      const u = new URL(url);
      if (u.protocol !== 'http:' && u.protocol !== 'https:') return '链接只支持 http 或 https。';
      return null;
    } catch (e) { return '链接格式不对。'; }
  }

  function toMarkdown(item, at) {
    const lines = ['# ' + (item.title || '医美新知'), ''];
    if (item.summary) lines.push(item.summary, '');
    if (item.worth) lines.push('是否值得收藏：' + item.worth, '');
    if (item.source) lines.push('来源：' + item.source, '');
    if (item.url) lines.push('原文：' + item.url, '');
    lines.push('保存时间：' + new Date(at).toISOString());
    return lines.join('\n');
  }

  function isSame(doc, item) {
    if (item.url && doc.url) return doc.url === item.url;
    return doc.title === item.title && doc.summary === item.summary;
  }

  function alreadySaved(item) {
    return read().some(d => isSame(d, item));
  }

  function saveItem(raw, now) {
    const item = normalizeItem(raw);
    if (!item.title) return { ok: false, error: '请填写标题。' };
    const err = validateUrl(item.url);
    if (err) return { ok: false, error: err };
    if (alreadySaved(item)) return { ok: false, error: '这条已经存在本机。', already: true };
    const ls = storage();
    if (!ls) return { ok: false, error: '这个浏览器不能本地保存。' };
    const at = now || Date.now();
    const doc = {
      id: newId(at),
      kind: KIND,
      procedure: item.title.slice(0, 40),
      title: item.title,
      url: item.url,
      summary: item.summary,
      worth: item.worth,
      source: item.source,
      created_at: at,
      markdown: toMarkdown(item, at),
      synced_to_mac: false,
    };
    const list = read();
    list.push(doc);
    list.sort((a, b) => a.created_at - b.created_at);
    while (list.length > MAX) {
      const i = list.findIndex(d => d.synced_to_mac);
      list.splice(i >= 0 ? i : 0, 1);
    }
    write(list);
    return { ok: true, doc: doc };
  }

  function listSaved() {
    return read().slice().sort((a, b) => b.created_at - a.created_at);
  }

  function removeItem(id) {
    write(read().filter(d => d.id !== id));
  }

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
      const pending = read().filter(d => !d.synced_to_mac).sort((a, b) => a.created_at - b.created_at);
      const all = read();
      for (const d of pending) {
        let r;
        try {
          r = parseSaveResult(await callTool(SYNC_TOOL, {
            id: d.id, kind: d.kind, procedure: d.procedure, created_at: d.created_at, markdown: d.markdown,
          }, 10000));
        } catch (e) { r = { ok: false, stop: true, reason: '连接家里电脑失败。' }; }
        if (r.ok) {
          const cur = all.find(x => x.id === d.id);
          if (cur) { cur.synced_to_mac = true; cur.synced_at = nowMs; cur.mac_file = r.file; }
          synced++;
        } else {
          reason = r.reason;
          if (r.stop) break;
        }
      }
      write(all);
      return { ok: !reason, synced: synced, pending: pending.length - synced, reason: reason };
    } finally {
      syncing = false;
    }
  }

  function setHint(text) { if ($('digestHint')) $('digestHint').textContent = text || ''; }

  function renderToday(payload) {
    const el = $('digestToday');
    if (!el) return;
    const items = (payload && Array.isArray(payload.items)) ? payload.items.map(normalizeItem).filter(it => it.title) : [];
    const updated = payload && payload.updated ? String(payload.updated) : '';
    if (!items.length) {
      el.innerHTML = '<p class="mut">今天还没有自动检索到的新知，可以用下面的「手动添加」先存一条。</p>';
      return;
    }
    const head = updated ? '<p class="mut">更新于 ' + escapeHtml(updated) + '</p>' : '';
    el.innerHTML = head + items.map((it, i) => {
      const saved = alreadySaved(it);
      const link = it.url ? ' <a href="' + escapeHtml(it.url) + '" target="_blank" rel="noopener">打开原文</a>' : '';
      const meta = [it.source, it.worth].filter(Boolean).map(escapeHtml).join(' · ');
      return '<div class="home-link" data-digest-i="' + i + '">' +
        '<div><b>' + escapeHtml(it.title) + '</b>' + link + '</div>' +
        (it.summary ? '<div class="mut">' + escapeHtml(it.summary) + '</div>' : '') +
        (meta ? '<div class="mut">' + meta + '</div>' : '') +
        (saved
          ? '<div class="mut">已存到本机</div>'
          : '<button class="primary digest-save-today" data-digest-i="' + i + '">存到手机</button>') +
        '</div>';
    }).join('');
    el._items = items;
  }

  function renderSaved() {
    const el = $('digestSaved');
    if (!el) return;
    const list = listSaved();
    if (!list.length) {
      el.textContent = '还没有存到本机的新知。';
      return;
    }
    el.innerHTML = list.map(d => {
      const st = d.synced_to_mac ? '已同步到电脑' : '待同步到电脑';
      const link = d.url ? ' <a href="' + escapeHtml(d.url) + '" target="_blank" rel="noopener">原文</a>' : '';
      return '<div class="home-link">' +
        '<div><b>' + escapeHtml(d.title) + '</b>' + link + ' <span class="mut">' + st + '</span></div>' +
        (d.summary ? '<div class="mut">' + escapeHtml(d.summary) + '</div>' : '') +
        '<button class="digest-remove" data-id="' + escapeHtml(d.id) + '">删除</button>' +
        '</div>';
    }).join('');
  }

  async function loadToday(fetchFn) {
    const fn = fetchFn || (typeof fetch !== 'undefined' ? fetch : null);
    if (!fn) { renderToday({ items: [] }); return { ok: false, items: [] }; }
    try {
      const r = await fn(DIGEST_URL, { cache: 'no-store' });
      if (!r.ok) { renderToday({ items: [] }); return { ok: false, items: [] }; }
      const data = await r.json();
      renderToday(data);
      return { ok: true, items: (data && data.items) || [] };
    } catch (e) {
      renderToday({ items: [] });
      return { ok: false, items: [] };
    }
  }

  function bind() {
    renderSaved();
    loadToday();
    const today = $('digestToday');
    if (today) today.addEventListener('click', ev => {
      const btn = ev.target.closest && ev.target.closest('.digest-save-today');
      if (!btn) return;
      const items = today._items || [];
      const it = items[Number(btn.getAttribute('data-digest-i'))];
      if (!it) return;
      const r = saveItem(it);
      setHint(r.ok ? '已存到本机。' : r.error);
      renderToday({ items: items, updated: (today.querySelector && today.querySelector('.mut') && /更新于/.test(today.querySelector('.mut').textContent || '')) ? today.querySelector('.mut').textContent.replace(/^更新于\s*/, '') : '' });
      renderSaved();
    });
    if ($('digestAddBtn')) $('digestAddBtn').onclick = () => {
      const r = saveItem({
        title: ($('digestTitle') && $('digestTitle').value) || '',
        url: ($('digestUrl') && $('digestUrl').value) || '',
        summary: ($('digestNote') && $('digestNote').value) || '',
      });
      setHint(r.ok ? '已存到本机。' : r.error);
      if (r.ok) {
        if ($('digestTitle')) $('digestTitle').value = '';
        if ($('digestUrl')) $('digestUrl').value = '';
        if ($('digestNote')) $('digestNote').value = '';
        loadToday();
        renderSaved();
      }
    };
    if ($('digestSaved')) $('digestSaved').addEventListener('click', ev => {
      const btn = ev.target.closest && ev.target.closest('.digest-remove');
      if (!btn) return;
      removeItem(btn.getAttribute('data-id'));
      renderSaved();
      loadToday();
    });
    if ($('digestSyncBtn')) $('digestSyncBtn').onclick = async () => {
      const s = await syncPending({ force: true });
      setHint(s.ok ? ('同步完成：本次 ' + s.synced + ' 条。') : ('这次没同步：' + (s.reason || '')));
      renderSaved();
    };
  }

  async function onHubReachable() {
    const r = await syncPending();
    if (r.synced) {
      setHint('已自动同步 ' + r.synced + ' 条到电脑。');
      renderSaved();
    }
    return r;
  }

  const api = {
    KEY, KIND, MAX, DIGEST_URL, normalizeItem, validateUrl, toMarkdown, saveItem,
    alreadySaved, listSaved, removeItem, parseSaveResult, setCallTool, syncPending,
    renderToday, renderSaved, loadToday, bind, onHubReachable,
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else {
    root.PhoneLinkDigest = api;
    if (root.document) {
      if (root.document.readyState === 'loading') root.document.addEventListener('DOMContentLoaded', function () { /* app.js bind() */ });
    }
  }
})(typeof self !== 'undefined' ? self : this);
