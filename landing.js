// ============================================================
// RelayFleet — the public page (#homeView.rl.lq, site.css).
//  - the shop film: a 19-second loop of busy truck repair footage behind the whole page
//    (relay-shop.webm/.mp4 on computers, relay-shop-640.mp4 on phones, relay-shop.jpg as the still for
//    data saver and reduced motion). It rests while the page is hidden. The hero adds tinted glass,
//    drifting colour, light beams along a grid and a soft spotlight at the pointer.
//  - the hero: a live copy of the Relay shop board, work orders moving column to column
//  - the product tour: five short animated scenes that move on by themselves (paused on hover);
//    once you click a name or use the arrow keys, you are in charge and it stops moving on
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

  // ---------------- the shop film, behind the whole page ----------------
  const bg = home.querySelector('.lq-bg');
  if(bg && !headless){
    const saver = !!(navigator.connection && navigator.connection.saveData);
    const phone = !!(W.matchMedia && W.matchMedia('(max-width: 640px)').matches);
    let film = null;
    // data saver and reduced motion keep the still; phones get the small file
    if(!saver && !reduced){
      film = document.createElement('video'); film.className = 'lq-film';
      film.muted = true; film.defaultMuted = true; film.loop = true; film.playsInline = true; film.autoplay = true;
      film.setAttribute('muted', ''); film.setAttribute('playsinline', ''); film.setAttribute('preload', 'auto');
      const add = (src, type) => { if(!src) return; const so = document.createElement('source'); so.src = src; so.type = type; film.appendChild(so); };
      if(phone) add(bg.dataset.small, 'video/mp4');
      else { add(bg.dataset.webm, 'video/webm'); add(bg.dataset.video, 'video/mp4'); }
      film.addEventListener('playing', () => bg.classList.add('has-film'));
      film.addEventListener('error', () => { bg.classList.remove('has-film'); }, true);
      bg.insertBefore(film, bg.firstChild);
    }
    // it plays while the landing page is open and the tab is in front, and rests otherwise
    const playFilm = () => { if(!film) return; if(shown()){ const p = film.play(); if(p && p.catch) p.catch(() => {}); } else film.pause(); };
    document.addEventListener('visibilitychange', playFilm);
    new MutationObserver(playFilm).observe(home, { attributes: true, attributeFilter: ['class'] });
    playFilm();
    // the hero's spotlight under the pointer (set straight away, no easing, so it never trails behind)
    const hero = home.querySelector('.lq-hero'), fx = home.querySelector('.lq-hero-fx');
    if(!reduced && fx && hero && W.matchMedia && W.matchMedia('(pointer: fine)').matches){
      let qx = 0, qy = 0, queued = false;
      hero.addEventListener('pointermove', e => { const r = hero.getBoundingClientRect(); qx = e.clientX - r.left; qy = e.clientY - r.top;
        if(!queued){ queued = true; raf(() => { queued = false; fx.style.setProperty('--mx', qx + 'px'); fx.style.setProperty('--my', qy + 'px'); }); } }, { passive: true });
      hero.addEventListener('pointerenter', () => fx.classList.add('is-hover'));
      hero.addEventListener('pointerleave', () => fx.classList.remove('is-hover'));
    }
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
    let cur = 0, timer = null, left = DUR, started = 0, hover = false, inView = !IO, runs = [], picked = false;
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
        const len = path && typeof path.getTotalLength === 'function' ? path.getTotalLength() : 0, t0 = Date.now(), T = 4500;
        every(40, () => { const k = Math.max(0, Math.min(1, (Date.now() - t0) / T));
          if(len && truck){ const p = path.getPointAtLength(len * k); truck.setAttribute('transform', `translate(${p.x} ${p.y})`); }
          eta.textContent = k >= 1 ? 'Arrived' : Math.max(1, Math.round(14 * (1 - k))) + ' min'; });
      }
      if(i === 3){
        const mi = sc.querySelector('[data-mi]'), pt = sc.querySelector('[data-ptimer]'); mi.textContent = '6.2 mi'; pt.textContent = clock(0);
        const t0 = Date.now(); every(60, () => { const e = Date.now() - t0;
          if(e > 1900 && e < 3500) mi.textContent = (6.2 * (1 - (e - 1900) / 1600)).toFixed(1) + ' mi';
          if(e > 3600) pt.textContent = clock(Math.floor((e - 3600) / 1000)); });
      }
      if(i === 4){
        const els = [...sc.querySelectorAll('[data-count]')], t0 = Date.now();
        every(40, () => { const k = Math.max(0, Math.min(1, (Date.now() - t0) / 900)), e = 1 - Math.pow(1 - k, 3);
          els.forEach(el => { el.textContent = (el.dataset.pre || '') + Math.round(Number(el.dataset.count) * e).toLocaleString('en-US') + (el.dataset.suf || ''); }); });
      }
    };
    const arm = () => {
      clearTimeout(timer); timer = null;
      if(reduced || picked || hover || !inView) return;
      started = Date.now(); timer = setTimeout(() => show(cur + 1), left);
    };
    function show(n, focus){
      cur = (n + tabs.length) % tabs.length; left = DUR;
      tabs.forEach((t, k) => { const on = k === cur; t.classList.remove('is-on', 'is-auto'); t.setAttribute('aria-selected', String(on)); t.tabIndex = on ? 0 : -1; if(on && focus) t.focus(); });
      void tour.offsetWidth;
      tabs[cur].classList.add('is-on'); if(!reduced && !picked) tabs[cur].classList.add('is-auto');
      scenes.forEach(s => s.classList.toggle('is-on', Number(s.dataset.s) === cur));
      play(cur); arm();
    }
    tabs.forEach((t, k) => {
      t.addEventListener('click', () => { picked = true; show(k); });
      t.addEventListener('keydown', e => { const d = ['ArrowDown', 'ArrowRight'].includes(e.key) ? 1 : ['ArrowUp', 'ArrowLeft'].includes(e.key) ? -1 : 0; if(!d) return; e.preventDefault(); picked = true; show(tabs.indexOf(t) + d, true); });
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
