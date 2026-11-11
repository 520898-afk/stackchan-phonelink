/* 医美术后注意事项：独立手动查询 + 供小智 MCP 工具复用。不依赖 WebSocket。 */
(function (root) {
  'use strict';

  const KEY_CFG = 'stackchan.phonelink.notesApi';
  const KEY_HIST = 'stackchan.phonelink.notesHistory';
  const MAX_HIST = 20;
  const MAX_PROC = 40;
  const ALLOWED_HOST_RE = /^https:\/\/[a-z0-9-]+\.ap-guangzhou\.tencentscf\.com\/?$/i;

  function $(id) { return document.getElementById(id); }

  function defaultCfg() { return { url: '', code: '' }; }
  function getCfg() {
    try { return Object.assign(defaultCfg(), JSON.parse(localStorage.getItem(KEY_CFG) || '{}')); }
    catch (e) { return defaultCfg(); }
  }
  function setCfg(cfg) {
    localStorage.setItem(KEY_CFG, JSON.stringify({
      url: String(cfg.url || '').trim(),
      code: String(cfg.code || '').trim(),
    }));
  }

  function getHist() {
    try { return JSON.parse(localStorage.getItem(KEY_HIST) || '[]'); }
    catch (e) { return []; }
  }
  function pushHist(item) {
    const list = getHist();
    list.unshift(item);
    localStorage.setItem(KEY_HIST, JSON.stringify(list.slice(0, MAX_HIST)));
  }
  function clearHist() { localStorage.removeItem(KEY_HIST); }

  function validateProcedure(raw) {
    const text = String(raw || '').replace(/\s+/g, ' ').trim();
    if (!text) return { ok: false, error: '请输入手术或项目名称，例如「泪沟填充」。' };
    if ([...text].length > MAX_PROC) return { ok: false, error: '名称过长，请控制在 40 个字以内。' };
    if (/:\/\//.test(text) || /www\./i.test(text)) return { ok: false, error: '名称不能包含网址。' };
    return { ok: true, procedure: text };
  }

  function validateCfg(cfg) {
    const url = String(cfg.url || '').trim();
    const code = String(cfg.code || '').trim();
    if (!url || !code) return '尚未配置云函数地址或访问码，请先在「医美助手设置」里填写。不用连接小智也能查。';
    if (!ALLOWED_HOST_RE.test(url)) return '云函数地址格式不对：应为 https://…….ap-guangzhou.tencentscf.com';
    return null;
  }

  async function query(procedure) {
    const cfg = getCfg();
    const cfgErr = validateCfg(cfg);
    if (cfgErr) return { ok: false, offline_config: true, error: cfgErr, procedure: procedure };
    const resp = await fetch(cfg.url.replace(/\/$/, ''), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Access-Code': cfg.code },
      body: JSON.stringify({ procedure: procedure }),
    });
    let data;
    try { data = await resp.json(); }
    catch (e) { return { ok: false, error: '云函数返回了无法解析的内容（HTTP ' + resp.status + '）。', procedure: procedure }; }
    if (typeof data !== 'object' || data === null) {
      return { ok: false, error: '云函数返回格式不对。', procedure: procedure };
    }
    data.procedure = data.procedure || procedure;
    if (!resp.ok && !data.card_text && !data.summary_for_robot) {
      return { ok: false, error: data.error || ('查询失败（HTTP ' + resp.status + '）。'), procedure: procedure };
    }
    return data;
  }

  // ---------- 本地知识库（经家里电脑汇聚服务，只读） ----------
  const LOCAL_UNAVAILABLE = '本地知识库这次查不到，只有网络结果';
  const MAX_LOCAL_ITEMS = 8;
  let localSearch = null; // (keyword) => Promise<hub /hub/tools/call 返回>
  function setLocalSearch(fn) { localSearch = typeof fn === 'function' ? fn : null; }

  // 解析汇聚服务转回的 search_knowledge 结果：{success, results:[{id, filename, excerpt}]}
  function parseKbToolResult(res) {
    if (!res || res.ok === false) return { ok: false, reason: (res && res.reason) || '汇聚服务没有响应。' };
    if (res.isError) {
      const t = res.content && res.content[0] && res.content[0].text;
      return { ok: false, reason: t || '电脑端检索出错。' };
    }
    let payload = res.structuredContent;
    if (payload && payload.result && typeof payload.result === 'object' && !payload.results) payload = payload.result;
    if (!payload && Array.isArray(res.content)) {
      const t = res.content.map(c => (c && c.type === 'text' && c.text) || '').join('');
      try { payload = JSON.parse(t); } catch (e) { return { ok: false, reason: '电脑端返回格式不对。' }; }
    }
    if (!payload || typeof payload !== 'object') return { ok: false, reason: '电脑端返回格式不对。' };
    if (payload.success === false) return { ok: false, reason: payload.error || '电脑端检索失败。' };
    const items = (payload.results || []).filter(x => x && (x.filename || x.excerpt)).map(x => ({
      id: x.id, filename: String(x.filename || ''), excerpt: String(x.excerpt || ''),
    }));
    return { ok: true, items: items };
  }

  async function searchLocal(data) {
    const kws = ((data && data.kb_keywords) || []).filter(Boolean).slice(0, 2);
    if (!kws.length && data && data.procedure) kws.push(data.procedure);
    if (!localSearch) return { available: false, reason: '没有配置家里电脑汇聚服务。', items: [], keywords: kws };
    const items = [];
    const seen = new Set();
    for (const kw of kws) {
      let r;
      try { r = parseKbToolResult(await localSearch(kw)); }
      catch (e) { r = { ok: false, reason: '连接家里电脑失败。' }; }
      if (!r.ok) {
        if (!items.length) return { available: false, reason: r.reason, items: [], keywords: kws };
        break;
      }
      for (const it of r.items) {
        const key = it.id != null ? 'id:' + it.id : 'f:' + it.filename;
        if (seen.has(key)) continue;
        seen.add(key);
        items.push(it);
        if (items.length >= MAX_LOCAL_ITEMS) break;
      }
      if (items.length >= MAX_LOCAL_ITEMS) break;
    }
    return { available: true, items: items, keywords: kws };
  }

  function localCite(it) {
    return '本地知识库' + (it.filename ? ' · ' + it.filename : '') + (it.id != null ? ' · #' + it.id : '');
  }

  function localPlain(local) {
    if (!local) return '';
    const lines = ['', '■ 本地知识库'];
    if (!local.available) {
      lines.push(LOCAL_UNAVAILABLE + '（' + String(local.reason || '原因未知').replace(/[。.\s]+$/, '') + '）。');
    } else if (!local.items.length) {
      lines.push('本地知识库没有找到「' + (local.keywords || []).join('、') + '」相关资料。');
    } else {
      local.items.forEach((it, i) => {
        lines.push((i + 1) + '. ' + (it.excerpt || '（无摘录）'));
        lines.push('   来源：' + localCite(it));
      });
    }
    return lines.join('\n') + '\n';
  }

  function renderLocal(local) {
    if (!local) return '';
    let html = '<h3 class="notes-h">本地知识库</h3>';
    if (!local.available) {
      return html + '<p class="mut">' + escapeHtml(LOCAL_UNAVAILABLE + '（' + String(local.reason || '原因未知').replace(/[。.\s]+$/, '') + '）。') + '</p>';
    }
    if (!local.items.length) {
      return html + '<p class="mut">' + escapeHtml('本地知识库没有找到「' + (local.keywords || []).join('、') + '」相关资料。') + '</p>';
    }
    html += '<ul class="notes-list">';
    local.items.forEach(it => {
      html += '<li>' + escapeHtml(it.excerpt || '（无摘录）') + '<div class="mut">来源：' + escapeHtml(localCite(it)) + '</div></li>';
    });
    return html + '</ul>';
  }

  function webTierLabel(it) {
    const src = it.source || {};
    const parts = [];
    if (src.tier) parts.push(src.tier);
    if (it.lang === 'en') parts.push('英文来源');
    return parts.length ? ' · ' + parts.join(' · ') : '';
  }

  function escapeHtml(s) {
    return String(s || '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  function cardPlain(data) {
    const web = (data && data.card_text) || (data && (data.error || data.message)) || '没有可复制的内容。';
    return data && data.local ? web.replace(/\s+$/, '') + '\n' + localPlain(data.local) : web;
  }

  function renderSections(data) {
    const titles = (data && data.section_titles) || { 护理: '护理', 饮食: '饮食', 活动: '活动', 用药: '用药', 复诊: '复诊', 就医信号: '异常就医信号' };
    const sections = (data && data.sections) || {};
    const order = ['护理', '饮食', '活动', '用药', '复诊', '就医信号'];
    let html = '';
    if (data.disclaimer) html += '<p class="warn">' + escapeHtml(data.disclaimer) + '</p>';
    if (!data.ok && (data.message || data.error)) {
      html += '<p>' + escapeHtml(data.message || data.error) + '</p>';
    }
    order.forEach(key => {
      const items = sections[key] || [];
      if (!items.length) return;
      html += '<h3 class="notes-h">' + escapeHtml(titles[key] || key) + '</h3><ul class="notes-list">';
      items.forEach(it => {
        const src = (it.source && (it.source.site || it.source.name)) || '专业来源';
        const url = it.source && it.source.url;
        const cite = url
          ? '<a href="' + escapeHtml(url) + '" target="_blank" rel="noreferrer">' + escapeHtml(src) + '</a>'
          : escapeHtml(src);
        html += '<li>' + escapeHtml(it.text) + '<div class="mut">来源：' + cite + escapeHtml(webTierLabel(it)) + '</div></li>';
      });
      html += '</ul>';
    });
    const sources = data.sources || [];
    const tiers = [];
    sources.forEach(s => { const t = s.tier || ''; if (tiers.indexOf(t) < 0) tiers.push(t); });
    tiers.forEach(t => {
      const group = sources.filter(s => (s.tier || '') === t);
      html += '<h3 class="notes-h">' + escapeHtml(t ? '来源（' + t + '）' : '来源') + '</h3><ol class="notes-src">';
      group.forEach(s => {
        const label = escapeHtml((s.name || '（无标题）') + (s.site ? ' — ' + s.site : ''));
        if (s.url) html += '<li><a href="' + escapeHtml(s.url) + '" target="_blank" rel="noreferrer">' + label + '</a></li>';
        else html += '<li>' + label + '</li>';
      });
      html += '</ol>';
    });
    if (!html) html = '<pre class="notes-pre">' + escapeHtml((data && (data.card_text || data.error || data.message)) || '没有可复制的内容。') + '</pre>';
    html += renderLocal(data.local);
    return html;
  }

  function histItemFrom(data) {
    return {
      at: Date.now(),
      procedure: data.procedure || '',
      ok: !!data.ok,
      card_text: data.card_text || '',
      summary_for_robot: data.summary_for_robot || '',
      sections: data.sections || {},
      section_titles: data.section_titles || {},
      sources: data.sources || [],
      disclaimer: data.disclaimer || '',
      message: data.message || data.error || '',
      local: data.local || null,
    };
  }

  function showResult(data, opts) {
    opts = opts || {};
    const box = $('notesResult');
    const title = $('notesResultTitle');
    const body = $('notesResultBody');
    const hint = $('notesHint');
    if (!box || !body) return;
    const proc = data.procedure || '';
    title.textContent = (proc ? '「' + proc + '」术后注意事项' : '术后注意事项') + (opts.fromHistory ? '（历史）' : '');
    body.innerHTML = renderSections(data);
    box.style.display = 'block';
    box.classList.add('lit');
    box.dataset.cardText = cardPlain(data);
    box.dataset.procedure = proc;
    if (hint) {
      hint.textContent = opts.fromRobot
        ? '小智刚查了这项手术的术后注意事项，全文在这里，可复制或分享。'
        : (data.ok ? '已整理，可复制或分享到微信。' : (data.error || data.message || '资料不足或查询未成功。'));
    }
    if (opts.scroll !== false) box.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }

  function renderHist() {
    const el = $('notesHistList');
    if (!el) return;
    const list = getHist();
    if (!list.length) { el.innerHTML = '<p class="mut">还没有查询记录。</p>'; return; }
    el.innerHTML = list.map((it, i) => {
      const t = new Date(it.at).toLocaleString('zh-CN', { hour12: false });
      const flag = it.ok ? '' : ' · 资料不足';
      return '<button type="button" class="hist-item" data-idx="' + i + '">' +
        escapeHtml(it.procedure || '（未命名）') + '<span class="mut">  ' + escapeHtml(t + flag) + '</span></button>';
    }).join('');
  }

  async function copyText(text) {
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(text);
        return true;
      }
    } catch (e) {}
    try {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.setAttribute('readonly', '');
      ta.style.position = 'fixed';
      ta.style.left = '-9999px';
      document.body.appendChild(ta);
      ta.select();
      const ok = document.execCommand('copy');
      document.body.removeChild(ta);
      return ok;
    } catch (e) { return false; }
  }

  async function shareText(procedure, text) {
    const title = (procedure ? procedure + ' · ' : '') + '术后注意事项';
    if (navigator.share) {
      try { await navigator.share({ title: title, text: text }); return 'shared'; }
      catch (e) { if (e && e.name === 'AbortError') return 'abort'; }
    }
    return (await copyText(text)) ? 'copied' : 'fail';
  }

  function setBusy(busy, label) {
    const btn = $('notesSearchBtn');
    const hint = $('notesHint');
    if (btn) { btn.disabled = !!busy; btn.textContent = busy ? '查询中…' : '查询术后注意事项'; }
    if (hint && label) hint.textContent = label;
  }

  async function runQuery(procedure, opts) {
    opts = opts || {};
    setBusy(true, '正在专业网站检索「' + procedure + '」的术后注意事项…');
    let data;
    try { data = await query(procedure); }
    catch (e) { data = { ok: false, error: '网络异常，请稍后重试。', procedure: procedure }; }
    setBusy(false);
    showResult(data, opts);
    // 先网络、后本地知识库：网络结果先显示，再追加「本地知识库」一节。
    if ($('notesHint')) $('notesHint').textContent = '网络结果已显示，正在查本地知识库…';
    try { data.local = await searchLocal(data); }
    catch (e) { data.local = { available: false, reason: '连接家里电脑失败。', items: [] }; }
    showResult(data, Object.assign({}, opts, { scroll: false }));
    if (!data.offline_config) {
      pushHist(histItemFrom(data));
      renderHist();
    }
    return data;
  }

  function bind() {
    const cfg = getCfg();
    if ($('notesUrl')) $('notesUrl').value = cfg.url || '';
    if ($('notesCode')) $('notesCode').value = cfg.code || '';
    if ($('notesCfgShow')) {
      $('notesCfgShow').textContent = cfg.url
        ? '云函数：已填写（' + cfg.url.replace(/^https:\/\//, '').slice(0, 28) + '…）'
        : '云函数：未配置（先填设置再查询）';
    }
    renderHist();

    if ($('notesSaveBtn')) $('notesSaveBtn').onclick = () => {
      const url = ($('notesUrl').value || '').trim();
      const code = ($('notesCode').value || '').trim();
      if (url && !ALLOWED_HOST_RE.test(url)) {
        alert('云函数地址格式不对：应为 https://…….ap-guangzhou.tencentscf.com');
        return;
      }
      setCfg({ url: url, code: code });
      if ($('notesCfgShow')) $('notesCfgShow').textContent = url
        ? '云函数：已保存'
        : '云函数：未配置（先填设置再查询）';
      if ($('notesHint')) $('notesHint').textContent = url && code ? '配置已保存，可以开始查询。' : '已清除配置。';
    };

    if ($('notesSearchBtn')) $('notesSearchBtn').onclick = () => submit();
    if ($('notesInput')) $('notesInput').addEventListener('keydown', ev => {
      if (ev.key === 'Enter') { ev.preventDefault(); submit(); }
    });

    function submit() {
      const v = validateProcedure($('notesInput') ? $('notesInput').value : '');
      if (!v.ok) { if ($('notesHint')) $('notesHint').textContent = v.error; return; }
      runQuery(v.procedure, { fromRobot: false });
    }

    if ($('notesCopyBtn')) $('notesCopyBtn').onclick = async () => {
      const text = ($('notesResult') && $('notesResult').dataset.cardText) || '';
      const ok = await copyText(text);
      if ($('notesHint')) $('notesHint').textContent = ok ? '已复制到剪贴板。' : '复制失败，请长按全文手动复制。';
    };
    if ($('notesShareBtn')) $('notesShareBtn').onclick = async () => {
      const box = $('notesResult');
      const r = await shareText(box && box.dataset.procedure, (box && box.dataset.cardText) || '');
      if ($('notesHint')) {
        $('notesHint').textContent = r === 'shared' ? '已打开系统分享。' : r === 'copied' ? '当前环境不支持分享，已改为复制。' : r === 'abort' ? '已取消分享。' : '分享失败。';
      }
    };
    if ($('notesCloseBtn')) $('notesCloseBtn').onclick = () => {
      const box = $('notesResult');
      if (box) { box.style.display = 'none'; box.classList.remove('lit'); }
    };
    if ($('notesClearHistBtn')) $('notesClearHistBtn').onclick = () => {
      if (!confirm('确定清空本机上的查询记录？')) return;
      clearHist();
      renderHist();
    };
    const histList = $('notesHistList');
    if (histList) histList.addEventListener('click', ev => {
      const btn = ev.target.closest('[data-idx]');
      if (!btn) return;
      const item = getHist()[Number(btn.getAttribute('data-idx'))];
      if (!item) return;
      showResult(item, { fromHistory: true });
    });
  }

  // MCP 工具入口：查完在手机上展示全文，只把短摘要交给小智口述。
  async function getProcedureNotes(procedure) {
    const v = validateProcedure(procedure);
    if (!v.ok) return { ok: false, text: v.error };
    const data = await runQuery(v.procedure, { fromRobot: true });
    let spoken = data.summary_for_robot || data.message || data.error || '查询结束，请查看手机上的卡片。';
    if (data.local && data.local.available && data.local.items.length) {
      spoken += ' 本地知识库另有' + data.local.items.length + '篇相关资料，已显示在手机上。';
    }
    return { ok: !!data.ok, text: spoken };
  }

  const api = {
    getCfg, setCfg, getHist, query, getProcedureNotes, bind, validateProcedure,
    setLocalSearch, searchLocal, parseKbToolResult, renderSections, cardPlain, LOCAL_UNAVAILABLE,
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.PhoneLinkNotes = api;
})(typeof self !== 'undefined' ? self : this);
