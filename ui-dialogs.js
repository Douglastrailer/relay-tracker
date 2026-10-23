// ============================================================
// RelayFleet — in-app messages and confirmations.
// Replaces the browser's alert() and confirm() boxes, which block the screen,
// cannot be styled and do not match Relay. Every message is written to say what
// happened and what to do next. Technical detail is kept in small print for support.
// ============================================================

// The database and the network report errors in technical words. Turn the common ones
// into plain language. Anything not recognised keeps its original text as the detail.
function friendlyError(err, action){
  const raw = String((err && (err.message || err.details || err)) || '').trim();
  const code = err && err.code ? String(err.code) : '';
  const lower = raw.toLowerCase();
  let say;
  if(code === '42501' || /row-level security|permission denied|not allowed|only the shop owner|only relay|only the owner/.test(lower)){
    say = "You don't have permission to do this. Ask the shop owner if you need it.";
  } else if(code === '23505' || /duplicate key|already exists|unique/.test(lower)){
    say = 'That already exists. Check the name or number and try again.';
  } else if(code === '23503' || /foreign key/.test(lower)){
    say = 'This is linked to other records, so it cannot be changed or removed right now.';
  } else if(code === '23514' || /check constraint|violates check|must be|is not valid/.test(lower)){
    say = 'Something in the form is not valid. Check the highlighted fields and try again.';
  } else if(/failed to fetch|networkerror|network request failed|load failed|timed out|timeout|offline|connection (lost|reset|refused|closed|error)/.test(lower) || (typeof navigator !== 'undefined' && navigator.onLine === false)){
    say = "There's no connection right now. Check your signal and try again.";
  } else if(/jwt|session|not authenticated|sign in|expired/.test(lower)){
    say = 'Your sign-in has ended. Sign in again to continue.';
  } else if(code === 'P0001' || (!code && /^[A-Z][^_\n]{2,160}$/.test(raw) && !/violates|relation|column|syntax|constraint|duplicate key|null value|permission denied|function .* does not exist/i.test(raw))){
    // a sentence the app itself wrote for this case, such as "This inspection is finished." — shown exactly
    say = raw;
  } else {
    say = 'Something went wrong on our side.';
  }
  const lead = action ? action.replace(/[.\s]+$/, '') + '. ' : '';
  return { message: lead + say, detail: raw && raw.length < 300 ? raw : '' };
}

let relayDialogSeq = 0;
// A message with one button. Resolves when it is closed.
function relayNotice(text, opts){
  opts = opts || {};
  const kind = opts.kind || 'info';        // 'info' | 'error' | 'success'
  const title = opts.title || (kind === 'error' ? "Couldn't complete that" : kind === 'success' ? 'Done' : 'Relay');
  const detail = opts.detail ? String(opts.detail) : '';
  if(typeof window !== 'undefined' && window.__relayTestHooks && window.__relayTestHooks.notice){ window.__relayTestHooks.notice(text); return Promise.resolve(); }
  return new Promise((resolve) => {
    const id = 'relayDlg' + (++relayDialogSeq);
    const wrap = document.createElement('div');
    wrap.className = 'relay-dlg-backdrop';
    wrap.innerHTML = `<div class="relay-dlg relay-dlg-${kind}" role="${kind === 'error' ? 'alertdialog' : 'dialog'}" aria-modal="true" aria-labelledby="${id}t" aria-describedby="${id}m">
      <h2 id="${id}t">${relayEsc(title)}</h2>
      <p id="${id}m">${relayEsc(text)}</p>
      ${detail ? `<details class="relay-dlg-detail"><summary>Technical detail (for support)</summary><code>${relayEsc(detail)}</code></details>` : ''}
      <div class="relay-dlg-actions"><button type="button" class="relay-dlg-ok">OK</button></div></div>`;
    document.body.appendChild(wrap);
    const ok = wrap.querySelector('.relay-dlg-ok');
    const close = () => { document.removeEventListener('keydown', onKey); wrap.remove(); resolve(); };
    const onKey = (e) => { if(e.key === 'Escape' || e.key === 'Enter') close(); };
    ok.onclick = close; document.addEventListener('keydown', onKey); ok.focus();
  });
}

// A question with two buttons. Resolves true for the confirm button, false otherwise.
function relayConfirm(opts){
  opts = opts || {};
  const text = opts.message || 'Are you sure?';
  if(typeof window !== 'undefined' && window.__relayTestHooks && window.__relayTestHooks.confirm){ return Promise.resolve(window.__relayTestHooks.confirm(text)); }
  const yes = opts.confirmText || 'Yes';
  const no = opts.cancelText || 'Cancel';
  return new Promise((resolve) => {
    const id = 'relayDlg' + (++relayDialogSeq);
    const wrap = document.createElement('div');
    wrap.className = 'relay-dlg-backdrop';
    wrap.innerHTML = `<div class="relay-dlg relay-dlg-confirm" role="alertdialog" aria-modal="true" aria-labelledby="${id}t" aria-describedby="${id}m">
      <h2 id="${id}t">${relayEsc(opts.title || 'Please confirm')}</h2>
      <p id="${id}m">${relayEsc(text)}</p>
      <div class="relay-dlg-actions"><button type="button" class="relay-dlg-no">${relayEsc(no)}</button><button type="button" class="relay-dlg-yes${opts.danger ? ' is-danger' : ''}">${relayEsc(yes)}</button></div></div>`;
    document.body.appendChild(wrap);
    const done = (v) => { document.removeEventListener('keydown', onKey); wrap.remove(); resolve(v); };
    const onKey = (e) => { if(e.key === 'Escape') done(false); };
    wrap.querySelector('.relay-dlg-no').onclick = () => done(false);
    wrap.querySelector('.relay-dlg-yes').onclick = () => done(true);
    document.addEventListener('keydown', onKey);
    wrap.querySelector('.relay-dlg-no').focus();   // the safe choice is focused, so Enter does not delete anything
  });
}

function relayEsc(s){ return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c])); }

// Shows a failure in plain words, with the original detail kept for support.
function relayFail(err, action){
  const f = friendlyError(err, action);
  return relayNotice(f.message, { kind: 'error', detail: f.detail });
}
