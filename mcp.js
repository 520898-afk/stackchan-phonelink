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
  const SEARCHABLE = ['淘宝', '京东', '拼多多', '抖音', '快手', '小红书', '哔哩哔哩', '网易云音乐'];
  const NAV_MODES = { '驾车': 0, '公交': 1, '步行': 2, '骑行': 3 };
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
      case '淘宝': return 'taobao://s.taobao.com?q=' + q;
      case '拼多多': return 'pinduoduo://yangkeduo.com/search_result.html?search_key=' + q;
      case '抖音': return 'snssdk1128://search?keyword=' + q;
      case '快手': return 'kwai://search?keyword=' + q;
      case '小红书': return 'xhsdiscover://search/result?keyword=' + q;
      case '哔哩哔哩': return 'bilibili://search?keyword=' + q;
      case '网易云音乐': return 'orpheus://search?keyword=' + q;
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
      '拼多多': q ? 'https://mobile.yangkeduo.com/search_result.html?search_key=' + q : 'https://mobile.yangkeduo.com/',
      '快手': q ? 'https://www.kuaishou.com/search/video?searchKey=' + q : 'https://www.kuaishou.com/',
      '高德地图': q ? 'https://uri.amap.com/search?keyword=' + q + '&src=StackChanPhoneLink' : 'https://uri.amap.com/',
      '网易云音乐': q ? 'https://music.163.com/m/search?keyword=' + q : 'https://music.163.com/m/applink',
    };
    return map[app.name] || null;
  }

  // 高德官方路线规划：起点留空=当前位置，终点只用地名（不编造经纬度）
  // https://developer.amap.com/api/amap-mobile/guide/ios/route
  function navigateURL(destination, mode) {
    const dest = String(destination || '').trim();
    if (!dest || [...dest].length > 40 || !isSafeKeyword(dest)) return null;
    const t = Object.prototype.hasOwnProperty.call(NAV_MODES, mode) ? NAV_MODES[mode] : 0;
    return 'iosamap://path?sourceApplication=StackChanPhoneLink&dname=' +
      encodeURIComponent(dest) + '&dev=0&t=' + t;
  }
  function modeLabel(mode) {
    return Object.prototype.hasOwnProperty.call(NAV_MODES, mode) ? mode : '驾车';
  }

  // 常见内地城市 → 携程城市三字码（多机场城市用城市码：北京 BJS、上海 SHA、西安 SIA）
  const CITY_CODES = {
    '北京': 'BJS', '上海': 'SHA', '广州': 'CAN', '深圳': 'SZX', '成都': 'CTU',
    '杭州': 'HGH', '武汉': 'WUH', '西安': 'SIA', '重庆': 'CKG', '南京': 'NKG',
    '昆明': 'KMG', '厦门': 'XMN', '青岛': 'TAO', '长沙': 'CSX', '天津': 'TSN',
    '大连': 'DLC', '郑州': 'CGO', '三亚': 'SYX', '海口': 'HAK', '哈尔滨': 'HRB',
    '沈阳': 'SHE', '福州': 'FOC', '济南': 'TNA', '宁波': 'NGB', '合肥': 'HFE',
    '贵阳': 'KWE', '南宁': 'NNG', '太原': 'TYN', '石家庄': 'SJW', '南昌': 'KHN',
    '温州': 'WNZ', '珠海': 'ZUH', '兰州': 'LHW', '银川': 'INC', '西宁': 'XNN',
    '呼和浩特': 'HET', '乌鲁木齐': 'URC', '拉萨': 'LXA', '丽江': 'LJG', '桂林': 'KWL',
    '无锡': 'WUX', '烟台': 'YNT', '泉州': 'JJN', '常州': 'CZX',
  };
  const CITY_BY_CODE = {};
  Object.keys(CITY_CODES).forEach(name => { CITY_BY_CODE[CITY_CODES[name]] = name; });
  const FLIGHT_APPS = ['携程', '去哪儿', '飞猪'];
  const FLIGHT_APP_ALIASES = { '携程旅行': '携程', 'ctrip': '携程', '去哪儿网': '去哪儿', 'qunar': '去哪儿', '飞猪旅行': '飞猪', 'fliggy': '飞猪' };
  const DEFAULT_FLIGHT_APP = '携程';

  function shanghaiTodayYmd() {
    return new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit',
    }).format(new Date());
  }
  function addDaysYmd(ymd, days) {
    const p = String(ymd).split('-').map(Number);
    const dt = new Date(Date.UTC(p[0], p[1] - 1, p[2] + days));
    return dt.getUTCFullYear() + '-' + String(dt.getUTCMonth() + 1).padStart(2, '0') + '-' + String(dt.getUTCDate()).padStart(2, '0');
  }
  function ymdFromParts(y, mo, d) {
    y = Number(y); mo = Number(mo); d = Number(d);
    const dt = new Date(Date.UTC(y, mo - 1, d));
    if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== mo - 1 || dt.getUTCDate() !== d) return null;
    if (y < 2020 || y > 2035) return null;
    return y + '-' + String(mo).padStart(2, '0') + '-' + String(d).padStart(2, '0');
  }
  function parseFlightDate(s) {
    const raw = String(s == null ? '' : s).trim();
    if (!raw) return addDaysYmd(shanghaiTodayYmd(), 1);
    if (!isSafeKeyword(raw)) return null;
    if (raw === '今天') return shanghaiTodayYmd();
    if (raw === '明天') return addDaysYmd(shanghaiTodayYmd(), 1);
    if (raw === '后天') return addDaysYmd(shanghaiTodayYmd(), 2);
    if (raw === '大后天') return addDaysYmd(shanghaiTodayYmd(), 3);
    let m = raw.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
    if (m) return ymdFromParts(m[1], m[2], m[3]);
    m = raw.match(/^(\d{4})年(\d{1,2})月(\d{1,2})日?$/);
    if (m) return ymdFromParts(m[1], m[2], m[3]);
    m = raw.match(/^(\d{1,2})月(\d{1,2})日?$/);
    if (m) return ymdFromParts(shanghaiTodayYmd().slice(0, 4), m[1], m[2]);
    return null;
  }
  function resolveCity(input) {
    const raw = String(input || '').trim();
    if (!raw || [...raw].length > 20 || !isSafeKeyword(raw)) return null;
    const stripped = raw.replace(/市$/, '');
    if (CITY_CODES[stripped]) return { name: stripped, code: CITY_CODES[stripped] };
    const code = raw.toUpperCase();
    if (CITY_BY_CODE[code]) return { name: CITY_BY_CODE[code], code: code };
    return null;
  }
  function resolveFlightApp(name) {
    const raw = String(name == null ? '' : name).trim();
    if (!raw) return DEFAULT_FLIGHT_APP;
    if (FLIGHT_APPS.includes(raw)) return raw;
    const mapped = FLIGHT_APP_ALIASES[raw] || FLIGHT_APP_ALIASES[raw.toLowerCase()];
    return mapped || null;
  }
  // 只打开带出发地、目的地、日期的结果页；不编造尚未证实的 App Scheme
  function flightSearchURL(app, fromCity, toCity, date) {
    if (!app || !fromCity || !toCity || !date) return null;
    const dep = encodeURIComponent(fromCity.name);
    const arr = encodeURIComponent(toCity.name);
    switch (app) {
      case '携程':
        return 'https://flights.ctrip.com/online/list/oneway-' + fromCity.code + '-' + toCity.code + '?depdate=' + date;
      case '去哪儿':
        return 'https://m.flight.qunar.com/ncs/page/flightlist?depCity=' + dep + '&arrCity=' + arr + '&goDate=' + date;
      case '飞猪':
        // tripType=0 单程（1 为往返）；服务端会把单程转到 homeow/trip_flight_search.htm，参数保留
        return 'https://sjipiao.fliggy.com/flight_search_result.htm?tripType=0&depCity=' + dep + '&arrCity=' + arr + '&depDate=' + date;
      default:
        return null;
    }
  }

  function toolDefinitions() {
    const names = APPS.map(a => a.name);
    return [
      {
        name: 'open_phone_app',
        description: '在用户的 iPhone 上打开指定 App。仅当用户只是要打开 App、没有搜索或导航意图时调用，例如「打开淘宝」「打开抖音」「打开B站」「打开高德」。用户要搜索时请改用 search_in_app，要导航到某地时请改用 navigate_in_map，要查机票时请改用 search_flights，不要先打开再让用户手动输入。只能打开：' +
          names.join('、') + '。不能付款、转账或打开任意网址。需要手机上的「小智手机直连」网页开着且在前台。',
        inputSchema: { type: 'object', properties: { app: { type: 'string', enum: names, description: '要打开的 App 中文名' } }, required: ['app'] },
      },
      {
        name: 'search_in_app',
        description: '在用户 iPhone 的指定 App 里直接搜索关键词（商品、视频或歌曲）。用户说「淘宝搜运动鞋」「京东搜手机」「抖音搜猫」「快手搜视频」「网易云搜歌名」「拼多多搜纸巾」「小红书搜泪沟」「B站搜钢琴」时调用。支持：' +
          SEARCHABLE.join('、') + '。如果用户是要搜索，必须直接调用本工具，不要先调用 open_phone_app（先打开会把直连页切到后台，搜索指令就送不到手机）。只搜索，不下单、不付款。需要「小智手机直连」网页开着且在前台。',
        inputSchema: {
          type: 'object',
          properties: {
            app: { type: 'string', enum: SEARCHABLE, description: '在哪个 App 里搜索' },
            keyword: { type: 'string', description: '搜索关键词，1–40 个字' },
          },
          required: ['app', 'keyword'],
        },
      },
      {
        name: 'navigate_in_map',
        description: '用高德地图，从用户当前位置规划到指定地点的路线并打开导航。用户说「导航到上海站」「高德导航去附近的咖啡店」「去人民广场」「步行导航到外滩」时调用。不要只打开高德地图首页，必须直接调用本工具，不要先调用 open_phone_app（先打开会把直连页切到后台，导航指令就送不到手机）。默认驾车；也可公交、步行、骑行。不能付款。需要「小智手机直连」网页开着且在前台。',
        inputSchema: {
          type: 'object',
          properties: {
            destination: { type: 'string', description: '目的地名称或地址，1–40 个字' },
            mode: { type: 'string', enum: ['驾车', '公交', '步行', '骑行'], description: '出行方式，默认驾车' },
          },
          required: ['destination'],
        },
      },
      {
        name: 'search_flights',
        description: '查询单程机票并打开结果页。用户说「查机票」「买机票」「搜航班」「携程查西安到北京的机票」「飞猪搜上海飞广州明天的机票」时调用。支持：' +
          FLIGHT_APPS.join('、') + '。若用户没有指定 App，默认使用携程。必须直接调用本工具，不要先调用 open_phone_app（先打开会把直连页切到后台，查询指令就送不到手机）。只搜索航班，不预订、不付款。日期支持 YYYY-MM-DD、今天/明天/后天，缺省为明天（北京时间）。需要「小智手机直连」网页开着且在前台。',
        inputSchema: {
          type: 'object',
          properties: {
            app: { type: 'string', enum: FLIGHT_APPS, description: '在哪个 App 里查机票，可省略，默认携程' },
            from_city: { type: 'string', description: '出发城市，如 西安、北京' },
            to_city: { type: 'string', description: '到达城市，如 北京、上海' },
            date: { type: 'string', description: '出发日期，YYYY-MM-DD 或 今天/明天/后天，可省略，默认明天' },
          },
          required: ['from_city', 'to_city'],
        },
      },
      {
        name: 'get_procedure_notes',
        description: '查询某项医美或整形手术的术后注意事项，从专业医学网站检索并整理护理、饮食、活动、用药、复诊和异常就医信号。用户说「泪沟填充术后注意事项」「双眼皮术后护理」「隆鼻术后要注意什么」时调用。全文会显示在用户手机上，本工具只返回一段简短摘要供口述。不要用本工具查询术前准备或其他无关内容。不要求用户先做任何操作以外的确认。',
        inputSchema: {
          type: 'object',
          properties: {
            procedure: { type: 'string', description: '手术或项目名称，如 泪沟填充、双眼皮、隆鼻，1–40个字' },
          },
          required: ['procedure'],
        },
      },
    ];
  }

  /**
   * env: {
   *   launch(url, summary, app) -> Promise<{ok:boolean, text:string}>   // 网页里真正打开（或亮起按钮）
   *   isForeground() -> boolean
   *   log(line)
   *   getProcedureNotes(procedure) -> Promise<{ok:boolean, text:string}>
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
      if (name === 'navigate_in_map') {
        const app = resolveApp('高德地图');
        const dest = String(args.destination || '').trim();
        if (looksLikePayment(dest)) return toolText('出于安全考虑，不执行与付款、转账相关的操作。', true);
        const url = navigateURL(dest, args.mode);
        if (!url) return toolText('目的地无效（需要 1–40 个普通文字）。', true);
        const how = modeLabel(args.mode);
        return run(url, how + '导航到「' + dest + '」', app, dest);
      }
      if (name === 'search_flights') {
        const appName = resolveFlightApp(args.app);
        if (!appName) return toolText('这个 App 不支持直接查机票。支持：' + FLIGHT_APPS.join('、') + '。未指定时默认携程。', true);
        const fields = [args.from_city, args.to_city, args.date];
        if (fields.some(v => v != null && String(v) !== '' && looksLikePayment(v)))
          return toolText('出于安全考虑，不执行与付款、转账相关的操作。', true);
        const fromCity = resolveCity(args.from_city);
        const toCity = resolveCity(args.to_city);
        if (!fromCity || !toCity) return toolText('暂不支持这个城市。请用常见内地城市名，例如「西安」「北京」「上海」。', true);
        const date = parseFlightDate(args.date);
        if (!date) return toolText('日期无效。请用 YYYY-MM-DD，或今天、明天、后天。', true);
        const url = flightSearchURL(appName, fromCity, toCity, date);
        if (!url) return toolText('无法生成机票查询链接。', true);
        const summary = '在' + appName + '查询' + fromCity.name + '到' + toCity.name + '（' + date + '）的机票';
        return run(url, summary, { name: appName }, '', url);
      }
      if (name === 'get_procedure_notes') {
        const procedure = String(args.procedure || '').trim();
        if (!env.getProcedureNotes) return toolText('手机网页尚未配置医美助手。', true);
        if (!procedure) return toolText('请提供手术或项目名称，例如「泪沟填充」。', true);
        return env.getProcedureNotes(procedure).then(r => toolText(r.text, !r.ok));
      }
      return toolText('未知工具：' + name, true);
    }

    async function run(url, summary, app, kw, web) {
      if (!env.isForeground()) return toolText('手机网页不在前台，无法打开。请让用户把「小智手机直连」切回前台。', true);
      const r = await env.launch(url, summary, app, web !== undefined ? web : webURL(app, kw));
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

  const PHONE_TOOL_NAMES = toolDefinitions().map(t => t.name);
  const api = { APPS, SEARCHABLE, NAV_MODES, FLIGHT_APPS, DEFAULT_FLIGHT_APP, CITY_CODES, PHONE_TOOL_NAMES, resolveApp, searchURL, navigateURL, homeURL, webURL, toolDefinitions, createHandler,
                resolveCity, resolveFlightApp, parseFlightDate, shanghaiTodayYmd, addDaysYmd, flightSearchURL, isSafeKeyword, looksLikePayment, validateEndpoint, maskEndpoint };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.PhoneLinkMCP = api;
})(typeof self !== 'undefined' ? self : this);
