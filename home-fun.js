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
      el.style.bottom = 'env(safe-area-inset-bottom,0px)'; el.style.left = 'env(safe-area-inset-left,0px)'; el.style.right = 'auto';
      el.innerHTML = '<svg width="150" height="150" viewBox="0 0 150 150"><path d="M18 150 40 10" stroke="#4d7a2a" stroke-width="7"/><path d="M18 150 40 10" stroke="#7fae4a" stroke-width="7" stroke-dasharray="3 22"/><path d="M40 10q-16 4-26 18M40 10q14 2 24 14" stroke="#5f9a35" stroke-width="4" fill="none"/>' +
        '<path d="M132 150 112 14" stroke="#4d7a2a" stroke-width="7"/><path d="M132 150 112 14" stroke="#7fae4a" stroke-width="7" stroke-dasharray="3 22"/>' +
        '<ellipse cx="75" cy="118" rx="38" ry="30" fill="#c96a2a"/><path d="M45 104q30 10 60 0" stroke="#f2c14e" stroke-width="5" fill="none"/><path d="M50 116q25 8 50 0" stroke="#7a2e10" stroke-width="2" fill="none"/>' +
        '<ellipse cx="75" cy="88" rx="30" ry="8" fill="#8a3a1c"/><path d="M50 86q6-20 14-6q6-18 12-2q8-16 12 0q6-14 12 4q4 4-50 4z" fill="#fff8e6"/>' +
        '<circle cx="62" cy="76" r="4" fill="#fff8e6"/><circle cx="84" cy="72" r="3" fill="#fff8e6"/></svg>';
    } else if (kind === 'kolam') {
      el.style.top = 'env(safe-area-inset-top,0px)'; el.style.left = 'env(safe-area-inset-left,0px)'; el.style.right = 'auto';
      var dots = '', loops = '';
      for (var r = 0; r < 4; r++) for (var c = 0; c < 4 - r; c++) { var cx = 18 + c * 26, cy = 18 + r * 26; dots += '<circle cx="' + cx + '" cy="' + cy + '" r="2.4" fill="#fff"/>'; loops += '<path d="M' + cx + ' ' + (cy - 11) + 'q11 0 11 11q0 11-11 11q-11 0-11-11q0-11 11-11z" stroke="#f4efe2" stroke-width="1.6" fill="none"/>'; }
      el.innerHTML = '<svg width="130" height="130" viewBox="0 0 130 130">' + loops + dots + '<circle cx="18" cy="18" r="6" fill="#ff7aa8" opacity=".8"/><circle cx="44" cy="44" r="5" fill="#ffb347" opacity=".8"/></svg>';
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
        (kind === 'star' ? '<svg width="54" height="54" viewBox="0 0 24 24" style="position:absolute;left:50%;transform:translateX(-50%);top:30px"><path d="M12 2l2.9 6.3 6.9.7-5.2 4.6 1.5 6.8L12 17l-6.1 3.4 1.5-6.8L2.2 9l6.9-.7z" fill="#ffd166" stroke="#f4a261"/></svg>' : '');
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
