/* Purchase Pro — basketball upload animation. Every photo / PDF upload (any page) shows a small
   card: the file flies in an arc into the hoop, the net swishes, then the bar fills to Done.
   Works by watching fetch() POSTs to /purchase-pro/api/photos — no page needs to call it. */
(function () {
  'use strict';
  const URL_RE = /\/purchase-pro\/api\/(photos|inbox)(\?|$)/;
  const calm = false; // always play (Windows "Animation effects" off used to hide the throw)
  let card = null, pending = 0, done = 0, failed = 0, crawl = null, pct = 0, hideT = null, shotBusy = false, shotQ = 0;

  const SVG = `
    <svg class="hp-hoop" viewBox="0 0 90 92" aria-hidden="true">
      <rect x="15" y="2" width="60" height="42" rx="4" class="hp-board"/>
      <rect x="32" y="16" width="26" height="18" rx="2" class="hp-box"/>
      <g class="hp-net"><path d="M24 50 L32 82 M35 50 L38 84 M45 50 L45 85 M55 50 L52 84 M66 50 L58 82 M27 60 L63 60 M30 71 L60 71 M33 81 L57 81"/></g>
      <ellipse cx="45" cy="50" rx="22" ry="5" class="hp-rim"/>
    </svg>`;
  const FILE = `<svg viewBox="0 0 26 32" aria-hidden="true"><path d="M3 1h14l7 7v21a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V3a2 2 0 0 1 2-2z" class="hp-paper"/><path d="M17 1v7h7" class="hp-fold"/><rect x="5" y="19" width="14" height="7" rx="1.5" class="hp-tag"/></svg>`;

  function build() {
    if (card && document.body.contains(card)) return card;
    card = document.createElement('div');
    card.className = 'hp-card';
    card.innerHTML = `
      <div class="hp-head"><b>Uploading</b><span class="hp-count"></span></div>
      <div class="hp-court">${SVG}<div class="hp-ball">${FILE}</div><div class="hp-trail"></div></div>
      <div class="hp-file"><span class="hp-pdf">FILE</span><span class="hp-name"></span><span class="hp-pct"></span></div>
      <div class="hp-bar"><i></i></div>
      <div class="hp-msg"></div>`;
    document.body.appendChild(card);
    return card;
  }

  // the throw: a curve from bottom-left up over the rim, then down through the net
  function shoot() {
    if (calm) return Promise.resolve();
    const c = build(), ball = c.querySelector('.hp-ball'), court = c.querySelector('.hp-court');
    const W = court.clientWidth, x0 = 8, y0 = 92, x1 = W - 66, y1 = 28, cx = (x0 + x1) / 2 - 10, cy = -40;
    const frames = [];
    for (let i = 0; i <= 24; i++) {
      const t = i / 24, u = 1 - t;
      const x = u * u * x0 + 2 * u * t * cx + t * t * x1, y = u * u * y0 + 2 * u * t * cy + t * t * y1;
      frames.push({ transform: `translate(${x}px, ${y}px) rotate(${t * 330}deg)`, opacity: 1, offset: t * 0.72 });
    }
    frames.push({ transform: `translate(${x1}px, ${y1 + 30}px) rotate(360deg) scale(.82)`, opacity: 1, offset: 0.9 });
    frames.push({ transform: `translate(${x1}px, ${y1 + 48}px) rotate(370deg) scale(.7)`, opacity: 0, offset: 1 });
    // dotted aim line, fades as the ball flies
    const trail = c.querySelector('.hp-trail');
    trail.innerHTML = Array.from({ length: 9 }, (_, i) => {
      const t = (i + 1) / 10, u = 1 - t;
      return `<i style="left:${u * u * x0 + 2 * u * t * cx + t * t * x1 + 11}px;top:${u * u * y0 + 2 * u * t * cy + t * t * y1 + 14}px;animation-delay:${i * 40}ms"></i>`;
    }).join('');
    const a = ball.animate(frames, { duration: 1050, easing: 'linear', fill: 'forwards' });
    setTimeout(() => {
      c.querySelector('.hp-net')?.animate([{ transform: 'scaleY(1)' }, { transform: 'scaleY(1.22)' }, { transform: 'scaleY(.94)' }, { transform: 'scaleY(1)' }],
        { duration: 420, easing: 'ease-out' });
      c.querySelector('.hp-rim')?.animate([{ transform: 'translateY(0)' }, { transform: 'translateY(1.5px)' }, { transform: 'translateY(0)' }], { duration: 260 });
    }, 780);
    return a.finished.catch(() => {});
  }
  async function queueShot() {
    shotQ++;
    if (shotBusy) return;
    shotBusy = true;
    while (shotQ > 0) { shotQ--; await shoot(); }
    shotBusy = false;
  }

  function draw() {
    if (!card) return;
    const total = done + pending + failed;
    card.querySelector('.hp-count').textContent = total > 1 ? `${done} of ${total}` : '';
    card.querySelector('.hp-head b').textContent = pending ? 'Uploading' : failed ? 'Upload failed' : 'Uploaded';
    card.querySelector('.hp-pct').textContent = pending ? Math.round(pct) + '%' : failed && !done ? '' : 'Done';
    card.querySelector('.hp-bar i').style.width = (pending ? pct : 100) + '%';
    card.classList.toggle('ok', !pending && !failed);
    card.classList.toggle('bad', !pending && !!failed);
    card.querySelector('.hp-msg').textContent = pending ? '' : failed ? '⚠ ' + failed + (failed === 1 ? ' file' : ' files') + ' did not upload' : '✓ ' + (done === 1 ? 'File' : done + ' files') + ' uploaded';
  }

  function start(name) {
    clearTimeout(hideT);
    const c = build();
    if (!pending) { pct = 4; if (!c.classList.contains('show')) { done = 0; failed = 0; } }
    pending++;
    c.querySelector('.hp-name').textContent = name || 'file';
    c.querySelector('.hp-pdf').textContent = /\.pdf$/i.test(name || '') ? 'PDF' : 'IMG';
    requestAnimationFrame(() => c.classList.add('show'));
    clearInterval(crawl);
    crawl = setInterval(() => { pct = Math.min(92, pct + (92 - pct) * 0.07); draw(); }, 120);
    draw();
    queueShot();
  }
  function end(ok) {
    pending = Math.max(0, pending - 1);
    ok ? done++ : failed++;
    if (!pending) {
      clearInterval(crawl);
      const finish = async () => {
        while (shotBusy) await new Promise(r => setTimeout(r, 80)); // let the ball land first
        if (pending) return;
        draw();
        hideT = setTimeout(() => card?.classList.remove('show'), failed ? 3500 : 1600);
      };
      finish();
    } else draw();
  }

  const realFetch = window.fetch.bind(window);
  window.fetch = function (input, init) {
    const url = typeof input === 'string' ? input : input?.url || '';
    const isUp = URL_RE.test(url) && String(init?.method || 'GET').toUpperCase() === 'POST' && init?.body instanceof FormData;
    if (!isUp) return realFetch(input, init);
    const f = init.body.get('photo');
    start(f && f.name);
    return realFetch(input, init).then(
      (res) => { end(res.ok); return res; },
      (err) => { end(false); throw err; });
  };
})();
