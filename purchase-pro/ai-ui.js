/* Purchase Pro — Ask AI: type a question in English / Tamil / Tanglish,
   the answer comes from the live Purchase Pro data (server: ai.js). */
(function () {
  'use strict';
  const PP = window.PP;
  const { $, esc, api, S } = PP;

  // the chat stays while you move between pages (cleared on reload)
  const chat = [];
  let busy = false;
  const SAMPLES = [
    'How much do we owe in total?',
    'Silver with Padma Silvers?',
    'Which bills are unpaid for more than 30 days?',
    'Gold & silver pending with workers',
    'This month how much did we pay?',
    'KNR kitta evlo pending?',
  ];

  function bubble(m) {
    if (m.role === 'user') return `<div class="ai-msg ai-me">${esc(m.content)}</div>`;
    if (m.role === 'wait') return `<div class="ai-msg ai-bot ai-wait"><span></span><span></span><span></span></div>`;
    return `<div class="ai-msg ai-bot${m.err ? ' ai-err' : ''}">${esc(m.content)}</div>`;
  }

  async function viewAi(view) {
    view.innerHTML = `
      <div class="card ai-box">
        <div class="ai-log" id="aiLog"></div>
        <div class="ai-samples" id="aiSamples">${SAMPLES.map(s => `<button type="button" class="ai-chip">${esc(s)}</button>`).join('')}</div>
        <form class="ai-bar" id="aiForm" autocomplete="off">
          <input class="input" id="aiQ" maxlength="600" placeholder="Ask anything — e.g. How much silver is with Padma?" />
          <button class="btn primary" id="aiSend" type="submit">Ask</button>
          <button class="btn" id="aiClear" type="button" title="Start a new chat">New</button>
        </form>
      </div>`;
    const log = $('#aiLog');
    const draw = () => {
      log.innerHTML = chat.length ? chat.map(bubble).join('') : '<div class="ai-hello"><b>Ask about suppliers, bills, payments, gold & silver.</b>English, Tamil or Tanglish — all fine.</div>';
      $('#aiSamples').style.display = chat.length ? 'none' : '';
      log.scrollTop = log.scrollHeight;
    };
    const ask = async (q) => {
      q = String(q || '').trim();
      if (!q || busy) return;
      busy = true; $('#aiSend').disabled = true; $('#aiQ').value = '';
      const history = chat.filter(m => (m.role === 'user' || m.role === 'assistant') && !m.err).map(m => ({ role: m.role, content: m.content }));
      chat.push({ role: 'user', content: q }, { role: 'wait' });
      draw();
      try {
        const r = await api('/ai/ask', { method: 'POST', body: { firm: S.firm, question: q, history } });
        chat.splice(chat.length - 1, 1, { role: 'assistant', content: r.answer });
      } catch (e) {
        chat.splice(chat.length - 1, 1, { role: 'assistant', content: e.message, err: true });
      }
      busy = false;
      if (document.body.contains(log)) { $('#aiSend').disabled = false; draw(); $('#aiQ').focus(); }
    };
    $('#aiForm').onsubmit = (e) => { e.preventDefault(); ask($('#aiQ').value); };
    $('#aiClear').onclick = () => { if (busy) return; chat.length = 0; draw(); $('#aiQ').focus(); };
    view.onclick = (e) => { const c = e.target.closest('.ai-chip'); if (c) ask(c.textContent); };
    draw();
    $('#aiQ').focus();
  }

  PP.views.ai = viewAi;
})();
