/* 家里电脑后台入口：只在同一 Wi-Fi 且电脑开着时可用。不含「控制小智」。 */
(function (root) {
  'use strict';

  const KEY = 'stackchan.phonelink.homeAdmin';
  const ADMIN_HOST = 'macdemacbook-air.local';
  const ADMIN_ORIGIN = 'http://macdemacbook-air.local:8000';
  const HUB_ORIGIN = 'https://macdemacbook-air.local:8443';
  const DEFAULTS = {
    base: ADMIN_ORIGIN,
    fallback: '',
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

  function hostnameOf(url) {
    try { return new URL(String(url || '').trim()).hostname.toLowerCase().replace(/\.$/, ''); }
    catch (e) { return ''; }
  }

  // If the primary address is a LAN IP and the other slot is a .local name, prefer .local
  // so DHCP IP changes do not break the buttons. Other fields (e.g. token) are kept.
  function preferLocalHost(cfg, primaryKey) {
    const key = primaryKey || 'base';
    const out = Object.assign({}, cfg);
    const primary = out[key];
    const fallback = out.fallback;
    const primaryHost = hostnameOf(primary);
    const fallbackHost = hostnameOf(fallback);
    if (_ipv4(primaryHost) && fallbackHost.endsWith('.local')) {
      out[key] = fallback;
      out.fallback = primary;
    }
    return out;
  }

  function storage() {
    try {
      if (typeof localStorage !== 'undefined') return localStorage;
    } catch (e) {}
    return null;
  }

  function getCfg() {
    let cfg;
    try { cfg = Object.assign(defaultCfg(), JSON.parse((storage() && storage().getItem(KEY)) || '{}')); }
    catch (e) { cfg = defaultCfg(); }
    const preferred = preferLocalHost(cfg, 'base');
    const next = {
      base: normalizeAdminBase(preferred.base),
      fallback: normalizeAdminFallback(preferred.fallback, preferred.base),
    };
    if (next.base !== cfg.base || next.fallback !== cfg.fallback) {
      setCfg(next);
    }
    return next;
  }

  function setCfg(cfg) {
    const base = normalizeAdminBase((cfg && cfg.base) || '');
    const next = {
      base: base,
      fallback: normalizeAdminFallback((cfg && cfg.fallback) || '', base),
    };
    const store = storage();
    if (store) store.setItem(KEY, JSON.stringify(next));
    return next;
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

  function _portOf(u) {
    if (u.port) return u.port;
    return u.protocol === 'https:' ? '443' : '80';
  }

  // 后台按钮只用 http://…:8000。手机不能用 127.0.0.1；也不能把汇聚 https:8443 拼到 /knowledge、/admin。
  function normalizeAdminBase(url) {
    const raw = String(url || '').trim();
    if (!raw) return ADMIN_ORIGIN;
    let u;
    try { u = new URL(raw); }
    catch (e) { return ADMIN_ORIGIN; }
    const port = _portOf(u);
    if (u.protocol === 'https:' || port === '8443') return ADMIN_ORIGIN;
    let host = String(u.hostname || '').toLowerCase().replace(/\.$/, '');
    if (!host || host === 'localhost' || host === '127.0.0.1' || _ipv4(host)) host = ADMIN_HOST;
    if (port !== '8000' && port !== '80') {
      // Unexpected non-admin port: still keep http + stable host + 8000.
      return 'http://' + host + ':8000';
    }
    if (!host.endsWith('.local')) host = ADMIN_HOST;
    return 'http://' + host + ':8000';
  }

  function normalizeAdminFallback(url, primary) {
    if (!String(url || '').trim()) return '';
    const n = normalizeAdminBase(url);
    return n === normalizeAdminBase(primary) ? '' : n;
  }

  // 汇聚只用 https://macdemacbook-air.local:8443。证书不支持变化的局域网 IP，手机不能用 127.0.0.1。
  function normalizeHubUrl(url) {
    const raw = String(url || '').trim();
    if (!raw) return HUB_ORIGIN;
    let u;
    try { u = new URL(raw); }
    catch (e) { return HUB_ORIGIN; }
    if (u.protocol !== 'https:') return HUB_ORIGIN;
    const port = _portOf(u);
    if (port !== '8443' && port !== '443') return HUB_ORIGIN;
    let host = String(u.hostname || '').toLowerCase().replace(/\.$/, '');
    if (!host || host === 'localhost' || host === '127.0.0.1' || _ipv4(host)) return HUB_ORIGIN;
    if (!host.endsWith('.local')) return HUB_ORIGIN;
    return 'https://' + host + ':8443';
  }

  function normalizeHubFallback(url, primary) {
    if (!String(url || '').trim()) return '';
    const n = normalizeHubUrl(url);
    return n === normalizeHubUrl(primary || HUB_ORIGIN) ? '' : n;
  }

  function validateBase(url) {
    const raw = String(url || '').trim();
    if (!raw) return '请填写家里电脑的地址。';
    let u;
    try { u = new URL(raw); }
    catch (e) { return '地址格式不对，例如 http://macdemacbook-air.local:8000'; }
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return '只支持 http 或 https。';
    if (u.username || u.password) return '地址里不要带账号密码。';
    if (u.hash || (u.search && u.search.length > 0)) {
      // allow empty query; reject unexpected noise
    }
    if (!isPrivateOrLocalHost(u.hostname)) {
      return '请填写家里电脑的 .local 名称或局域网地址。保存后会改成 http://macdemacbook-air.local:8000。';
    }
    return null;
  }

  const HUB_DEFAULTS = {
    url: HUB_ORIGIN,
    fallback: '',
  };

  function validateHubUrl(url) {
    const raw = String(url || '').trim();
    if (!raw) return '请填写家里电脑的汇聚地址。';
    let u;
    try { u = new URL(raw); }
    catch (e) { return '地址格式不对，例如 https://macdemacbook-air.local:8443'; }
    if (u.protocol === 'http:') return '汇聚地址必须是 https（不能用 http，手机页面会拦截）。';
    if (u.protocol !== 'https:') return '汇聚地址必须是 https。';
    if (u.username || u.password) return '地址里不要带账号密码。';
    if (!isPrivateOrLocalHost(u.hostname)) {
      return '请填写家里电脑的 .local 名称（例如 macdemacbook-air.local）。汇聚须使用 https，不要填公网地址。';
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
      const hint = $('homeAdminHint');
      if (base && validateBase(base) && !/^https?:\/\//i.test(base)) {
        if (hint) hint.textContent = validateBase(base);
        return;
      }
      if (fallback && validateBase(fallback) && !/^https?:\/\//i.test(fallback)) {
        if (hint) hint.textContent = validateBase(fallback);
        return;
      }
      const next = setCfg({ base: base, fallback: fallback });
      if ($('homeAdminBase')) $('homeAdminBase').value = next.base || '';
      if ($('homeAdminFallback')) $('homeAdminFallback').value = next.fallback || '';
      renderLinks();
      let msg = '地址已保存。后台按钮打开 http://macdemacbook-air.local:8000，不会走到汇聚 8443。';
      if (base && normalizeAdminBase(base) !== base) {
        msg = '已改成后台地址 ' + next.base + '（不会使用汇聚 8443 或 127.0.0.1）。';
      }
      if (hint) hint.textContent = msg;
    };
  }

  const api = { getCfg, setCfg, joinBase, validateBase, validateHubUrl, isPrivateOrLocalHost, preferLocalHost, normalizeAdminBase, normalizeAdminFallback, normalizeHubUrl, normalizeHubFallback, LINKS, DEFAULTS, HUB_DEFAULTS, ADMIN_ORIGIN, HUB_ORIGIN, bind, renderLinks };
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
