/* Verified originals arrive only over the existing authenticated home Hub. */
(function (root) {
  'use strict';
  const TOOL = 'show_knowledge_sources';

  function safeURL(value) {
    if (typeof value !== 'string' || value.length > 4096 || /[\s\\\u0000-\u001f\u007f]/.test(value)) return null;
    try {
      const url = new URL(value);
      if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) return null;
      if (!url.hostname || url.hostname === 'localhost' || url.hostname.endsWith('.local')) return null;
      return url.href;
    } catch (_) { return null; }
  }

  function createPresenter(env) {
    let pending = null;
    let objectURLs = [];
    function receipt(status) {
      const data = { phone_receipt: { status, display_verified: false } };
      return { structuredContent: data, content: [{ type: 'text', text: JSON.stringify(data) }],
        isError: ['phone_not_foreground', 'download_failed'].includes(status) };
    }
    async function present(args) {
      pending = null;
      if (!env.isForeground()) return receipt('phone_not_foreground');
      const refs = Array.isArray(args.references) ? args.references.slice(0, 3) : [];
      const clean = refs.map(ref => {
        const id = Number.isSafeInteger(ref.id) && ref.id > 0 ? ref.id : null;
        return { id, filename: String(ref.filename || '原始资料').slice(0, 300),
          url: ref.status === 'located' && ref.kind === 'web' ? safeURL(ref.url) : null,
          download_path: id && ref.status === 'located' && ref.kind === 'file' &&
            ref.download_path === '/hub/knowledge/original/' + id ? ref.download_path : null };
      });
      objectURLs.forEach(url => env.revokeObjectURL(url));
      objectURLs = [];
      env.render({ answer: String(args.answer || '').slice(0, 10000), references: clean });
      const first = clean[0];
      if (!first || (!first.url && !first.download_path)) return receipt('original_unavailable');
      let target = first.url;
      if (first.download_path) {
        try {
          const blob = await env.fetchOriginal(first.download_path);
          if (!env.isForeground()) return receipt('phone_not_foreground');
          target = env.createObjectURL(blob);
          objectURLs.push(target);
          env.setFirstLink(target, first.filename);
        } catch (_) { return receipt('download_failed'); }
      }
      if (env.autoOpen()) {
        pending = target;
        return receipt('navigation_scheduled');
      }
      return receipt('displayed');
    }
    function afterAcknowledged(posted) {
      const target = pending;
      pending = null;
      if (posted && target && env.isForeground()) env.navigate(target);
    }
    return { present, afterAcknowledged };
  }

  function browserPresenter(env) {
    const doc = root.document;
    const panel = doc.getElementById('knowledgeOriginals');
    function link(ref, index) {
      const li = doc.createElement('li');
      const a = doc.createElement('a');
      a.textContent = ref.filename;
      a.rel = 'noreferrer';
      if (ref.url) a.href = ref.url;
      else if (ref.download_path) {
        a.href = '#';
        a.addEventListener('click', async event => {
          if (a.href.startsWith('blob:')) return;
          event.preventDefault();
          try {
            const blob = await env.fetchOriginal(ref.download_path);
            const url = URL.createObjectURL(blob);
            a.href = url;
            root.location.assign(url);
          } catch (_) { doc.getElementById('knowledgeStatus').textContent = '本地原文件暂时无法取得'; }
        });
      } else {
        a.removeAttribute('href');
        a.textContent += '（原文件未定位）';
      }
      a.id = 'knowledgeSource' + index;
      li.appendChild(a);
      return li;
    }
    const presenter = createPresenter({
      ...env,
      render(data) {
        panel.hidden = false;
        doc.getElementById('knowledgeAnswer').textContent = data.answer;
        const list = doc.getElementById('knowledgeLinks');
        list.replaceChildren(...data.references.map(link));
        doc.getElementById('knowledgeStatus').textContent = '原文入口已送达';
        root.scrollTo({ top: panel.offsetTop, behavior: 'smooth' });
      },
      setFirstLink(url) {
        const first = doc.getElementById('knowledgeSource0');
        if (first) first.href = url;
      },
      createObjectURL: blob => URL.createObjectURL(blob),
      revokeObjectURL: url => URL.revokeObjectURL(url),
      navigate: url => root.location.assign(url),
    });
    doc.getElementById('knowledgeClose').onclick = () => { panel.hidden = true; };
    return presenter;
  }
  const api = { TOOL, safeURL, createPresenter, browserPresenter };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.PhoneLinkOriginals = api;
})(typeof self !== 'undefined' ? self : this);
