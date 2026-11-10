/* 专业手术视频搜索：复用「医美助手设置」里的云函数地址和访问码。不下载、不转存。 */
(function (root) {
  'use strict';

  const KEY_HIST = 'stackchan.phonelink.videosHistory';
  const MAX_HIST = 20;
  const Notes = function () { return root.PhoneLinkNotes; };

  function $(id) { return document.getElementById(id); }

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

  function escapeHtml(s) {
    return String(s || '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  async function query(procedure) {
    const N = Notes();
    if (!N) return { ok: false, error: '页面尚未加载医美助手。', procedure: procedure };
    const v = N.validateProcedure(procedure);
    if (!v.ok) return { ok: false, offline_config: true, error: v.error, procedure: procedure };
    const cfg = N.getCfg();
    const cfgErr = (function () {
      const url = String(cfg.url || '').trim();
      const code = String(cfg.code || '').trim();
      if (!url || !code) return '尚未配置云函数地址或访问码，请先在「医美助手设置」里填写。不用连接小智也能查。';
      if (!/^https:\/\/[a-z0-9-]+\.ap-guangzhou\.tencentscf\.com\/?$/i.test(url)) {
        return '云函数地址格式不对：应为 https://…….ap-guangzhou.tencentscf.com';
      }
      return null;
    })();
    if (cfgErr) return { ok: false, offline_config: true, error: cfgErr, procedure: v.procedure };
    const resp = await fetch(cfg.url.replace(/\/$/, ''), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Access-Code': cfg.code },
      body: JSON.stringify({ procedure: v.procedure, action: 'videos' }),
    });
    let data;
    try { data = await resp.json(); }
    catch (e) { return { ok: false, error: '云函数返回了无法解析的内容（HTTP ' + resp.status + '）。', procedure: v.procedure }; }
    if (typeof data !== 'object' || data === null) {
      return { ok: false, error: '云函数返回格式不对。', procedure: v.procedure };
    }
    data.procedure = data.procedure || v.procedure;
    if (!resp.ok && !(data.videos && data.videos.length) && !data.card_text) {
      return { ok: false, error: data.error || ('查询失败（HTTP ' + resp.status + '）。'), procedure: v.procedure };
    }
    return data;
  }

  function cardPlain(data) {
    if (data && data.card_text) return data.card_text;
    return (data && (data.error || data.message)) || '没有可复制的内容。';
  }

  function renderVideos(data) {
    let html = '';
    if (data.disclaimer) html += '<p class="warn">' + escapeHtml(data.disclaimer) + '</p>';
    if (!data.ok && (data.message || data.error)) {
      html += '<p>' + escapeHtml(data.message || data.error) + '</p>';
    }
    const items = data.videos || [];
    if (items.length) {
      html += '<ul class="vid-list">';
      items.forEach(it => {
        const title = escapeHtml(it.title || '（无标题）');
        const url = it.url || '';
        const site = escapeHtml(it.site || '');
        const dur = escapeHtml(it.duration || '');
        const badges = [];
        if (dur) badges.push(dur);
        if (it.vpn_needed) badges.push('需翻墙');
        if (it.verification === 'keyword_match') badges.push('平台视频，官方账号未核验');
        const cite = url
          ? '<a href="' + escapeHtml(url) + '" target="_blank" rel="noreferrer">' + title + '</a>'
          : title;
        html += '<li><div class="vid-title">' + cite + '</div>';
        html += '<div class="mut">' + site + (badges.length ? ' · ' + badges.map(escapeHtml).join(' · ') : '') + '</div>';
        if (it.summary) html += '<div class="mut">' + escapeHtml(it.summary) + '</div>';
        html += '</li>';
      });
      html += '</ul>';
    }
    if (!html) html = '<pre class="notes-pre">' + escapeHtml(cardPlain(data)) + '</pre>';
    return html;
  }

  function histItemFrom(data) {
    return {
      at: Date.now(),
      procedure: data.procedure || '',
      ok: !!data.ok,
      card_text: data.card_text || '',
      videos: data.videos || [],
      disclaimer: data.disclaimer || '',
      message: data.message || data.error || '',
    };
  }

  function showResult(data, opts) {
    opts = opts || {};
    const box = $('vidResult');
    const title = $('vidResultTitle');
    const body = $('vidResultBody');
    const hint = $('vidHint');
    if (!box || !body) return;
    const proc = data.procedure || '';
    title.textContent = (proc ? '「' + proc + '」专业手术视频' : '专业手术视频') + (opts.fromHistory ? '（历史）' : '');
    body.innerHTML = renderVideos(data);
    box.style.display = 'block';
    box.classList.add('lit');
    box.dataset.cardText = cardPlain(data);
    box.dataset.procedure = proc;
    if (hint) {
      hint.textContent = data.ok
        ? ('找到 ' + ((data.videos || []).length) + ' 条链接，可复制或到原网站观看。')
        : (data.error || data.message || '资料不足或查询未成功。');
    }
    if (opts.scroll !== false) box.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }

  function renderHist() {
    const el = $('vidHistList');
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

  function setBusy(busy, label) {
    const btn = $('vidSearchBtn');
    const hint = $('vidHint');
    if (btn) { btn.disabled = !!busy; btn.textContent = busy ? '查询中…' : '查询专业手术视频'; }
    if (hint && label) hint.textContent = label;
  }

  async function runQuery(procedure) {
    setBusy(true, '正在专业网站检索「' + procedure + '」的手术教学视频…');
    let data;
    try { data = await query(procedure); }
    catch (e) { data = { ok: false, error: '网络异常，请稍后重试。', procedure: procedure }; }
    setBusy(false);
    showResult(data, {});
    if (!data.offline_config) {
      pushHist(histItemFrom(data));
      renderHist();
    }
    return data;
  }

  function bind() {
    renderHist();
    if ($('vidSearchBtn')) $('vidSearchBtn').onclick = () => submit();
    if ($('vidInput')) $('vidInput').addEventListener('keydown', ev => {
      if (ev.key === 'Enter') { ev.preventDefault(); submit(); }
    });
    function submit() {
      const N = Notes();
      const raw = $('vidInput') ? $('vidInput').value : '';
      const v = N && N.validateProcedure ? N.validateProcedure(raw) : { ok: !!String(raw || '').trim(), procedure: String(raw || '').trim(), error: '请输入手术名称。' };
      if (!v.ok) { if ($('vidHint')) $('vidHint').textContent = v.error; return; }
      runQuery(v.procedure);
    }
    if ($('vidCopyBtn')) $('vidCopyBtn').onclick = async () => {
      const text = ($('vidResult') && $('vidResult').dataset.cardText) || '';
      const N = Notes();
      let ok = false;
      if (N && N.query) {
        // reuse notes copy via a tiny local fallback (notes copyText is not exported)
      }
      try {
        if (navigator.clipboard && navigator.clipboard.writeText) {
          await navigator.clipboard.writeText(text);
          ok = true;
        }
      } catch (e) {}
      if (!ok) {
        try {
          const ta = document.createElement('textarea');
          ta.value = text;
          ta.setAttribute('readonly', '');
          ta.style.position = 'fixed';
          ta.style.left = '-9999px';
          document.body.appendChild(ta);
          ta.select();
          ok = document.execCommand('copy');
          document.body.removeChild(ta);
        } catch (e) { ok = false; }
      }
      if ($('vidHint')) $('vidHint').textContent = ok ? '已复制到剪贴板。' : '复制失败，请长按全文手动复制。';
    };
    if ($('vidCloseBtn')) $('vidCloseBtn').onclick = () => {
      const box = $('vidResult');
      if (box) { box.style.display = 'none'; box.classList.remove('lit'); }
    };
    if ($('vidClearHistBtn')) $('vidClearHistBtn').onclick = () => {
      if (!confirm('确定清空本机上的视频查询记录？')) return;
      clearHist();
      renderHist();
    };
    const histList = $('vidHistList');
    if (histList) histList.addEventListener('click', ev => {
      const btn = ev.target.closest('[data-idx]');
      if (!btn) return;
      const item = getHist()[Number(btn.getAttribute('data-idx'))];
      if (!item) return;
      showResult(item, { fromHistory: true });
    });
  }

  const api = { query, runQuery, bind, getHist, renderVideos, histItemFrom };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else {
    root.PhoneLinkVideos = api;
    if (root.document) {
      if (root.document.readyState === 'loading') {
        root.document.addEventListener('DOMContentLoaded', bind);
      } else {
        bind();
      }
    }
  }
})(typeof self !== 'undefined' ? self : this);
