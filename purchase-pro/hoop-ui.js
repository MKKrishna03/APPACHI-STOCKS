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
  // the "ball" is the file being uploaded: a PDF page or an image
  const DOC = '<path d="M5.5 1H15l5 5v15.5a1.5 1.5 0 0 1-1.5 1.5h-13A1.5 1.5 0 0 1 4 21.5v-19A1.5 1.5 0 0 1 5.5 1z" class="hp-doc"/><path d="M15 1v5h5" class="hp-fold"/>';
  const ICON = {
    pdf: `<svg viewBox="0 0 24 24" aria-hidden="true">${DOC}<rect x="1.5" y="11" width="16" height="8" rx="1.5" fill="#dc2626"/><text x="9.5" y="17.2" class="hp-lbl">PDF</text></svg>`,
    img: `<svg viewBox="0 0 24 24" aria-hidden="true">${DOC}<circle cx="9" cy="9.5" r="1.8" fill="#f59e0b"/><path d="M6 19l4.5-5.5 3 3.5 2-2.2L18 19z" fill="#16a34a"/></svg>`
  };

  function build() {
    if (card && document.body.contains(card)) return card;
    card = document.createElement('div');
    card.className = 'hp-card';
    card.innerHTML = `
      <div class="hp-panel">
        <div class="hp-head"><b>Score to upload</b><span class="hp-score"></span><span class="hp-count"></span></div>
        <div class="hp-court">${SVG}<canvas class="hp-aim"></canvas><div class="hp-ball"></div><span class="hp-hint">Pull back &amp; release</span><span class="hp-pop"></span></div>
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

  // ── the game: pull the ball back (slingshot), release to shoot.
  // Stretch = power, direction = aim. The dots run the exact same physics as the throw, so the ball follows them.
  const R = 11, G = 900, POW = 13, MAX = 60, STEP = 1 / 240;
  let playing = false, score = 0, shots = 0;
  function geo(court) {
    const W = court.clientWidth, H = court.clientHeight, hx = W - 100; // hoop svg left edge (right:10, width:90)
    return { W, H, x0: 70, y0: H - 75, rimL: hx + 23, rimR: hx + 67, rimY: 4 + 50 };
  }
  function place(ball, x, y, rot) { ball.style.transform = `translate(${x - 11}px, ${y - 11}px) rotate(${rot || 0}deg)`; }
  function resetBall(c) {
    const g = geo(c.querySelector('.hp-court')), ball = c.querySelector('.hp-ball');
    ball.getAnimations().forEach(a => a.cancel());
    ball.style.opacity = 1; place(ball, g.x0, g.y0);
  }
  function bounceOff(b, px, py) { // ball vs a rim edge (a point)
    const dx = b.x - px, dy = b.y - py, d = Math.hypot(dx, dy);
    if (d >= R || d === 0) return false;
    const nx = dx / d, ny = dy / d, dot = b.vx * nx + b.vy * ny;
    b.x = px + nx * R; b.y = py + ny * R;
    if (dot < 0) { b.vx -= 1.6 * dot * nx; b.vy -= 1.6 * dot * ny; }
    return true;
  }
  // one fixed physics step — shared by the throw and the aim dots. Returns 'in' / 'out' on the first fall past
  // rim height (one chance per shot), 'rim' on a rim hit, else ''.
  function tick(b, g) {
    b.vy += G * STEP; b.x += b.vx * STEP; b.y += b.vy * STEP;
    let ev = '';
    if (bounceOff(b, g.rimL, g.rimY) | bounceOff(b, g.rimR, g.rimY)) ev = 'rim';
    if (b.y < g.rimY - 4) b.above = true;
    if (b.above && !b.crossed && b.vy > 0 && b.y >= g.rimY) { b.crossed = true; ev = b.x > g.rimL + 2 && b.x < g.rimR - 2 ? 'in' : 'out'; }
    if (b.y > g.H - R) { b.y = g.H - R; b.vy *= -0.5; b.vx *= 0.8; }
    if (b.x < R) { b.x = R; b.vx *= -0.6; }
    if (b.x > g.W - R) { b.x = g.W - R; b.vx *= -0.6; }
    return ev;
  }
  // aim dots on one canvas, drawn once per frame
  function canvasFor(c, g) {
    const cv = c.querySelector('.hp-aim'), k = scale * (devicePixelRatio || 1);
    if (cv.width !== Math.round(g.W * k) || cv.height !== Math.round(g.H * k)) { cv.width = Math.round(g.W * k); cv.height = Math.round(g.H * k); }
    const ctx = cv.getContext('2d');
    ctx.setTransform(k, 0, 0, k, 0, 0);
    ctx.clearRect(0, 0, g.W, g.H);
    return ctx;
  }
  function aim(c, g, v) {
    const ctx = canvasFor(c, g);
    if (!v) return;
    const b = { x: g.x0, y: g.y0, vx: v.vx, vy: v.vy };
    ctx.fillStyle = c._dot || (c._dot = getComputedStyle(c).getPropertyValue('--ink-3').trim() || '#888'); // read once, not every frame
    const pts = [];
    for (let i = 1; i <= 360; i++) { // up to 1.5 s of flight, a dot every 1/30 s
      const ev = tick(b, g);
      if (i % 8 === 0) pts.push(b.x, b.y);
      if (ev === 'in' || ev === 'out' || b.y >= g.H - R) break; // where the shot is decided
    }
    const show = Math.ceil(pts.length / 4) * 2; // only the first half of the path — judge the finish yourself
    for (let j = 0; j < show; j += 2) {
      ctx.globalAlpha = 0.9 - 0.75 * j / show; // fades out toward the end
      ctx.beginPath(); ctx.arc(pts[j], pts[j + 1], 1.7, 0, 7); ctx.fill();
    }
    ctx.globalAlpha = 1;
  }
  function swish(c) {
    c.querySelector('.hp-net')?.animate([{ transform: 'scaleY(1)' }, { transform: 'scaleY(1.25)' }, { transform: 'scaleY(.94)' }, { transform: 'scaleY(1)' }], { duration: 420, easing: 'ease-out' });
  }
  function clank(c) {
    c.querySelector('.hp-rim')?.animate([{ transform: 'translateY(0)' }, { transform: 'translateY(2px)' }, { transform: 'translateY(-1px)' }, { transform: 'translateY(0)' }], { duration: 240 });
  }
  function fly(c, v) {
    const court = c.querySelector('.hp-court'), ball = c.querySelector('.hp-ball'), g = geo(court);
    const b = { x: g.x0, y: g.y0, vx: v.vx, vy: v.vy }, t0 = performance.now();
    let last = null, acc = 0, rot = 0, scored = false;
    playing = true; shots++;
    function frame(now) {
      if (last === null) last = now;
      acc += Math.max(0, Math.min(0.05, (now - last) / 1000)); last = now;
      while (acc >= STEP) { // fixed steps, same as the dots
        acc -= STEP;
        const ev = tick(b, g);
        if (ev === 'rim') clank(c);
        if (ev === 'in') { scored = true; score++; swish(c); b.vx *= 0.3; b.vy *= 0.5; tally(c, true); release(); }
      }
      rot += b.vx * 0.05;
      place(ball, b.x, b.y, rot);
      const resting = b.y >= g.H - R - 1 && Math.abs(b.vy) < 40 && Math.abs(b.vx) < 30;
      if (now - t0 < 4000 && !resting) return requestAnimationFrame(frame);
      if (!scored) tally(c, false);
      ball.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 200, fill: 'forwards' }).finished.then(() => {
        resetBall(c); playing = false;
      });
    }
    requestAnimationFrame(frame);
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
      drag = { sx: e.clientX, sy: e.clientY, x: e.clientX, y: e.clientY, v: null, g: geo(court), ball: c.querySelector('.hp-ball'), raf: 0 };
      c.querySelector('.hp-hint').style.opacity = 0; c._dot = '';
    });
    const pull = () => { // slingshot: pull back, the shot goes the opposite way; longer pull = stronger
      const d = drag; if (!d) return;
      d.raf = 0;
      let dx = (d.x - d.sx) / scale, dy = (d.y - d.sy) / scale;
      const len = Math.hypot(dx, dy);
      if (len > MAX) { dx *= MAX / len; dy *= MAX / len; }
      d.v = len < 8 ? null : { vx: -dx * POW, vy: -dy * POW };
      place(d.ball, Math.max(R, d.g.x0 + dx), Math.min(d.g.H - R, d.g.y0 + dy)); // ball stays inside the court
      aim(c, d.g, d.v);
    };
    court.addEventListener('pointermove', (e) => {
      if (!drag) return;
      drag.x = e.clientX; drag.y = e.clientY;
      if (!drag.raf) drag.raf = requestAnimationFrame(pull); // at most one update per frame
    });
    const letGo = () => {
      if (!drag) return;
      const d = drag; drag = null;
      cancelAnimationFrame(d.raf);
      aim(c, d.g, null);
      if (!d.v) return resetBall(c);
      fly(c, d.v);
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
    const isPdf = /\.pdf/i.test(name || ''); // PDF pages arrive as "name.pdf-p1.jpg"
    c.querySelector('.hp-pdf').textContent = isPdf ? 'PDF' : 'IMG';
    c.querySelector('.hp-ball').innerHTML = ICON[isPdf ? 'pdf' : 'img'];
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
