/* 小智手机直连 · 页面逻辑：连接、重连、常亮、前后台、打开 App、日志、电脑汇聚 */
(function () {
  'use strict';
  const M = window.PhoneLinkMCP;
  const Home = window.PhoneLinkHomeAdmin;
  const Hub = window.PhoneLinkHub;
  const $ = id => document.getElementById(id);
  const KEY = 'stackchan.phonelink.endpoint';
  const PREF = 'stackchan.phonelink.prefs';

  // ---------- 存储 ----------
  let endpoint = localStorage.getItem(KEY) || sessionStorage.getItem(KEY) || '';
  const prefs = Object.assign({ autoOpen: true, keepAwake: true }, JSON.parse(localStorage.getItem(PREF) || '{}'));
  function savePrefs() { localStorage.setItem(PREF, JSON.stringify(prefs)); }

  // ---------- 日志 ----------
  const logLines = [];
  function log(line) {
    const t = new Date().toLocaleTimeString('zh-CN', { hour12: false });
    logLines.unshift(t + '  ' + redact(line));
    if (logLines.length > 200) logLines.length = 200;
    $('log').textContent = logLines.join('\n');
  }
  function redact(s) {
    return String(s)
      .replace(/token=[^&\s"]+/g, 'token=***')
      .replace(/Bearer\s+\S+/gi, 'Bearer ***')
      .replace(/("token"\s*:\s*")[^"]*/g, '$1***');
  }

  // ---------- 状态 ----------
  function setStatus(text, cls) { $('status').textContent = text; $('dot').className = 'dot ' + cls; }
  function showEndpoint() { $('endpointShow').textContent = '接入点：' + (endpoint ? M.maskEndpoint(endpoint) : '（未设置）'); }
  function showHub() {
    if (!$('hubShow')) return;
    const cfg = Hub ? Hub.getCfg() : {};
    const configured = Hub && Hub.isConfigured(cfg);
    if (!configured) {
      $('hubShow').textContent = '电脑汇聚：未配置（未填令牌前仍只用手机工具）';
      return;
    }
    const st = hubClient ? hubClient.getState() : null;
    if (st && st.reachable) $('hubShow').textContent = '电脑汇聚：已连接（电脑已汇聚）';
    else if (st && st.probing) $('hubShow').textContent = '电脑汇聚：正在探测家里电脑…';
    else $('hubShow').textContent = '电脑汇聚：不可用。' + (st && st.reason ? st.reason : '原因未知，未静默忽略。');
  }

  // ---------- 打开 App ----------
  let pending = null;
  function light(url, web, summary) {
    pending = { url, web, summary, at: Date.now() };
    $('openHint').textContent = '小智请求：' + summary + '（点一下打开）';
    $('openBtn').textContent = summary;
    $('openBtn').href = url;
    $('webBtn').style.display = web ? 'inline-block' : 'none';
    if (web) $('webBtn').href = web;
    $('openBox').classList.add('lit');
    try { navigator.vibrate && navigator.vibrate(200); } catch (e) {}
  }
  function unlight() { pending = null; $('openBox').classList.remove('lit'); }
  $('dismissBtn').onclick = () => { log('已取消：' + (pending ? pending.summary : '')); unlight(); };
  $('openBtn').addEventListener('click', () => { if (pending) log('手动点击打开：' + pending.summary); setTimeout(unlight, 800); });
  $('webBtn').addEventListener('click', () => { if (pending) log('用网页链接打开：' + pending.summary); setTimeout(unlight, 800); });

  function waitHidden(ms) {
    return new Promise(resolve => {
      if (document.hidden) return resolve(true);
      const on = () => { if (document.hidden) { done(true); } };
      const blur = () => done(true);
      const timer = setTimeout(() => done(false), ms);
      function done(v) { clearTimeout(timer); document.removeEventListener('visibilitychange', on); window.removeEventListener('pagehide', blur); resolve(v); }
      document.addEventListener('visibilitychange', on);
      window.addEventListener('pagehide', blur);
    });
  }

  async function launch(url, summary, app, web) {
    light(url, web, summary);
    if (!prefs.autoOpen) return { ok: true, text: '手机屏幕上已亮起「' + summary + '」大按钮，用户点一下即可打开。' };
    const hidden = waitHidden(2000);
    try { window.location.href = url; } catch (e) { log('自动跳转异常：' + e.message); }
    if (await hidden) { unlight(); return { ok: true, text: '已在手机上' + summary + '。' }; }
    return { ok: true, text: '已向手机发出「' + summary + '」。Safari 可能需要用户确认或点一下：手机屏幕上已亮起大按钮。若手机没装这个 App，则不会打开。' };
  }

  const Notes = window.PhoneLinkNotes;
  if (Notes && Notes.bind) Notes.bind();
  const getProcedureNotes = procedure => {
    if (!Notes || !Notes.getProcedureNotes) return Promise.resolve({ ok: false, text: '手机网页尚未加载医美助手。' });
    return Notes.getProcedureNotes(procedure);
  };
  const handler = M.createHandler({ launch, isForeground: () => !document.hidden, log, getProcedureNotes });

  // ---------- 电脑汇聚 ----------
  let lastHubReachable = false;
  const hubClient = Hub ? Hub.createHubClient({
    fetch: window.fetch.bind(window),
    getCfg: () => Hub.getCfg(),
    isForeground: () => !document.hidden,
    phoneTools: () => M.toolDefinitions(),
    callPhoneTool: (name, args) => handler.callTool(name, args),
    log,
    timeoutMs: 6000,
    retries: 2,
    onState: (st) => {
      showHub();
      if (st.reachable && !lastHubReachable) {
        lastHubReachable = true;
        closeAccessPointSocket('电脑已汇聚，已断开手机接入点，避免互挤');
        if (wantConnected) {
          setStatus('电脑已汇聚', 'on');
          hubClient.ensureSidecar();
        }
      } else if (!st.reachable && lastHubReachable) {
        lastHubReachable = false;
        if (hubClient) hubClient.stopSidecar();
        if (wantConnected) {
          log('电脑汇聚已断开，改用仅手机工具。' + (st.reason || ''));
          connect();
        } else {
          showHub();
        }
      } else if (st.reachable && wantConnected) {
        setStatus('电脑已汇聚', 'on');
        hubClient.ensureSidecar();
      }
    },
  }) : null;

  function hubConfigured() { return !!(Hub && Hub.isConfigured(Hub.getCfg())); }
  function hubReachable() { return !!(hubClient && hubClient.isReachable()); }

  function fillHubForm() {
    if (!Hub) return;
    const cfg = Hub.getCfg();
    if ($('hubUrl')) $('hubUrl').value = cfg.url || '';
    if ($('hubFallback')) $('hubFallback').value = cfg.fallback || '';
    if ($('hubToken')) $('hubToken').value = cfg.token ? '********' : '';
  }

  // ---------- WebSocket + 重连 ----------
  let ws = null, wantConnected = false, retry = 0, retryTimer = null, lastMsg = 0, watchdog = null;
  function closeAccessPointSocket(reason) {
    clearTimeout(retryTimer); retryTimer = null;
    if (ws) { const s = ws; ws = null; try { s.close(1000, 'hub'); } catch (e) {} }
    if (reason) log(reason);
  }
  function connect() {
    if (hubReachable()) {
      wantConnected = true;
      closeAccessPointSocket();
      setStatus('电脑已汇聚', 'on');
      if (hubClient) hubClient.ensureSidecar();
      showHub();
      return;
    }
    const url = M.validateEndpoint(endpoint);
    if (!url) { setStatus('请先设置接入点', 'off'); $('setup').open = true; return; }
    wantConnected = true; clearTimeout(retryTimer); retryTimer = null;
    if (ws && (ws.readyState === 0 || ws.readyState === 1)) return;
    setStatus(hubConfigured() ? '仅手机工具 · 连接中…' : '连接中…', 'wait');
    let sock;
    try { sock = new WebSocket(url); } catch (e) { log('无法创建连接：' + e.message); return scheduleRetry(); }
    ws = sock;
    sock.onopen = () => {
      if (ws !== sock) return;
      if (hubReachable()) { try { sock.close(1000, 'hub'); } catch (e) {} return; }
      retry = 0; lastMsg = Date.now();
      setStatus(hubConfigured() ? '已连接 · 仅手机工具' : '已连接，等待小智', 'on');
      log('已连上接入点');
    };
    sock.onmessage = async ev => {
      if (ws !== sock) return;
      lastMsg = Date.now();
      let method = '?'; try { method = JSON.parse(ev.data).method || 'reply'; } catch (e) {}
      if (method !== 'ping') log('← ' + method);
      if (method === 'tools/list') setStatus(hubConfigured() ? '已连接 · 仅手机工具' : '已连接 · 工具已注册', 'on');
      const out = await handler.handle(typeof ev.data === 'string' ? ev.data : '');
      if (out && sock.readyState === 1) sock.send(out);
    };
    sock.onerror = () => { if (ws === sock) log('连接出错（详细原因浏览器不提供；常见：token 错误/过期、网络、服务器拒绝网页来源）'); };
    sock.onclose = ev => {
      if (ws !== sock) return;
      ws = null;
      log('连接关闭 code=' + ev.code + (ev.reason ? ' ' + ev.reason : ''));
      if (wantConnected && !hubReachable()) scheduleRetry();
      else if (!wantConnected) setStatus('未连接', 'off');
    };
  }
  function scheduleRetry() {
    if (!wantConnected || hubReachable()) return;
    if (document.hidden) { setStatus('后台已暂停，回到前台自动重连', 'wait'); return; }
    const delay = Math.min(60000, 1000 * Math.pow(2, retry)) * (0.8 + Math.random() * 0.4);
    retry = Math.min(retry + 1, 6);
    setStatus('已断开，' + Math.round(delay / 1000) + ' 秒后重连', 'wait');
    retryTimer = setTimeout(connect, delay);
  }
  function disconnect() {
    wantConnected = false; clearTimeout(retryTimer);
    if (hubClient) hubClient.stopSidecar();
    if (ws) { const s = ws; ws = null; try { s.close(1000, 'user'); } catch (e) {} }
    setStatus('未连接', 'off'); log('已手动断开');
    showHub();
  }
  // 看门狗：页面在前台但连接“假活着”（长时间无消息且 readyState 异常）时重建
  watchdog = setInterval(() => {
    if (!wantConnected || document.hidden) return;
    if (hubReachable()) { if (hubClient) hubClient.ensureSidecar(); return; }
    if (!ws || ws.readyState === 3) { if (!retryTimer) connect(); }
  }, 15000);

  let hubTimer = null;
  async function hubTick(initial) {
    if (!hubClient) return;
    const st = await hubClient.tick({ initial: !!initial });
    showHub();
    return st;
  }
  function startHubLoop() {
    if (!hubClient || hubTimer) return;
    hubTimer = setInterval(() => { hubTick(false); }, 7000);
  }

  // ---------- 屏幕常亮 ----------
  let wakeLock = null;
  async function acquireWake() {
    if (!prefs.keepAwake || document.hidden) return;
    if (!('wakeLock' in navigator)) { $('wakeShow').textContent = '屏幕常亮：此浏览器不支持（iOS 16.4+ 才有），请在 设置→显示与亮度→自动锁定 调长'; return; }
    try {
      wakeLock = await navigator.wakeLock.request('screen');
      $('wakeShow').textContent = '屏幕常亮：已开启';
      wakeLock.addEventListener('release', () => { $('wakeShow').textContent = '屏幕常亮：已释放（回到前台会重新申请）'; });
    } catch (e) { $('wakeShow').textContent = '屏幕常亮：申请失败（' + e.name + '），点一下页面任意处再试'; }
  }
  function releaseWake() { if (wakeLock) { wakeLock.release().catch(() => {}); wakeLock = null; } $('wakeShow').textContent = '屏幕常亮：未开启'; }
  document.addEventListener('click', () => { if (prefs.keepAwake && !wakeLock) acquireWake(); }, { capture: true });

  // ---------- 前后台 ----------
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) { log('页面进入后台（iOS 会暂停网页，连接可能断开）'); return; }
    log('页面回到前台');
    acquireWake();
    if (hubReachable()) {
      if (wantConnected && hubClient) hubClient.ensureSidecar();
      return;
    }
    if (wantConnected && (!ws || ws.readyState > 1)) { retry = 0; clearTimeout(retryTimer); connect(); }
  });
  window.addEventListener('pageshow', e => { if (e.persisted && wantConnected && !hubReachable()) { retry = 0; connect(); } });
  window.addEventListener('online', () => { if (wantConnected && !hubReachable()) { retry = 0; clearTimeout(retryTimer); connect(); } });

  // ---------- UI ----------
  $('appList').textContent = M.APPS.map(a => a.name).join('、');
  $('autoOpen').checked = prefs.autoOpen; $('keepAwake').checked = prefs.keepAwake;
  $('autoOpen').onchange = e => { prefs.autoOpen = e.target.checked; savePrefs(); };
  $('keepAwake').onchange = e => { prefs.keepAwake = e.target.checked; savePrefs(); prefs.keepAwake ? acquireWake() : releaseWake(); };
  $('connectBtn').onclick = () => { retry = 0; connect(); acquireWake(); };
  $('disconnectBtn').onclick = disconnect;
  $('clearLogBtn').onclick = () => { logLines.length = 0; $('log').textContent = ''; };
  $('saveBtn').onclick = () => {
    const v = M.validateEndpoint($('endpointInput').value);
    if (!v) { alert('接入点格式不对：需要以 wss:// 开头的完整地址'); return; }
    endpoint = v; $('endpointInput').value = '';
    localStorage.removeItem(KEY); sessionStorage.removeItem(KEY);
    ($('remember').checked ? localStorage : sessionStorage).setItem(KEY, v);
    showEndpoint(); $('setup').open = false; log('已保存接入点');
    if (ws) { const s = ws; ws = null; try { s.close(); } catch (e) {} }
    retry = 0; connect(); acquireWake();
  };
  $('clearBtn').onclick = () => {
    if (!confirm('确定从这台手机清除 token？')) return;
    disconnect(); endpoint = ''; localStorage.removeItem(KEY); sessionStorage.removeItem(KEY); showEndpoint(); log('已清除 token');
  };

  if ($('hubSaveBtn') && Hub) {
    fillHubForm();
    $('hubSaveBtn').onclick = () => {
      const url = ($('hubUrl').value || '').trim();
      const fallback = ($('hubFallback').value || '').trim();
      const typed = ($('hubToken').value || '').trim();
      const prev = Hub.getCfg();
      const token = (!typed || typed === '********') ? (prev.token || '') : typed;
      const err = Home.validateHubUrl(url) || (fallback ? Home.validateHubUrl(fallback) : null);
      const hint = $('hubHint');
      if (err) { if (hint) hint.textContent = err; return; }
      if (!token) { if (hint) hint.textContent = '请填写汇聚令牌（不要发到聊天里）。'; return; }
      Hub.setCfg({ url, fallback, token });
      if ($('hubToken')) $('hubToken').value = '********';
      if (hint) hint.textContent = '汇聚设置已保存。只存在本机，不会上传到 GitHub Pages。';
      log('已保存电脑汇聚地址');
      lastHubReachable = hubReachable();
      hubTick(true).then(() => { if (wantConnected && !hubReachable() && endpoint) connect(); });
    };
    if ($('hubClearBtn')) $('hubClearBtn').onclick = () => {
      if (!confirm('确定清除本机保存的汇聚令牌和地址？')) return;
      Hub.clearCfg();
      fillHubForm();
      lastHubReachable = false;
      if (hubClient) hubClient.stopSidecar();
      showHub();
      log('已清除电脑汇聚设置');
      if (wantConnected && endpoint) connect();
    };
  }

  showEndpoint();
  showHub();
  startHubLoop();
  const boot = () => {
    if (endpoint && hubConfigured() && hubClient) {
      wantConnected = true;
      setStatus('正在探测家里电脑…', 'wait');
      hubTick(true).then((st) => {
        if (hubReachable()) {
          setStatus('电脑已汇聚', 'on');
          hubClient.ensureSidecar();
        } else if (wantConnected) {
          log('电脑汇聚不可用，改用仅手机工具。' + ((st && st.reason) || ''));
          connect();
        }
      });
    } else if (endpoint) {
      connect();
    } else {
      $('setup').open = true;
    }
  };
  boot();
  acquireWake();
  if ('serviceWorker' in navigator && location.protocol === 'https:') navigator.serviceWorker.register('sw.js').catch(() => {});

  // 测试钩子（只读状态）
  window.__phonelink = { get state() { return { wsState: ws ? ws.readyState : -1, pending, wantConnected, retry, wake: !!wakeLock, hub: hubClient ? hubClient.getState() : null }; } };
})();
