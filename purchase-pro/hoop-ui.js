/* Purchase Pro — basketball upload card. Every photo / PDF upload (any page) shows a small
   card with a playable hoop: drag the ball toward the hoop and release to shoot while the bar fills.
   Works by watching fetch() POSTs to /purchase-pro/api/photos — no page needs to call it. */
(function () {
  'use strict';
  const URL_RE = /\/purchase-pro\/api\/(photos|inbox)(\?|$)/;
  let card = null, pending = 0, done = 0, failed = 0, crawl = null, pct = 0, hideT = null;

  const SVG = `
    <svg class="hp-hoop" viewBox="0 0 90 92" aria-hidden="true">
      <rect x="15" y="2" width="60" height="42" rx="4" class="hp-board"/>
      <rect x="32" y="16" width="26" height="18" rx="2" class="hp-box"/>
      <g class="hp-net"><path d="M24 50 L32 82 M35 50 L38 84 M45 50 L45 85 M55 50 L52 84 M66 50 L58 82 M27 60 L63 60 M30 71 L60 71 M33 81 L57 81"/></g>
      <ellipse cx="45" cy="50" rx="22" ry="5" class="hp-rim"/>
    </svg>`;
  const FILE = `<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="11" class="hp-bb"/><path d="M1 12h22M12 1v22M4.2 4.2c3.4 3 3.4 12.6 0 15.6M19.8 4.2c-3.4 3-3.4 12.6 0 15.6" class="hp-seam"/></svg>`;

  function build() {
    if (card && document.body.contains(card)) return card;
    card = document.createElement('div');
    card.className = 'hp-card';
    card.innerHTML = `
      <div class="hp-head"><b>Uploading</b><span class="hp-score"></span><span class="hp-count"></span></div>
      <div class="hp-court">${SVG}<div class="hp-trail"></div><div class="hp-ball">${FILE}</div><span class="hp-hint">Drag toward the hoop &amp; release</span><span class="hp-pop"></span></div>
      <div class="hp-file"><span class="hp-pdf">FILE</span><span class="hp-name"></span><span class="hp-pct"></span></div>
      <div class="hp-bar"><i></i></div>
      <div class="hp-msg"></div>`;
    document.body.appendChild(card);
    requestAnimationFrame(() => wire(card));
    return card;
  }

  // the game: drag the ball back (slingshot), release to shoot. Real gravity, rim + backboard bounces.
  const R = 11, G = 900, POW = 5.2;
  let game = null, playing = false, lastPlay = 0, score = 0, shots = 0;
  function geo(court) {
    const W = court.clientWidth, H = court.clientHeight, hx = W - 100; // hoop svg left edge (right:10, width:90)
    return { W, H, x0: 26, y0: H - 18, rimL: hx + 23, rimR: hx + 67, rimY: 4 + 50, boardX: hx + 75, boardTop: 6, boardBot: 48 };
  }
  function place(ball, x, y, rot) { ball.style.transform = `translate(${x - 11}px, ${y - 11}px) rotate(${rot || 0}deg)`; }
  function resetBall(c) {
    const court = c.querySelector('.hp-court'), g = geo(court), ball = c.querySelector('.hp-ball');
    ball.getAnimations().forEach(a => a.cancel());
    ball.style.opacity = 1; place(ball, g.x0, g.y0);
    game = { x: g.x0, y: g.y0 };
  }
  function aim(c, vx, vy) {
    const g = geo(c.querySelector('.hp-court'));
    let html = '';
    for (let i = 1; i <= 10; i++) {
      const t = i * 0.045, x = g.x0 + vx * t, y = g.y0 + vy * t + 0.5 * G * t * t;
      html += `<i style="left:${x - 1.5}px;top:${y - 1.5}px;opacity:${(0.75 - i * 0.06).toFixed(2)}"></i>`;
    }
    c.querySelector('.hp-trail').innerHTML = html;
  }
  function swish(c) {
    c.querySelector('.hp-net')?.animate([{ transform: 'scaleY(1)' }, { transform: 'scaleY(1.25)' }, { transform: 'scaleY(.94)' }, { transform: 'scaleY(1)' }], { duration: 420, easing: 'ease-out' });
  }
  function clank(c) {
    c.querySelector('.hp-rim')?.animate([{ transform: 'translateY(0)' }, { transform: 'translateY(2px)' }, { transform: 'translateY(-1px)' }, { transform: 'translateY(0)' }], { duration: 240 });
  }
  function bounceOff(b, px, py) { // ball vs a rim edge (a point)
    const dx = b.x - px, dy = b.y - py, d = Math.hypot(dx, dy);
    if (d >= R || d === 0) return false;
    const nx = dx / d, ny = dy / d, dot = b.vx * nx + b.vy * ny;
    b.x = px + nx * R; b.y = py + ny * R;
    if (dot < 0) { b.vx -= 1.6 * dot * nx; b.vy -= 1.6 * dot * ny; }
    return true;
  }
  function fly(c, vx, vy) {
    const court = c.querySelector('.hp-court'), ball = c.querySelector('.hp-ball'), g = geo(court);
    const b = { x: g.x0, y: g.y0, vx, vy, rot: 0 }, t0 = performance.now();
    let last = t0, scored = false, above = false;
    playing = true; shots++;
    function step(now) {
      const dt = Math.min(0.032, (now - last) / 1000); last = now;
      for (let k = 0; k < 4; k++) { // sub-steps so the ball can't skip through the rim
        const h = dt / 4;
        b.vy += G * h; b.x += b.vx * h; b.y += b.vy * h;
        const hitL = bounceOff(b, g.rimL, g.rimY), hitR = bounceOff(b, g.rimR, g.rimY);
        if (hitL || hitR) clank(c);
        if (b.y > g.boardTop && b.y < g.boardBot && b.x + R > g.boardX && b.vx > 0) { b.x = g.boardX - R; b.vx *= -0.55; clank(c); }
        if (b.y < g.rimY - 4) above = true;
        if (!scored && above && b.vy > 0 && b.y >= g.rimY && b.x > g.rimL + 2 && b.x < g.rimR - 2) {
          scored = true; score++; swish(c); b.vx *= 0.3; b.vy *= 0.5; tally(c, true);
        }
        if (b.y > g.H - R) { b.y = g.H - R; b.vy *= -0.5; b.vx *= 0.8; }
        if (b.x < R) { b.x = R; b.vx *= -0.6; }
        if (b.x > g.W - R) { b.x = g.W - R; b.vx *= -0.6; }
      }
      b.rot += b.vx * dt * 3;
      place(ball, b.x, b.y, b.rot);
      const resting = b.y >= g.H - R - 1 && Math.abs(b.vy) < 40 && Math.abs(b.vx) < 30;
      if (now - t0 < 4000 && !resting) return requestAnimationFrame(step);
      if (!scored) tally(c, false);
      ball.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 200, fill: 'forwards' }).finished.then(() => {
        resetBall(c); playing = false; lastPlay = Date.now();
      });
    }
    requestAnimationFrame(step);
  }
  function tally(c, ok) {
    const el = c.querySelector('.hp-score');
    el.textContent = `🏀 ${score}/${shots}`;
    el.animate([{ transform: 'scale(1.35)' }, { transform: 'scale(1)' }], { duration: 300 });
    const pop = c.querySelector('.hp-pop');
    pop.textContent = ok ? 'Swish!' : 'Miss';
    pop.className = 'hp-pop ' + (ok ? 'yes' : 'no');
    pop.animate([{ opacity: 0, transform: 'translateY(6px)' }, { opacity: 1, transform: 'none', offset: .2 }, { opacity: 1, transform: 'none', offset: .7 }, { opacity: 0, transform: 'translateY(-8px)' }], { duration: 900, fill: 'forwards' });
  }
  function wire(c) {
    const court = c.querySelector('.hp-court');
    let drag = null;
    resetBall(c);
    court.addEventListener('pointerdown', (e) => {
      if (playing) return;
      e.preventDefault();
      court.setPointerCapture(e.pointerId);
      drag = { sx: e.clientX, sy: e.clientY, vx: 0, vy: 0 };
      c.querySelector('.hp-hint').style.opacity = 0;
      lastPlay = Date.now();
    });
    court.addEventListener('pointermove', (e) => {
      if (!drag) return;
      let dx = e.clientX - drag.sx, dy = e.clientY - drag.sy; // flick toward the hoop
      const len = Math.hypot(dx, dy), max = 90;
      if (len > max) { dx *= max / len; dy *= max / len; }
      drag.vx = dx * POW; drag.vy = dy * POW;
      const g = geo(court);
      place(c.querySelector('.hp-ball'), g.x0 + dx * 0.2, g.y0 + dy * 0.2);
      aim(c, drag.vx, drag.vy);
      lastPlay = Date.now();
    });
    const release = () => {
      if (!drag) return;
      const d = drag; drag = null;
      c.querySelector('.hp-trail').innerHTML = '';
      if (Math.hypot(d.vx, d.vy) < 60) return resetBall(c);
      fly(c, d.vx, d.vy);
    };
    court.addEventListener('pointerup', release);
    court.addEventListener('pointercancel', release);
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
  }
  function end(ok) {
    pending = Math.max(0, pending - 1);
    ok ? done++ : failed++;
    if (!pending) {
      clearInterval(crawl);
      const finish = async () => {
        if (pending) return;
        draw();
        const hide = () => { if (playing || card?.matches(':hover') || Date.now() - lastPlay < 5000) hideT = setTimeout(hide, 1000); else card?.classList.remove('show'); };
        hideT = setTimeout(hide, failed ? 3500 : 2500);
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
