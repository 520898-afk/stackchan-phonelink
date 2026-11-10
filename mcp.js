/* 小智手机直连 · MCP 工具服务端逻辑（纯 JS，无依赖；浏览器与 Node 测试共用）
 * 小智云端是 MCP 客户端，本网页是“工具服务器”：回应 initialize / tools/list / tools/call / ping。
 * 只允许白名单 App；不接受任意网址；不做任何付款/转账。 */
(function (root) {
  'use strict';

  // 白名单：中文名 → URL Scheme
  const APPS = [
    { name: '淘宝', scheme: 'taobao', aliases: ['手机淘宝', 'taobao'] },
    { name: '京东', scheme: 'openapp.jdmobile', aliases: ['jd'] },
    { name: '拼多多', scheme: 'pinduoduo', aliases: ['pdd'] },
    { name: '抖音', scheme: 'snssdk1128', aliases: ['douyin'] },
    { name: '快手', scheme: 'kwai', aliases: [] },
    { name: '小红书', scheme: 'xhsdiscover', aliases: ['红书'] },
    { name: '微信', scheme: 'weixin', aliases: ['wechat'] },
    { name: '哔哩哔哩', scheme: 'bilibili', aliases: ['b站', 'bilibili'] },
    { name: '网易云音乐', scheme: 'orpheus', aliases: ['网易云'] },
    { name: '高德地图', scheme: 'iosamap', aliases: ['高德'] },
    { name: '闲鱼', scheme: 'fleamarket', aliases: ['咸鱼'] },
  ];
  const SEARCHABLE = ['淘宝', '京东', '抖音', '小红书', '哔哩哔哩'];
  const PAYMENT_WORDS = ['支付', '付款', '转账', '红包', '收款', 'pay', 'transfer'];

  function resolveApp(name) {
    const key = String(name || '').trim().toLowerCase();
    if (!key) return null;
    return APPS.find(a => a.name.toLowerCase() === key || a.aliases.includes(key)) || null;
  }

  function isSafeKeyword(s) {
    if (/[\u0000-\u001f\u007f]/.test(s)) return false;
    const l = s.toLowerCase();
    return !['://', 'javascript:', '<script', '%0a', '%0d'].some(b => l.includes(b));
  }
  function looksLikePayment(s) {
    const l = String(s || '').toLowerCase();
    return PAYMENT_WORDS.some(w => l.includes(w));
  }

  function homeURL(app) { return app.scheme + '://'; }

  // 站内搜索（社区整理的 URL Scheme，需真机验证；打不开时退回首页）
  function searchURL(app, keyword) {
    const kw = String(keyword || '').trim();
    if (!kw || [...kw].length > 40 || !isSafeKeyword(kw)) return null;
    const q = encodeURIComponent(kw);
    switch (app.name) {
      case '淘宝': return 'taobao://s.taobao.com/search?q=' + q;
      case '抖音': return 'snssdk1128://search?keyword=' + q;
      case '小红书': return 'xhsdiscover://search/result?keyword=' + q;
      case '哔哩哔哩': return 'bilibili://search?keyword=' + q;
      case '京东':
        return 'openapp.jdmobile://virtual?params=' + encodeURIComponent(
          JSON.stringify({ category: 'jump', des: 'productList', from: 'search', keyWord: kw }));
      default: return null;
    }
  }

  // 网页版（https）备选链接，必须用户亲手点。2026-11-10 查各域名 apple-app-site-association：
  // 京东 m.jd.com、B站 m.bilibili.com 全路径可直跳 App；抖音只有首页“/”；网易云 /m/applink；
  // 淘宝/拼多多/小红书搜索页/快手/高德 这些地址不在通用链接范围内，只会打开网页版。
  function webURL(app, keyword) {
    const q = keyword ? encodeURIComponent(String(keyword).trim()) : '';
    const map = {
      '淘宝': q ? 'https://s.taobao.com/search?q=' + q : 'https://m.taobao.com/',
      '京东': q ? 'https://so.m.jd.com/ware/search.action?keyword=' + q : 'https://m.jd.com/',
      '抖音': q ? 'https://www.douyin.com/search/' + q : 'https://www.douyin.com/',
      '小红书': q ? 'https://www.xiaohongshu.com/search_result?keyword=' + q : 'https://www.xiaohongshu.com/',
      '哔哩哔哩': q ? 'https://m.bilibili.com/search?keyword=' + q : 'https://m.bilibili.com/',
      '拼多多': 'https://mobile.yangkeduo.com/',
      '快手': 'https://www.kuaishou.com/',
      '高德地图': 'https://uri.amap.com/',
      '网易云音乐': 'https://music.163.com/m/applink',
    };
    return map[app.name] || null;
  }

  function toolDefinitions() {
    const names = APPS.map(a => a.name);
    return [
      {
        name: 'open_phone_app',
        description: '在用户的 iPhone 上打开指定 App。用户说「打开淘宝」「打开抖音」「打开B站」「打开高德」等时调用。只能打开：' +
          names.join('、') + '。不能付款、转账或打开任意网址。需要手机上的「小智手机直连」网页开着且在前台。',
        inputSchema: { type: 'object', properties: { app: { type: 'string', enum: names, description: '要打开的 App 中文名' } }, required: ['app'] },
      },
      {
        name: 'search_in_app',
        description: '在用户 iPhone 的指定 App 里直接搜索关键词。用户说「在抖音搜猫」「淘宝搜运动鞋」「小红书搜泪沟」「B站搜钢琴」时调用。支持：' +
          SEARCHABLE.join('、') + '。只搜索，不下单、不付款。',
        inputSchema: {
          type: 'object',
          properties: {
            app: { type: 'string', enum: SEARCHABLE, description: '在哪个 App 里搜索' },
            keyword: { type: 'string', description: '搜索关键词，1–40 个字' },
          },
          required: ['app', 'keyword'],
        },
      },
    ];
  }

  /**
   * env: {
   *   launch(url, summary, app) -> Promise<{ok:boolean, text:string}>   // 网页里真正打开（或亮起按钮）
   *   isForeground() -> boolean
   *   log(line)
   * }
   */
  function createHandler(env) {
    const reply = (id, result) => (id === undefined || id === null) ? null :
      JSON.stringify({ jsonrpc: '2.0', id, result });
    const toolText = (text, isError) => ({ content: [{ type: 'text', text }], isError: !!isError });

    async function callTool(name, args) {
      args = args || {};
      if (name === 'open_phone_app') {
        const app = resolveApp(args.app);
        if (!app) return toolText('不支持的 App。可打开：' + APPS.map(a => a.name).join('、'), true);
        return run(homeURL(app), '打开' + app.name, app, '');
      }
      if (name === 'search_in_app') {
        const app = resolveApp(args.app);
        if (!app || !SEARCHABLE.includes(app.name))
          return toolText('这个 App 不支持直接搜索。支持：' + SEARCHABLE.join('、'), true);
        const kw = String(args.keyword || '').trim();
        if (looksLikePayment(kw)) return toolText('出于安全考虑，不执行与付款、转账相关的操作。', true);
        const url = searchURL(app, kw);
        if (!url) return toolText('搜索关键词无效（需要 1–40 个普通文字）。', true);
        return run(url, '在' + app.name + '搜索「' + kw + '」', app, kw);
      }
      return toolText('未知工具：' + name, true);
    }

    async function run(url, summary, app, kw) {
      if (!env.isForeground()) return toolText('手机网页不在前台，无法打开。请让用户把「小智手机直连」切回前台。', true);
      const r = await env.launch(url, summary, app, webURL(app, kw));
      return toolText(r.text, !r.ok);
    }

    async function handle(text) {
      let msg;
      try { msg = JSON.parse(text); } catch (e) {
        return JSON.stringify({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } });
      }
      if (!msg || typeof msg !== 'object' || typeof msg.method !== 'string') return null; // 云端回复/未知
      const { id, method } = msg;
      const params = msg.params || {};
      switch (method) {
        case 'initialize':
          return reply(id, {
            protocolVersion: params.protocolVersion || '2024-11-05',
            capabilities: { tools: { listChanged: false } },
            serverInfo: { name: 'StackChanPhoneLink-Web', version: '1.0' },
          });
        case 'ping': return reply(id, {});
        case 'tools/list': return reply(id, { tools: toolDefinitions() });
        case 'tools/call': {
          const res = await callTool(params.name, params.arguments);
          env.log && env.log((params.name || '?') + ' → ' + (res.isError ? '失败' : '成功') + '：' + res.content[0].text);
          return reply(id, res);
        }
        default:
          if (method.startsWith('notifications/') || id === undefined || id === null) return null;
          return JSON.stringify({ jsonrpc: '2.0', id, error: { code: -32601, message: 'Method not found: ' + method } });
      }
    }
    return { handle, callTool };
  }

  /** 校验接入点：只接受 wss://（本机调试允许 ws://127.0.0.1 / localhost） */
  function validateEndpoint(s) {
    let u;
    try { u = new URL(String(s || '').trim()); } catch (e) { return null; }
    if (u.protocol === 'wss:') return u.toString();
    if (u.protocol === 'ws:' && (u.hostname === '127.0.0.1' || u.hostname === 'localhost')) return u.toString();
    return null;
  }
  function maskEndpoint(s) {
    try {
      const u = new URL(s); const t = u.searchParams.get('token') || '';
      const tail = t.length > 8 ? t.slice(0, 4) + '…' + t.slice(-4) : (t ? '****' : '无 token');
      return u.protocol + '//' + u.host + u.pathname + ' · token ' + tail;
    } catch (e) { return '（未设置）'; }
  }

  const api = { APPS, SEARCHABLE, resolveApp, searchURL, homeURL, webURL, toolDefinitions, createHandler,
                isSafeKeyword, looksLikePayment, validateEndpoint, maskEndpoint };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.PhoneLinkMCP = api;
})(typeof self !== 'undefined' ? self : this);
