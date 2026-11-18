// ============================================================
// RelayFleet — the public page (#homeView.rl.lq, site.css).
//  - background: an engine turning (crankshaft, pistons, gears, turbo, belt, wheel) drawn on a
//    canvas and blurred, with water caustics over it (WebGL). It revs up a little while you scroll.
//    A filmed clip can replace it: set data-video="clip.mp4" on .lq-bg.
//  - the hero: a live copy of the Relay shop board, work orders moving column to column
//  - the product tour: five animated scenes, moving on by themselves (paused on hover);
//    click a name or use the arrow keys to pick one
//  - the AI call plays out when it comes into view; fleet portal statuses change
//  - the demo request form books a call through request_demo (migration 0052)
// Everything stops while the page is hidden, and nothing moves for reduced-motion visitors.
// ============================================================
(function(){
  const home = document.getElementById('homeView'); if(!home || !home.classList.contains('lq')) return;
  const W = window;
  const reduced = !!(W.matchMedia && W.matchMedia('(prefers-reduced-motion: reduce)').matches);
  const headless = /jsdom/i.test(navigator.userAgent || '');
  const raf = W.requestAnimationFrame ? W.requestAnimationFrame.bind(W) : (f => setTimeout(() => f(Date.now()), 33));
  const shown = () => !home.classList.contains('hidden') && !document.hidden;
  const IO = typeof W.IntersectionObserver === 'function' ? W.IntersectionObserver : null;
  const watch = (el, fn, th) => { if(!el) return; if(!IO){ fn(false); return; } new IO(es => es.forEach(e => fn(e.isIntersecting)), { threshold: th || .25 }).observe(el); };
  if(reduced || !IO) home.classList.add('no-fx');
  home.dataset.motion = reduced ? 'reduced' : 'on';

  // ---------------- background ----------------
  const bg = home.querySelector('.lq-bg');
  let rev = 1, lastY = W.scrollY || 0;
  W.addEventListener('scroll', () => { const y = W.scrollY || 0; rev = Math.min(5, rev + Math.abs(y - lastY) * .012); lastY = y; }, { passive: true });

  function engine(cv){
    const ctx = cv.getContext && cv.getContext('2d'); if(!ctx) return null;
    let w = 0, h = 0, u = 1;
    const fit = () => { const r = cv.getBoundingClientRect(), k = .55; w = cv.width = Math.max(320, Math.round(r.width * k)); h = cv.height = Math.max(240, Math.round(r.height * k)); u = Math.min(w, h) / 100; };
    fit(); W.addEventListener('resize', fit);
    const metal = (x, y, r, a, b) => { const g = ctx.createRadialGradient(x - r * .35, y - r * .4, r * .1, x, y, r * 1.1); g.addColorStop(0, a || '#8fb3bb'); g.addColorStop(.55, '#3d5f68'); g.addColorStop(1, b || '#132a30'); return g; };
    function gear(x, y, r, n, ang){
      const th = r * .13, st = Math.PI * 2 / n;
      ctx.beginPath();
      for(let i = 0; i < n; i++){
        const a = ang + i * st;
        const p = (aa, rr) => ctx.lineTo(x + Math.cos(aa) * rr, y + Math.sin(aa) * rr);
        p(a, r - th * .4); p(a + st * .22, r + th); p(a + st * .5, r + th); p(a + st * .72, r - th * .4);
      }
      ctx.closePath(); ctx.fillStyle = metal(x, y, r); ctx.fill(); ctx.lineWidth = u * .25; ctx.strokeStyle = 'rgba(190,240,245,.35)'; ctx.stroke();
      ctx.fillStyle = '#0a1d22';
      for(let i = 0; i < 6; i++){ const a = ang * 1 + i * Math.PI / 3; ctx.beginPath(); ctx.arc(x + Math.cos(a) * r * .55, y + Math.sin(a) * r * .55, r * .15, 0, 7); ctx.fill(); }
      ctx.beginPath(); ctx.arc(x, y, r * .26, 0, 7); ctx.fillStyle = metal(x, y, r * .26, '#b9d6dc'); ctx.fill();
      ctx.beginPath(); ctx.arc(x, y, r * .1, 0, 7); ctx.fillStyle = '#081619'; ctx.fill();
    }
    function pistons(cx, cy, t){
      const R = 4.2 * u, L = 15 * u, gap = 12 * u, bore = 9 * u, ph = [0, Math.PI, Math.PI, 0];
      // block
      ctx.fillStyle = 'rgba(30,60,68,.55)'; ctx.fillRect(cx - bore, cy - L - R * 3.2, gap * 3 + bore * 2, L + R * 1.2);
      ctx.strokeStyle = 'rgba(190,240,245,.18)'; ctx.lineWidth = u * .3; ctx.strokeRect(cx - bore, cy - L - R * 3.2, gap * 3 + bore * 2, L + R * 1.2);
      // shaft
      ctx.strokeStyle = '#6f939b'; ctx.lineWidth = 2.2 * u; ctx.beginPath(); ctx.moveTo(cx - bore * 1.4, cy); ctx.lineTo(cx + gap * 3 + bore * 1.4, cy); ctx.stroke();
      ph.forEach((p, i) => {
        const x = cx + i * gap, a = t + p, px = x + R * Math.sin(a), py = cy - R * Math.cos(a);
        const yP = cy - (R * Math.cos(a) + Math.sqrt(L * L - Math.pow(R * Math.sin(a), 2)));
        ctx.fillStyle = 'rgba(8,24,29,.8)'; ctx.fillRect(x - bore / 2 - u * .4, cy - L - R * 3, bore + u * .8, L + R * .9);  // cylinder
        ctx.beginPath(); ctx.arc(x, cy, R * 1.25, 0, 7); ctx.fillStyle = metal(x, cy, R * 1.25); ctx.fill();               // web
        ctx.strokeStyle = '#a9c9cf'; ctx.lineWidth = 1.6 * u; ctx.beginPath(); ctx.moveTo(px, py); ctx.lineTo(x, yP); ctx.stroke();  // rod
        const g = ctx.createLinearGradient(x - bore / 2, 0, x + bore / 2, 0); g.addColorStop(0, '#2a4a52'); g.addColorStop(.45, '#c6e2e7'); g.addColorStop(1, '#2a4a52');
        ctx.fillStyle = g; ctx.fillRect(x - bore / 2, yP - 5 * u, bore, 6.5 * u);                                        // piston
        ctx.fillStyle = 'rgba(10,30,35,.7)'; ctx.fillRect(x - bore / 2, yP - 3.8 * u, bore, u * .5); ctx.fillRect(x - bore / 2, yP - 2.6 * u, bore, u * .5);
        ctx.beginPath(); ctx.arc(px, py, u * 1.1, 0, 7); ctx.fillStyle = '#dff3f6'; ctx.fill();
        if(Math.cos(a) > .93){ ctx.fillStyle = 'rgba(255,190,90,.55)'; ctx.beginPath(); ctx.arc(x, cy - L - R * 2.3, u * 3, 0, 7); ctx.fill(); }  // firing
      });
    }
    function turbo(x, y, r, a){
      ctx.beginPath(); for(let k = 0; k < 60; k++){ const q = k / 59 * Math.PI * 2, rr = r * (1 + .35 * k / 59); ctx.lineTo(x + Math.cos(q) * rr, y + Math.sin(q) * rr); }
      ctx.closePath(); ctx.fillStyle = metal(x, y, r * 1.35, '#7fa2aa', '#10252b'); ctx.fill();
      ctx.beginPath(); ctx.arc(x, y, r * .82, 0, 7); ctx.fillStyle = '#071519'; ctx.fill();
      ctx.strokeStyle = '#cfe9ee'; ctx.lineWidth = u * .7; ctx.lineCap = 'round';
      for(let i = 0; i < 11; i++){ const b = a + i * Math.PI * 2 / 11; ctx.beginPath(); ctx.moveTo(x + Math.cos(b) * r * .18, y + Math.sin(b) * r * .18);
        ctx.quadraticCurveTo(x + Math.cos(b + .5) * r * .5, y + Math.sin(b + .5) * r * .5, x + Math.cos(b + .9) * r * .78, y + Math.sin(b + .9) * r * .78); ctx.stroke(); }
      ctx.beginPath(); ctx.arc(x, y, r * .16, 0, 7); ctx.fillStyle = '#9fc3ca'; ctx.fill();
    }
    function wheel(x, y, r, a){
      ctx.beginPath(); ctx.arc(x, y, r, 0, 7); ctx.fillStyle = '#0b1416'; ctx.fill();
      ctx.strokeStyle = 'rgba(150,190,198,.25)'; ctx.lineWidth = u * .8;
      for(let i = 0; i < 24; i++){ const b = a + i * Math.PI / 12; ctx.beginPath(); ctx.moveTo(x + Math.cos(b) * r * .86, y + Math.sin(b) * r * .86); ctx.lineTo(x + Math.cos(b + .08) * r, y + Math.sin(b + .08) * r); ctx.stroke(); }
      ctx.beginPath(); ctx.arc(x, y, r * .66, 0, 7); ctx.fillStyle = metal(x, y, r * .66, '#c3dde2'); ctx.fill();
      for(let i = 0; i < 10; i++){ const b = a + i * Math.PI / 5; ctx.beginPath(); ctx.arc(x + Math.cos(b) * r * .42, y + Math.sin(b) * r * .42, r * .05, 0, 7); ctx.fillStyle = '#e8f6f8'; ctx.fill(); }
      ctx.beginPath(); ctx.arc(x, y, r * .22, 0, 7); ctx.fillStyle = metal(x, y, r * .22, '#e6f4f6'); ctx.fill();
    }
    function belt(x1, y1, r1, x2, y2, r2, t){
      ctx.save(); ctx.strokeStyle = '#1c2f33'; ctx.lineWidth = u * 1.6; ctx.setLineDash([u * 1.2, u * .8]); ctx.lineDashOffset = -t * u * 6;
      ctx.beginPath(); ctx.moveTo(x1, y1 - r1); ctx.lineTo(x2, y2 - r2); ctx.arc(x2, y2, r2, -Math.PI / 2, Math.PI / 2); ctx.lineTo(x1, y1 + r1); ctx.arc(x1, y1, r1, Math.PI / 2, Math.PI * 1.5); ctx.stroke(); ctx.restore();
      [[x1, y1, r1], [x2, y2, r2]].forEach(([x, y, r], k) => { ctx.beginPath(); ctx.arc(x, y, r * .86, 0, 7); ctx.fillStyle = metal(x, y, r); ctx.fill();
        const a = t * (k ? r1 / r2 : 1); ctx.strokeStyle = 'rgba(10,25,29,.9)'; ctx.lineWidth = u * .6; for(let i = 0; i < 3; i++){ const b = a + i * 2.094; ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + Math.cos(b) * r * .8, y + Math.sin(b) * r * .8); ctx.stroke(); } });
    }
    return function draw(t){
      ctx.clearRect(0, 0, w, h);
      const A = { x: w * .8, y: h * .3, r: 20 * u }, B = { r: 12 * u }, C = { r: 7 * u };
      const ab = 2.35, bc = 1.2;
      B.x = A.x + Math.cos(ab) * (A.r + B.r + u); B.y = A.y + Math.sin(ab) * (A.r + B.r + u);
      C.x = B.x + Math.cos(bc) * (B.r + C.r + u); C.y = B.y + Math.sin(bc) * (B.r + C.r + u);
      gear(A.x, A.y, A.r, 30, t * .35); gear(B.x, B.y, B.r, 18, -t * .35 * A.r / B.r + .1); gear(C.x, C.y, C.r, 11, t * .35 * A.r / C.r);
      gear(w * .36, h * .1, 15 * u, 24, -t * .22);
      turbo(w * .1, h * .25, 10 * u, t * 4.2);
      pistons(w * .16, h * .86, t * 2.4);
      belt(w * .54, h * .84, 8 * u, w * .7, h * .72, 4.5 * u, t * 2);
      wheel(w * .94, h * .9, 22 * u, t * 1.1);
    };
  }

  function water(cv){
    let gl = null; try { gl = cv.getContext('webgl', { premultipliedAlpha: false, alpha: true }); } catch(e){}
    if(!gl) return null;
    const vs = 'attribute vec2 p;void main(){gl_Position=vec4(p,0.,1.);}';
    const fs = 'precision mediump float;uniform vec2 r;uniform float t;' +
      'float w(vec2 p,float t){return sin(p.x+t)+sin(p.y*1.3-t*.8)+sin((p.x+p.y)*.7+t*.6);}' +
      'void main(){vec2 uv=gl_FragCoord.xy/r.y;vec2 p=uv*8.;float c=0.;' +
      'for(int i=0;i<2;i++){float s=float(i)*1.7+1.;vec2 q=p*s+.7*vec2(w(p*.9*s,t),w(p.yx*1.1*s+3.,t*1.2));float v=w(q*1.3,t*1.3+s);c+=pow(1.-smoothstep(0.,.75,abs(v)),3.)/s;}' +
      'float f=smoothstep(0.,1.,gl_FragCoord.y/r.y);vec3 col=mix(vec3(.25,.75,.82),vec3(.75,1.,1.),c);gl_FragColor=vec4(col*c,c*.9*(.45+.55*f));}';
    const sh = (type, src) => { const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s); return s; };
    const pr = gl.createProgram(); gl.attachShader(pr, sh(gl.VERTEX_SHADER, vs)); gl.attachShader(pr, sh(gl.FRAGMENT_SHADER, fs)); gl.linkProgram(pr);
    if(!gl.getProgramParameter(pr, gl.LINK_STATUS)) return null;
    gl.useProgram(pr);
    const buf = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, buf); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    const loc = gl.getAttribLocation(pr, 'p'); gl.enableVertexAttribArray(loc); gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
    const uR = gl.getUniformLocation(pr, 'r'), uT = gl.getUniformLocation(pr, 't');
    const fit = () => { const r = cv.getBoundingClientRect(), k = .4; cv.width = Math.max(200, Math.round(r.width * k)); cv.height = Math.max(150, Math.round(r.height * k)); gl.viewport(0, 0, cv.width, cv.height); };
    fit(); W.addEventListener('resize', fit);
    return function draw(t){ gl.uniform2f(uR, cv.width, cv.height); gl.uniform1f(uT, t * .45); gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT); gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4); };
  }

  if(bg && !headless){
    const eng = engine(bg.querySelector('.lq-engine')), wat = water(bg.querySelector('.lq-water'));
    const clip = (bg.dataset.video || '').trim();
    if(clip){
      const v = document.createElement('video'); v.muted = true; v.loop = true; v.autoplay = true; v.playsInline = true; v.setAttribute('playsinline', ''); v.preload = 'auto';
      v.addEventListener('error', () => v.remove()); v.addEventListener('playing', () => { const e = bg.querySelector('.lq-engine'); if(e) e.style.display = 'none'; });
      v.src = clip; bg.insertBefore(v, bg.firstChild);
    }
    let t = 0, last = 0;
    const frame = now => {
      raf(frame);
      if(!shown() || now - last < 33) return;
      const dt = Math.min(.1, (now - last) / 1000 || .033); last = now;
      rev += (1 - rev) * .04; t += dt * rev;
      if(eng) eng(t); if(wat) wat(t);
    };
    if(reduced){ if(eng) eng(2); if(wat) wat(2); } else raf(frame);
  }

  // ---------------- reveal on scroll ----------------
  if(IO && !reduced){
    const io = new IO(es => es.forEach(e => { if(e.isIntersecting){ e.target.classList.add('is-in'); io.unobserve(e.target); } }), { threshold: .12, rootMargin: '0px 0px -40px 0px' });
    home.querySelectorAll('.lq-rv').forEach(el => io.observe(el));
  }

  // ---------------- hero: the live shop board ----------------
  (function(){
    const board = document.getElementById('lqBoard'); if(!board) return;
    const cols = [...board.querySelectorAll('.lq-cards')], toast = document.getElementById('lqToast');
    const kpi = k => home.querySelector('[data-kpi="' + k + '"]');
    const money = n => '$' + Math.round(n).toLocaleString('en-US');
    let woNo = 4871, revenue = 4180, open = 8;
    const pool = [
      ['Trailer 5521', 'Flat tire, I‑4 EB mile 72', 'Road call', 'road', 412],
      ['Truck 118', 'Check engine light, DEF warning', 'Logan', '', 690],
      ['Truck SF‑12', 'Brake chamber leaking, left rear', 'Sam', '', 371],
      ['Truck CF‑7', 'PM service A and DOT inspection', 'Ana', '', 540],
      ['Truck 96', 'Battery dead, jump and test', 'Road call', 'road', 265],
      ['Truck MT‑3', 'Replace front shocks, both sides', 'Logan', '', 820],
      ['Truck GC‑21', 'Turbo actuator fault', 'Sam', '', 1180],
      ['Trailer 7790', 'ABS light, sensor left rear', 'Ana', '', 310],
      ['Truck 204', 'Coolant leak at water pump', 'Marcus', '', 760]
    ];
    let pi = 0;
    let newNo = 4872;
    const make = (ai) => {
      const p = pool[pi++ % pool.length], c = document.createElement('div');
      c.className = 'lq-card'; c.dataset.amt = p[4];
      const em = document.createElement('em'); em.textContent = 'WO‑00' + (ai ? newNo++ : woNo--);
      const b = document.createElement('b'); b.textContent = p[0];
      const s = document.createElement('span'); s.textContent = p[1];
      const chip = document.createElement('span'); chip.className = 'chip ' + (ai ? 'ai' : p[3]); chip.textContent = ai ? 'AI phone line' : p[2];
      c.append(em, b, s, chip);
      return c;
    };
    // the opening board
    [[0], [1], [2, 2], [3, 3], [4]].forEach((list, ci) => list.forEach(() => cols[ci].appendChild(make())));
    const flip = (mutate) => {
      const cards = [...board.querySelectorAll('.lq-card')], before = new Map(cards.map(c => [c, c.getBoundingClientRect()]));
      mutate();
      board.querySelectorAll('.lq-card').forEach(c => {
        const a = before.get(c); if(!a || typeof c.animate !== 'function') return;
        const b = c.getBoundingClientRect(), dx = a.left - b.left, dy = a.top - b.top;
        if(Math.abs(dx) + Math.abs(dy) < 1) return;
        c.animate([{ transform: `translate(${dx}px, ${dy}px)` }, { transform: 'none' }], { duration: 750, easing: 'cubic-bezier(.2,.8,.2,1)' });
      });
    };
    const bump = (el, txt) => { if(!el) return; el.textContent = txt; el.classList.add('bump'); setTimeout(() => el.classList.remove('bump'), 900); };
    const say = (title, line) => { if(!toast) return; toast.textContent = ''; const b = document.createElement('b'); b.textContent = title; toast.append(b, document.createTextNode(line)); toast.classList.add('is-on'); setTimeout(() => toast.classList.remove('is-on'), 2600); };
    let step = 0, visible = !IO;
    const tick = () => {
      if(!shown() || !visible) return;
      step++;
      if(step % 4 === 0 && cols[0].children.length < 3){
        const c = make(true); c.classList.add('is-new');
        flip(() => cols[0].prepend(c));
        bump(kpi('open'), String(++open)); bump(kpi('road'), String(2 + (step / 4) % 2));
        say('AI phone line · road call created', c.querySelector('em').textContent + ' · ' + c.querySelector('b').textContent);
        return;
      }
      // move one card forward, starting nearest to Done
      for(let k = 0; k < 4; k++){
        const ci = 3 - ((step + k) % 4), from = cols[ci], to = cols[ci + 1];
        if(!from.children.length || (ci + 1 < 4 && to.children.length >= 3)) continue;
        const card = from.lastElementChild;
        card.classList.add('is-moving'); setTimeout(() => card.classList.remove('is-moving'), 800);
        flip(() => { to.prepend(card); if(ci + 1 === 4 && to.children.length > 2) to.lastElementChild.remove(); });
        if(ci + 1 === 4){ revenue += Number(card.dataset.amt || 300); bump(kpi('rev'), money(revenue)); bump(kpi('open'), String(--open)); say('Invoice sent', card.querySelector('em').textContent + ' · ' + money(card.dataset.amt)); }
        if(ci + 1 === 2) bump(kpi('wait'), String(cols[2].children.length));
        break;
      }
    };
    watch(board, v => { visible = v || !IO; }, .2);
    if(!reduced) setInterval(tick, 2400);
  })();

  // ---------------- the product tour ----------------
  (function(){
    const tour = home.querySelector('.lq-tour'); if(!tour) return;
    const tabs = [...tour.querySelectorAll('.lq-tab')], scenes = [...tour.querySelectorAll('.lq-scene')];
    const DUR = 8500; tour.style.setProperty('--lq-dur', DUR + 'ms');
    let cur = 0, timer = null, left = DUR, started = 0, hover = false, inView = !IO, runs = [];
    const stopRuns = () => { runs.forEach(f => f()); runs = []; };
    const every = (ms, fn) => { const id = setInterval(fn, ms); runs.push(() => clearInterval(id)); };
    const later = (ms, fn) => { const id = setTimeout(fn, ms); runs.push(() => clearTimeout(id)); };
    const pad = n => String(n).padStart(2, '0');
    const clock = s => pad(Math.floor(s / 3600)) + ':' + pad(Math.floor(s / 60) % 60) + ':' + pad(s % 60);
    const play = i => {
      stopRuns(); if(reduced) return;
      const sc = scenes[i];
      if(i === 0){ const el = sc.querySelector('[data-timer]'); let s = 42 * 60 + 10; el.textContent = clock(s); every(1000, () => { el.textContent = clock(++s); }); }
      if(i === 1){
        const path = sc.querySelector('#lqRoute'), truck = sc.querySelector('#lqTruck'), eta = sc.querySelector('[data-eta]');
        const len = path && typeof path.getTotalLength === 'function' ? path.getTotalLength() : 0, t0 = Date.now() + 300, T = 7000;
        every(40, () => { const k = Math.max(0, Math.min(1, (Date.now() - t0) / T));
          if(len && truck){ const p = path.getPointAtLength(len * k); truck.setAttribute('transform', `translate(${p.x} ${p.y})`); }
          eta.textContent = k >= 1 ? 'Arrived' : Math.max(1, Math.round(14 * (1 - k))) + ' min'; });
      }
      if(i === 3){
        const mi = sc.querySelector('[data-mi]'), pt = sc.querySelector('[data-ptimer]'); mi.textContent = '6.2 mi'; pt.textContent = clock(0);
        const t0 = Date.now(); every(60, () => { const e = Date.now() - t0;
          if(e > 3900 && e < 6600) mi.textContent = (6.2 * (1 - (e - 3900) / 2700)).toFixed(1) + ' mi';
          if(e > 6700) pt.textContent = clock(Math.floor((e - 6700) / 1000)); });
      }
      if(i === 4){
        const els = [...sc.querySelectorAll('[data-count]')], t0 = Date.now() + 300;
        every(40, () => { const k = Math.max(0, Math.min(1, (Date.now() - t0) / 1600)), e = 1 - Math.pow(1 - k, 3);
          els.forEach(el => { el.textContent = (el.dataset.pre || '') + Math.round(Number(el.dataset.count) * e).toLocaleString('en-US') + (el.dataset.suf || ''); }); });
      }
    };
    const arm = () => {
      clearTimeout(timer); timer = null;
      if(reduced || hover || !inView) return;
      started = Date.now(); timer = setTimeout(() => show(cur + 1), left);
    };
    function show(n, focus){
      cur = (n + tabs.length) % tabs.length; left = DUR;
      tabs.forEach((t, k) => { const on = k === cur; t.classList.remove('is-on', 'is-auto'); t.setAttribute('aria-selected', String(on)); t.tabIndex = on ? 0 : -1; if(on && focus) t.focus(); });
      void tour.offsetWidth;
      tabs[cur].classList.add('is-on'); if(!reduced) tabs[cur].classList.add('is-auto');
      scenes.forEach(s => s.classList.remove('is-on')); void tour.offsetWidth;
      scenes.forEach(s => s.classList.toggle('is-on', Number(s.dataset.s) === cur));
      play(cur); arm();
    }
    tabs.forEach((t, k) => {
      t.addEventListener('click', () => show(k));
      t.addEventListener('keydown', e => { const d = ['ArrowDown', 'ArrowRight'].includes(e.key) ? 1 : ['ArrowUp', 'ArrowLeft'].includes(e.key) ? -1 : 0; if(!d) return; e.preventDefault(); show(tabs.indexOf(t) + d, true); });
    });
    tour.addEventListener('mouseenter', () => { hover = true; if(timer){ clearTimeout(timer); timer = null; left = Math.max(400, left - (Date.now() - started)); } });
    tour.addEventListener('mouseleave', () => { hover = false; arm(); });
    watch(tour, v => { inView = v || !IO; if(inView){ if(!timer) arm(); } else { clearTimeout(timer); timer = null; } }, .3);
    show(0);
  })();

  // ---------------- the AI call plays out ----------------
  (function(){
    const call = document.getElementById('lqCall'); if(!call || reduced || !IO) return;
    const lines = [...call.querySelectorAll('.call-log > div')], res = call.querySelector('.call-result');
    let ids = [], on = false;
    const clear = () => { ids.forEach(clearTimeout); ids = []; };
    const run = () => {
      clear(); call.classList.add('is-playing'); lines.forEach(l => l.classList.remove('is-shown')); res.classList.remove('is-shown');
      lines.forEach((l, i) => ids.push(setTimeout(() => l.classList.add('is-shown'), 500 + i * 1500)));
      ids.push(setTimeout(() => res.classList.add('is-shown'), 500 + lines.length * 1500));
      ids.push(setTimeout(() => { if(on) run(); }, 500 + lines.length * 1500 + 6000));
    };
    watch(call, v => { if(v && !on){ on = true; run(); } else if(!v && on){ on = false; clear(); lines.forEach(l => l.classList.add('is-shown')); res.classList.add('is-shown'); } }, .35);
  })();

  // ---------------- fleet portal statuses change ----------------
  (function(){
    const portal = document.getElementById('lqPortal'); if(!portal || reduced || !IO) return;
    const eta = portal.querySelector('[data-p="eta"]'), appr = portal.querySelector('[data-p="appr"]');
    let n = 14, s = 0, vis = false;
    const flash = el => { el.classList.remove('flash'); void el.offsetWidth; el.classList.add('flash'); };
    setInterval(() => {
      if(!vis || !shown()) return; s++;
      if(n > 1){ n--; eta.textContent = 'Mechanic ' + n + ' min away'; } else if(n === 1){ n = 0; eta.textContent = 'Mechanic on site'; eta.className = 'tg ok'; flash(eta); }
      else if(s % 6 === 0){ n = 14; eta.textContent = 'Mechanic 14 min away'; eta.className = 'tg live'; flash(eta); }
      if(s % 7 === 0){ const ok = appr.classList.contains('wait'); appr.textContent = ok ? 'Approved, $371.00' : 'Awaiting approval, $371.00'; appr.className = 'tg ' + (ok ? 'ok' : 'wait'); flash(appr); }
    }, 1000);
    watch(portal, v => { vis = v; }, .3);
  })();

  // hero drops follow the pointer a little
  if(!reduced && W.matchMedia && W.matchMedia('(pointer: fine)').matches){
    const drops = [...home.querySelectorAll('.lq-drop')];
    home.addEventListener('pointermove', e => { const x = e.clientX / W.innerWidth - .5, y = e.clientY / W.innerHeight - .5;
      drops.forEach((d, i) => { const k = (i + 1) * 9; d.style.translate = `${-x * k}px ${-y * k}px`; }); }, { passive: true });
  }
})();

