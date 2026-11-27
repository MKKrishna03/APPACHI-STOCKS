/* Purchase Pro — small fun touches:
   PP.stamp(word)            rubber stamp slams onto the screen when something is saved
   PP.trophy(title, sub)     confetti + trophy (month end all clean)
   PP.scale(box, want, got)  balance scale: tips toward the heavier side, settles level when they match */
(function () {
  'use strict';
  const PP = window.PP = window.PP || {};

  // ── rubber stamp
  PP.stamp = function (word) {
    const el = document.createElement('div');
    el.className = 'fx-stamp';
    el.innerHTML = `<span>${String(word || 'FILED').replace(/[<>&]/g, '')} ✓</span>`;
    document.body.appendChild(el);
    const s = el.firstChild;
    s.animate([
      { transform: 'rotate(-14deg) scale(2.6)', opacity: 0 },
      { transform: 'rotate(-14deg) scale(.92)', opacity: 1, offset: .22 },
      { transform: 'rotate(-14deg) scale(1)', opacity: 1, offset: .3 },
      { transform: 'rotate(-14deg) scale(1)', opacity: 1, offset: .78 },
      { transform: 'rotate(-14deg) scale(1.04)', opacity: 0 }
    ], { duration: 1300, easing: 'cubic-bezier(.2,.8,.3,1)' }).finished.then(() => el.remove(), () => el.remove());
    setTimeout(() => { // thump: the page jolts as the stamp lands
      document.querySelector('.main, main, #view')?.animate(
        [{ transform: 'translate(0,0)' }, { transform: 'translate(-3px,2px)' }, { transform: 'translate(2px,-1px)' }, { transform: 'translate(0,0)' }], { duration: 180 });
    }, 280);
  };

  // ── trophy + confetti
  PP.trophy = function (title, sub) {
    const el = document.createElement('div');
    el.className = 'fx-trophy';
    el.innerHTML = `<canvas></canvas><div class="fx-cup"><div class="fx-emoji">🏆</div><b></b><span></span></div>`;
    el.querySelector('b').textContent = title || 'All done!';
    el.querySelector('span').textContent = sub || '';
    document.body.appendChild(el);
    const cv = el.querySelector('canvas'), ctx = cv.getContext('2d'), dpr = devicePixelRatio || 1;
    const W = innerWidth, H = innerHeight;
    cv.width = W * dpr; cv.height = H * dpr; ctx.scale(dpr, dpr);
    const COLS = ['#d4a72c', '#f5d061', '#16a34a', '#2563eb', '#dc2626', '#f97316', '#ffffff'];
    const bits = Array.from({ length: 160 }, () => ({
      x: W / 2 + (Math.random() - .5) * 120, y: H * .45, vx: (Math.random() - .5) * 900, vy: -300 - Math.random() * 700,
      r: Math.random() * 6.28, vr: (Math.random() - .5) * 12, w: 6 + Math.random() * 6, h: 3 + Math.random() * 4, c: COLS[(Math.random() * COLS.length) | 0]
    }));
    let last = null, alive = true;
    const close = () => { if (!alive) return; alive = false; el.classList.add('out'); setTimeout(() => el.remove(), 300); };
    el.addEventListener('click', close);
    setTimeout(close, 4500);
    requestAnimationFrame(() => el.classList.add('in'));
    (function frame(now) {
      if (!alive) return;
      if (last === null) last = now;
      const dt = Math.min(0.033, (now - last) / 1000); last = now;
      ctx.clearRect(0, 0, W, H);
      for (const b of bits) {
        b.vy += 900 * dt; b.vx *= 0.99; b.x += b.vx * dt; b.y += b.vy * dt; b.r += b.vr * dt;
        ctx.save(); ctx.translate(b.x, b.y); ctx.rotate(b.r); ctx.fillStyle = b.c; ctx.fillRect(-b.w / 2, -b.h / 2, b.w, Math.abs(Math.cos(b.r * 2)) * b.h + 1); ctx.restore();
      }
      requestAnimationFrame(frame);
    })(performance.now());
  };

  // ── balance scale
  const L = 80, CX = 120, CY = 34, DROP = 38;
  PP.scale = function (box, want, got, labels) {
    if (!box) return;
    if (!(want > 0.0005) || !(got > 0.0005)) { box.innerHTML = ''; return; }
    if (!box.querySelector('.fx-scale')) {
      box.innerHTML = `<div class="fx-scale">
        <svg viewBox="0 0 240 118" aria-hidden="true">
          <path d="M120 34 L120 100 M96 104 h48" class="sc-post"/>
          <path d="M108 104 l12-10 l12 10z" class="sc-foot"/>
          <g class="sc-beam"><path d="M${CX - L} ${CY} H${CX + L}" class="sc-bar"/><circle cx="${CX}" cy="${CY}" r="4.5" class="sc-pin"/></g>
          <g class="sc-pan sc-l"><path d="M${CX - L} ${CY} L${CX - L - 20} ${CY + DROP} M${CX - L} ${CY} L${CX - L + 20} ${CY + DROP}" class="sc-str"/><path d="M${CX - L - 26} ${CY + DROP} h52 a26 9 0 0 1 -52 0z" class="sc-dish"/></g>
          <g class="sc-pan sc-r"><path d="M${CX + L} ${CY} L${CX + L - 20} ${CY + DROP} M${CX + L} ${CY} L${CX + L + 20} ${CY + DROP}" class="sc-str"/><path d="M${CX + L - 26} ${CY + DROP} h52 a26 9 0 0 1 -52 0z" class="sc-dish"/></g>
        </svg>
        <div class="sc-vals"><span class="sc-a"></span><b class="sc-msg"></b><span class="sc-b"></span></div>
      </div>`;
    }
    const diff = got - want, even = Math.abs(diff) < 0.0005;
    const deg = even ? 0 : Math.max(-16, Math.min(16, (diff / Math.max(want, got)) * 120 + Math.sign(diff) * 3));
    const t = deg * Math.PI / 180, dx = L - L * Math.cos(t), dy = L * Math.sin(t);
    const s = box.querySelector('.fx-scale');
    s.querySelector('.sc-beam').style.transform = `rotate(${deg}deg)`;
    s.querySelector('.sc-l').style.transform = `translate(${dx}px, ${-dy}px)`;
    s.querySelector('.sc-r').style.transform = `translate(${-dx}px, ${dy}px)`;
    const g = (n) => n.toFixed(3) + ' g';
    s.querySelector('.sc-a').textContent = `${(labels && labels[0]) || 'Expected'} ${g(want)}`;
    s.querySelector('.sc-b').textContent = `${(labels && labels[1]) || 'Received'} ${g(got)}`;
    s.querySelector('.sc-msg').textContent = even ? 'Balanced ✓' : (diff > 0 ? '+' : '−') + g(Math.abs(diff));
    const was = s.classList.contains('even');
    s.classList.toggle('even', even);
    if (even && !was) s.querySelector('.sc-msg').animate([{ transform: 'scale(1.4)' }, { transform: 'scale(1)' }], { duration: 350 });
  };
})();
