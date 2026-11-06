// ============================================================
// RelayFleet — Appearance. Each person picks their own look on this device:
// light or dark, how frosted the glass is, the accent colour, and whether the
// water background moves. Loads first in <head> so the chosen look is there from
// the very first paint. Stored only on this device (localStorage).
// ============================================================
(function(){
  var KEY = 'relay_look';
  var ACCENTS = {
    blue:     { a:'#0A6CD6', b:'#0A84FF', label:'Blue' },
    teal:     { a:'#0D7A86', b:'#14A3B3', label:'Teal' },
    violet:   { a:'#6A4BD8', b:'#8A6BF0', label:'Violet' },
    graphite: { a:'#3A4656', b:'#5B6B80', label:'Graphite' }
  };
  var DEFAULTS = { mode:'light', glass:55, accent:'blue', motion:'on' };

  function hexToRgb(h){
    var n = parseInt(h.slice(1), 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255].join(',');
  }
  function read(){
    var v = {};
    try { v = JSON.parse(localStorage.getItem(KEY) || '{}') || {}; } catch(e){}
    try {
      // people who chose dark mode before this panel existed keep dark mode
      if(!localStorage.getItem(KEY) && localStorage.getItem('relay_theme') === 'dark') v.mode = 'dark';
    } catch(e){}
    var out = {};
    for(var k in DEFAULTS) out[k] = (v[k] !== undefined && v[k] !== null) ? v[k] : DEFAULTS[k];
    if(!ACCENTS[out.accent]) out.accent = DEFAULTS.accent;
    if(out.mode !== 'dark') out.mode = 'light';
    out.glass = Math.min(100, Math.max(0, Number(out.glass) || 0));
    return out;
  }
  function apply(s){
    var root = document.documentElement;
    if(s.mode === 'dark') root.setAttribute('data-theme', 'dark'); else root.removeAttribute('data-theme');
    root.setAttribute('data-accent', s.accent);
    root.setAttribute('data-motion', s.motion === 'off' ? 'off' : 'on');
    var acc = ACCENTS[s.accent];
    root.style.setProperty('--g-alpha', (0.22 + s.glass / 100 * 0.7).toFixed(2));
    root.style.setProperty('--accent', acc.a);
    root.style.setProperty('--accent-2', acc.b);
    root.style.setProperty('--accent-soft', 'rgba(' + hexToRgb(acc.a) + ',' + (s.mode === 'dark' ? '.22' : '.13') + ')');
  }
  function save(s){
    try { localStorage.setItem(KEY, JSON.stringify(s)); } catch(e){}
    apply(s);
    if(typeof window.relayLookChanged === 'function') window.relayLookChanged(s);
  }

  window.relayLook = {
    get: read,
    set: function(patch){ save(Object.assign(read(), patch)); },
    setMode: function(mode){ save(Object.assign(read(), { mode: mode === 'dark' ? 'dark' : 'light' })); },
    accents: ACCENTS
  };

  apply(read());

  // ----- the Aa button and its panel (every page, including sign-in) -----
  function build(){
    if(document.getElementById('lookBtn')) return;
    var btn = document.createElement('button');
    btn.type = 'button'; btn.id = 'lookBtn'; btn.className = 'look-fab';
    btn.setAttribute('aria-label', 'Appearance'); btn.setAttribute('aria-expanded', 'false');
    btn.title = 'Appearance';
    btn.textContent = 'Aa';

    var panel = document.createElement('div');
    panel.id = 'lookPanel'; panel.className = 'look-panel hidden'; panel.setAttribute('role', 'dialog'); panel.setAttribute('aria-label', 'Appearance');
    panel.innerHTML =
      '<div class="look-head"><b>Appearance</b><button type="button" class="look-close" aria-label="Close">&times;</button></div>' +
      '<div class="look-row"><span class="look-label">Mode</span>' +
        '<div class="look-seg" role="group" aria-label="Mode">' +
          '<button type="button" data-mode="light">Light</button><button type="button" data-mode="dark">Dark</button>' +
        '</div></div>' +
      '<div class="look-row"><label class="look-label" for="lookGlass">Glass</label>' +
        '<input type="range" id="lookGlass" min="0" max="100" step="5" aria-describedby="lookGlassVal"><span id="lookGlassVal" class="look-val"></span></div>' +
      '<div class="look-row"><span class="look-label">Colour</span><div class="look-swatches" role="group" aria-label="Colour">' +
        Object.keys(ACCENTS).map(function(k){ return '<button type="button" data-accent="' + k + '" title="' + ACCENTS[k].label + '" aria-label="' + ACCENTS[k].label + '" style="background:' + ACCENTS[k].a + '"></button>'; }).join('') +
      '</div></div>' +
      '<div class="look-row"><label class="look-label" for="lookMotion">Moving water</label><input type="checkbox" id="lookMotion"></div>' +
      '<p class="look-note">Saved on this device. Turning on "Reduce motion" in your system settings also stops the water.</p>';

    document.body.appendChild(btn);
    document.body.appendChild(panel);

    function sync(){
      var s = read();
      panel.querySelectorAll('[data-mode]').forEach(function(b){ b.classList.toggle('on', b.dataset.mode === s.mode); b.setAttribute('aria-pressed', String(b.dataset.mode === s.mode)); });
      panel.querySelectorAll('[data-accent]').forEach(function(b){ b.classList.toggle('on', b.dataset.accent === s.accent); });
      var g = document.getElementById('lookGlass'); g.value = s.glass;
      document.getElementById('lookGlassVal').textContent = s.glass < 30 ? 'Clear' : s.glass < 70 ? 'Frosted' : 'Solid';
      document.getElementById('lookMotion').checked = s.motion !== 'off';
    }
    function open(on){
      panel.classList.toggle('hidden', !on);
      btn.setAttribute('aria-expanded', String(on));
      if(on){ sync(); }
    }
    btn.addEventListener('click', function(e){ e.stopPropagation(); open(panel.classList.contains('hidden')); });
    panel.querySelector('.look-close').addEventListener('click', function(){ open(false); btn.focus(); });
    panel.querySelectorAll('[data-mode]').forEach(function(b){ b.addEventListener('click', function(){ window.relayLook.set({ mode: b.dataset.mode }); sync(); }); });
    panel.querySelectorAll('[data-accent]').forEach(function(b){ b.addEventListener('click', function(){ window.relayLook.set({ accent: b.dataset.accent }); sync(); }); });
    document.getElementById('lookGlass').addEventListener('input', function(e){ window.relayLook.set({ glass: Number(e.target.value) }); sync(); });
    document.getElementById('lookMotion').addEventListener('change', function(e){ window.relayLook.set({ motion: e.target.checked ? 'on' : 'off' }); });
    document.addEventListener('click', function(e){ if(!panel.classList.contains('hidden') && !panel.contains(e.target) && e.target !== btn) open(false); });
    document.addEventListener('keydown', function(e){ if(e.key === 'Escape' && !panel.classList.contains('hidden')){ open(false); btn.focus(); } });
  }
  if(document.readyState === 'loading') document.addEventListener('DOMContentLoaded', build); else build();
})();
