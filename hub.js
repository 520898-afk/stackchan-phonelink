/* 小智手机直连 · 家里电脑汇聚客户端（方案 A）：探测汇聚层、登记侧车、不在电脑在线时占用接入点。 */
(function (root) {
  'use strict';

  const KEY = 'stackchan.phonelink.hub';
  const HUB_READ_TOOLS = ['search_knowledge'];
  // 唯一的写入工具：手术记录/知情同意书 .md 存到电脑固定文件夹（2026-11-11）。
  const HUB_WRITE_TOOLS = ['save_medical_doc'];
  const Home = (typeof module !== 'undefined' && module.exports)
    ? require('./homeadmin.js')
    : (root.PhoneLinkHomeAdmin || {});

  function defaultCfg() {
    const d = Home.HUB_DEFAULTS || { url: 'https://192.168.3.8:8443', fallback: 'https://macdemacbook-air.local:8443' };
    return { url: d.url, fallback: d.fallback, token: '' };
  }

  function getCfg() {
    try { return Object.assign(defaultCfg(), JSON.parse((root.localStorage && root.localStorage.getItem(KEY)) || '{}')); }
    catch (e) { return defaultCfg(); }
  }

  function setCfg(cfg) {
    const next = {
      url: String((cfg && cfg.url) || '').trim(),
      fallback: String((cfg && cfg.fallback) || '').trim(),
      token: String((cfg && cfg.token) || '').trim(),
    };
    if (root.localStorage) root.localStorage.setItem(KEY, JSON.stringify(next));
    return next;
  }

  function clearCfg() {
    if (root.localStorage) root.localStorage.removeItem(KEY);
    return defaultCfg();
  }

  function isConfigured(cfg) {
    cfg = cfg || getCfg();
    const validate = Home.validateHubUrl || function () { return '缺少地址校验'; };
    if (!cfg.token) return false;
    if (validate(cfg.url)) return false;
    if (cfg.fallback && validate(cfg.fallback)) return false;
    return true;
  }

  function joinHub(url, path) {
    const b = String(url || '').trim().replace(/\/$/, '');
    const p = path.startsWith('/') ? path : '/' + path;
    return b + p;
  }

  function classifyProbeError(err) {
    const name = err && err.name ? String(err.name) : '';
    const msg = String((err && err.message) || err || '');
    const low = (name + ' ' + msg).toLowerCase();
    if (name === 'AbortError' || low.includes('abort') || low.includes('timeout')) {
      return '连家里电脑超时。请确认电脑已开机、与手机在同一 Wi-Fi。';
    }
    if (/(cert|ssl|tls|trust|certificate|secure connection|not trusted|证书)/i.test(low)) {
      return '证书未受信任或无效。请在本机安装并完全信任家里电脑证书。';
    }
    return '连不上家里电脑汇聚服务。若是第一次使用，请先安装并信任证书；也请确认手机和电脑在同一 Wi-Fi、电脑已开机。';
  }

  function classifyHttpStatus(status) {
    if (status === 401) return '汇聚令牌不正确，请在设置里重新填写。';
    if (status === 403 || status === 400) return '电脑拒绝了这次访问（地址或来源不符合要求）。';
    return '电脑汇聚服务响应异常（HTTP ' + status + '）。';
  }

  function probeHealth(url, token, opts) {
    opts = opts || {};
    const fetchFn = opts.fetch || (typeof fetch !== 'undefined' ? fetch : null);
    const timeoutMs = opts.timeoutMs == null ? 6000 : opts.timeoutMs;
    const validate = Home.validateHubUrl || function () { return null; };
    const err = validate(url);
    if (err) return Promise.resolve({ ok: false, reason: err, url: url });
    if (!token) return Promise.resolve({ ok: false, reason: '尚未填写汇聚令牌。', url: url });
    if (!fetchFn) return Promise.resolve({ ok: false, reason: '当前环境无法访问网络。', url: url });
    const ctrl = (typeof AbortController !== 'undefined') ? new AbortController() : null;
    const timer = setTimeout(function () { if (ctrl) ctrl.abort(); }, timeoutMs);
    return fetchFn(joinHub(url, '/hub/health'), {
      method: 'GET',
      headers: { Authorization: 'Bearer ' + token },
      signal: ctrl ? ctrl.signal : undefined,
    }).then(function (res) {
      if (!res.ok) return { ok: false, reason: classifyHttpStatus(res.status), url: url, status: res.status };
      return res.json().then(function (data) {
        if (data && data.ok) return { ok: true, reason: '', url: url, data: data };
        return { ok: false, reason: '汇聚服务回报异常。', url: url, data: data };
      });
    }).catch(function (e) {
      return { ok: false, reason: classifyProbeError(e), url: url };
    }).then(function (result) {
      clearTimeout(timer);
      return result;
    });
  }

  function shouldConnectAccessPoint(state) {
    if (!state || state.mode === 'unconfigured') return true;
    return !state.reachable;
  }

  function createHubClient(env) {
    env = env || {};
    const fetchFn = env.fetch || (typeof fetch !== 'undefined' ? fetch : null);
    const timeoutMs = env.timeoutMs == null ? 6000 : env.timeoutMs;
    const retries = env.retries == null ? 2 : env.retries;
    const getCfgFn = env.getCfg || getCfg;
    const state = { reachable: false, reason: '', mode: 'unconfigured', activeUrl: '', probing: false };
    let consecutiveFails = 0;
    let started = false;
    let sidecarAbort = null;

    function snapshot() {
      return { reachable: state.reachable, reason: state.reason, mode: state.mode, activeUrl: state.activeUrl, probing: state.probing };
    }

    function emit() {
      if (env.onState) env.onState(snapshot());
      return snapshot();
    }

    async function probeTarget(cfg, attempts) {
      const urls = [cfg.url, cfg.fallback].filter(Boolean);
      let last = { ok: false, reason: '未探测' };
      for (let u = 0; u < urls.length; u++) {
        for (let i = 0; i < attempts; i++) {
          last = await probeHealth(urls[u], cfg.token, { fetch: fetchFn, timeoutMs: timeoutMs });
          if (last.ok) return last;
        }
      }
      return last;
    }

    async function tick(opts) {
      opts = opts || {};
      const cfg = getCfgFn();
      if (!isConfigured(cfg)) {
        state.reachable = false;
        state.reason = cfg.token ? (Home.validateHubUrl(cfg.url) || '') : '';
        state.mode = 'unconfigured';
        state.activeUrl = '';
        consecutiveFails = 0;
        return emit();
      }
      state.probing = true;
      emit();
      const wasReachable = state.reachable;
      const attempts = opts.initial && !wasReachable ? (1 + retries) : (wasReachable ? 1 : 1);
      const result = await probeTarget(cfg, attempts);
      state.probing = false;
      if (result.ok) {
        consecutiveFails = 0;
        state.reachable = true;
        state.reason = '';
        state.mode = 'hub';
        state.activeUrl = result.url;
      } else if (wasReachable) {
        consecutiveFails += 1;
        if (consecutiveFails >= 2) {
          state.reachable = false;
          state.reason = result.reason;
          state.mode = 'phone-only';
        } else {
          state.reason = result.reason;
        }
      } else {
        consecutiveFails += 1;
        state.reachable = false;
        state.reason = result.reason;
        state.mode = 'phone-only';
      }
      return emit();
    }

    async function postJson(path, body, waitMs) {
      const cfg = getCfgFn();
      const url = state.activeUrl || cfg.url;
      if (!url || !cfg.token) return { ok: false, reason: '未配置汇聚服务。' };
      const ctrl = (typeof AbortController !== 'undefined') ? new AbortController() : null;
      const timer = setTimeout(function () { if (ctrl) ctrl.abort(); }, waitMs || 15000);
      try {
        const res = await fetchFn(joinHub(url, path), {
          method: 'POST',
          headers: { Authorization: 'Bearer ' + cfg.token, 'Content-Type': 'application/json' },
          body: JSON.stringify(body || {}),
          signal: ctrl ? ctrl.signal : undefined,
        });
        const data = await res.json().catch(function () { return null; });
        if (!res.ok) return { ok: false, reason: classifyHttpStatus(res.status), data: data };
        return Object.assign({ ok: true }, data || {});
      } catch (e) {
        return { ok: false, reason: classifyProbeError(e) };
      } finally {
        clearTimeout(timer);
      }
    }

    async function sidecarOnce() {
      const tools = env.phoneTools ? env.phoneTools() : undefined;
      const res = await postJson('/hub/sidecar/heartbeat', {
        wait_s: env.heartbeatWaitS == null ? 8 : env.heartbeatWaitS,
        foreground: env.isForeground ? !!env.isForeground() : true,
        tools: tools,
      }, 20000);
      if (!res.ok) return res;
      const pending = res.pending || [];
      for (let i = 0; i < pending.length; i++) {
        const call = pending[i];
        if (!env.callPhoneTool) continue;
        const result = await env.callPhoneTool(call.name, call.arguments || {});
        const posted = await postJson('/hub/sidecar/result', { id: call.id, result: result }, 8000);
        if (env.log) env.log((call.name || '?') + ' → 已回传电脑汇聚' + (posted.ok ? '' : '（回传失败）'));
      }
      return res;
    }

    async function runSidecar(signal) {
      while (signal && !signal.aborted && state.reachable) {
        if (env.isForeground && !env.isForeground()) {
          await new Promise(function (r) { setTimeout(r, 1000); });
          continue;
        }
        await sidecarOnce();
      }
    }

    function stopSidecar() {
      if (sidecarAbort) { sidecarAbort.aborted = true; sidecarAbort = null; }
    }

    function ensureSidecar() {
      if (!state.reachable) return;
      if (sidecarAbort && !sidecarAbort.aborted) return;
      sidecarAbort = { aborted: false };
      const token = sidecarAbort;
      Promise.resolve().then(function () { return runSidecar(token); }).catch(function () {});
    }

    function isReachable() { return !!state.reachable; }

    // 手机页只读调用电脑工具：目前只允许本地知识库检索，不允许写入或其它工具。
    async function callTool(name, args, waitMs) {
      if (HUB_READ_TOOLS.indexOf(name) < 0 && HUB_WRITE_TOOLS.indexOf(name) < 0) return { ok: false, reason: '该工具不允许从手机页调用。' };
      const cfg = getCfgFn();
      if (!cfg.token) return { ok: false, reason: '没有配置家里电脑汇聚服务。' };
      // 刚打开页面时可能还没探测过：先探测一次（与 7 秒轮询同一逻辑），仍连不上就明确告知。
      if (!state.reachable && !state.probing) { try { await tick({}); } catch (e) {} }
      if (!state.reachable) return { ok: false, reason: '连不上家里电脑（不在家里 Wi‑Fi，或电脑离线/休眠）。' };
      return postJson('/hub/tools/call', { name: name, arguments: args || {} }, waitMs || 8000);
    }
    function getState() { return snapshot(); }

    return {
      tick, ensureSidecar, stopSidecar, isReachable, getState, callTool, shouldConnectAccessPoint: function () { return shouldConnectAccessPoint(state); },
      sidecarOnce, probeTarget, classifyProbeError, classifyHttpStatus,
    };
  }

  const api = {
    KEY, HUB_READ_TOOLS, HUB_WRITE_TOOLS, getCfg, setCfg, clearCfg, isConfigured, joinHub, probeHealth,
    classifyProbeError, classifyHttpStatus, shouldConnectAccessPoint, createHubClient,
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.PhoneLinkHub = api;
})(typeof self !== 'undefined' ? self : this);
