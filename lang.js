// ============================================================
// RelayFleet — languages for shop users (owner, office staff, mechanics).
// A translation layer: the app keeps its English text; this file swaps in the
// chosen language for text it recognises EXACTLY (menus, buttons, labels,
// statuses, common messages). Anything it does not recognise — customer names,
// notes, long help text, Natasha's replies — stays as it is.
// Dictionaries live in lang-xx.js and load only when chosen.
// ============================================================
const RELAY_LANGS = { en:'English', es:'Español', ru:'Русский', pt:'Português', fr:'Français' };
let relayLang = 'en', i18nActive = false;
const i18nText = new WeakMap(), i18nAttrs = new WeakMap();
const I18N_ATTRS = ['placeholder', 'title', 'aria-label', 'alt'];
const I18N_SKIP = /^(SCRIPT|STYLE|TEXTAREA|CODE|PRE|SVG)$/i;

function trText(s){
  const d = (window.RELAY_I18N || {})[relayLang]; if(!d || !s) return s;
  const m = String(s).match(/^(\s*)([\s\S]*?)(\s*)$/), core = m[2].replace(/\s+/g, ' ');
  if(!core) return s;
  let out = d.words[core];
  if(out == null) for(const k in d.prefixes){ if(core.startsWith(k)){ out = d.prefixes[k] + trText(core.slice(k.length)); break; } }   // "Moved to Waiting for parts"
  return out == null ? s : m[1] + out + m[3];
}
function i18nSkipped(el){ return !el || I18N_SKIP.test(el.nodeName) || (el.closest && el.closest('[data-no-i18n]')); }
function i18nNode(n){
  if(i18nSkipped(n.parentNode)) return;
  const rec = i18nText.get(n), en = (rec && n.nodeValue === rec.out) ? rec.en : n.nodeValue;   // our own write → remember the English behind it
  const out = trText(en); i18nText.set(n, { en, out });
  if(n.nodeValue !== out) n.nodeValue = out;
}
function i18nAttr(el, a){
  if(i18nSkipped(el) || !el.hasAttribute(a)) return;
  const recs = i18nAttrs.get(el) || {}, rec = recs[a], cur = el.getAttribute(a), en = (rec && cur === rec.out) ? rec.en : cur, out = trText(en);
  recs[a] = { en, out }; i18nAttrs.set(el, recs);
  if(cur !== out) el.setAttribute(a, out);
}
function i18nTree(node){
  if(node.nodeType === 3){ i18nNode(node); return; }
  if(node.nodeType !== 1 || I18N_SKIP.test(node.nodeName)) return;
  I18N_ATTRS.forEach(a => i18nAttr(node, a));
  for(let c = node.firstChild; c; c = c.nextSibling) i18nTree(c);
}
const i18nObserver = new MutationObserver(muts => {
  for(const m of muts){
    if(m.type === 'characterData') i18nNode(m.target);
    else if(m.type === 'childList') m.addedNodes.forEach(i18nTree);
    else if(m.type === 'attributes') i18nAttr(m.target, m.attributeName);
  }
});
// messages shown with alert() / confirm() use the same dictionary
{ const a = window.alert.bind(window), c = window.confirm.bind(window); window.alert = m => a(trText(String(m))); window.confirm = m => c(trText(String(m))); }

function relayLangLoad(code){
  return new Promise(res => {
    if(code === 'en' || (window.RELAY_I18N || {})[code]) return res(true);
    const s = document.createElement('script'); s.src = 'lang-' + code + '.js?v=1';
    s.onload = () => res(!!(window.RELAY_I18N || {})[code]); s.onerror = () => res(false); document.head.appendChild(s);
  });
}
async function relayLangSet(code, opts){
  if(!RELAY_LANGS[code]) code = 'en';
  if(!(await relayLangLoad(code))) code = 'en';          // the file could not be loaded: stay in English
  relayLang = code; document.documentElement.lang = code;
  if(!(opts && opts.persist === false) && typeof session !== 'undefined' && session && session.id){ try { localStorage.setItem('relay.lang.' + session.id, code); } catch(_){} }
  if(!i18nActive){ i18nActive = true; i18nObserver.observe(document.body, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: I18N_ATTRS }); }
  i18nTree(document.body);
  const sel = document.getElementById('langSelect'); if(sel && sel.value !== code) sel.value = code;
  return code;
}
// called when someone signs in: only shop staff and mechanics get the picker
function relayLangInit(){
  const ok = typeof session !== 'undefined' && session && (session.role === 'shop' || session.role === 'mechanic');
  const box = document.getElementById('menuLang'), sel = document.getElementById('langSelect');
  if(box) box.classList.toggle('hidden', !ok);
  if(!ok || !sel) return Promise.resolve('en');
  if(!sel.options.length) sel.innerHTML = Object.entries(RELAY_LANGS).map(([k, v]) => `<option value="${k}">${v}</option>`).join('');
  sel.onchange = () => relayLangSet(sel.value);
  let saved = 'en'; try { saved = localStorage.getItem('relay.lang.' + session.id) || 'en'; } catch(_){}
  sel.value = RELAY_LANGS[saved] ? saved : 'en';
  return saved !== 'en' ? relayLangSet(saved, { persist: false }) : Promise.resolve('en');
}
{ const lo = document.getElementById('logoutBtn'); if(lo) lo.addEventListener('click', () => { relayLangSet('en', { persist: false }); }); }   // the sign-in page is always English
