/* Restocking — Ask AI: a ✦ button (bottom-left) opens a chat panel. Answers come from the live
   Restocking data (server: restock-ai.js → POST /api/restock/ai/ask). Uses the page's colour tokens. */
(function () {
  'use strict';
  var chat = [], busy = false;
  var SAMPLES = [
    'How many pieces to order in KOLUSU?',
    'What should I order from SIRAN SILVER?',
    'Top selling products this month',
    'Which 9.5 BOMBAY products need stock?',
    'Slow-moving products in SL',
    'Ordered items not arrived yet',
  ];
  var esc = function (s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); };

  var css = document.createElement('style');
  css.textContent = [
    '.rai-btn{position:fixed;left:18px;bottom:18px;z-index:40;height:46px;padding:0 18px;border-radius:999px;border:1px solid var(--gold,#d4af37);background:var(--gold,#d4af37);color:#1a1405;font:700 14px Inter,sans-serif;cursor:pointer;box-shadow:0 10px 30px -10px rgba(0,0,0,.6);display:flex;align-items:center;gap:8px}',
    '.rai-btn:hover{filter:brightness(1.08)}',
    '.rai-panel{position:fixed;left:18px;bottom:76px;z-index:41;width:420px;max-width:calc(100vw - 32px);height:min(600px,calc(100vh - 110px));display:none;flex-direction:column;background:var(--surface-2,#161d29);border:1px solid var(--line-strong,rgba(255,255,255,.12));border-radius:16px;box-shadow:0 24px 60px -20px rgba(0,0,0,.7);overflow:hidden;color:var(--text,#e8ecf2)}',
    '.rai-panel.open{display:flex}',
    '.rai-head{display:flex;align-items:center;gap:8px;padding:12px 14px;border-bottom:1px solid var(--line,rgba(255,255,255,.07));font:700 15px Inter,sans-serif}',
    '.rai-head span{flex:1}',
    '.rai-x{background:none;border:0;color:var(--text-dim,#8a96a8);font-size:20px;cursor:pointer;line-height:1}',
    '.rai-new{background:none;border:1px solid var(--line-strong,rgba(255,255,255,.12));color:var(--text-dim,#8a96a8);border-radius:8px;padding:3px 10px;font:600 12px Inter,sans-serif;cursor:pointer}',
    '.rai-log{flex:1;overflow-y:auto;padding:14px;display:flex;flex-direction:column;gap:10px}',
    '.rai-hello{margin:auto;text-align:center;color:var(--text-dim,#8a96a8);font-size:13.5px;line-height:1.7}',
    '.rai-hello b{display:block;color:var(--text,#e8ecf2);font-size:15px}',
    '.rai-msg{max-width:88%;padding:9px 13px;border-radius:14px;font-size:14.5px;line-height:1.55;white-space:pre-wrap;word-wrap:break-word}',
    '.rai-me{align-self:flex-end;background:var(--gold,#d4af37);color:#1a1405;font-weight:600;border-bottom-right-radius:4px}',
    '.rai-bot{align-self:flex-start;background:var(--surface,rgba(19,25,34,.78));border:1px solid var(--line,rgba(255,255,255,.07));border-bottom-left-radius:4px}',
    '.rai-err{color:var(--need,#ff6b63)}',
    '.rai-wait{display:flex;gap:5px;padding:13px}',
    '.rai-wait i{width:7px;height:7px;border-radius:50%;background:var(--text-dim,#8a96a8);animation:raiDot 1s infinite ease-in-out}',
    '.rai-wait i:nth-child(2){animation-delay:.15s}.rai-wait i:nth-child(3){animation-delay:.3s}',
    '@keyframes raiDot{0%,80%,100%{opacity:.25;transform:translateY(0)}40%{opacity:1;transform:translateY(-3px)}}',
    '.rai-samples{display:flex;flex-wrap:wrap;gap:6px;padding:0 14px 10px;justify-content:center}',
    '.rai-chip{border:1px solid var(--line-strong,rgba(255,255,255,.12));background:transparent;color:var(--text-dim,#8a96a8);border-radius:999px;padding:5px 11px;font:500 12.5px Inter,sans-serif;cursor:pointer}',
    '.rai-chip:hover{border-color:var(--gold,#d4af37);color:var(--text,#e8ecf2)}',
    '.rai-bar{display:flex;gap:8px;padding:10px;border-top:1px solid var(--line,rgba(255,255,255,.07))}',
    '.rai-bar input{flex:1;min-width:0;height:40px;background:var(--surface,rgba(19,25,34,.78));border:1px solid var(--line-strong,rgba(255,255,255,.12));border-radius:10px;padding:0 12px;color:var(--text,#e8ecf2);font:500 14px Inter,sans-serif;outline:none}',
    '.rai-bar input:focus{border-color:var(--gold,#d4af37)}',
    '.rai-bar button{height:40px;padding:0 16px;border-radius:10px;border:0;background:var(--gold,#d4af37);color:#1a1405;font:700 13px Inter,sans-serif;cursor:pointer}',
    '.rai-bar button:disabled{opacity:.5;cursor:default}',
    '@media (max-width:760px){.rai-btn{left:12px;bottom:12px;height:42px;padding:0 14px}.rai-panel{left:8px;right:8px;width:auto;max-width:none;bottom:62px;height:calc(100vh - 80px)}}',
    '@media print{.rai-btn,.rai-panel{display:none!important}}',
  ].join('');
  document.head.appendChild(css);

  var btn = document.createElement('button');
  btn.type = 'button'; btn.className = 'rai-btn'; btn.title = 'Ask AI about stock, orders and sales';
  btn.innerHTML = '<span aria-hidden="true">✦</span> Ask AI';
  var panel = document.createElement('div');
  panel.className = 'rai-panel';
  panel.innerHTML = '<div class="rai-head"><span>✦ Ask AI · Restocking</span><button type="button" class="rai-new" id="raiNew">New</button><button type="button" class="rai-x" id="raiX" title="Close">×</button></div>' +
    '<div class="rai-log" id="raiLog"></div>' +
    '<div class="rai-samples" id="raiSamples">' + SAMPLES.map(function (s) { return '<button type="button" class="rai-chip">' + esc(s) + '</button>'; }).join('') + '</div>' +
    '<form class="rai-bar" id="raiForm" autocomplete="off"><input id="raiQ" maxlength="600" placeholder="Ask anything — stock, orders, sales…" /><button id="raiSend" type="submit">Ask</button></form>';
  document.body.appendChild(btn);
  document.body.appendChild(panel);
  var $ = function (id) { return document.getElementById(id); };

  function draw() {
    var log = $('raiLog');
    log.innerHTML = chat.length ? chat.map(function (m) {
      if (m.role === 'user') return '<div class="rai-msg rai-me">' + esc(m.content) + '</div>';
      if (m.role === 'wait') return '<div class="rai-msg rai-bot rai-wait"><i></i><i></i><i></i></div>';
      return '<div class="rai-msg rai-bot' + (m.err ? ' rai-err' : '') + '">' + esc(m.content) + '</div>';
    }).join('') : '<div class="rai-hello"><b>Ask about stock, targets, orders and sales.</b>KOLUSU and SL · English, Tamil or Tanglish.</div>';
    $('raiSamples').style.display = chat.length ? 'none' : '';
    log.scrollTop = log.scrollHeight;
  }
  async function ask(q) {
    q = String(q || '').trim();
    if (!q || busy) return;
    busy = true; $('raiSend').disabled = true; $('raiQ').value = '';
    var history = chat.filter(function (m) { return (m.role === 'user' || m.role === 'assistant') && !m.err; }).map(function (m) { return { role: m.role, content: m.content }; });
    chat.push({ role: 'user', content: q }, { role: 'wait' });
    draw();
    try {
      var r = await fetch('/api/restock/ai/ask', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ question: q, history: history }) });
      var j = await r.json().catch(function () { return {}; });
      if (!r.ok || j.error) throw new Error(j.error || 'AI could not answer (' + r.status + ').');
      chat.splice(chat.length - 1, 1, { role: 'assistant', content: j.answer });
    } catch (e) {
      chat.splice(chat.length - 1, 1, { role: 'assistant', content: e.message, err: true });
    }
    busy = false; $('raiSend').disabled = false; draw(); $('raiQ').focus();
  }
  btn.onclick = function () { var open = panel.classList.toggle('open'); if (open) { draw(); $('raiQ').focus(); } };
  $('raiX').onclick = function () { panel.classList.remove('open'); };
  $('raiNew').onclick = function () { if (busy) return; chat = []; draw(); $('raiQ').focus(); };
  $('raiForm').onsubmit = function (e) { e.preventDefault(); ask($('raiQ').value); };
  panel.addEventListener('click', function (e) { var c = e.target.closest('.rai-chip'); if (c) ask(c.textContent); });
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && panel.classList.contains('open')) panel.classList.remove('open'); });
})();
