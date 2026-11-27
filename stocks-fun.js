/* Stocks — fun touches (self-contained: injects its own styles, uses shared.css colours).
   SF.spinAssign(list)            auto-assign: a wheel spins per stock and lands on who was picked → Promise
   SF.doneStamp(el)               Mark Done: a green DONE ✓ stamp slams onto the stock card
   SF.handshake(you, other, what) swap accepted: two cards slide in and shake hands
   SF.swipeable(card, { onRight, onLeft })  swipe a card right / left (swap request: accept / decline)
   SF.flipIn(container)           flip-board: each .team-names flips letters like a departures board, then settles
   SF.shine(el)                   gold shimmer sweep across a card (done on time)
   SF.ring(host, done, total, key) team progress ring; burst once per key when it hits 100%
   SF.leaveFlip(date, who)        calendar page flips to the leave date with an off-day stamp
   SF.nextPeek(label, list)       mini wheel + ranked list of who's likely next for a stock */
(function () {
  'use strict';
  var SF = window.SF = window.SF || {};
  var esc = function (s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); };

  // ── sounds (WebAudio, no files)
  var ac = null;
  function ctx() { try { ac = ac || new (window.AudioContext || window.webkitAudioContext)(); if (ac.state === 'suspended') ac.resume(); return ac; } catch (e) { return null; } }
  function tone(f, f2, dur, vol, type, t) {
    var a = ctx(); if (!a) return;
    var o = a.createOscillator(), g = a.createGain(), s = a.currentTime + (t || 0);
    o.type = type || 'sine'; o.frequency.setValueAtTime(f, s); if (f2) o.frequency.exponentialRampToValueAtTime(f2, s + dur);
    g.gain.setValueAtTime(0.0001, s); g.gain.exponentialRampToValueAtTime(vol, s + 0.01); g.gain.exponentialRampToValueAtTime(0.0001, s + dur);
    o.connect(g).connect(a.destination); o.start(s); o.stop(s + dur + 0.02);
  }
  SF.sound = function (n) {
    if (n === 'tick') tone(1800, 0, 0.03, 0.06, 'square');
    else if (n === 'thump') { tone(120, 45, 0.22, 0.5); tone(900, 200, 0.06, 0.08, 'triangle'); }
    else if (n === 'ding') { tone(880, 0, 0.5, 0.12); tone(1320, 0, 0.5, 0.08, 'sine', 0.08); }
    else if (n === 'chime') [523, 659, 784, 1047].forEach(function (f, i) { tone(f, 0, 0.55, 0.11, 'triangle', i * 0.1); });
    else if (n === 'whoosh') tone(700, 180, 0.2, 0.08, 'sawtooth');
  };

  var CSS = '' +
    /* spin wheel */
    '.sf-spin{position:fixed;inset:0;z-index:9000;display:flex;align-items:center;justify-content:center;gap:28px;padding:16px;background:rgba(5,7,10,.86);flex-wrap:wrap;opacity:0;transition:opacity .2s;font-family:inherit}' +
    '.sf-spin.in{opacity:1}' +
    '.sf-wl{display:flex;flex-direction:column;align-items:center;gap:12px}' +
    '.sf-stock{color:#d4af37;font-size:20px;font-weight:800;letter-spacing:.04em;text-align:center;min-height:26px}' +
    '.sf-wheel{position:relative;width:min(340px,80vw);height:min(340px,80vw)}' +
    '.sf-wheel svg{width:100%;height:100%;display:block;filter:drop-shadow(0 12px 30px rgba(0,0,0,.5))}' +
    '.sf-rot{transform-origin:0 0;transform-box:view-box}' +
    '.sf-ptr{position:absolute;left:50%;top:-6px;width:0;height:0;margin-left:-14px;border:14px solid transparent;border-top:26px solid #fff;filter:drop-shadow(0 2px 3px rgba(0,0,0,.5));z-index:2}' +
    '.sf-hub{position:absolute;left:50%;top:50%;width:54px;height:54px;margin:-27px 0 0 -27px;border-radius:50%;background:#0d1117;border:4px solid #d4af37;display:flex;align-items:center;justify-content:center;font-size:22px}' +
    '.sf-won{color:#fff;font-size:22px;font-weight:800;min-height:30px;text-align:center}' +
    '.sf-list{width:min(320px,90vw);max-height:70vh;overflow:auto;background:var(--panel,#131922);border:1px solid var(--border,#222d3d);border-radius:14px;padding:12px}' +
    '.sf-list h3{margin:0 0 8px;font-size:12px;letter-spacing:.1em;text-transform:uppercase;color:var(--text-dim,#8b98a8)}' +
    '.sf-li{display:flex;justify-content:space-between;gap:10px;padding:7px 4px;border-bottom:1px solid var(--border,#222d3d);font-size:13px;color:var(--text,#e6edf3);animation:sfIn .3s ease both}' +
    '.sf-li b{color:#d4af37;text-align:right}' +
    '@keyframes sfIn{from{opacity:0;transform:translateX(-10px)}}' +
    '.sf-btns{display:flex;gap:10px;margin-top:10px}' +
    '.sf-btn{flex:1;border:0;border-radius:10px;padding:10px;font:700 14px inherit;font-family:inherit;cursor:pointer;background:var(--panel-elev,#1a2230);color:var(--text,#e6edf3)}' +
    '.sf-btn.gold{background:linear-gradient(135deg,#d4af37,#9c7c1a);color:#0d1117}' +
    /* done stamp */
    '.sf-stamp{position:absolute;left:50%;top:50%;z-index:5;pointer-events:none;padding:3px 12px;border:4px double #2ecc71;border-radius:8px;color:#2ecc71;font:900 22px/1 Georgia,serif;letter-spacing:.06em;background:rgba(13,17,23,.55);white-space:nowrap}' +
    /* handshake */
    '.sf-hs{position:fixed;inset:0;z-index:9000;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:18px;background:rgba(5,7,10,.78);opacity:0;transition:opacity .25s;cursor:pointer;padding:16px}' +
    '.sf-hs.in{opacity:1}' +
    '.sf-hs-row{display:flex;align-items:center;gap:6px}' +
    '.sf-p{width:min(130px,32vw);padding:16px 10px;border-radius:16px;background:var(--panel,#131922);border:1px solid var(--border,#222d3d);text-align:center;color:var(--text,#e6edf3);box-shadow:0 12px 30px rgba(0,0,0,.4)}' +
    '.sf-p .av{width:52px;height:52px;margin:0 auto 8px;border-radius:50%;background:linear-gradient(135deg,#d4af37,#9c7c1a);color:#0d1117;font-size:22px;font-weight:800;display:flex;align-items:center;justify-content:center}' +
    '.sf-p b{display:block;font-size:14px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}' +
    '.sf-l{animation:sfL .55s cubic-bezier(.2,1.3,.4,1) both}.sf-r{animation:sfR .55s cubic-bezier(.2,1.3,.4,1) both}' +
    '@keyframes sfL{from{transform:translateX(-60vw)}}@keyframes sfR{from{transform:translateX(60vw)}}' +
    '.sf-shake{font-size:56px;animation:sfShake .5s .55s ease-in-out 3 both}' +
    '@keyframes sfShake{0%,100%{transform:translateY(0) scale(1)}50%{transform:translateY(-10px) scale(1.12)}}' +
    '.sf-hs-t{color:#fff;font-size:17px;font-weight:700;text-align:center;max-width:420px;line-height:1.5}.sf-hs-t em{color:#d4af37;font-style:normal}' +
    /* swipe */
    '.sf-swipe{touch-action:pan-y;cursor:grab;will-change:transform;position:relative}' +
    '.sf-sw-tag{position:absolute;top:14px;padding:3px 10px;border:3px solid;border-radius:8px;font:900 18px/1 Georgia,serif;opacity:0;pointer-events:none;z-index:3}' +
    '.sf-sw-tag.y{right:14px;color:#2ecc71;transform:rotate(12deg)}.sf-sw-tag.n{left:14px;color:#ff5d5d;transform:rotate(-12deg)}' +
    '.sf-sw-hint{margin-top:12px;text-align:center;font-size:12px;color:var(--text-dim,#8b98a8)}' +
    /* flip board */
    '.sf-fl{display:inline-block;min-width:.62em;text-align:center;padding:0 1px;margin:0 .5px;border-radius:3px;background:#1a1f27;color:#f8fafc;font-family:ui-monospace,Consolas,monospace;font-weight:800;line-height:1.35}' +
    '.sf-fl.sp{background:none;min-width:.35em}' +
    '.sf-fl.go{animation:sfFlip .05s linear}@keyframes sfFlip{50%{transform:scaleY(.15)}}' +
    /* shine */
    '.sf-shine{position:absolute;inset:0;border-radius:inherit;pointer-events:none;overflow:hidden;z-index:4}' +
    '.sf-shine::before{content:"";position:absolute;top:-20%;bottom:-20%;width:40%;left:-50%;transform:skewX(-20deg);background:linear-gradient(90deg,transparent,rgba(255,226,140,.65),rgba(255,255,255,.9),rgba(255,226,140,.65),transparent);animation:sfShine 1.1s ease-in-out forwards}' +
    '@keyframes sfShine{to{left:130%}}' +
    '.sf-shone{box-shadow:0 0 0 1.5px #d4af37,0 0 18px rgba(212,175,55,.45)!important;transition:box-shadow .4s}' +
    /* ring */
    '.sf-ring{position:relative;width:46px;height:46px;flex:none;cursor:default}' +
    '.sf-ring svg{width:100%;height:100%;transform:rotate(-90deg)}' +
    '.sf-ring .tr{fill:none;stroke:var(--border,#222d3d);stroke-width:4}' +
    '.sf-ring .fl{fill:none;stroke:#d4af37;stroke-width:4;stroke-linecap:round;transition:stroke-dashoffset .8s cubic-bezier(.3,1.2,.5,1),stroke .3s}' +
    '.sf-ring.full .fl{stroke:#2ecc71}' +
    '.sf-ring span{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;font-size:10.5px;font-weight:800;color:var(--text,#e6edf3)}' +
    '.sf-burst{position:absolute;left:50%;top:50%;width:0;height:0;pointer-events:none}' +
    '.sf-burst i{position:absolute;width:5px;height:5px;margin:-2.5px;border-radius:50%;background:var(--c);animation:sfBurst .9s ease-out forwards;transform:rotate(var(--a)) translateX(0)}' +
    '@keyframes sfBurst{to{transform:rotate(var(--a)) translateX(42px);opacity:0}}' +
    /* leave calendar */
    '.sf-cal{position:fixed;inset:0;z-index:9000;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:14px;background:rgba(5,7,10,.72);opacity:0;transition:opacity .25s;cursor:pointer}' +
    '.sf-cal.in{opacity:1}' +
    '.sf-cal-pad{position:relative;width:190px;height:210px;perspective:700px}' +
    '.sf-cal-rings{position:absolute;left:0;right:0;top:-8px;display:flex;justify-content:space-around;z-index:5}.sf-cal-rings i{width:12px;height:24px;border-radius:6px;background:#9aa0ad;border:2px solid #4b5563}' +
    '.sf-cal-old,.sf-cal-page{position:absolute;inset:0;border-radius:14px;background:#fff;box-shadow:0 14px 36px rgba(0,0,0,.45);overflow:hidden;text-align:center;color:#1f2937}' +
    '.sf-cal-old{background:#f3f4f6;transform-origin:50% 0;animation:sfCalOff .6s .3s ease-in forwards;z-index:3}' +
    '@keyframes sfCalOff{to{transform:rotateX(110deg);opacity:0}}' +
    '.sf-cal .m{background:#dc2626;color:#fff;font:800 15px system-ui,sans-serif;letter-spacing:.14em;padding:12px 0 10px}' +
    '.sf-cal .d{font:900 84px/1.1 Georgia,serif;margin-top:6px}.sf-cal .w{font:700 14px system-ui,sans-serif;color:#6b7280}' +
    '.sf-cal-old .m{background:#9ca3af}' +
    '.sf-cal-stamp{position:absolute;left:50%;top:84%;z-index:6;padding:4px 12px;border:4px double #16a34a;border-radius:8px;color:#16a34a;font:900 18px/1 Georgia,serif;white-space:nowrap;background:rgba(255,255,255,.85);opacity:0;transform:translate(-50%,-50%) rotate(-12deg) scale(2.4);animation:sfCalStamp .35s .85s cubic-bezier(.2,.8,.3,1.3) forwards}' +
    '@keyframes sfCalStamp{to{opacity:1;transform:translate(-50%,-50%) rotate(-12deg) scale(1)}}' +
    '.sf-cal-who{color:#fff;font-size:16px;font-weight:700;text-align:center;max-width:90vw}' +
    /* next peek */
    '.sf-peek{position:fixed;inset:0;z-index:9000;display:flex;align-items:center;justify-content:center;background:rgba(5,7,10,.72);opacity:0;transition:opacity .2s;padding:16px}' +
    '.sf-peek.in{opacity:1}' +
    '.sf-peek-card{position:relative;width:340px;max-width:100%;max-height:90vh;overflow:auto;padding:20px 18px;border-radius:16px;background:var(--panel,#131922);border:1px solid var(--border,#222d3d);color:var(--text,#e6edf3);text-align:center}' +
    '.sf-peek-x{position:absolute;right:10px;top:10px;border:0;background:none;color:var(--text-dim,#8b98a8);font-size:18px;cursor:pointer}' +
    '.sf-peek-h{font-size:11px;font-weight:800;letter-spacing:.1em;text-transform:uppercase;color:#d4af37}.sf-peek-s{font-size:18px;font-weight:800;margin:4px 0 12px}' +
    '.sf-wheel.sm{width:190px;height:190px;margin:0 auto 12px}.sf-wheel.sm .sf-hub{width:40px;height:40px;margin:-20px 0 0 -20px;font-size:16px}' +
    '.sf-peek-l{list-style:none;margin:0;padding:0;text-align:left;counter-reset:n}' +
    '.sf-peek-l li{counter-increment:n;display:flex;justify-content:space-between;gap:10px;padding:7px 8px;border-radius:8px;font-size:13px}' +
    '.sf-peek-l li::before{content:counter(n);width:18px;color:var(--text-dim,#8b98a8);font-weight:700}.sf-peek-l li b{flex:1}.sf-peek-l li span{color:var(--text-dim,#8b98a8)}' +
    '.sf-peek-l li.lit{background:rgba(212,175,55,.16);box-shadow:inset 0 0 0 1px #d4af37}' +
    '.sf-peek-n{margin-top:10px;font-size:11px;color:var(--text-dim,#8b98a8)}';
  function addCss() {
    if (document.getElementById('sfCss')) return;
    var s = document.createElement('style'); s.id = 'sfCss'; s.textContent = CSS; document.head.appendChild(s);
  }

  // ── spin wheel for auto-assign. list: [{ label, names: [eligible], picked: [assigned] }]
  var COLS = ['#d4af37', '#1f2937', '#b8913a', '#374151', '#e8c96a', '#273142'];
  SF.spinAssign = function (list) {
    addCss();
    list = (list || []).filter(function (x) { return x.picked && x.picked.length; });
    if (!list.length) return Promise.resolve();
    return new Promise(function (resolve) {
      var el = document.createElement('div');
      el.className = 'sf-spin';
      el.innerHTML = '<div class="sf-wl"><div class="sf-stock"></div><div class="sf-wheel"><div class="sf-ptr"></div><svg viewBox="-110 -110 220 220"><g class="sf-rot"></g></svg><div class="sf-hub">🎯</div></div><div class="sf-won"></div></div>' +
        '<div class="sf-list"><h3>Assigned</h3><div class="sf-rows"></div><div class="sf-btns"><button type="button" class="sf-btn" data-k="skip">Skip ⏭</button><button type="button" class="sf-btn gold" data-k="done" hidden>Done</button></div></div>';
      document.body.appendChild(el);
      requestAnimationFrame(function () { el.classList.add('in'); });
      var rot = el.querySelector('.sf-rot'), stockEl = el.querySelector('.sf-stock'), won = el.querySelector('.sf-won'), rows = el.querySelector('.sf-rows');
      var i = 0, angle = 0, stop = false, timers = [];
      var later = function (fn, ms) { var t = setTimeout(fn, ms); timers.push(t); return t; };
      function addRow(x) { rows.insertAdjacentHTML('beforeend', '<div class="sf-li"><span>' + esc(x.label) + '</span><b>' + esc(x.picked.join(', ')) + '</b></div>'); rows.parentNode.scrollTop = 1e6; }
      function finish() {
        timers.forEach(clearTimeout);
        if (stop) return; stop = true;
        for (; i < list.length; i++) addRow(list[i]);
        el.querySelector('[data-k=skip]').hidden = true; el.querySelector('[data-k=done]').hidden = false;
        SF.sound('chime');
      }
      function wheel(x) {
        // up to 10 slices, always including whoever was picked
        var names = x.names.filter(function (n) { return x.picked.indexOf(n) === -1; }).slice(0, Math.max(1, 10 - x.picked.length));
        names = names.concat([x.picked[0]]).sort(function () { return Math.random() - 0.5; });
        if (names.length === 1) names.push('—');
        var n = names.length, seg = 360 / n, html = '';
        names.forEach(function (nm, k) {
          var a0 = (k * seg - 90) * Math.PI / 180, a1 = ((k + 1) * seg - 90) * Math.PI / 180, mid = ((k + 0.5) * seg - 90);
          html += '<path d="M0 0 L' + (100 * Math.cos(a0)).toFixed(2) + ' ' + (100 * Math.sin(a0)).toFixed(2) + ' A100 100 0 ' + (seg > 180 ? 1 : 0) + ' 1 ' + (100 * Math.cos(a1)).toFixed(2) + ' ' + (100 * Math.sin(a1)).toFixed(2) + 'Z" fill="' + COLS[k % COLS.length] + '" stroke="#0d1117" stroke-width="1.2"/>' +
            '<text transform="rotate(' + mid.toFixed(1) + ') translate(62 0)" fill="' + (k % 2 ? '#e6edf3' : '#0d1117') + '" font-size="' + (n > 7 ? 9 : 11) + '" font-weight="800" text-anchor="middle" dominant-baseline="middle" font-family="system-ui,sans-serif">' + esc(String(nm).slice(0, 12)) + '</text>';
        });
        rot.innerHTML = html + '<circle r="101" fill="none" stroke="#d4af37" stroke-width="3"/>';
        return { idx: names.indexOf(x.picked[0]), seg: seg };
      }
      function next() {
        if (stop) return;
        if (i >= list.length) return finish();
        var x = list[i], w = wheel(x);
        stockEl.textContent = x.label; won.textContent = '';
        // pointer is at the top: bring the picked slice's centre to 0°
        var target = 360 - (w.idx + 0.5) * w.seg;
        var base = angle - (angle % 360);
        angle = base + 360 * 4 + target;
        rot.style.transition = 'none';
        rot.style.transform = 'rotate(' + (base) + 'deg)';
        void rot.getBoundingClientRect();
        rot.style.transition = 'transform 1.5s cubic-bezier(.12,.8,.22,1)';
        rot.style.transform = 'rotate(' + angle + 'deg)';
        var tk = 0; (function tickTock() { if (stop || tk > 14) return; SF.sound('tick'); tk++; later(tickTock, 40 + tk * tk * 4); })();
        later(function () { won.textContent = '🎉 ' + x.picked.join(', '); SF.sound('ding'); addRow(x); i++; later(next, 650); }, 1550);
      }
      el.querySelector('[data-k=skip]').onclick = finish;
      el.querySelector('[data-k=done]').onclick = function () { el.classList.remove('in'); setTimeout(function () { el.remove(); }, 220); resolve(); };
      next();
    });
  };

  // ── DONE ✓ stamp on a stock card
  SF.doneStamp = function (host) {
    if (!host) return;
    addCss();
    if (getComputedStyle(host).position === 'static') host.style.position = 'relative';
    var s = document.createElement('div');
    s.className = 'sf-stamp'; s.textContent = 'DONE ✓';
    host.appendChild(s);
    s.animate([
      { transform: 'translate(-50%,-50%) rotate(-12deg) scale(2.6)', opacity: 0 },
      { transform: 'translate(-50%,-50%) rotate(-12deg) scale(.92)', opacity: 1, offset: .3 },
      { transform: 'translate(-50%,-50%) rotate(-12deg) scale(1)', opacity: 1, offset: .4 },
      { transform: 'translate(-50%,-50%) rotate(-12deg) scale(1)', opacity: 1, offset: .8 },
      { transform: 'translate(-50%,-50%) rotate(-12deg) scale(1)', opacity: 0 }
    ], { duration: 1500, easing: 'ease-out' }).finished.then(function () { s.remove(); }, function () { s.remove(); });
    setTimeout(function () { SF.sound('thump'); host.animate([{ transform: 'none' }, { transform: 'translateY(2px)' }, { transform: 'none' }], { duration: 160 }); }, 400);
  };

  // ── handshake when a swap is accepted
  SF.handshake = function (you, other, what) {
    addCss();
    var el = document.createElement('div');
    el.className = 'sf-hs';
    var av = function (n) { return esc(String(n || '?').trim().charAt(0).toUpperCase()); };
    el.innerHTML = '<div class="sf-hs-row"><div class="sf-p sf-l"><div class="av">' + av(you) + '</div><b>' + esc(you) + '</b></div><div class="sf-shake">🤝</div><div class="sf-p sf-r"><div class="av">' + av(other) + '</div><b>' + esc(other) + '</b></div></div>' +
      '<div class="sf-hs-t"><em>' + esc(you) + '</em> takes <em>' + esc(what) + '</em> from <em>' + esc(other) + '</em></div>';
    document.body.appendChild(el);
    requestAnimationFrame(function () { el.classList.add('in'); });
    setTimeout(function () { SF.sound('chime'); }, 550);
    var close = function () { el.classList.remove('in'); setTimeout(function () { el.remove(); }, 260); };
    el.onclick = close;
    setTimeout(close, 3200);
  };

  // ── flip board: names flip letter by letter, then the real (styled) names come back
  var FLIP_CH = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  SF.flipIn = function (box) {
    if (!box) return;
    addCss();
    var rows = box.querySelectorAll('.team-names');
    var n = 0;
    rows.forEach(function (el, ri) {
      if (el.dataset.flipping) return;
      var html = el.innerHTML, text = el.textContent.replace(/✓\s*/g, '').trim();
      if (!text) return;
      el.dataset.flipping = '1';
      el.innerHTML = text.split('').map(function (c) { return c === ' ' || c === ',' ? '<span class="sf-fl sp">' + (c === ',' ? ',' : '&nbsp;') + '</span>' : '<span class="sf-fl">' + esc(c) + '</span>'; }).join('');
      var cells = el.querySelectorAll('.sf-fl:not(.sp)'), left = cells.length;
      cells.forEach(function (cell, ci) {
        var target = cell.textContent, spins = 5 + ((Math.random() * 5) | 0) + Math.min(ci, 8), k = 0;
        cell.textContent = FLIP_CH[(Math.random() * 26) | 0];
        setTimeout(function tick() {
          var last = k >= spins;
          cell.textContent = last ? target : FLIP_CH[(Math.random() * 26) | 0];
          cell.classList.remove('go'); void cell.offsetWidth; cell.classList.add('go');
          if (ci % 4 === 0 && n++ % 3 === 0) SF.sound('tick');
          if (last) { if (--left === 0) setTimeout(function () { el.innerHTML = html; delete el.dataset.flipping; }, 250); return; }
          k++; setTimeout(tick, 50);
        }, ri * 110);
      });
    });
  };

  // ── gold shimmer sweep
  SF.shine = function (host) {
    if (!host) return;
    addCss();
    if (getComputedStyle(host).position === 'static') host.style.position = 'relative';
    var s = document.createElement('div'); s.className = 'sf-shine';
    host.appendChild(s);
    host.classList.add('sf-shone');
    setTimeout(function () { s.remove(); }, 1300);
    setTimeout(function () { host.classList.remove('sf-shone'); }, 2600);
  };

  // ── team progress ring
  SF.ring = function (host, done, total, key) {
    if (!host) return;
    addCss();
    var r = 15.5, C = 2 * Math.PI * r, p = total ? done / total : 0;
    if (!host.querySelector('.sf-ring')) host.innerHTML = '<div class="sf-ring" title="Team progress today"><svg viewBox="0 0 36 36"><circle cx="18" cy="18" r="' + r + '" class="tr"/><circle cx="18" cy="18" r="' + r + '" class="fl" stroke-dasharray="' + C.toFixed(2) + '" stroke-dashoffset="' + C.toFixed(2) + '"/></svg><span></span></div>';
    var ring = host.querySelector('.sf-ring');
    ring.querySelector('.fl').style.strokeDashoffset = (C * (1 - p)).toFixed(2);
    ring.querySelector('span').textContent = done + '/' + total;
    ring.classList.toggle('full', total > 0 && done >= total);
    if (total > 0 && done >= total && key) {
      var seen = true; try { seen = localStorage.getItem('sf_ring_' + key) === '1'; localStorage.setItem('sf_ring_' + key, '1'); } catch (e) {}
      if (!seen) {
        SF.sound('chime');
        var b = document.createElement('div'); b.className = 'sf-burst';
        b.innerHTML = Array.from({ length: 14 }, function (_, i) { return '<i style="--a:' + (i * 360 / 14) + 'deg;--c:' + COLS[i % 3 === 0 ? 0 : i % 3 === 1 ? 2 : 4] + '"></i>'; }).join('');
        ring.appendChild(b);
        setTimeout(function () { b.remove(); }, 1100);
      }
    }
  };

  // ── leave: a calendar page flips to the date with an off-day stamp
  SF.leaveFlip = function (date, who) {
    if (!date) return;
    addCss();
    var d = new Date(date + 'T12:00:00');
    if (isNaN(d)) return;
    var el = document.createElement('div');
    el.className = 'sf-cal';
    el.innerHTML = '<div class="sf-cal-pad"><div class="sf-cal-rings"><i></i><i></i></div>' +
      '<div class="sf-cal-old"><div class="m"></div><div class="d"></div></div>' +
      '<div class="sf-cal-page"><div class="m">' + esc(d.toLocaleDateString('en-GB', { month: 'long' }).toUpperCase()) + '</div><div class="d">' + d.getDate() + '</div><div class="w">' + esc(d.toLocaleDateString('en-GB', { weekday: 'long' })) + '</div></div>' +
      '<div class="sf-cal-stamp">🌴 OFF DAY</div></div>' +
      (who ? '<div class="sf-cal-who">' + esc(who) + '</div>' : '');
    document.body.appendChild(el);
    requestAnimationFrame(function () { el.classList.add('in'); });
    setTimeout(function () { SF.sound('whoosh'); }, 250);
    setTimeout(function () { SF.sound('thump'); }, 900);
    var close = function () { el.classList.remove('in'); setTimeout(function () { el.remove(); }, 260); };
    el.onclick = close;
    setTimeout(close, 3000);
  };

  // ── who's likely next for a stock
  SF.nextPeek = function (label, list) {
    addCss();
    list = (list || []).slice(0, 8);
    var el = document.createElement('div');
    el.className = 'sf-peek';
    var days = function (d) {
      if (!d) return 'never done';
      var n = Math.round((Date.now() - new Date(d + 'T12:00:00')) / 864e5);
      return n <= 0 ? 'today' : n === 1 ? 'yesterday' : n + ' days ago';
    };
    el.innerHTML = '<div class="sf-peek-card"><button type="button" class="sf-peek-x">✕</button>' +
      '<div class="sf-peek-h">Who\'s likely next</div><div class="sf-peek-s">' + esc(label) + '</div>' +
      '<div class="sf-wheel sm"><div class="sf-ptr"></div><svg viewBox="-110 -110 220 220"><g class="sf-rot"></g></svg><div class="sf-hub">👀</div></div>' +
      '<ol class="sf-peek-l">' + (list.length ? list.map(function (x, i) { return '<li' + (i === 0 ? ' class="top"' : '') + '><b>' + esc(x.alias) + '</b><span>' + esc(days(x.last_date)) + '</span></li>'; }).join('') : '<li><span>Nobody is set for this stock</span></li>') + '</ol>' +
      '<div class="sf-peek-n">Longest since last done comes first. A guide only — auto-assign also checks leave and other rules.</div></div>';
    document.body.appendChild(el);
    requestAnimationFrame(function () { el.classList.add('in'); });
    var close = function () { el.classList.remove('in'); setTimeout(function () { el.remove(); }, 220); };
    el.onclick = function (e) { if (e.target === el || e.target.closest('.sf-peek-x')) close(); };
    if (!list.length) return;
    // mini wheel lands on the top name
    var rot = el.querySelector('.sf-rot'), names = list.map(function (x) { return x.alias; });
    if (names.length === 1) names.push('—');
    var seg = 360 / names.length, html = '';
    names.forEach(function (nm, k) {
      var a0 = (k * seg - 90) * Math.PI / 180, a1 = ((k + 1) * seg - 90) * Math.PI / 180, mid = (k + 0.5) * seg - 90;
      html += '<path d="M0 0 L' + (100 * Math.cos(a0)).toFixed(2) + ' ' + (100 * Math.sin(a0)).toFixed(2) + ' A100 100 0 ' + (seg > 180 ? 1 : 0) + ' 1 ' + (100 * Math.cos(a1)).toFixed(2) + ' ' + (100 * Math.sin(a1)).toFixed(2) + 'Z" fill="' + COLS[k % COLS.length] + '" stroke="#0d1117" stroke-width="1.2"/>' +
        '<text transform="rotate(' + mid.toFixed(1) + ') translate(60 0)" fill="' + (k % 2 ? '#e6edf3' : '#0d1117') + '" font-size="' + (names.length > 6 ? 10 : 12) + '" font-weight="800" text-anchor="middle" dominant-baseline="middle" font-family="system-ui,sans-serif">' + esc(String(nm).slice(0, 10)) + '</text>';
    });
    rot.innerHTML = html + '<circle r="101" fill="none" stroke="#d4af37" stroke-width="3"/>';
    var angle = 360 * 3 + (360 - 0.5 * seg);
    rot.style.transform = 'rotate(0deg)';
    void rot.getBoundingClientRect();
    rot.style.transition = 'transform 1.4s cubic-bezier(.12,.8,.22,1)';
    rot.style.transform = 'rotate(' + angle + 'deg)';
    var tk = 0; (function t() { if (tk > 12) return; SF.sound('tick'); tk++; setTimeout(t, 40 + tk * tk * 5); })();
    setTimeout(function () { SF.sound('ding'); el.querySelector('.sf-peek-l li.top')?.classList.add('lit'); }, 1450);
  };

  // ── swipe a card right / left
  SF.swipeable = function (card, o) {
    if (!card) return;
    addCss();
    card.classList.add('sf-swipe');
    card.insertAdjacentHTML('afterbegin', '<div class="sf-sw-tag y">' + esc(o.yes || '✓') + '</div><div class="sf-sw-tag n">' + esc(o.no || '✗') + '</div>');
    if (o.hint) card.insertAdjacentHTML('beforeend', '<div class="sf-sw-hint">' + esc(o.hint) + '</div>');
    var y = card.querySelector('.sf-sw-tag.y'), n = card.querySelector('.sf-sw-tag.n');
    var sx = 0, dx = 0, drag = false, raf = 0, FAR = 100;
    var show = function () { raf = 0; card.style.transform = 'translateX(' + dx + 'px) rotate(' + dx / 20 + 'deg)'; y.style.opacity = Math.max(0, Math.min(1, dx / FAR)); n.style.opacity = Math.max(0, Math.min(1, -dx / FAR)); };
    card.addEventListener('pointerdown', function (e) {
      if (e.target.closest('button')) return; // buttons still work as normal
      drag = true; sx = e.clientX; dx = 0; card.setPointerCapture(e.pointerId); card.style.transition = 'none';
    });
    card.addEventListener('pointermove', function (e) { if (!drag) return; dx = e.clientX - sx; if (!raf) raf = requestAnimationFrame(show); });
    var up = function () {
      if (!drag) return;
      drag = false; cancelAnimationFrame(raf); raf = 0;
      if (Math.abs(dx) > FAR) {
        var right = dx > 0;
        SF.sound('whoosh');
        card.style.transition = 'transform .3s ease-in, opacity .3s';
        card.style.transform = 'translateX(' + (right ? 1 : -1) * innerWidth + 'px) rotate(' + (right ? 20 : -20) + 'deg)';
        card.style.opacity = '0';
        setTimeout(function () { (right ? o.onRight : o.onLeft)(); }, 280);
        return;
      }
      card.style.transition = 'transform .35s cubic-bezier(.3,1.5,.5,1)'; card.style.transform = '';
      y.style.opacity = 0; n.style.opacity = 0;
    };
    card.addEventListener('pointerup', up);
    card.addEventListener('pointercancel', up);
  };
})();
