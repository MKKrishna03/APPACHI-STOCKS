/* Purchase Pro — basketball upload game. Every photo / PDF upload (any page) opens a full-screen hoop:
   the upload is held until you score (drag the ball toward the hoop and release), then it goes.
   Works by watching fetch() POSTs to /purchase-pro/api/photos|inbox — no page needs to call it. */
(function () {
  'use strict';
  const URL_RE = /\/purchase-pro\/api\/(photos|inbox)(\?|$)/;
  let card = null, pending = 0, done = 0, failed = 0, crawl = null, pct = 0, hideT = null;
  let released = false, held = [];          // uploads waiting for a basket
  let scale = 1;                            // panel is drawn small and scaled up to fill the screen

  const SVG = `
    <svg class="hp-hoop" viewBox="0 0 90 92" aria-hidden="true">
      <rect x="15" y="2" width="60" height="42" rx="4" class="hp-board"/>
      <rect x="32" y="16" width="26" height="18" rx="2" class="hp-box"/>
      <g class="hp-net"><path d="M24 50 L32 82 M35 50 L38 84 M45 50 L45 85 M55 50 L52 84 M66 50 L58 82 M27 60 L63 60 M30 71 L60 71 M33 81 L57 81"/></g>
      <ellipse cx="45" cy="50" rx="22" ry="5" class="hp-rim"/>
    </svg>`;
  const BALL = `<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="11" class="hp-bb"/><path d="M1 12h22M12 1v22M4.2 4.2c3.4 3 3.4 12.6 0 15.6M19.8 4.2c-3.4 3-3.4 12.6 0 15.6" class="hp-seam"/></svg>`;

  function build() {
    if (card && document.body.contains(card)) return card;
    card = document.createElement('div');
    card.className = 'hp-card';
    card.innerHTML = `
      <div class="hp-panel">
        <div class="hp-head"><b>Score to upload</b><span class="hp-score"></span><span class="hp-count"></span></div>
        <div class="hp-court">${SVG}<div class="hp-trail"></div><div class="hp-ball">${BALL}</div><span class="hp-hint">Drag &amp; shoot</span><span class="hp-pop"></span></div>
        <div class="hp-file"><span class="hp-pdf">FILE</span><span class="hp-name"></span><span class="hp-pct"></span></div>
        <div class="hp-bar"><i></i></div>
        <div class="hp-foot"><span class="hp-msg"></span><button type="button" class="hp-skip">Skip</button></div>
      </div>`;
    document.body.appendChild(card);
    card.querySelector('.hp-skip').addEventListener('click', release);
    addEventListener('resize', fit);
    requestAnimationFrame(() => wire(card));
    return card;
  }
  function fit() {
    if (!card) return;
    const p = card.querySelector('.hp-panel');
    p.style.transform = 'none';
    scale = Math.max(1, Math.min(innerWidth * 0.94 / p.offsetWidth, innerHeight * 0.92 / p.offsetHeight, 3.2));
    p.style.transform = `scale(${scale})`;
  }

  // ── the game: drag toward the hoop, release to shoot. Real gravity, rim + backboard bounces.
  const R = 11, G = 900;
  let playing = false, score = 0, shots = 0;
  function geo(court) {
    const W = court.clientWidth, H = court.clientHeight, hx = W - 100; // hoop svg left edge (right:10, width:90)
    return { W, H, x0: 26, y0: H - 18, rimL: hx + 23, rimR: hx + 67, rimY: 4 + 50, boardX: hx + 75, boardTop: 6, boardBot: 48 };
  }
  function place(ball, x, y, rot) { ball.style.transform = `translate(${x - 11}px, ${y - 11}px) rotate(${rot || 0}deg)`; }
  function resetBall(c) {
    const g = geo(c.querySelector('.hp-court')), ball = c.querySelector('.hp-ball');
    ball.getAnimations().forEach(a => a.cancel());
    ball.style.opacity = 1; place(ball, g.x0, g.y0);
  }
  // drag direction = aim: the ray from the ball picks a spot at rim height; the ball is lobbed onto that spot.
  // Near the rim it gets pulled toward the centre a little, so a good aim goes in.
  function solve(g, dx, dy) {
    if (dy > -6 || dx < 4 || Math.hypot(dx, dy) < 15) return null;
    let tx = g.x0 + dx * (g.rimY - g.y0) / dy;
    tx = Math.max(g.x0 + 40, Math.min(g.W - R, tx));
    const mid = (g.rimL + g.rimR) / 2;
    if (Math.abs(tx - mid) < 30) tx = mid + (tx - mid) * 0.35;
    const T = 0.8 + (tx - g.x0) / 1200, ty = g.rimY + 2;
    return { vx: (tx - g.x0) / T, vy: (ty - g.y0) / T - 0.5 * G * T, T };
  }
  function aim(c, shot) {
    const g = geo(c.querySelector('.hp-court'));
    let html = '';
    if (shot) for (let i = 1; i <= 14; i++) {
      const t = shot.T * i / 14, x = g.x0 + shot.vx * t, y = g.y0 + shot.vy * t + 0.5 * G * t * t;
      html += `<i style="left:${x - 1.5}px;top:${y - 1.5}px;opacity:${(0.85 - i * 0.04).toFixed(2)}"></i>`;
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
    let last = null, scored = false, above = false, crossed = false;
    playing = true; shots++;
    function step(now) {
      if (last === null) last = now; // first frame: rAF time can be earlier than t0
      const dt = Math.max(0, Math.min(0.032, (now - last) / 1000)); last = now;
      for (let k = 0; k < 4; k++) { // sub-steps so the ball can't skip through the rim
        const h = dt / 4;
        b.vy += G * h; b.x += b.vx * h; b.y += b.vy * h;
        const hitL = bounceOff(b, g.rimL, g.rimY), hitR = bounceOff(b, g.rimR, g.rimY);
        if (hitL || hitR) clank(c);
        if (b.y < g.rimY - 4) above = true;
        if (above && !crossed && b.vy > 0 && b.y >= g.rimY) { // one chance: the first fall past rim height
          crossed = true;
          if (b.x > g.rimL + 2 && b.x < g.rimR - 2) { scored = true; score++; swish(c); b.vx *= 0.3; b.vy *= 0.5; tally(c, true); release(); }
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
        resetBall(c); playing = false;
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
      drag = { sx: e.clientX, sy: e.clientY, shot: null };
      c.querySelector('.hp-hint').style.opacity = 0;
    });
    court.addEventListener('pointermove', (e) => {
      if (!drag) return;
      let dx = (e.clientX - drag.sx) / scale, dy = (e.clientY - drag.sy) / scale; // flick toward the hoop
      const len = Math.hypot(dx, dy), max = 90;
      if (len > max) { dx *= max / len; dy *= max / len; }
      const g = geo(court);
      drag.shot = solve(g, dx, dy);
      place(c.querySelector('.hp-ball'), g.x0 + dx * 0.2, g.y0 + dy * 0.2);
      aim(c, drag.shot);
    });
    const letGo = () => {
      if (!drag) return;
      const d = drag; drag = null;
      c.querySelector('.hp-trail').innerHTML = '';
      if (!d.shot) return resetBall(c);
      fly(c, d.shot.vx, d.shot.vy);
    };
    court.addEventListener('pointerup', letGo);
    court.addEventListener('pointercancel', letGo);
  }

  // ── upload state
  function draw() {
    if (!card) return;
    const total = done + pending + failed;
    card.querySelector('.hp-count').textContent = total > 1 ? `${done} of ${total}` : '';
    card.querySelector('.hp-head b').textContent = !released ? 'Score to upload' : pending ? 'Uploading' : failed ? 'Upload failed' : 'Uploaded';
    card.querySelector('.hp-pct').textContent = !released ? '' : pending ? Math.round(pct) + '%' : failed && !done ? '' : 'Done';
    card.querySelector('.hp-bar i').style.width = (!released ? 0 : pending ? pct : 100) + '%';
    card.querySelector('.hp-skip').hidden = released;
    card.classList.toggle('ok', released && !pending && !failed);
    card.classList.toggle('bad', released && !pending && !!failed);
    card.querySelector('.hp-msg').textContent = !released || pending ? '' : failed ? '⚠ ' + failed + (failed === 1 ? ' file' : ' files') + ' did not upload' : '✓ ' + (done === 1 ? 'File' : done + ' files') + ' uploaded';
  }
  function release() {
    if (released) return;
    released = true;
    pct = 4;
    clearInterval(crawl);
    crawl = setInterval(() => { pct = Math.min(92, pct + (92 - pct) * 0.07); draw(); }, 120);
    const go = held; held = [];
    go.forEach(fn => fn());
    draw();
  }
  function start(name) {
    clearTimeout(hideT);
    const c = build();
    if (!c.classList.contains('show')) { done = 0; failed = 0; released = false; score = 0; shots = 0; c.querySelector('.hp-score').textContent = ''; c.querySelector('.hp-hint').style.opacity = 1; }
    pending++;
    c.querySelector('.hp-name').textContent = name || 'file';
    c.querySelector('.hp-pdf').textContent = /\.pdf$/i.test(name || '') ? 'PDF' : 'IMG';
    c.classList.add('show');
    fit();
    draw();
  }
  function end(ok) {
    pending = Math.max(0, pending - 1);
    ok ? done++ : failed++;
    draw();
    if (pending) return;
    clearInterval(crawl);
    const hide = () => { if (pending) return; if (playing) hideT = setTimeout(hide, 500); else card?.classList.remove('show'); };
    hideT = setTimeout(hide, failed ? 3000 : 1400);
  }

  const realFetch = window.fetch.bind(window);
  window.fetch = function (input, init) {
    const url = typeof input === 'string' ? input : input?.url || '';
    const isUp = URL_RE.test(url) && String(init?.method || 'GET').toUpperCase() === 'POST' && init?.body instanceof FormData;
    if (!isUp) return realFetch(input, init);
    const f = init.body.get('photo');
    start(f && f.name);
    const gate = released ? Promise.resolve() : new Promise(r => held.push(r)); // wait for a basket
    return gate.then(() => realFetch(input, init)).then(
      (res) => { end(res.ok); return res; },
      (err) => { end(false); throw err; });
  };
})();
