/* Purchase Pro — small fun touches:
   PP.stamp(word)            rubber stamp slams onto the screen when something is saved
   PP.trophy(title, sub)     confetti + trophy (month end all clean)
   PP.scale(box, want, got)  balance scale: tips toward the heavier side, settles level when they match */
(function () {
  'use strict';
  const PP = window.PP = window.PP || {};

  // ── sounds: made on the fly with WebAudio (no files). Mute button 🔊/🔇 in the side menu, remembered.
  let ac = null, muted = false;
  try { muted = localStorage.getItem('pp_sound') === 'off'; } catch (e) {}
  function ctx() {
    if (!ac) { const A = window.AudioContext || window.webkitAudioContext; if (!A) return null; ac = new A(); }
    if (ac.state === 'suspended') ac.resume();
    return ac;
  }
  function tone(a, { f = 440, f2, type = 'sine', t = 0, dur = 0.15, vol = 0.2 }) {
    const o = a.createOscillator(), g = a.createGain(), s = a.currentTime + t;
    o.type = type; o.frequency.setValueAtTime(f, s); if (f2) o.frequency.exponentialRampToValueAtTime(f2, s + dur);
    g.gain.setValueAtTime(0.0001, s); g.gain.exponentialRampToValueAtTime(vol, s + 0.01); g.gain.exponentialRampToValueAtTime(0.0001, s + dur);
    o.connect(g).connect(a.destination); o.start(s); o.stop(s + dur + 0.02);
  }
  function noise(a, { t = 0, dur = 0.2, vol = 0.2, from = 800, to, q = 1, type = 'bandpass' }) {
    const n = Math.ceil(a.sampleRate * dur), buf = a.createBuffer(1, n, a.sampleRate), d = buf.getChannelData(0);
    for (let i = 0; i < n; i++) d[i] = Math.random() * 2 - 1;
    const src = a.createBufferSource(), f = a.createBiquadFilter(), g = a.createGain(), s = a.currentTime + t;
    src.buffer = buf; f.type = type; f.Q.value = q; f.frequency.setValueAtTime(from, s); if (to) f.frequency.exponentialRampToValueAtTime(to, s + dur);
    g.gain.setValueAtTime(vol, s); g.gain.exponentialRampToValueAtTime(0.0001, s + dur);
    src.connect(f).connect(g).connect(a.destination); src.start(s);
  }
  const SFX = {
    thump: (a) => { tone(a, { f: 120, f2: 45, dur: 0.22, vol: 0.5 }); noise(a, { dur: 0.08, vol: 0.35, from: 1800, type: 'lowpass' }); },
    swish: (a) => noise(a, { dur: 0.35, vol: 0.28, from: 600, to: 4000, q: 0.8 }),
    clank: (a) => { tone(a, { f: 620, dur: 0.3, vol: 0.12, type: 'triangle' }); tone(a, { f: 1460, dur: 0.22, vol: 0.06 }); },
    ding: (a) => { tone(a, { f: 880, dur: 0.5, vol: 0.12 }); tone(a, { f: 1320, t: 0.08, dur: 0.5, vol: 0.08 }); },
    whoosh: (a) => noise(a, { dur: 0.22, vol: 0.18, from: 2500, to: 500, q: 0.7 }),
    chime: (a) => [523, 659, 784, 1047].forEach((f, i) => tone(a, { f, t: i * 0.11, dur: 0.6, vol: 0.12, type: 'triangle' })),
    shred: (a) => { noise(a, { dur: 1.1, vol: 0.22, from: 300, q: 2 }); tone(a, { f: 70, dur: 1.1, vol: 0.12, type: 'sawtooth' }); },
    tick: (a) => tone(a, { f: 1500, dur: 0.06, vol: 0.08, type: 'square' }),
    drop: (a) => { noise(a, { dur: 0.18, vol: 0.2, from: 1200, to: 300, q: 0.8 }); tone(a, { f: 180, f2: 90, t: 0.12, dur: 0.18, vol: 0.3 }); },
    count: (a) => { for (let i = 0; i < 16; i++) noise(a, { t: i * 0.055, dur: 0.03, vol: 0.25, from: 3000, q: 3 }); },
  };
  PP.sound = function (name) {
    if (muted || !SFX[name]) return;
    try { const a = ctx(); if (a) SFX[name](a); } catch (e) {}
  };
  const sb = document.getElementById('soundBtn');
  if (sb) {
    const show = () => { sb.textContent = muted ? '🔇' : '🔊'; sb.title = muted ? 'Sounds off — click to turn on' : 'Sounds on — click to mute'; };
    sb.onclick = () => { muted = !muted; try { localStorage.setItem('pp_sound', muted ? 'off' : 'on'); } catch (e) {} show(); PP.sound('ding'); };
    show();
  }

  // ── scan laser: a green line sweeps over the photo while the AI reads it, then what it found pops out
  //   const fx = PP.scanFx(el); … fx.done([[label, value], …]) or fx.fail()
  PP.scanFx = function (host) {
    if (!host) return { done() {}, fail() {} };
    if (getComputedStyle(host).position === 'static') host.style.position = 'relative';
    host.querySelector('.fx-scan')?.remove();
    const el = document.createElement('div');
    el.className = 'fx-scan';
    el.innerHTML = '<div class="sc-grid"></div><div class="sc-laser"></div><div class="sc-found"></div>';
    host.appendChild(el);
    const end = (ms) => setTimeout(() => { el.classList.add('out'); setTimeout(() => el.remove(), 400); }, ms);
    return {
      done(found) {
        el.classList.add('stop');
        const list = (found || []).filter(([, v]) => v !== '' && v != null && v !== 0).slice(0, 7);
        const box = el.querySelector('.sc-found');
        list.forEach(([k, v], i) => setTimeout(() => {
          const c = document.createElement('div');
          c.className = 'sc-chip';
          c.innerHTML = '<small></small><b></b>';
          c.querySelector('small').textContent = k; c.querySelector('b').textContent = v;
          box.appendChild(c);
          PP.sound('tick');
        }, 180 + i * 230));
        end(1400 + list.length * 230);
      },
      fail() { el.classList.add('stop', 'bad'); end(900); }
    };
  };

  // ── shredder: a deleted bill goes through the shredder
  PP.shred = function (label) {
    const el = document.createElement('div');
    el.className = 'fx-shred';
    el.innerHTML = `<div class="sh-wrap"><div class="sh-paper"><b></b><i></i><i></i><i></i><i></i><i></i></div>
      <div class="sh-machine"><span>RECYCLE BIN</span></div><div class="sh-strips">${Array.from({ length: 9 }, (_, k) => `<s style="left:${8 + k * 10.5}%;animation-delay:${0.25 + (k % 3) * 0.06}s"></s>`).join('')}</div></div>`;
    el.querySelector('b').textContent = label || 'Bill';
    document.body.appendChild(el);
    PP.sound('shred');
    setTimeout(() => { el.classList.add('out'); setTimeout(() => el.remove(), 250); }, 1500);
  };

  // ── cash counter: the payment amount rolls up like a note-counting machine
  PP.cashCount = function (amount) {
    const el = document.createElement('div');
    el.className = 'fx-cash';
    el.innerHTML = `<div class="cc-box"><div class="cc-notes">${'<i></i>'.repeat(6)}</div><div class="cc-lcd">₹<span>0</span></div><div class="cc-lbl">PAID</div></div>`;
    document.body.appendChild(el);
    const out = el.querySelector('.cc-lcd span'), amt = Math.abs(Number(amount) || 0), t0 = performance.now(), D = 950;
    const fmt = (n) => n.toLocaleString('en-IN', { maximumFractionDigits: 0 });
    PP.sound('count');
    (function roll(now) {
      const p = Math.min(1, (now - t0) / D), e = 1 - Math.pow(1 - p, 3);
      out.textContent = fmt(Math.round(amt * e));
      if (p < 1) return requestAnimationFrame(roll);
      out.textContent = amt.toLocaleString('en-IN', { maximumFractionDigits: 2 });
      el.classList.add('done'); PP.sound('ding');
      setTimeout(() => { el.classList.add('out'); setTimeout(() => el.remove(), 250); }, 900);
    })(t0);
  };

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
    setTimeout(() => PP.sound('thump'), 260);
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
    PP.sound('chime');
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
    if (even && !was) PP.sound('ding');
    if (even && !was) s.querySelector('.sc-msg').animate([{ transform: 'scale(1.4)' }, { transform: 'scale(1)' }], { duration: 350 });
  };
})();
