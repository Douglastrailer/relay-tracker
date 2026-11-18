// ============================================================
// RelayFleet — the public page (#homeView.rl, site.css).
//  - the product tour: click a screen's name (or use the arrow keys) to show it
//  - the demo request form books a call through request_demo (migration 0052)
//  - "Book a demo" buttons bring you to the form, ready to type
// Nothing moves on its own.
// ============================================================
(function(){
  const list = document.querySelector('.rl-tour-list'); if(!list) return;
  const tabs = [...list.querySelectorAll('.rl-tour-tab')], imgs = [...document.querySelectorAll('.rl-tour-img')];
  const show = (n, focus) => {
    const i = (n + tabs.length) % tabs.length;
    tabs.forEach((t, k) => { const on = k === i; t.classList.toggle('is-on', on); t.setAttribute('aria-selected', String(on)); t.tabIndex = on ? 0 : -1; if(on && focus) t.focus(); });
    imgs.forEach(im => im.classList.toggle('is-on', Number(im.dataset.s) === i));
  };
  tabs.forEach((t, k) => {
    t.addEventListener('click', () => show(k));
    t.addEventListener('keydown', e => { const d = ['ArrowDown', 'ArrowRight'].includes(e.key) ? 1 : ['ArrowUp', 'ArrowLeft'].includes(e.key) ? -1 : 0; if(!d) return; e.preventDefault(); show(tabs.indexOf(t) + d, true); });
  });
  show(0);
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

