// ============================================================
// RelayFleet landing — Night shift. Motion follows the scroll wheel (it never takes it over):
//  - the product screen starts tilted back and settles flat; the phone drifts ahead of it
//  - "One job, start to finish" holds in place while its five steps play, one screen each
//  - sections slide in as they arrive; the closing line lights up word by word
// One requestAnimationFrame per scroll, transform and opacity only. Reduced motion: still.
// The demo form books a call through request_demo (migration 0052).
// ============================================================
(function(){
  const home = document.getElementById('homeView'); if(!home || !home.classList.contains('nx')) return;
  const reduce = !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const stage = document.getElementById('nxStage'), phone = stage && stage.querySelector('.nx-phone');
  const story = document.getElementById('nxStory'), bar = document.getElementById('nxBar');
  const steps = story ? [...story.querySelectorAll('.nx-step')] : [], panels = story ? [...story.querySelectorAll('.nx-panel')] : [];
  const close = document.getElementById('nxClose'), title = document.getElementById('nxCloseH');
  // the closing line, one word at a time
  let words = [];
  if(title){ const text = title.textContent.trim().split(/\s+/); title.textContent = ''; text.forEach((w, i) => { const s = document.createElement('span'); s.className = 'nx-word'; s.textContent = w; title.append(s); if(i < text.length - 1) title.append(' '); }); words = [...title.querySelectorAll('.nx-word')]; }

  let current = -1;
  function setStep(i){
    if(i === current) return; current = i;
    steps.forEach((s, k) => { s.classList.toggle('is-on', k === i); s.setAttribute('aria-current', k === i ? 'step' : 'false'); });
    panels.forEach((p, k) => { p.classList.toggle('is-on', k === i); p.classList.toggle('is-past', k < i); });
  }
  function frame(){
    ticking = false;
    const vh = window.innerHeight || 800;
    if(stage){   // settle the product flat over the first screen of scrolling
      const p = clamp(window.scrollY / (vh * 0.7), 0, 1);
      stage.style.transform = `perspective(1600px) rotateX(${(1 - p) * 16}deg) translateY(${(1 - p) * 30}px) scale(${0.94 + p * 0.06})`;
      if(phone) phone.style.transform = `translateY(${-p * 70}px)`;
    }
    if(story){   // the story's progress decides its step
      const r = story.getBoundingClientRect(), total = r.height - vh;
      const p = total > 0 ? clamp(-r.top / total, 0, 1) : 0;
      if(bar) bar.style.transform = `scaleX(${p})`;
      setStep(Math.min(steps.length - 1, Math.floor(p * steps.length * 0.9999)));
    }
    if(close && words.length){   // light the closing words as it rises into view
      const r = close.getBoundingClientRect();
      const p = clamp((vh - r.top) / (vh * 0.75), 0, 1);
      const lit = Math.round(p * words.length);
      words.forEach((w, k) => w.classList.toggle('is-lit', k < lit));
    }
  }
  let ticking = false;
  const onScroll = () => { if(!ticking){ ticking = true; requestAnimationFrame(frame); } };

  // sections slide in once, as they arrive
  const reveals = [...home.querySelectorAll('[data-reveal]')];
  if(reduce || !('IntersectionObserver' in window)){ reveals.forEach(el => el.classList.add('is-in')); words.forEach(w => w.classList.add('is-lit')); setStep(0); steps.forEach(s => s.classList.add('is-on')); return; }
  const io = new IntersectionObserver(es => es.forEach(e => { if(e.isIntersecting){ e.target.classList.add('is-in'); io.unobserve(e.target); } }), { threshold: 0.18, rootMargin: '0px 0px -8% 0px' });
  reveals.forEach(el => io.observe(el));
  window.addEventListener('scroll', onScroll, { passive: true });
  window.addEventListener('resize', onScroll, { passive: true });
  frame();
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
  // "Book a demo call" lower down brings you back to the form
  document.querySelectorAll('[data-nx-demo]').forEach(b => b.addEventListener('click', () => {
    const target = document.getElementById('rfDemoForm') || document.getElementById('nxThanks'); if(!target) return;
    if(target.scrollIntoView) target.scrollIntoView({ behavior: window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'center' });
    setTimeout(() => { const n = document.getElementById('rfName'); if(n) n.focus({ preventScroll: true }); }, 450);
  }));
})();
