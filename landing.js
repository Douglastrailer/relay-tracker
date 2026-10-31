// ============================================================
// RelayFleet landing — the repair order.
// One example order plays from the road call to paid, and each copy (shop, mechanic, customer)
// shows the same moment from that person's side. Pauses on hover or focus, off screen, when the
// tab is hidden, or with the Pause button; people who ask for reduced motion see the finished
// order, still. The demo slip books a call through request_demo (migration 0052).
// ============================================================
(function(){
  const ro = document.getElementById('rfRo'); if(!ro) return;
  const paper = ro.querySelector('.rf-paper'), stamp = ro.querySelector('.rf-stamp'), play = document.getElementById('rfPlay');
  const tabs = [...ro.querySelectorAll('[role="tab"]')], panel = document.getElementById('rfCopy');
  const LINES = {
    shop: ['New road call, 2 minutes ago', 'Dispatched to Logan R., about 18 minutes away', 'Logan is on site. Estimate sent to the customer.', 'Estimate approved by Ana Ruiz. The order moved on by itself.', 'Repaired. Invoice INV-4029 emailed.', 'Paid, $371.00. Review requested.'],
    mech: ['New call: I-4, mile 72', 'Driving, 14 miles to go', 'On site, timer running', 'Approved. Go ahead with the repair.', 'Job done in 52 minutes', 'Paid. Ready for the next call.'],
    cust: ['We have your request.', 'Logan is on the way. Arrives in about 18 minutes.', 'Logan has arrived at your truck.', 'You approved the estimate: $371.00', 'Your truck is ready to roll.', 'Paid. Thank you.']
  };
  const reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  let step = 0, timer = null, paused = false, hovering = false, visible = true;

  function render(){
    paper.dataset.step = String(step);
    ro.querySelectorAll('.rf-steps li').forEach(li => { const s = Number(li.dataset.s); li.classList.toggle('is-done', s <= step); li.classList.toggle('is-now', s === step); });
    ro.querySelectorAll('.rf-check li').forEach(li => li.classList.toggle('is-done', Number(li.dataset.s) <= step));
    ro.querySelectorAll('[data-live]').forEach(el => { el.textContent = LINES[el.dataset.live][step]; });
    const word = step >= 5 ? 'Paid' : step >= 3 ? 'Approved' : '';
    if(stamp.textContent !== word){
      stamp.textContent = word; stamp.classList.remove('is-on');
      if(word){ void stamp.offsetWidth; stamp.classList.add('is-on'); }
    }
  }
  function tick(){ step = step >= 5 ? 0 : step + 1; render(); schedule(); }
  function schedule(){
    clearTimeout(timer);
    if(reduce || paused || hovering || !visible || document.hidden) return;
    timer = setTimeout(tick, step >= 5 ? 5200 : 2600);
  }
  function setCopy(name, focus){
    tabs.forEach(t => { const on = t.dataset.copy === name; t.setAttribute('aria-selected', String(on)); t.tabIndex = on ? 0 : -1; if(on && focus) t.focus(); });
    paper.dataset.copy = name;
    panel.setAttribute('aria-labelledby', 'rfTab-' + name);
    panel.querySelectorAll('.rf-view').forEach(v => { v.hidden = v.dataset.view !== name; });
  }
  tabs.forEach((t, i) => {
    t.addEventListener('click', () => setCopy(t.dataset.copy));
    t.addEventListener('keydown', e => {
      const k = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0; if(!k) return;
      e.preventDefault(); setCopy(tabs[(i + k + tabs.length) % tabs.length].dataset.copy, true);
    });
  });
  ro.addEventListener('mouseenter', () => { hovering = true; schedule(); });
  ro.addEventListener('mouseleave', () => { hovering = false; schedule(); });
  ro.addEventListener('focusin', () => { hovering = true; schedule(); });
  ro.addEventListener('focusout', () => { hovering = false; schedule(); });
  if(play){
    if(reduce) play.hidden = true;
    play.addEventListener('click', () => { paused = !paused; play.textContent = paused ? 'Play' : 'Pause'; play.setAttribute('aria-pressed', String(paused)); schedule(); });
  }
  document.addEventListener('visibilitychange', schedule);
  if('IntersectionObserver' in window) new IntersectionObserver(es => { visible = es[0].isIntersecting; schedule(); }).observe(ro);
  if(reduce) step = 5;   // the finished order, still
  render(); schedule();
})();

// ---- the demo slip ----
(function(){
  const form = document.getElementById('rfDemoForm'); if(!form) return;
  const msg = document.getElementById('rfDemoMsg'), btn = document.getElementById('rfDemoBtn');
  const val = id => (document.getElementById(id).value || '').trim();
  const say = (t, ok) => { msg.textContent = t; msg.classList.toggle('is-ok', !!ok); };
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    form.querySelectorAll('[aria-invalid]').forEach(el => el.removeAttribute('aria-invalid'));
    const name = val('rfName'), email = val('rfEmail'), phone = val('rfPhone');
    if(!name){ document.getElementById('rfName').setAttribute('aria-invalid', 'true'); document.getElementById('rfName').focus(); say('Please add your name.'); return; }
    if(!email && !phone){ document.getElementById('rfPhone').setAttribute('aria-invalid', 'true'); document.getElementById('rfPhone').focus(); say('Please add a phone number or an email so we can reach you.'); return; }
    if(email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)){ document.getElementById('rfEmail').setAttribute('aria-invalid', 'true'); document.getElementById('rfEmail').focus(); say('That email address does not look right.'); return; }
    if(typeof sb === 'undefined' || !sb){ say('We could not reach Relay just now. Please email support@relayfleet.us.'); return; }
    btn.disabled = true; btn.textContent = 'Sending…'; say('');
    const kind = (form.querySelector('input[name="kind"]:checked') || {}).value || 'repair_shop';
    const { error } = await sb.rpc('request_demo', { p_name: name, p_business: val('rfBiz') || null, p_kind: kind, p_email: email || null, p_phone: phone || null, p_best_time: val('rfWhen') || null, p_note: null });
    btn.disabled = false; btn.textContent = 'Book my demo';
    if(error){ say(typeof friendlyError === 'function' ? friendlyError(error, 'Could not send your request').message : (error.message || 'Could not send your request.')); return; }
    form.classList.add('is-done');
    const first = name.split(/\s+/)[0];
    const thanks = document.createElement('div'); thanks.className = 'rf-thanks';
    const b = document.createElement('b'); b.textContent = 'Thanks, ' + first + '.';
    thanks.append(b, document.createTextNode('We will call you' + (val('rfWhen') ? ' (' + val('rfWhen') + ')' : '') + ' to set up your demo. Nothing else to do for now.'));
    form.insertBefore(thanks, msg); say('', true);
  });
  // "Book a demo call" further down the page brings you back to the slip
  document.querySelectorAll('[data-rf-demo]').forEach(b => b.addEventListener('click', () => {
    if(form.scrollIntoView) form.scrollIntoView({ behavior: window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'center' });
    setTimeout(() => { const n = document.getElementById('rfName'); if(n) n.focus({ preventScroll: true }); }, 350);
  }));
})();

// any remaining "Get started" buttons do the same as the account button in the slip
document.querySelectorAll('[data-lx-start]').forEach(b => b.addEventListener('click', () => { const s = document.getElementById('landingSignup'); if(s) s.click(); }));
