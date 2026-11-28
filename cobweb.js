/* Home — away 14+ hours? A strong cobweb spins across the top-right of the screen and a
   house spider drops on one thread. One tap sweeps it off and the spider climbs back up.
   "Away" = time since the app was last hidden/closed (auth.js stamps aj_last_active). */
(function () {
  'use strict';
  var AWAY_MS = 14 * 60 * 60 * 1000, KEY = 'aj_last_active';
  var reduce = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;
  var shown = false;

  function lastActive() { try { return Number(localStorage.getItem(KEY)) || 0; } catch (e) { return 0; } }
  function check() {
    if (shown || document.hidden) return;
    var last = lastActive();
    if ((last && Date.now() - last >= AWAY_MS) || /[?&]cobweb=1\b/.test(location.search)) show(); // ?cobweb=1 = try it now
  }

  function show() {
    shown = true;
    var cv = document.createElement('canvas');
    cv.setAttribute('aria-label', 'Cobwebs on the screen. Tap to clear.');
    cv.style.cssText = 'position:fixed;inset:0;width:100vw;height:100vh;z-index:9990;cursor:pointer;touch-action:manipulation';
    var hint = document.createElement('div');
    hint.textContent = 'Tap anywhere to clear the cobwebs';
    hint.style.cssText = 'position:fixed;left:0;right:0;bottom:calc(26px + env(safe-area-inset-bottom,0px));z-index:9991;text-align:center;font:600 13px Inter,system-ui,sans-serif;letter-spacing:.04em;color:rgba(232,237,244,.8);opacity:0;transition:opacity .5s;pointer-events:none';
    document.body.appendChild(cv); document.body.appendChild(hint);
    var x = cv.getContext('2d'), W = 0, H = 0, web, spider, state = 'build', t0 = performance.now(), clearAt = 0;

    function size() {
      var d = window.devicePixelRatio || 1; W = innerWidth; H = innerHeight;
      cv.width = W * d; cv.height = H * d; x.setTransform(d, 0, 0, d, 0, 0);
      var R = Math.min(W, H) * 0.95, sp = [];
      for (var i = 0; i < 12; i++) sp.push({ a: Math.PI / 2 + (Math.PI / 2) * (i / 11) + (Math.random() - .5) * .06, r: R * (.85 + Math.random() * .25) });
      web = { cx: W, cy: 0, sp: sp, rings: 14 };
      spider = spider || { x: W * .7, y: -40, target: H * .42, vy: 0 };
      spider.x = W * .7; spider.target = Math.min(H * .42, 360);
    }
    size(); addEventListener('resize', size);

    function drawWeb(p, fade) {
      var w = web, spn = Math.min(1, p / .35), rg = Math.max(0, (p - .3) / .7);
      x.lineWidth = 1.6; x.strokeStyle = 'rgba(230,235,245,' + (.78 * fade) + ')'; x.shadowColor = 'rgba(255,255,255,.35)'; x.shadowBlur = 3;
      x.beginPath();
      w.sp.forEach(function (s) { x.moveTo(w.cx, w.cy); x.lineTo(w.cx + Math.cos(s.a) * s.r * spn, w.cy + Math.sin(s.a) * s.r * spn); });
      x.stroke();
      var shownRings = rg * w.rings;
      x.lineWidth = 1.25; x.strokeStyle = 'rgba(230,235,245,' + (.68 * fade) + ')';
      for (var k = 0; k < Math.ceil(shownRings); k++) {
        var frac = 1 - (k + 1) / (w.rings + 1), part = Math.min(1, shownRings - k), n = Math.max(2, Math.ceil((w.sp.length - 1) * part) + 1);
        x.beginPath();
        for (var i = 0; i < n; i++) {
          var s = w.sp[i], rr = s.r * frac, px = w.cx + Math.cos(s.a) * rr, py = w.cy + Math.sin(s.a) * rr;
          if (!i) { x.moveTo(px, py); continue; }
          var q = w.sp[i - 1], mr = (rr + q.r * frac) / 2 * .9, ma = (s.a + q.a) / 2; // threads sag toward the corner
          x.quadraticCurveTo(w.cx + Math.cos(ma) * mr, w.cy + Math.sin(ma) * mr, px, py);
        }
        x.stroke();
      }
      x.shadowBlur = 0;
      if (p > .9) { x.fillStyle = 'rgba(255,255,255,' + (.8 * fade) + ')'; w.sp.forEach(function (s, i) { if (i % 2) { var rr = s.r * (.35 + (i % 3) * .15); x.beginPath(); x.arc(w.cx + Math.cos(s.a) * rr, w.cy + Math.sin(s.a) * rr, 1.3, 0, 7); x.fill(); } }); }
    }

    function drawSpider(s, fade, el) {
      var sw = Math.sin(el * 1.3) * 6, leg = el * 6;
      x.strokeStyle = 'rgba(235,240,250,' + (.85 * fade) + ')'; x.lineWidth = 1.4;
      x.beginPath(); x.moveTo(s.x, 0); x.lineTo(s.x + sw, s.y - 9); x.stroke();
      x.save(); x.translate(s.x + sw, s.y + 14); x.rotate(sw * .02); x.globalAlpha = fade; x.scale(2.3, 2.3);
      var halo = x.createRadialGradient(0, 2, 2, 0, 2, 22); halo.addColorStop(0, 'rgba(255,240,210,.22)'); halo.addColorStop(1, 'rgba(255,240,210,0)');
      x.fillStyle = halo; x.beginPath(); x.arc(0, 2, 22, 0, 7); x.fill();
      x.lineCap = 'round'; x.lineJoin = 'round';
      [[-1.25, 1.1], [-.55, .95], [.35, .9], [1.0, 1.05]].forEach(function (L, i) {
        [-1, 1].forEach(function (side) {
          var tw = Math.sin(leg * 1.3 + i * 1.7 + (side > 0 ? 0 : 1)) * .07, ox = side * 2.2, oy = -4 + i * 1.6, a1 = L[0] + tw;
          var kx = ox + side * Math.cos(a1) * 7 * L[1], ky = oy + Math.sin(a1) * 7 * L[1] - 4, fx = kx + side * 6 * L[1], fy = ky + 5 + i * 1.2;
          var mx = (kx + fx) / 2 + side * 1.2, my = (ky + fy) / 2 - 1;
          x.strokeStyle = '#3a2a1c'; x.lineWidth = 1.3;
          x.beginPath(); x.moveTo(ox, oy); x.lineTo(kx, ky); x.lineTo(mx, my); x.lineTo(fx, fy); x.stroke();
          x.strokeStyle = 'rgba(214,180,130,.55)'; x.lineWidth = .5;
          x.beginPath(); x.arc(kx, ky, .7, 0, 7); x.arc(mx, my, .6, 0, 7); x.stroke();
        });
      });
      var ab = x.createRadialGradient(-2, 4, 1, 0, 7, 9); ab.addColorStop(0, '#8a6a46'); ab.addColorStop(.55, '#5a4029'); ab.addColorStop(1, '#2a1d12');
      x.fillStyle = ab; x.beginPath(); x.ellipse(0, 7, 6.6, 8.6, 0, 0, 7); x.fill();
      x.strokeStyle = 'rgba(235,205,160,.55)'; x.lineWidth = .7;
      for (var k = 0; k < 4; k++) { var yy = 4 + k * 2.6, w = 3.6 - k * .6; x.beginPath(); x.moveTo(-w, yy - 1); x.lineTo(0, yy + .6); x.lineTo(w, yy - 1); x.stroke(); }
      x.fillStyle = 'rgba(255,255,255,.28)'; x.beginPath(); x.ellipse(-2.4, 3.2, 1.6, 2.4, -.4, 0, 7); x.fill();
      var ce = x.createRadialGradient(-1, -5, .5, 0, -4, 5); ce.addColorStop(0, '#7a5a3a'); ce.addColorStop(1, '#2e2014');
      x.fillStyle = ce; x.beginPath(); x.ellipse(0, -4, 4.2, 4.6, 0, 0, 7); x.fill();
      x.strokeStyle = '#2a1c10'; x.lineWidth = 1;
      x.beginPath(); x.moveTo(-1.4, -8.2); x.lineTo(-2.2, -10.4); x.moveTo(1.4, -8.2); x.lineTo(2.2, -10.4); x.stroke();
      [[-1.6, -6.9, .75], [1.6, -6.9, .75], [-.6, -7.5, .55], [.6, -7.5, .55]].forEach(function (e) {
        x.fillStyle = '#050505'; x.beginPath(); x.arc(e[0], e[1], e[2], 0, 7); x.fill();
        x.fillStyle = 'rgba(255,255,255,.9)'; x.beginPath(); x.arc(e[0] - e[2] * .3, e[1] - e[2] * .3, e[2] * .35, 0, 7); x.fill();
      });
      x.restore(); x.globalAlpha = 1;
    }

    function frame(now) {
      var el = (now - t0) / 1000, fade = state === 'clear' ? Math.max(0, 1 - (now - clearAt) / 700) : 1;
      x.clearRect(0, 0, W, H);
      x.fillStyle = 'rgba(5,7,10,' + (.38 * fade) + ')'; x.fillRect(0, 0, W, H);
      drawWeb(reduce ? 1 : Math.min(1, el / 2.2), fade);
      if (el > 1.4 || reduce) {
        if (state === 'clear') spider.y -= 7; // climbs back up its thread
        else if (reduce) spider.y = spider.target;
        else { spider.vy = (spider.vy + (spider.target - spider.y) * .035) * .86; spider.y += spider.vy; }
        drawSpider(spider, state === 'clear' ? Math.max(0, 1 - (now - clearAt) / 1400) : 1, el);
      }
      if (state === 'build' && el > 2.6) { state = 'idle'; hint.style.opacity = 1; }
      if (state === 'clear' && now - clearAt > 1500) { cv.remove(); hint.remove(); removeEventListener('resize', size); return; }
      requestAnimationFrame(frame);
    }
    cv.addEventListener('click', function () { if (state === 'clear') return; state = 'clear'; clearAt = performance.now(); hint.style.opacity = 0; });
    requestAnimationFrame(frame);
  }

  // opened after 14h, or the app brought back from the background after 14h
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', check); else check();
  // Home has no auth.js, so it stamps "last in use" itself when hidden or left (check runs before the stamp)
  var stamp = function () { try { localStorage.setItem(KEY, String(Date.now())); } catch (e) {} };
  document.addEventListener('visibilitychange', function () { if (!document.hidden) check(); else stamp(); });
  addEventListener('pagehide', stamp);
})();
