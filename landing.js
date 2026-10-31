// ============================================================
// RelayFleet landing — Night shift. Motion follows the scroll:
//  - the first screen arrives (lines rise, the product swings in, the phone springs up and floats)
//  - scrolling settles the product flat; the phone and the glow drift
//  - "One job, start to finish" holds while its five steps play: a highlight glides between steps,
//    screens slide across, notices drop in, the amount counts up
//  - sections rise in as they arrive; the closing line lights up word by word
//  - a notched mouse wheel glides instead of jumping (trackpads, touch and keyboards are untouched)
// Transform, opacity and filter only, one frame per scroll. Reduced motion: everything still.
// The demo form books a call through request_demo (migration 0052).
// ============================================================
(function(){
  const home = document.getElementById('homeView'); if(!home || !home.classList.contains('nx')) return;
  const reduce = !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const stage = document.getElementById('nxStage'), phone = stage && stage.querySelector('.nx-phone'), glow = document.getElementById('nxGlow');
  const story = document.getElementById('nxStory'), bar = document.getElementById('nxBar');
  const steps = story ? [...story.querySelectorAll('.nx-step')] : [], panels = story ? [...story.querySelectorAll('.nx-panel')] : [];
  const close = document.getElementById('nxClose'), title = document.getElementById('nxCloseH');
  let words = [];
  if(title){ const text = title.textContent.trim().split(/\s+/); title.textContent = ''; text.forEach((w, i) => { const s = document.createElement('span'); s.className = 'nx-word'; s.textContent = w; title.append(s); if(i < text.length - 1) title.append(' '); }); words = [...title.querySelectorAll('.nx-word')]; }

  // the story's gliding highlight
  const list = story && story.querySelector('.nx-steps');
  let glideEl = null, current = -1;
  if(list && !reduce){ glideEl = document.createElement('i'); glideEl.className = 'nx-glide'; glideEl.setAttribute('aria-hidden', 'true'); list.prepend(glideEl); list.classList.add('has-glide'); }
  function moveGlide(){ const on = steps[current]; if(!glideEl || !on) return; glideEl.style.height = on.offsetHeight + 'px'; glideEl.style.transform = `translateY(${on.offsetTop}px)`; }
  function countUp(panel){
    const b = panel && panel.querySelector('[data-count]'); if(!b || reduce) return;
    const to = Number(b.dataset.count) || 0, t0 = performance.now(), mine = current;
    b.textContent = '$0.00';   // start from zero at once, so the final amount never flashes first
    const run = (t) => { const k = Math.min(1, (t - t0) / 900), e = 1 - Math.pow(1 - k, 3);
      b.textContent = '$' + (to * e).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
      if(k < 1 && current === mine) requestAnimationFrame(run); else b.textContent = '$' + to.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); };
    requestAnimationFrame(run);
  }
  function setStep(i){
    if(i === current) return; current = i;
    steps.forEach((s, k) => { s.classList.toggle('is-on', k === i); s.setAttribute('aria-current', k === i ? 'step' : 'false'); });
    panels.forEach((p, k) => { p.classList.toggle('is-on', k === i); p.classList.toggle('is-past', k < i); });
    requestAnimationFrame(moveGlide); countUp(panels[i]);
  }
  function frame(){
    ticking = false;
    const vh = window.innerHeight || 800;
    if(stage){   // settle the product flat over the first screen of scrolling; the phone and glow drift
      const p = clamp(window.scrollY / (vh * 0.7), 0, 1);
      stage.style.transform = `perspective(1400px) rotateX(${(1 - p) * 22}deg) rotateY(${(1 - p) * -6}deg) translateY(${(1 - p) * 40}px) scale(${0.9 + p * 0.1})`;
      if(phone) phone.style.transform = `translateY(${-p * 130}px) rotate(${(1 - p) * -4}deg)`;
      if(glow) glow.style.transform = `translate(${-p * 220}px, ${p * 260}px) scale(${1 + p * 0.3})`;
    }
    if(story){
      const r = story.getBoundingClientRect(), total = r.height - vh;
      const p = total > 0 ? clamp(-r.top / total, 0, 1) : 0;
      if(bar) bar.style.transform = `scaleX(${p})`;
      setStep(Math.min(steps.length - 1, Math.floor(p * steps.length * 0.9999)));
    }
    if(close && words.length){
      const r = close.getBoundingClientRect();
      const p = clamp((vh - r.top) / (vh * 0.75), 0, 1);
      const lit = Math.round(p * words.length);
      words.forEach((w, k) => w.classList.toggle('is-lit', k < lit));
    }
  }
  let ticking = false;
  const onScroll = () => { if(!ticking){ ticking = true; requestAnimationFrame(frame); } };

  const reveals = [...home.querySelectorAll('[data-reveal]')];
  if(reduce || !('IntersectionObserver' in window)){ reveals.forEach(el => el.classList.add('is-in')); words.forEach(w => w.classList.add('is-lit')); setStep(0); steps.forEach(s => s.classList.add('is-on')); return; }
  const io = new IntersectionObserver(es => es.forEach(e => { if(e.isIntersecting){ e.target.classList.add('is-in'); io.unobserve(e.target); } }), { threshold: 0.15, rootMargin: '0px 0px -6% 0px' });
  reveals.forEach(el => io.observe(el));
  window.addEventListener('scroll', onScroll, { passive: true });
  window.addEventListener('resize', () => { onScroll(); moveGlide(); }, { passive: true });
  frame();

  // smooth mouse-wheel scrolling, on the landing page only: each notch of a mouse wheel glides
  // instead of jumping. Trackpads (fine steps), touch and the keyboard keep the browser's scrolling.
  let target = window.scrollY, gliding = false, expected = null;
  const glideFrame = () => {
    const y = window.scrollY;
    // something else moved the page (scrollbar, a link, a button, the keyboard): stop and let it be
    if(expected !== null && Math.abs(y - expected) > 2){ gliding = false; expected = null; target = y; return; }
    const d = target - y;
    if(Math.abs(d) < 0.6){ window.scrollTo(0, target); gliding = false; expected = null; return; }
    expected = Math.round(y + d * 0.14); window.scrollTo(0, expected); requestAnimationFrame(glideFrame);
  };
  window.addEventListener('wheel', (e) => {
    if(home.classList.contains('hidden') || e.ctrlKey || e.defaultPrevented) return;
    const notched = e.deltaMode === 1 || (Math.abs(e.deltaY) >= 50 && Number.isInteger(e.deltaY) && Math.abs(e.deltaX) < 1);
    if(!notched || (e.target && e.target.closest && e.target.closest('textarea, select, [data-no-glide]'))){ target = window.scrollY; return; }
    e.preventDefault();
    const max = document.documentElement.scrollHeight - window.innerHeight;
    if(!gliding) target = window.scrollY;
    target = clamp(target + (e.deltaMode === 1 ? e.deltaY * 40 : e.deltaY), 0, max);
    if(!gliding){ gliding = true; expected = null; requestAnimationFrame(glideFrame); }
  }, { passive: false });
  window.addEventListener('keydown', () => { target = window.scrollY; }, { passive: true });
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

// ---- the screen showcase: Board, Work orders, Work order, Schedule, Reports ----
// Moves on every few seconds (a bar fills along the active tab); pauses on hover or focus, off
// screen and when the tab is hidden. Tabs and arrow keys jump straight to a screen.
(function(){
  const box = document.getElementById('nxScreens'); if(!box) return;
  const screens = [...box.querySelectorAll('.nx-screen')], tabs = [...document.querySelectorAll('.nx-tab')];
  const area = box.closest('.nx-stage'), DWELL = 4200;
  const reduce = !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  let i = 0, timer = null, held = false, visible = true;
  area.style.setProperty('--nx-dwell', DWELL + 'ms');
  function show(n, focus){
    i = (n + screens.length) % screens.length;
    screens.forEach((s, k) => { s.classList.toggle('is-on', k === i); s.classList.toggle('is-past', k < i); });
    tabs.forEach((t, k) => { const on = k === i; t.classList.toggle('is-on', on); t.setAttribute('aria-selected', String(on)); t.tabIndex = on ? 0 : -1; t.classList.remove('is-timing'); if(on && focus) t.focus(); });
    plan();
  }
  function plan(){
    clearTimeout(timer); const on = tabs[i];
    if(reduce || held || !visible || document.hidden){ if(on) on.classList.remove('is-timing'); return; }
    if(on){ on.classList.remove('is-timing'); void on.offsetWidth; on.classList.add('is-timing'); }
    timer = setTimeout(() => show(i + 1), DWELL);
  }
  tabs.forEach((t, k) => {
    t.addEventListener('click', () => show(k));
    t.addEventListener('keydown', e => { const d = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0; if(!d) return; e.preventDefault(); show(i + d, true); });
  });
  [area].forEach(el => {
    el.addEventListener('mouseenter', () => { held = true; plan(); }); el.addEventListener('mouseleave', () => { held = false; plan(); });
    el.addEventListener('focusin', () => { held = true; plan(); }); el.addEventListener('focusout', () => { held = false; plan(); });
  });
  document.addEventListener('visibilitychange', plan);
  if('IntersectionObserver' in window) new IntersectionObserver(es => { visible = es[0].isIntersecting; plan(); }).observe(box);
  show(0);
})();
