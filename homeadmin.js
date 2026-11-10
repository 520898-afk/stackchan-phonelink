/* 家里电脑后台入口：只在同一 Wi-Fi 且电脑开着时可用。不含「控制小智」。 */
(function (root) {
  'use strict';

  const KEY = 'stackchan.phonelink.homeAdmin';
  const DEFAULTS = {
    base: 'http://192.168.3.8:8000',
    fallback: 'http://macdemacbook-air.local:8000',
  };
  // Intentionally omitted: /admin/control (motion commands are disabled).
  const LINKS = [
    { name: '工作台', path: '/' },
    { name: '知识库', path: '/knowledge' },
    { name: '医学检索', path: '/admin/search' },
    { name: '题库', path: '/admin/study' },
    { name: '后台总览', path: '/admin' },
    { name: '本地视频', path: '/admin/videos', later: true },
  ];

  function $(id) { return document.getElementById(id); }

  function defaultCfg() { return { base: DEFAULTS.base, fallback: DEFAULTS.fallback }; }

  function getCfg() {
    try { return Object.assign(defaultCfg(), JSON.parse(localStorage.getItem(KEY) || '{}')); }
    catch (e) { return defaultCfg(); }
  }

  function setCfg(cfg) {
    localStorage.setItem(KEY, JSON.stringify({
      base: String(cfg.base || '').trim(),
      fallback: String(cfg.fallback || '').trim(),
    }));
  }

  function joinBase(base, path) {
    const b = String(base || '').trim().replace(/\/$/, '');
    if (!b) return '';
    const p = path === '/' || path === '' ? '/' : (String(path).startsWith('/') ? path : '/' + path);
    return b + p;
  }

  function _ipv4(host) {
    const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host);
    if (!m) return null;
    const parts = m.slice(1).map(Number);
    if (parts.some(n => n > 255)) return null;
    return parts;
  }

  function isPrivateOrLocalHost(host) {
    host = String(host || '').toLowerCase().replace(/\.$/, '');
    if (host === 'localhost' || host === '127.0.0.1') return true;
    if (host.endsWith('.local')) return true;
    const ip = _ipv4(host);
    if (!ip) return false;
    const [a, b] = ip;
    if (a === 10) return true;
    if (a === 192 && b === 168) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 127) return true;
    if (a === 169 && b === 254) return true;
    // Tailscale / CGNAT, reserved for a later remote-access option.
    if (a === 100 && b >= 64 && b <= 127) return true;
    return false;
  }

  function validateBase(url) {
    const raw = String(url || '').trim();
    if (!raw) return '请填写家里电脑的地址。';
    let u;
    try { u = new URL(raw); }
    catch (e) { return '地址格式不对，例如 http://192.168.3.8:8000'; }
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return '只支持 http 或 https。';
    if (u.username || u.password) return '地址里不要带账号密码。';
    if (u.hash || (u.search && u.search.length > 0)) {
      // allow empty query; reject unexpected noise
    }
    if (!isPrivateOrLocalHost(u.hostname)) {
      return '请填写家里电脑的局域网地址（例如 192.168.3.8）或 .local 名称。';
    }
    return null;
  }

  function escapeHtml(s) {
    return String(s || '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  function renderLinks() {
    const el = $('homeAdminLinks');
    if (!el) return;
    const cfg = getCfg();
    el.innerHTML = LINKS.map(link => {
      const primary = joinBase(cfg.base, link.path);
      const fallback = cfg.fallback ? joinBase(cfg.fallback, link.path) : '';
      const later = link.later ? '<div class="mut">硬盘接上并开通后台页后可用</div>' : '';
      const fb = fallback
        ? '<div class="mut">连不上时试试 <a href="' + escapeHtml(fallback) + '">' + escapeHtml(fallback) + '</a></div>'
        : '';
      return '<div class="home-link">' +
        '<a class="btn primary" href="' + escapeHtml(primary) + '">' + escapeHtml(link.name) + '</a>' +
        later + fb +
        '</div>';
    }).join('');
  }

  function bind() {
    const cfg = getCfg();
    if ($('homeAdminBase')) $('homeAdminBase').value = cfg.base || '';
    if ($('homeAdminFallback')) $('homeAdminFallback').value = cfg.fallback || '';
    renderLinks();
    if ($('homeAdminSaveBtn')) $('homeAdminSaveBtn').onclick = () => {
      const base = ($('homeAdminBase').value || '').trim();
      const fallback = ($('homeAdminFallback').value || '').trim();
      const err = validateBase(base) || (fallback ? validateBase(fallback) : null);
      const hint = $('homeAdminHint');
      if (err) { if (hint) hint.textContent = err; return; }
      setCfg({ base: base, fallback: fallback });
      renderLinks();
      if (hint) hint.textContent = '地址已保存。只在连家里同一 Wi-Fi、电脑开着时打得开。';
    };
  }

  const api = { getCfg, setCfg, joinBase, validateBase, isPrivateOrLocalHost, LINKS, DEFAULTS, bind, renderLinks };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else {
    root.PhoneLinkHomeAdmin = api;
    if (root.document) {
      if (root.document.readyState === 'loading') {
        root.document.addEventListener('DOMContentLoaded', bind);
      } else {
        bind();
      }
    }
  }
})(typeof self !== 'undefined' ? self : this);
