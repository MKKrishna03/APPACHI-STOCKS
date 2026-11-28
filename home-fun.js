/* Home — little live touches:
   1. Dusty tiles  — a tile not opened on this phone for 5+ days gathers dust; tap blows it off
   2. Rain on glass — when Melur's live weather says rain, drops slide down the screen; swipe wipes them
   3. Night owl    — 10 PM to 5 AM a sleepy owl blinks in the corner with "இரவு வணக்கம்"
   4. Festivals    — Pongal, Deepavali, Karthigai Deepam, Tamil New Year, Republic / Independence Day,
                     Christmas, New Year: Home dresses up by itself (dates in FESTIVALS below)
   Try now: /home.html?fx=dust | rain | owl | pongal | diya | kolam | tricolor | star | newyear */
(function () {
  'use strict';
  var Q = (location.search.match(/[?&]fx=([a-z]+)/) || [])[1] || '';
  var reduce = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;
  var css = document.createElement('style');
  css.textContent =
    '.choice{position:relative;overflow:hidden}' +
    '.hf-dust{position:absolute;inset:0;pointer-events:none;border-radius:inherit;transition:opacity .45s;' +
      'background:radial-gradient(circle at 12% 18%,rgba(190,180,160,.55) 0 1px,transparent 1.6px),radial-gradient(circle at 63% 72%,rgba(190,180,160,.5) 0 1px,transparent 1.6px),' +
      'radial-gradient(circle at 82% 28%,rgba(190,180,160,.5) 0 1.2px,transparent 1.8px),radial-gradient(circle at 34% 58%,rgba(190,180,160,.45) 0 .9px,transparent 1.5px),' +
      'linear-gradient(180deg,rgba(150,140,120,.32),rgba(110,100,85,.42));background-size:23px 19px,31px 27px,37px 33px,17px 21px,100% 100%;filter:saturate(.6)}' +
    '.hf-dust svg{position:absolute;top:0;right:0;width:46px;height:46px;opacity:.75}' +
    '.hf-dust.gone{opacity:0}' +
    '.hf-puff{position:fixed;width:8px;height:8px;border-radius:50%;background:rgba(200,190,170,.75);pointer-events:none;z-index:9995;transition:transform .6s ease-out,opacity .6s ease-out}' +
    '.hf-owl{position:fixed;right:calc(14px + env(safe-area-inset-right,0px));bottom:calc(14px + env(safe-area-inset-bottom,0px));z-index:9970;display:flex;align-items:flex-end;gap:6px;cursor:pointer;animation:hfBob 3.2s ease-in-out infinite}' +
    '.hf-owl .bub{background:var(--panel,#161d29);border:1px solid var(--border,#263142);color:var(--text,#e8edf4);font:700 13px "Noto Sans Tamil",Inter,sans-serif;padding:7px 10px;border-radius:12px 12px 2px 12px;margin-bottom:46px;white-space:nowrap}' +
    '.hf-owl .lid{animation:hfBlink 4.5s infinite;transform-origin:center 22px}' +
    '@keyframes hfBlink{0%,92%,100%{transform:scaleY(0)}95%{transform:scaleY(1)}}' +
    '@keyframes hfBob{0%,100%{transform:translateY(0)}50%{transform:translateY(-4px)}}' +
    '.hf-fest{position:fixed;left:0;right:0;pointer-events:none;z-index:9960}' +
    '.hf-fest-msg{text-align:center;font:800 15px "Noto Sans Tamil",Inter,sans-serif;color:var(--accent,#d4af37);margin:6px 0 14px;letter-spacing:.02em}' +
    '.hf-diya .fl{animation:hfFlick .25s infinite alternate;transform-origin:50% 100%}' +
    '@keyframes hfFlick{from{transform:scale(1,1)}to{transform:scale(.88,1.12)}}' +
    '.hf-bulb{animation:hfTw 1.4s infinite alternate}@keyframes hfTw{from{opacity:.35}to{opacity:1}}' +
    '@media (prefers-reduced-motion:reduce){.hf-owl,.hf-owl .lid,.hf-diya .fl,.hf-bulb{animation:none}}';
  document.head.appendChild(css);

  function ready(fn) { if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', fn); else fn(); }
  function ls(k, v) { try { if (v === undefined) return localStorage.getItem(k); localStorage.setItem(k, v); } catch (e) { return null; } }

  /* ── 1. Dusty tiles ── */
  var DUST_DAYS = 5;
  var WEB = '<svg viewBox="0 0 46 46" fill="none" stroke="rgba(235,235,235,.8)" stroke-width=".8"><path d="M46 0 8 0M46 0 46 38M46 0 14 20M46 0 26 32M46 0 34 10"/><path d="M38 0q2 6 8 8M29 0q3 12 17 17M20 0q4 18 26 26"/></svg>';
  function dustTiles() {
    var now = Date.now();
    document.querySelectorAll('.choice[data-page]').forEach(function (a) {
      if (a.hidden || a._hf) return; a._hf = true;
      var key = 'aj_tile_' + (a.getAttribute('href') || a.dataset.page), last = Number(ls(key)) || 0;
      if (!last) ls(key, String(now)); // start the clock the first time we see this tile
      var dusty = Q === 'dust' || (last && now - last > DUST_DAYS * 864e5);
      var d = null;
      if (dusty) { d = document.createElement('span'); d.className = 'hf-dust'; d.innerHTML = WEB; a.appendChild(d); }
      a.addEventListener('click', function (ev) {
        ls(key, String(Date.now()));
        if (!d || d.classList.contains('gone')) return;
        ev.preventDefault();
        puff(a); d.classList.add('gone');
        var href = a.href; setTimeout(function () { location.href = href; }, reduce ? 0 : 520);
      });
    });
  }
  function puff(el) {
    if (reduce) return;
    var r = el.getBoundingClientRect();
    for (var i = 0; i < 16; i++) {
      var p = document.createElement('i'); p.className = 'hf-puff';
      var px = r.left + r.width * Math.random(), py = r.top + r.height * Math.random();
      p.style.left = px + 'px'; p.style.top = py + 'px'; document.body.appendChild(p);
      (function (p) { requestAnimationFrame(function () { p.style.transform = 'translate(' + ((Math.random() - .5) * 120) + 'px,' + (-30 - Math.random() * 90) + 'px) scale(' + (1.5 + Math.random() * 2) + ')'; p.style.opacity = 0; }); setTimeout(function () { p.remove(); }, 700); })(p);
    }
  }

  /* ── 2. Rain on the glass (live Melur weather) ── */
  var WX = 'https://api.open-meteo.com/v1/forecast?latitude=10.0313&longitude=78.3381&current=weather_code&timezone=Asia%2FKolkata';
  function rainy(c) { return (c >= 51 && c <= 67) || (c >= 80 && c <= 82) || c >= 95; }
  function checkRain() {
    if (Q === 'rain') return rainGlass(1);
    if (Q) return;
    fetch(WX).then(function (r) { return r.json(); }).then(function (j) { var c = j && j.current && j.current.weather_code; if (rainy(c)) rainGlass(c >= 61 ? 1 : .6); }).catch(function () {});
  }
  function rainGlass(heavy) {
    var cv = document.createElement('canvas');
    cv.style.cssText = 'position:fixed;inset:0;width:100vw;height:100vh;pointer-events:none;z-index:9950';
    document.body.appendChild(cv);
    var x = cv.getContext('2d'), W, H, drops = [], last = 0;
    function size() { var d = window.devicePixelRatio || 1; W = innerWidth; H = innerHeight; cv.width = W * d; cv.height = H * d; x.setTransform(d, 0, 0, d, 0, 0); }
    size(); addEventListener('resize', size);
    function drop() { return { x: Math.random() * W, y: Math.random() * H, r: 2 + Math.random() * 4.5, v: 0, slide: Math.random() < .25, trail: [] }; }
    var N = Math.round(40 * heavy); for (var i = 0; i < N; i++) drops.push(drop());
    function wipe(px, py) { drops = drops.filter(function (d) { return Math.hypot(d.x - px, d.y - py) > 46; }); }
    document.addEventListener('touchmove', function (e) { var t = e.touches[0]; if (t) wipe(t.clientX, t.clientY); }, { passive: true });
    document.addEventListener('mousemove', function (e) { if (e.buttons) wipe(e.clientX, e.clientY); });
    function draw(d) {
      d.trail.forEach(function (t, k) { x.fillStyle = 'rgba(200,220,240,' + (.08 * k / d.trail.length) + ')'; x.beginPath(); x.arc(t[0], t[1], d.r * .45, 0, 7); x.fill(); });
      var g = x.createRadialGradient(d.x - d.r * .35, d.y - d.r * .4, d.r * .1, d.x, d.y, d.r);
      g.addColorStop(0, 'rgba(255,255,255,.55)'); g.addColorStop(.6, 'rgba(190,210,235,.18)'); g.addColorStop(1, 'rgba(120,140,170,.35)');
      x.fillStyle = g; x.beginPath(); x.ellipse(d.x, d.y, d.r * .9, d.r, 0, 0, 7); x.fill();
    }
    (function frame(now) {
      if (document.hidden) { requestAnimationFrame(frame); return; }
      if (now - last < 33) { requestAnimationFrame(frame); return; } last = now; // ~30 fps
      x.clearRect(0, 0, W, H);
      drops.forEach(function (d) {
        if (!reduce && (d.slide || Math.random() < .002)) { d.slide = true; d.v = Math.min(5, d.v + .06 * d.r / 3); d.y += d.v; d.x += Math.sin(d.y / 30) * .3; d.trail.push([d.x, d.y]); if (d.trail.length > 14) d.trail.shift(); }
        draw(d);
      });
      drops = drops.filter(function (d) { return d.y < H + 10; });
      while (drops.length < N && Math.random() < .08) { var nd = drop(); nd.y = Math.random() * H * .4; drops.push(nd); } // fresh drops keep landing
      requestAnimationFrame(frame);
    })(0);
  }

  /* ── 3. Night owl ── */
  function owl() {
    var h = new Date().getHours();
    if (Q !== 'owl' && (Q || !(h >= 22 || h < 5))) return;
    try { if (sessionStorage.getItem('aj_owl_off')) return; } catch (e) {}
    var o = document.createElement('div'); o.className = 'hf-owl'; o.title = 'Tap to send the owl to sleep';
    o.innerHTML = '<div class="bub">இரவு வணக்கம் 🌙</div>' +
      '<svg width="64" height="74" viewBox="0 0 64 74"><path d="M14 14 9 3l12 7M50 14l5-11-12 7" fill="#6b5132"/>' +
      '<ellipse cx="32" cy="42" rx="24" ry="28" fill="#7a5c3a"/><ellipse cx="32" cy="50" rx="15" ry="18" fill="#c9a77a"/>' +
      '<path d="M22 46q4 3 8 0M34 52q4 3 8 0M24 58q4 3 8 0" stroke="#9c7a52" stroke-width="1.4" fill="none"/>' +
      '<circle cx="22" cy="26" r="10" fill="#f4ead8"/><circle cx="42" cy="26" r="10" fill="#f4ead8"/>' +
      '<circle cx="22" cy="26" r="5.5" fill="#1a1208"/><circle cx="42" cy="26" r="5.5" fill="#1a1208"/><circle cx="20.5" cy="24.5" r="1.6" fill="#fff"/><circle cx="40.5" cy="24.5" r="1.6" fill="#fff"/>' +
      '<g class="lid"><rect x="11" y="15" width="22" height="22" rx="11" fill="#7a5c3a"/><rect x="31" y="15" width="22" height="22" rx="11" fill="#7a5c3a"/></g>' +
      '<path d="M29 32h6l-3 6z" fill="#e0a43a"/><path d="M20 70h8M36 70h8" stroke="#e0a43a" stroke-width="3" stroke-linecap="round"/></svg>';
    o.onclick = function () { try { sessionStorage.setItem('aj_owl_off', '1'); } catch (e) {} o.style.transition = 'opacity .4s,transform .4s'; o.style.opacity = 0; o.style.transform = 'translateY(20px)'; setTimeout(function () { o.remove(); }, 450); };
    document.body.appendChild(o);
  }

  /* ── 4. Festivals ── (MM-DD = every year; YYYY-MM-DD = that year only — add next year's moving dates here) */
  var FESTIVALS = {
    '01-01': ['newyear', 'இனிய புத்தாண்டு நல்வாழ்த்துகள்'],
    '01-26': ['tricolor', 'குடியரசு தின வாழ்த்துகள்'],
    '04-14': ['kolam', 'இனிய தமிழ்ப் புத்தாண்டு நல்வாழ்த்துகள்'],
    '08-15': ['tricolor', 'சுதந்திர தின வாழ்த்துகள்'],
    '12-25': ['star', 'இனிய கிறிஸ்துமஸ் வாழ்த்துகள்'],
    '2027-01-14': ['pongal', 'போகிப் பண்டிகை வாழ்த்துகள்'],
    '2027-01-15': ['pongal', 'இனிய பொங்கல் நல்வாழ்த்துகள்'],
    '2027-01-16': ['pongal', 'மாட்டுப் பொங்கல் வாழ்த்துகள்'],
    '2027-10-28': ['diya', 'இனிய தீபாவளி நல்வாழ்த்துகள்'],
    '2027-12-12': ['diya', 'கார்த்திகை தீப வாழ்த்துகள்'],
  };
  function festival() {
    var d = new Date(), md = String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
    var f = FESTIVALS[d.getFullYear() + '-' + md] || FESTIVALS[md];
    if (['pongal', 'diya', 'kolam', 'tricolor', 'star', 'newyear'].indexOf(Q) >= 0) f = [Q, { pongal: 'இனிய பொங்கல் நல்வாழ்த்துகள்', diya: 'இனிய தீபாவளி நல்வாழ்த்துகள்', kolam: 'இனிய தமிழ்ப் புத்தாண்டு நல்வாழ்த்துகள்', tricolor: 'குடியரசு தின வாழ்த்துகள்', star: 'இனிய கிறிஸ்துமஸ் வாழ்த்துகள்', newyear: 'இனிய புத்தாண்டு நல்வாழ்த்துகள்' }[Q]];
    else if (Q) return;
    if (!f) return;
    var kind = f[0];
    var msg = document.createElement('div'); msg.className = 'hf-fest-msg'; msg.textContent = f[1];
    var w = document.querySelector('.welcome'); if (w) w.after(msg);
    var el = document.createElement('div'); el.className = 'hf-fest';
    if (kind === 'diya') {
      el.style.bottom = 'env(safe-area-inset-bottom,0px)'; el.className += ' hf-diya';
      var n = Math.max(5, Math.min(11, Math.floor(innerWidth / 60))), s = '';
      for (var i = 0; i < n; i++) s += '<svg width="44" height="44" viewBox="0 0 44 44"><path class="fl" style="animation-delay:' + (i * .07) + 's" d="M22 4q6 9 0 16q-6-7 0-16z" fill="#ffb627"/><path d="M22 10q2.5 4 0 8q-2.5-4 0-8z" fill="#fff1a8"/><path d="M4 24q18 18 36 0z" fill="#c2552d"/><path d="M4 24h36" stroke="#8a3a1c" stroke-width="2"/></svg>';
      el.innerHTML = '<div style="display:flex;justify-content:space-around;padding:0 6px 6px">' + s + '</div>';
    } else if (kind === 'pongal') {
      el.style.bottom = 'env(safe-area-inset-bottom,0px)'; el.style.display = 'flex'; el.style.justifyContent = 'center';
      el.innerHTML = "<svg width=\"230\" height=\"210\" viewBox=\"0 0 230 210\"><defs><radialGradient id=\"pgSun\" cx=\"50%\" cy=\"50%\" r=\"50%\"><stop offset=\"0\" stop-color=\"#fff3b0\"/><stop offset=\".55\" stop-color=\"#ffc93c\"/><stop offset=\"1\" stop-color=\"#ff8a00\" stop-opacity=\"0\"/></radialGradient><linearGradient id=\"pgPot\" x1=\"0\" x2=\"1\"><stop offset=\"0\" stop-color=\"#9c3d12\"/><stop offset=\".35\" stop-color=\"#e2762b\"/><stop offset=\".6\" stop-color=\"#f5a04a\"/><stop offset=\"1\" stop-color=\"#8a3410\"/></linearGradient><linearGradient id=\"pgCane\" x1=\"0\" x2=\"1\"><stop offset=\"0\" stop-color=\"#3d1d4f\"/><stop offset=\".5\" stop-color=\"#7b3f8f\"/><stop offset=\"1\" stop-color=\"#3d1d4f\"/></linearGradient><linearGradient id=\"pgLeaf\" x1=\"0\" y1=\"0\" x2=\"0\" y2=\"1\"><stop offset=\"0\" stop-color=\"#9be15d\"/><stop offset=\"1\" stop-color=\"#2e8b3a\"/></linearGradient></defs><circle cx=\"115\" cy=\"78\" r=\"70\" fill=\"url(#pgSun)\"/><g stroke=\"#ffd166\" stroke-width=\"2.5\" stroke-linecap=\"round\" opacity=\".55\"><path d=\"M115 2v14M60 22l9 10M170 22l-9 10M38 70h14M178 70h14\"/></g><g><path d=\"M40 205 92 40\" stroke=\"url(#pgCane)\" stroke-width=\"9\" stroke-linecap=\"round\"/><path d=\"M40 205 92 40\" stroke=\"#c9a2d6\" stroke-width=\"9\" stroke-dasharray=\"1.5 20\" stroke-linecap=\"butt\"/><path d=\"M92 40q-30-6-46 14q22-2 46-14zM92 40q10-26 34-30q-12 20-34 30zM92 40q-26-22-48-16q24 10 48 16z\" fill=\"url(#pgLeaf)\"/><path d=\"M190 205 138 40\" stroke=\"url(#pgCane)\" stroke-width=\"9\" stroke-linecap=\"round\"/><path d=\"M190 205 138 40\" stroke=\"#c9a2d6\" stroke-width=\"9\" stroke-dasharray=\"1.5 20\" stroke-linecap=\"butt\"/><path d=\"M138 40q30-6 46 14q-22-2-46-14zM138 40q-10-26-34-30q12 20 34 30zM138 40q26-22 48-16q-24 10-48 16z\" fill=\"url(#pgLeaf)\"/></g><g><ellipse cx=\"115\" cy=\"190\" rx=\"98\" ry=\"16\" fill=\"#1d2433\" opacity=\".6\"/><g fill=\"none\" stroke-width=\"3\"><ellipse cx=\"115\" cy=\"190\" rx=\"92\" ry=\"14\" stroke=\"#ff4d8d\"/><ellipse cx=\"115\" cy=\"190\" rx=\"76\" ry=\"10\" stroke=\"#ffd166\"/><ellipse cx=\"115\" cy=\"190\" rx=\"58\" ry=\"7\" stroke=\"#4cc9f0\"/></g><g fill=\"#fff\"><circle cx=\"35\" cy=\"190\" r=\"2\"/><circle cx=\"195\" cy=\"190\" r=\"2\"/><circle cx=\"62\" cy=\"181\" r=\"1.8\"/><circle cx=\"168\" cy=\"181\" r=\"1.8\"/><circle cx=\"62\" cy=\"199\" r=\"1.8\"/><circle cx=\"168\" cy=\"199\" r=\"1.8\"/></g><g fill=\"#ff8c42\"><path d=\"M24 190l8-5 8 5-8 5z\"/><path d=\"M190 190l8-5 8 5-8 5z\"/></g></g><path d=\"M70 120q-8 54 45 66q53-12 45-66z\" fill=\"url(#pgPot)\"/><path d=\"M73 138q42 14 84 0\" stroke=\"#ffd166\" stroke-width=\"6\" fill=\"none\"/><path d=\"M73 138q42 14 84 0\" stroke=\"#d62828\" stroke-width=\"2\" fill=\"none\" stroke-dasharray=\"6 5\"/><g fill=\"#fff\"><circle cx=\"90\" cy=\"158\" r=\"2.2\"/><circle cx=\"105\" cy=\"164\" r=\"2.2\"/><circle cx=\"125\" cy=\"164\" r=\"2.2\"/><circle cx=\"140\" cy=\"158\" r=\"2.2\"/><circle cx=\"115\" cy=\"170\" r=\"2.2\"/></g><path d=\"M98 158q8-8 17 0q9-8 17 0q-8 10-17 12q-9-2-17-12z\" fill=\"none\" stroke=\"#fff\" stroke-width=\"1.4\"/><ellipse cx=\"115\" cy=\"120\" rx=\"46\" ry=\"10\" fill=\"#7a2c0c\"/><path d=\"M72 118q-4-14 10-14q2-14 16-8q6-12 18-4q10-12 20 0q14-6 16 8q14 0 10 14q4 6-6 6q-6 10-10 0q-8 8-14 0q-8 8-14 0q-8 8-14 0q-6 10-12 0q-12 2-10-6z\" fill=\"#fffaf0\"/><path d=\"M80 124q-2 12 3 14q4-2 1-14zM146 124q2 12-3 14q-4-2-1-14zM112 126q-1 9 3 11q3-2 1-11z\" fill=\"#fffaf0\"/><circle cx=\"92\" cy=\"98\" r=\"5\" fill=\"#fffaf0\"/><circle cx=\"132\" cy=\"94\" r=\"4\" fill=\"#fffaf0\"/><circle cx=\"112\" cy=\"86\" r=\"3.5\" fill=\"#fffaf0\"/><g><path d=\"M68 116q-16-20-6-36q8 18 10 34z\" fill=\"url(#pgLeaf)\"/><path d=\"M162 116q16-20 6-36q-8 18-10 34z\" fill=\"url(#pgLeaf)\"/><path d=\"M64 114q-10-8-22-4q10 8 22 8z\" fill=\"url(#pgLeaf)\"/><ellipse cx=\"66\" cy=\"118\" rx=\"7\" ry=\"4\" fill=\"#e9b949\" transform=\"rotate(-20 66 118)\"/></g><g fill=\"#fff\"><path d=\"M28 60l2 6 6 2-6 2-2 6-2-6-6-2 6-2z\" opacity=\".8\"/><path d=\"M200 100l1.6 4.4 4.4 1.6-4.4 1.6-1.6 4.4-1.6-4.4-4.4-1.6 4.4-1.6z\" opacity=\".7\"/></g></svg>";
    } else if (kind === 'kolam') {
      // Tamil New Year: mango-leaf thoranam with marigolds across the top + a colourful rangoli with a lit diya at the bottom
      var TW = innerWidth, th = '<defs><linearGradient id="tnLeaf" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#7ed957"/><stop offset="1" stop-color="#1f7a33"/></linearGradient><radialGradient id="tnMari"><stop offset="0" stop-color="#ffe14d"/><stop offset=".6" stop-color="#ff9f1c"/><stop offset="1" stop-color="#e86a00"/></radialGradient></defs>';
      th += '<path d="M0 6 Q ' + TW / 2 + ' 22 ' + TW + ' 6" stroke="#c9a227" stroke-width="2" fill="none"/>';
      for (var tx = 14, ti = 0; tx < TW; tx += 26, ti++) {
        var ty = 6 + 16 * (1 - Math.pow((tx - TW / 2) / (TW / 2), 2));
        th += ti % 2 ? '<g transform="translate(' + tx + ' ' + ty + ')"><circle r="8" fill="url(#tnMari)"/><circle r="3" fill="#c84b00"/></g>'
                     : '<path transform="translate(' + tx + ' ' + ty + ')" d="M0 0q9 14 0 34q-9-20 0-34z" fill="url(#tnLeaf)"/><path transform="translate(' + tx + ' ' + ty + ')" d="M0 2v30" stroke="#145a24" stroke-width=".8"/>';
      }
      var top = document.createElement('div'); top.className = 'hf-fest'; top.style.top = 'env(safe-area-inset-top,0px)';
      top.innerHTML = '<svg width="100%" height="60">' + th + '</svg>';
      document.body.appendChild(top);
      var rg = '<svg width="200" height="200" viewBox="-100 -100 200 200">', pc = ['#ff4d8d', '#ff9f1c', '#ffd23f', '#3bceac', '#4cc9f0', '#9b5de5'];
      for (var p1 = 0; p1 < 12; p1++) rg += '<path transform="rotate(' + p1 * 30 + ')" d="M0-92q18 24 0 46q-18-22 0-46z" fill="' + pc[p1 % 6] + '"/>';
      rg += '<circle r="48" fill="#1b2232" stroke="#fff" stroke-width="2" stroke-dasharray="2 5"/>';
      for (var p2 = 0; p2 < 8; p2++) rg += '<path transform="rotate(' + (p2 * 45 + 22.5) + ')" d="M0-46q12 14 0 28q-12-14 0-28z" fill="' + pc[(p2 + 2) % 6] + '"/>';
      for (var p3 = 0; p3 < 16; p3++) rg += '<circle transform="rotate(' + p3 * 22.5 + ')" cy="-58" r="2.6" fill="#fff"/>';
      rg += '<circle r="16" fill="#ffd23f"/><circle r="11" fill="#ff4d8d"/>' +
        '<path d="M-10 4q10 10 20 0z" fill="#c2552d"/><path class="fl" d="M0-14q5 7 0 14q-5-7 0-14z" fill="#ffb627"/></svg>';
      el.style.bottom = 'env(safe-area-inset-bottom,0px)'; el.style.display = 'flex'; el.style.justifyContent = 'center'; el.className += ' hf-diya';
      el.innerHTML = rg;
    } else if (kind === 'tricolor') {
      el.style.top = '0';
      el.innerHTML = '<div style="height:5px;background:#ff9933"></div><div style="height:5px;background:#fff"></div><div style="height:5px;background:#138808"></div>' +
        '<svg width="56" height="64" viewBox="0 0 56 64" style="position:absolute;right:calc(16px + env(safe-area-inset-right,0px));top:calc(20px + env(safe-area-inset-top,0px))"><path d="M6 4v60" stroke="#aaa" stroke-width="3"/><rect x="8" y="4" width="44" height="10" fill="#ff9933"/><rect x="8" y="14" width="44" height="10" fill="#fff"/><rect x="8" y="24" width="44" height="10" fill="#138808"/><circle cx="30" cy="19" r="3.6" fill="none" stroke="#000080" stroke-width="1"/></svg>';
    } else if (kind === 'star' || kind === 'newyear') {
      el.style.top = 'env(safe-area-inset-top,0px)';
      var cols = ['#ff5d5d', '#ffd166', '#06d6a0', '#4cc9f0', '#f72585'], b = '';
      var m = Math.floor(innerWidth / 34);
      for (var k = 0; k < m; k++) b += '<circle class="hf-bulb" style="animation-delay:' + (k % 5) * .28 + 's" cx="' + (17 + k * 34) + '" cy="' + (16 + Math.sin(k) * 5) + '" r="5" fill="' + cols[k % 5] + '"/>';
      el.innerHTML = '<svg width="100%" height="34"><path d="M0 12 Q ' + innerWidth / 4 + ' 26 ' + innerWidth / 2 + ' 12 T ' + innerWidth + ' 12" stroke="rgba(255,255,255,.35)" fill="none"/>' + b + '</svg>' +
        (kind === 'star' ? '<svg width="54" height="54" viewBox="0 0 24 24" style="position:absolute;right:14px;top:34px"><path d="M12 2l2.9 6.3 6.9.7-5.2 4.6 1.5 6.8L12 17l-6.1 3.4 1.5-6.8L2.2 9l6.9-.7z" fill="#ffd166" stroke="#f4a261"/></svg>' : '');
    }
    document.body.appendChild(el);
  }

  ready(function () {
    // tiles are shown/hidden by home's own access check — dust only what's visible, once that's done
    var tries = 0;
    (function wait() { var ch = document.getElementById('chooser'); if (ch && ch.classList.contains('ready')) dustTiles(); else if (tries++ < 50) setTimeout(wait, 100); })();
    checkRain(); owl(); festival();
  });
})();
