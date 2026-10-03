// RelayFleet — install to home screen (Phase 10).
(function(){
  if('serviceWorker' in navigator){
    window.addEventListener('load', () => { navigator.serviceWorker.register('/sw.js').catch(e => console.warn('service worker', e)); });
  }
  const standalone = window.matchMedia && window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;
  const isIOS = /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  let deferred = null;
  function buttons(){ return document.querySelectorAll('.nav-install'); }
  function show(on){ buttons().forEach(b => b.classList.toggle('hidden', !on)); }
  window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); deferred = e; show(true); });
  window.addEventListener('appinstalled', () => { deferred = null; show(false); });
  document.addEventListener('click', async (e) => {
    const b = e.target.closest('.nav-install');
    if(!b) return;
    if(deferred){ deferred.prompt(); try { await deferred.userChoice; } catch(_){} deferred = null; show(false); return; }
    if(isIOS) alert('To install Relay on your iPhone or iPad:\n\n1. Tap the Share button (square with an arrow) at the bottom of Safari.\n2. Tap "Add to Home Screen".\n3. Tap "Add".');
  });
  // iPhone/iPad never fire the install prompt; offer the steps instead.
  document.addEventListener('DOMContentLoaded', () => { if(isIOS && !standalone) show(true); });
})();