// ---- the demo form ----
(function(){
  const form = document.getElementById('rfDemoForm'); if(!form) return;
  const msg = document.getElementById('rfDemoMsg'), btn = document.getElementById('rfDemoBtn');
  const nameEl = document.getElementById('rfName'), contactEl = document.getElementById('rfContact');
  const say = (t, ok) => { msg.textContent = t; msg.classList.toggle('is-ok', !!ok); };
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    [nameEl, contactEl].forEach(el => el.removeAttribute('aria-invalid'));
    const name = nameEl.value.trim(), contact = contactEl.value.trim();
    if(!name){ nameEl.setAttribute('aria-invalid', 'true'); nameEl.focus(); say('Please add your name.'); return; }
    if(!contact){ contactEl.setAttribute('aria-invalid', 'true'); contactEl.focus(); say('Please add a phone number or an email so we can reach you.'); return; }
    const isEmail = contact.includes('@');
    if(isEmail && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(contact)){ contactEl.setAttribute('aria-invalid', 'true'); contactEl.focus(); say('That email address does not look right.'); return; }
    if(!isEmail && contact.replace(/\D/g, '').length < 7){ contactEl.setAttribute('aria-invalid', 'true'); contactEl.focus(); say('That phone number looks too short.'); return; }
    if(typeof sb === 'undefined' || !sb){ say('We could not reach Relay just now. Please email support@relayfleet.us.'); return; }
    btn.disabled = true; btn.textContent = 'Sending…'; say('');
    const { error } = await sb.rpc('request_demo', { p_name: name, p_business: null, p_kind: 'repair_shop', p_email: isEmail ? contact : null, p_phone: isEmail ? null : contact, p_best_time: null, p_note: null });
    btn.disabled = false; btn.textContent = 'Book a demo';
    if(error){ say(typeof friendlyError === 'function' ? friendlyError(error, 'Could not send your request').message : (error.message || 'Could not send your request.')); return; }
    const thanks = document.createElement('div'); thanks.className = 'nx-thanks'; thanks.id = 'nxThanks';
    const b = document.createElement('b'); b.textContent = 'Thanks, ' + name.split(/\s+/)[0] + '.';
    thanks.append(b, document.createTextNode('We will ' + (isEmail ? 'email' : 'call') + ' you to set a time for your demo.'));
    form.replaceWith(thanks); say('', true);
  });
  document.querySelectorAll('[data-nx-demo]').forEach(b => b.addEventListener('click', () => {
    const target = document.getElementById('rfDemoForm') || document.getElementById('nxThanks'); if(!target) return;
    if(target.scrollIntoView) target.scrollIntoView({ behavior: window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'center' });
    setTimeout(() => { const n = document.getElementById('rfName'); if(n) n.focus({ preventScroll: true }); }, 450);
  }));
})();
