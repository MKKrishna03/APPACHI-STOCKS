/* Companion animation (butterflies, kite, koi, firefly, paper airplane, jellyfish, hummingbird,
   shooting star) — flies on every page. Pick it in Home → Settings → Companion (window.openCompanionPicker). */
(function(){
  if (window.__ajCompanion) return; window.__ajCompanion = true;
  if (/\/(login|signup|reset)\.html$/.test(location.pathname)) return; // not before sign-in
  var st = document.createElement('style'); st.textContent = ".creature{ position:fixed; top:0; left:0; z-index:9999; cursor:pointer; user-select:none; touch-action:manipulation; }\n\n/* Butterfly */\n.bfly{ width:30px; height:24px; }\n.bfly-body{ position:absolute; left:50%; top:2px; width:2px; height:20px; background:#3a2a1a; border-radius:2px; transform:translateX(-50%); }\n.bfly-wing{ position:absolute; top:1px; width:15px; height:18px; background:radial-gradient(circle at 32% 30%, var(--c2), var(--c1)); box-shadow:0 0 5px rgba(0,0,0,.18); animation:bfly-flap .22s ease-in-out infinite; }\n.bfly-wing-l{ left:0; border-radius:80% 20% 60% 40% / 70% 60% 40% 30%; transform-origin:right center; }\n.bfly-wing-r{ right:0; border-radius:20% 80% 40% 60% / 60% 70% 30% 40%; transform-origin:left center; }\n.bfly.creature-shy .bfly-wing{ animation-duration:.09s; }\n@keyframes bfly-flap{ 0%,100%{ transform:scaleX(1) rotateZ(0deg); } 50%{ transform:scaleX(.3) rotateZ(6deg); } }\n\n/* Kite */\n.kite{ width:16px; height:36px; }\n.kite-diamond{ position:absolute; top:0; left:0; width:14px; height:14px; border-radius:3px; background:linear-gradient(135deg,var(--c1),var(--c2)); border:1px solid rgba(255,255,255,.4); box-shadow:0 1px 3px rgba(0,0,0,.25); transform:rotate(45deg); }\n.kite-bow{ position:absolute; top:4px; left:4px; width:6px; height:6px; border-radius:50%; background:radial-gradient(circle,#fff8dc,var(--c2)); box-shadow:0 0 2px rgba(0,0,0,.3); }\n.kite-tail{ position:absolute; left:6px; width:3.5px; height:3.5px; border-radius:50%; background:var(--c2); box-shadow:0 0 2px rgba(0,0,0,.2); }\n.kite-tail-1{ top:16px; animation:kite-sway .8s ease-in-out infinite; }\n.kite-tail-2{ top:23px; animation:kite-sway .8s ease-in-out infinite .15s; }\n.kite-tail-3{ top:30px; animation:kite-sway .8s ease-in-out infinite .3s; }\n@keyframes kite-sway{ 0%,100%{ transform:translateX(-3px) rotate(-12deg); } 50%{ transform:translateX(3px) rotate(12deg); } }\n\n/* Koi fish */\n.koi{ width:36px; height:16px; }\n.koi-body{ position:absolute; left:6px; top:1px; width:24px; height:14px; border-radius:50% 50% 45% 45% / 60% 60% 40% 40%; background:linear-gradient(120deg,#fff 0%,var(--c1) 55%,var(--c2) 100%); box-shadow:0 1px 4px rgba(0,0,0,.25); }\n.koi-tail{ position:absolute; left:0; top:2px; width:12px; height:12px; background:linear-gradient(90deg, transparent, var(--c1)); clip-path:polygon(100% 20%, 0 0, 0 100%, 100% 80%); transform-origin:right center; animation:koi-wag .6s ease-in-out infinite; }\n@keyframes koi-wag{ 0%,100%{ transform:rotate(-16deg); } 50%{ transform:rotate(16deg); } }\n.koi-eye{ position:absolute; left:22px; top:4px; width:2.5px; height:2.5px; border-radius:50%; background:#1a1410; box-shadow:0 0 1px rgba(255,255,255,.6); }\n.koi-bubbles{ position:absolute; left:28px; top:1px; width:16px; height:16px; }\n.koi-bubble{ position:absolute; left:0; top:6px; width:3px; height:3px; border-radius:50%; background:radial-gradient(circle at 35% 35%, #fff, rgba(180,220,255,.65)); box-shadow:0 0 2px rgba(255,255,255,.5); opacity:0; animation:koi-bubble-rise 2.4s ease-out infinite; }\n.koi-bubble-2{ top:7px; animation-delay:.8s; }\n.koi-bubble-3{ top:5px; animation-delay:1.6s; }\n@keyframes koi-bubble-rise{\n  0%{ opacity:0; transform:translate(0,0) scale(.4); }\n  15%{ opacity:.9; }\n  100%{ opacity:0; transform:translate(-10px,-24px) scale(1.7); }\n}\n.koi-burst .koi-bubble{ animation-duration:.7s; }\n\n/* Firefly */\n.firefly{ width:10px; height:10px; }\n.firefly-body{ width:100%; height:100%; border-radius:50%; background:radial-gradient(circle, #fff8dc, var(--c1) 55%, transparent 100%); box-shadow:0 0 6px 2px var(--c1); animation:firefly-pulse 2.4s ease-in-out infinite; }\n@keyframes firefly-pulse{ 0%,100%{ opacity:.35; box-shadow:0 0 3px 1px var(--c1); } 50%{ opacity:1; box-shadow:0 0 12px 5px var(--c1); } }\n.firefly.creature-flash .firefly-body{ animation:firefly-flash .5s ease-out; }\n@keyframes firefly-flash{ 0%{ box-shadow:0 0 6px 2px var(--c1); } 45%{ box-shadow:0 0 24px 11px var(--c1); } 100%{ box-shadow:0 0 6px 2px var(--c1); } }\n\n/* Paper airplane */\n.plane{ width:28px; height:20px; }\n.plane-body{ width:100%; height:100%; background:linear-gradient(135deg,var(--c2),var(--c1)); clip-path:polygon(100% 45%, 0% 0%, 26% 50%, 0% 100%); box-shadow:0 2px 5px rgba(0,0,0,.2); }\n\n/* Jellyfish */\n.jelly{ width:26px; height:44px; }\n.jelly-bell{\n  position:absolute; top:0; left:3px; width:20px; height:16px; border-radius:50% 50% 40% 40% / 70% 70% 30% 30%;\n  background:radial-gradient(circle at 40% 30%, rgba(255,255,255,.55), var(--c1) 55%, var(--c2) 100%);\n  box-shadow:0 0 10px 2px var(--c1), inset 0 -3px 6px rgba(255,255,255,.2);\n  opacity:.88;\n}\n.jelly-tentacle{ position:absolute; top:14px; width:1.6px; height:26px; background:linear-gradient(180deg, var(--c2), transparent); border-radius:2px; transform-origin:top center; animation:jelly-wave 2.2s ease-in-out infinite; }\n.jelly-tentacle-1{ left:6px; animation-delay:0s; }\n.jelly-tentacle-2{ left:11px; animation-delay:.3s; height:30px; }\n.jelly-tentacle-3{ left:16px; animation-delay:.6s; }\n.jelly-tentacle-4{ left:21px; animation-delay:.9s; height:22px; }\n@keyframes jelly-wave{ 0%,100%{ transform:rotate(-8deg); } 50%{ transform:rotate(8deg); } }\n.jelly.creature-flash .jelly-bell{ animation:jelly-pulse .6s ease-out; }\n@keyframes jelly-pulse{ 0%{ transform:scale(1); box-shadow:0 0 10px 2px var(--c1); } 40%{ transform:scale(1.3); box-shadow:0 0 24px 9px var(--c1); } 100%{ transform:scale(1); box-shadow:0 0 10px 2px var(--c1); } }\n\n/* Hummingbird */\n.hb{ width:34px; height:24px; }\n.hb-tail{ position:absolute; left:0; top:7px; width:11px; height:10px; background:linear-gradient(90deg, var(--c2), transparent); clip-path:polygon(100% 0, 0 50%, 100% 100%); }\n.hb-body{ position:absolute; left:9px; top:6px; width:18px; height:11px; border-radius:60% 40% 50% 50% / 70% 70% 40% 40%; background:linear-gradient(135deg,var(--c1),var(--c2) 60%,#d4af37); box-shadow:0 1px 4px rgba(0,0,0,.3); }\n.hb-head{ position:absolute; left:23px; top:3px; width:10px; height:10px; border-radius:50%; background:linear-gradient(135deg,var(--c1),#1b6b5c); box-shadow:0 1px 3px rgba(0,0,0,.25); }\n.hb-beak{ position:absolute; left:31px; top:7px; width:9px; height:1.6px; background:#2a1a10; border-radius:1px; }\n.hb-wing{ position:absolute; left:11px; top:-5px; width:17px; height:14px; background:rgba(255,255,255,.5); border-radius:50%; animation:hb-blur .07s linear infinite; }\n@keyframes hb-blur{ 0%,100%{ opacity:.15; transform:scaleY(1); } 50%{ opacity:.55; transform:scaleY(.35); } }\n\n/* Shooting star */\n.star{ width:60px; height:8px; }\n.star-core{ position:absolute; right:0; top:1px; width:6px; height:6px; border-radius:50%; background:#fff8dc; box-shadow:0 0 10px 3px var(--c1); }\n.star-trail{ position:absolute; right:6px; top:3px; width:52px; height:2px; background:linear-gradient(to left, var(--c1), transparent); }\n\n@media (prefers-reduced-motion: reduce){\n  .bfly-wing, .kite-tail, .koi-tail, .koi-bubble, .firefly-body, .hb-wing{ animation:none; }\n}\n\n/* Companion picker popover */\n.companion-picker{\n  position:fixed; z-index:10001; background:var(--panel,#161d29); border:1px solid var(--border,#263142); border-radius:12px;\n  box-shadow:0 20px 50px rgba(0,0,0,.55); padding:6px; min-width:200px;\n  display:flex; flex-direction:column; gap:2px; font-family:'Inter',sans-serif; font-size:13px;\n}\n.cp-row{ display:flex; align-items:center; gap:10px; padding:8px 10px; border-radius:8px; background:none; border:none; color:var(--text,#e8edf4); cursor:pointer; text-align:left; width:100%; font-family:inherit; font-size:inherit; }\n.cp-row:hover{ background:var(--panel-elev,#1a2230); }\n.cp-row.cp-active{ background:rgba(212,175,55,.14); color:#d4af37; font-weight:600; }\n.cp-emoji{ font-size:16px; width:20px; text-align:center; flex-shrink:0; }\n.cp-sep{ height:1px; background:var(--border,#263142); margin:4px 2px; }"; document.head.appendChild(st);
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const rand = (a, b) => a + Math.random() * (b - a);

  function animate(duration, onFrame, onDone) {
    const start = performance.now();
    (function frame(now) {
      const t = Math.min(1, (now - start) / duration);
      onFrame(t);
      if (t < 1) requestAnimationFrame(frame);
      else onDone && onDone();
    })(start);
  }

  // Keep creatures out of the sidebar / mobile header / mobile bottom-nav
  // regions entirely, so a tap that narrowly misses the (small, moving)
  // creature never lands on a nav link sitting underneath it instead.
  const isVisible = el => !!el && getComputedStyle(el).display !== 'none';
  function getBounds() {
    let minX = 24, maxX = window.innerWidth - 24;
    let minY = 80, maxY = window.innerHeight - 24;
    const sidebar = document.querySelector('.sidebar');
    const header  = document.querySelector('.mobile-header');
    const navbar  = document.querySelector('.mobile-nav');
    if (isVisible(sidebar)) minX = Math.max(minX, sidebar.getBoundingClientRect().right + 16);
    if (isVisible(header))  minY = Math.max(minY, header.getBoundingClientRect().bottom + 12);
    if (isVisible(navbar))  maxY = Math.min(maxY, navbar.getBoundingClientRect().top - 12);
    if (maxX <= minX) maxX = minX + 40;
    if (maxY <= minY) maxY = minY + 40;
    return { minX, maxX, minY, maxY };
  }

  // ── WANDER: wavy path to random points (butterfly, kite, koi) ──────────────
  // `opts.reaction` picks each species' click response: 'dash' (butterfly —
  // startled flutter away), 'loop' (kite — a quick spin-in-place trick),
  // 'burst' (koi — a flurry of bubbles + a little flinch), or 'none' (used
  // when the caller wires up its own click handler instead, e.g. firefly).
  function makeWanderer(el, opts) {
    opts = Object.assign({ speedMin:2000, speedMax:4400, speedPerPx:[9,14], wobbleAmp:[14,30], wobbleFreq:[2,4], reaction:'dash' }, opts);
    let b = getBounds();
    let x = rand(b.minX, b.maxX), y = rand(b.minY, b.maxY);
    let scale = 1, lastAngle = 0, flightId = 0, paused = false, pendingTimeout = null;

    const apply = angle => { lastAngle = angle; el.style.transform = `translate(${x}px, ${y}px) rotate(${angle}deg) scale(${scale})`; };
    apply(0);

    function flyToRandom() {
      if (paused) return;
      b = getBounds();
      const tx = rand(b.minX, b.maxX), ty = rand(b.minY, b.maxY);
      flyTo(tx, ty, rand(opts.speedMin, opts.speedMax) + Math.hypot(tx - x, ty - y) * rand(opts.speedPerPx[0], opts.speedPerPx[1]), () => {
        pendingTimeout = setTimeout(flyToRandom, rand(300, 1400));
      });
    }
    // Flies toward (tx,ty) with a wavy path instead of a straight line.
    // `startle` adds a quick shy "gasp" scale-pop, used only for the dash reaction.
    function flyTo(tx, ty, duration, onDone, startle) {
      const myFlight = ++flightId;
      const fromX = x, fromY = y;
      const dx = tx - fromX, dy = ty - fromY;
      const baseAngle = Math.atan2(dy, dx);
      const perp = baseAngle + Math.PI / 2;
      const wobbleAmp  = rand(opts.wobbleAmp[0], opts.wobbleAmp[1]);
      const wobbleFreq = rand(opts.wobbleFreq[0], opts.wobbleFreq[1]);
      animate(duration, t => {
        if (myFlight !== flightId || paused) return; // superseded, or turned off mid-flight
        const taper = 1 - t * 0.4;
        const wob = Math.sin(t * Math.PI * wobbleFreq) * wobbleAmp * taper;
        x = fromX + dx * t + Math.cos(perp) * wob;
        y = fromY + dy * t + Math.sin(perp) * wob;
        const heading = baseAngle * 180 / Math.PI + Math.sin(t * Math.PI * wobbleFreq) * 22;
        if (startle) scale = 1 + 0.4 * Math.max(0, 1 - t * 5);
        apply(heading);
      }, () => {
        if (myFlight !== flightId || paused) return;
        x = tx; y = ty; scale = 1;
        apply(baseAngle * 180 / Math.PI);
        onDone && onDone();
      });
    }

    if (!reduceMotion) flyToRandom();

    // dash: startled flutter and a bigger, more decisive dart away (butterfly).
    function dashAway() {
      b = getBounds();
      const angle = rand(0, Math.PI * 2), dist = rand(170, 320);
      const tx = Math.min(Math.max(x + Math.cos(angle) * dist, b.minX), b.maxX);
      const ty = Math.min(Math.max(y + Math.sin(angle) * dist, b.minY), b.maxY);
      el.classList.add('creature-shy');
      flyTo(tx, ty, rand(420, 650), () => {
        el.classList.remove('creature-shy');
        pendingTimeout = setTimeout(flyToRandom, rand(300, 1400));
      }, true);
    }
    // loop: a quick full spin in place, like a kite caught by a gust, then
    // carries on wandering from the same spot.
    function loopTrick() {
      if (pendingTimeout) { clearTimeout(pendingTimeout); pendingTimeout = null; }
      const myFlight = ++flightId;
      const startAngle = lastAngle;
      animate(500, t => {
        if (myFlight !== flightId || paused) return;
        apply(startAngle + t * 360);
      }, () => {
        if (myFlight !== flightId || paused) return;
        apply(startAngle);
        pendingTimeout = setTimeout(flyToRandom, rand(200, 600));
      });
    }
    // burst: a quick flinch pop plus a flurry of extra bubbles (koi).
    function bubbleBurst() {
      el.classList.add('koi-burst');
      scale = 1.18; apply(lastAngle);
      setTimeout(() => { scale = 1; apply(lastAngle); el.classList.remove('koi-burst'); }, 500);
    }

    if (opts.reaction !== 'none') {
      el.addEventListener('click', e => {
        e.preventDefault();
        e.stopPropagation();
        if (paused) return;
        if (opts.reaction === 'loop') loopTrick();
        else if (opts.reaction === 'burst') bubbleBurst();
        else dashAway();
      });
    }

    return {
      pause() {
        paused = true;
        flightId++; // cancels whatever animate() loop is mid-flight
        if (pendingTimeout) { clearTimeout(pendingTimeout); pendingTimeout = null; }
      },
      destroy() { this.pause(); el.remove(); },
    };
  }

  // ── DRIFT_PULSE: slow gentle float, glow pulses via CSS (firefly) ──────────
  // Click reaction: a bright excited flash instead of fleeing.
  function makeDrifter(el) {
    const ctrl = makeWanderer(el, { speedMin:5000, speedMax:9000, speedPerPx:[16,24], wobbleAmp:[6,14], wobbleFreq:[0.6,1.2], reaction:'none' });
    el.addEventListener('click', e => {
      e.preventDefault(); e.stopPropagation();
      el.classList.add('creature-flash');
      setTimeout(() => el.classList.remove('creature-flash'), 500);
    });
    return ctrl;
  }

  // ── GLIDE: long straight-ish legs, banks into heading (paper airplane) ──────
  // Click reaction: a fast barrel-roll stunt.
  function makeGlider(el, opts) {
    opts = Object.assign({ speedMin:2600, speedMax:4200, speedPerPx:[7,10] }, opts);
    let b = getBounds();
    let x = rand(b.minX, b.maxX), y = rand(b.minY, b.maxY);
    let flightId = 0, paused = false, pendingTimeout = null, spin = 0, lastAngle = 0;
    const apply = angle => { lastAngle = angle; el.style.transform = `translate(${x}px, ${y}px) rotate(${angle + spin}deg)`; };
    apply(0);
    function glideToRandom() {
      if (paused) return;
      b = getBounds();
      const tx = rand(b.minX, b.maxX), ty = rand(b.minY, b.maxY);
      const dist = Math.hypot(tx - x, ty - y);
      const duration = rand(opts.speedMin, opts.speedMax) + dist * rand(opts.speedPerPx[0], opts.speedPerPx[1]);
      const myFlight = ++flightId;
      const fromX = x, fromY = y, dx = tx - fromX, dy = ty - fromY;
      const baseAngle = Math.atan2(dy, dx) * 180 / Math.PI;
      animate(duration, t => {
        if (myFlight !== flightId || paused) return;
        const ease = t < .5 ? 2 * t * t : -1 + (4 - 2 * t) * t; // easeInOutQuad — banked turns, not linear
        x = fromX + dx * ease; y = fromY + dy * ease;
        apply(baseAngle);
      }, () => {
        if (myFlight !== flightId || paused) return;
        x = tx; y = ty;
        pendingTimeout = setTimeout(glideToRandom, rand(500, 1800));
      });
    }
    function loopStunt() {
      if (pendingTimeout) { clearTimeout(pendingTimeout); pendingTimeout = null; }
      const myFlight = ++flightId;
      const startAngle = lastAngle;
      animate(480, t => {
        if (myFlight !== flightId || paused) return;
        spin = t * 360;
        apply(startAngle);
      }, () => {
        if (myFlight !== flightId || paused) return;
        spin = 0;
        pendingTimeout = setTimeout(glideToRandom, rand(200, 600));
      });
    }
    if (!reduceMotion) glideToRandom();
    el.addEventListener('click', e => {
      e.preventDefault(); e.stopPropagation();
      if (!paused) loopStunt();
    });
    return {
      pause() { paused = true; flightId++; if (pendingTimeout) { clearTimeout(pendingTimeout); pendingTimeout = null; } },
      destroy() { this.pause(); el.remove(); },
    };
  }

  // ── HOVER_DART: jitter near a spot, then a quick dart (hummingbird) ────────
  // Click reaction: darts BACKWARD briefly — real hummingbirds are the only
  // birds that can fly backward, so this is a species-accurate party trick.
  function makeHoverDart(el) {
    let b = getBounds();
    let x = rand(b.minX, b.maxX), y = rand(b.minY, b.maxY);
    let anchorX = x, anchorY = y, lastHeading = 0;
    let flightId = 0, paused = false, pendingTimeout = null, rafId = null;
    const apply = angle => { lastHeading = angle; el.style.transform = `translate(${x}px, ${y}px) rotate(${angle}deg)`; };
    apply(0);
    function jitter() {
      if (paused) return;
      const t = performance.now() / 300;
      x = anchorX + Math.sin(t) * 5;
      y = anchorY + Math.cos(t * 1.3) * 4;
      apply(lastHeading);
      rafId = requestAnimationFrame(jitter);
    }
    function dartToRandom() {
      if (paused) return;
      if (rafId) cancelAnimationFrame(rafId);
      b = getBounds();
      const tx = rand(b.minX, b.maxX), ty = rand(b.minY, b.maxY);
      const myFlight = ++flightId;
      const fromX = x, fromY = y, dx = tx - fromX, dy = ty - fromY;
      const heading = Math.atan2(dy, dx) * 180 / Math.PI;
      animate(rand(260, 420), t => {
        if (myFlight !== flightId || paused) return;
        x = fromX + dx * t; y = fromY + dy * t;
        apply(heading);
      }, () => {
        if (myFlight !== flightId || paused) return;
        anchorX = tx; anchorY = ty; x = tx; y = ty;
        jitter();
        pendingTimeout = setTimeout(dartToRandom, rand(1800, 3400));
      });
    }
    function reverseDart() {
      if (rafId) cancelAnimationFrame(rafId);
      if (pendingTimeout) { clearTimeout(pendingTimeout); pendingTimeout = null; }
      const myFlight = ++flightId;
      const rad = (lastHeading + 180) * Math.PI / 180;
      const b2 = getBounds();
      const fromX = x, fromY = y;
      const tx = Math.min(Math.max(fromX + Math.cos(rad) * 60, b2.minX), b2.maxX);
      const ty = Math.min(Math.max(fromY + Math.sin(rad) * 60, b2.minY), b2.maxY);
      animate(280, t => {
        if (myFlight !== flightId || paused) return;
        x = fromX + (tx - fromX) * t; y = fromY + (ty - fromY) * t;
        apply(lastHeading); // keeps facing forward while moving backward
      }, () => {
        if (myFlight !== flightId || paused) return;
        anchorX = x; anchorY = y;
        jitter();
        pendingTimeout = setTimeout(dartToRandom, rand(1800, 3400));
      });
    }
    if (!reduceMotion) { jitter(); pendingTimeout = setTimeout(dartToRandom, rand(1800, 3400)); }
    el.addEventListener('click', e => {
      e.preventDefault(); e.stopPropagation();
      if (!paused) reverseDart();
    });
    return {
      pause() { paused = true; flightId++; if (rafId) cancelAnimationFrame(rafId); if (pendingTimeout) { clearTimeout(pendingTimeout); pendingTimeout = null; } },
      destroy() { this.pause(); el.remove(); },
    };
  }

  // ── STREAK: rare corner-to-corner pass, long pause between (shooting star) ─
  // Click reaction: "make a wish" — summons an immediate pass instead of
  // waiting for the random timer.
  function makeStreaker(el) {
    let flightId = 0, paused = false, pendingTimeout = null;
    el.style.opacity = '0';
    function streak() {
      if (paused) return;
      const b = getBounds();
      const fromLeft = Math.random() < 0.5;
      const fromX = fromLeft ? b.minX - 40 : b.maxX + 40;
      const fromY = rand(b.minY, b.minY + (b.maxY - b.minY) * 0.4);
      const toX = fromLeft ? b.maxX + 40 : b.minX - 40;
      const toY = fromY + rand(80, 200);
      const heading = Math.atan2(toY - fromY, toX - fromX) * 180 / Math.PI;
      const myFlight = ++flightId;
      el.style.transform = `translate(${fromX}px, ${fromY}px) rotate(${heading}deg)`;
      el.style.opacity = '1';
      animate(rand(900, 1400), t => {
        if (myFlight !== flightId || paused) return;
        const x = fromX + (toX - fromX) * t, y = fromY + (toY - fromY) * t;
        el.style.transform = `translate(${x}px, ${y}px) rotate(${heading}deg)`;
        el.style.opacity = t > 0.85 ? String(1 - (t - 0.85) / 0.15) : '1';
      }, () => {
        if (myFlight !== flightId || paused) return;
        el.style.opacity = '0';
        pendingTimeout = setTimeout(streak, rand(5000, 11000));
      });
    }
    if (!reduceMotion) pendingTimeout = setTimeout(streak, rand(600, 2000));
    el.addEventListener('click', e => {
      e.preventDefault(); e.stopPropagation();
      if (paused) return;
      if (pendingTimeout) { clearTimeout(pendingTimeout); pendingTimeout = null; }
      streak();
    });
    return {
      pause() { paused = true; flightId++; if (pendingTimeout) { clearTimeout(pendingTimeout); pendingTimeout = null; } el.style.opacity = '0'; },
      destroy() { this.pause(); el.remove(); },
    };
  }

  // ── Species roster — one active at a time ───────────────────────────────────
  const SPECIES = [
    { id:'butterfly', label:'Butterflies', emoji:'🦋', count:3,
      colors:[['#ff6b6b','#ffd93d'],['#4dd0e1','#7c4dff'],['#ff8a65','#f06292']],
      render:(c1,c2)=>`<div class="creature bfly" style="--c1:${c1};--c2:${c2}"><div class="bfly-wing bfly-wing-l"></div><div class="bfly-wing bfly-wing-r"></div><div class="bfly-body"></div></div>`,
      make:el=>makeWanderer(el, { wobbleAmp:[14,30], wobbleFreq:[2,4] }) },
    { id:'kite', label:'Kite', emoji:'🪁', count:2,
      colors:[['#ff6b6b','#ffd93d'],['#4dd0e1','#d4af37']],
      render:(c1,c2)=>`<div class="creature kite" style="--c1:${c1};--c2:${c2}"><div class="kite-tail kite-tail-1"></div><div class="kite-tail kite-tail-2"></div><div class="kite-tail kite-tail-3"></div><div class="kite-diamond"></div><div class="kite-bow"></div></div>`,
      make:el=>makeWanderer(el, { speedMin:3400, speedMax:6200, speedPerPx:[13,18], wobbleAmp:[24,42], wobbleFreq:[0.8,1.4], reaction:'loop' }) },
    { id:'koi', label:'Koi Fish', emoji:'🐟', count:2,
      colors:[['#ff8a65','#d4af37'],['#f06292','#ffd93d']],
      render:(c1,c2)=>`<div class="creature koi" style="--c1:${c1};--c2:${c2}"><div class="koi-tail"></div><div class="koi-body"></div><div class="koi-eye"></div><div class="koi-bubbles"><div class="koi-bubble"></div><div class="koi-bubble koi-bubble-2"></div><div class="koi-bubble koi-bubble-3"></div></div></div>`,
      make:el=>makeWanderer(el, { speedMin:3200, speedMax:5600, speedPerPx:[11,15], wobbleAmp:[10,18], wobbleFreq:[1.2,2], reaction:'burst' }) },
    { id:'firefly', label:'Firefly', emoji:'✨', count:5,
      colors:[['#d4af37','#d4af37'],['#ffd93d','#ffd93d'],['#f2c14e','#f2c14e']],
      render:c1=>`<div class="creature firefly" style="--c1:${c1}"><div class="firefly-body"></div></div>`,
      make:el=>makeDrifter(el) },
    { id:'airplane', label:'Paper Airplane', emoji:'✈️', count:2,
      colors:[['#e6edf3','#8b98a8'],['#fff6da','#d4af37']],
      render:(c1,c2)=>`<div class="creature plane" style="--c1:${c1};--c2:${c2}"><div class="plane-body"></div></div>`,
      make:el=>makeGlider(el) },
    { id:'jellyfish', label:'Jellyfish', emoji:'🪼', count:3,
      colors:[['#7c4dff','#4dd0e1'],['#ff6ec7','#7c4dff'],['#4dd0e1','#2ec4b6']],
      render:(c1,c2)=>`<div class="creature jelly" style="--c1:${c1};--c2:${c2}"><div class="jelly-tentacle jelly-tentacle-1"></div><div class="jelly-tentacle jelly-tentacle-2"></div><div class="jelly-tentacle jelly-tentacle-3"></div><div class="jelly-tentacle jelly-tentacle-4"></div><div class="jelly-bell"></div></div>`,
      make:el=>makeDrifter(el) },
    { id:'hummingbird', label:'Hummingbird', emoji:'🐦', count:2,
      colors:[['#2ec4b6','#d4af37'],['#7c4dff','#ffd93d']],
      render:(c1,c2)=>`<div class="creature hb" style="--c1:${c1};--c2:${c2}"><div class="hb-tail"></div><div class="hb-wing"></div><div class="hb-body"></div><div class="hb-head"></div><div class="hb-beak"></div></div>`,
      make:el=>makeHoverDart(el) },
    { id:'star', label:'Shooting Star', emoji:'💫', count:1,
      colors:[['#d4af37','#d4af37']],
      render:c1=>`<div class="creature star" style="--c1:${c1}"><div class="star-trail"></div><div class="star-core"></div></div>`,
      make:el=>makeStreaker(el) },
  ];

  // ── Mount / unmount the active species ──────────────────────────────────────
  let activeControllers = [];
  function unmount() {
    activeControllers.forEach(c => c.destroy());
    activeControllers = [];
  }
  function mount(id) {
    unmount();
    const sp = SPECIES.find(s => s.id === id);
    if (!sp || reduceMotion) return;
    for (let i = 0; i < sp.count; i++) {
      const [c1, c2] = sp.colors[i % sp.colors.length];
      const wrap = document.createElement('div');
      wrap.innerHTML = sp.render(c1, c2);
      const el = wrap.firstElementChild;
      document.body.appendChild(el);
      activeControllers.push(sp.make(el));
    }
  }

  // ── Persistence — migrates the old on/off-only preference the first time ──
  const OLD_KEY = 'appachi_butterflies_off';
  const KEY = 'appachi_companion';
  let current = localStorage.getItem(KEY);
  if (!current) {
    current = localStorage.getItem(OLD_KEY) === '1' ? 'off' : 'butterfly';
    localStorage.setItem(KEY, current);
  }
  if (current !== 'off') mount(current);

  // tell the server this phone's companion + theme (owner's report) — on open and on every change
  window.__ajReportPrefs = function () {
    fetch('/api/my-prefs', { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ companion: current, theme: document.documentElement.dataset.theme, device: window.Capacitor?.isNativePlatform?.() ? 'app' : 'browser' }) }).catch(() => {});
  };
  // now that this runs on every page: report once per app run, plus on every change
  let reported = false; try { reported = !!sessionStorage.getItem('aj_prefs_sent'); sessionStorage.setItem('aj_prefs_sent', '1'); } catch (e) {}
  if (!reported) setTimeout(window.__ajReportPrefs, 3000);

  // Home → Settings shows the current pick next to "Companion"
  function updateToggleButtons() {
    const sp = SPECIES.find(s => s.id === current);
    const val = document.getElementById('companionVal');
    if (val) val.textContent = sp ? sp.emoji + ' ' + sp.label : 'Off';
  }
  updateToggleButtons();

  function setCompanion(id) {
    current = id;
    localStorage.setItem(KEY, id);
    if (id === 'off') unmount(); else mount(id);
    updateToggleButtons();
    window.__ajReportPrefs?.();
  }

  // ── Picker popover — opened from either toggle button ───────────────────────
  let pickerEl = null;
  function closePicker() {
    if (pickerEl) { pickerEl.remove(); pickerEl = null; }
    document.removeEventListener('click', onOutsideClick, true);
    document.removeEventListener('keydown', onEscape, true);
  }
  function onOutsideClick(e) { if (pickerEl && !pickerEl.contains(e.target)) closePicker(); }
  function onEscape(e) { if (e.key === 'Escape') closePicker(); }

  window.openCompanionPicker = function (evt) {
    if (pickerEl) { closePicker(); return; }
    const btn = (evt && (evt.currentTarget || evt.target)) || document.body;
    const rect = btn.getBoundingClientRect();
    pickerEl = document.createElement('div');
    pickerEl.className = 'companion-picker';
    const rows = SPECIES.map(sp => `
      <button type="button" class="cp-row${current === sp.id ? ' cp-active' : ''}" data-id="${sp.id}">
        <span class="cp-emoji">${sp.emoji}</span><span>${sp.label}</span>
      </button>`).join('');
    pickerEl.innerHTML = rows + `
      <div class="cp-sep"></div>
      <button type="button" class="cp-row${current === 'off' ? ' cp-active' : ''}" data-id="off">
        <span class="cp-emoji">🛑</span><span>Off</span>
      </button>`;
    document.body.appendChild(pickerEl);

    // Below the button if there's room, else above; clamp horizontally on-screen.
    const pr = pickerEl.getBoundingClientRect();
    let top = rect.bottom + 8;
    if (top + pr.height > window.innerHeight - 8) top = rect.top - pr.height - 8;
    let left = Math.min(rect.left, window.innerWidth - pr.width - 12);
    left = Math.max(12, left);
    pickerEl.style.top = top + 'px';
    pickerEl.style.left = left + 'px';

    pickerEl.querySelectorAll('.cp-row').forEach(row => {
      row.onclick = () => { setCompanion(row.dataset.id); closePicker(); };
    });
    setTimeout(() => {
      document.addEventListener('click', onOutsideClick, true);
      document.addEventListener('keydown', onEscape, true);
    }, 0);
  };
})();
