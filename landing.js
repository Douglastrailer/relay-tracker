// ============================================================
// RelayFleet landing — the hero scene: one roadside call, from
// dispatch to invoice, in ~14 seconds. Pauses when off-screen or
// when the tab is hidden; shows the finished job, still, to anyone
// whose device asks for reduced motion.
// ============================================================
(function(){
  const scene = document.getElementById('lxScene');
  if(!scene) return;
  const $ = id => document.getElementById(id);
  const route = $('lxRoute'), mech = $('lxMech'), eta = $('lxEta'), etaMin = $('lxEtaMin');
  const status = $('lxStatus'), accept = $('lxAccept'), labor = $('lxLabor'), parts = $('lxParts'), total = $('lxTotal'), foot = $('lxFoot');
  const LEN = route.getTotalLength ? route.getTotalLength() : 0;
  const RATE = 135, TIRE = 412, LOOP = 14000;
  const money = n => '$' + n.toLocaleString('en-US', { minimumFractionDigits:2, maximumFractionDigits:2 });
  const setStatus = (s, label) => { if(status.dataset.s !== s){ status.dataset.s = s; status.textContent = label; } };
  function place(p){
    if(!LEN) return;
    const pt = route.getPointAtLength(LEN * Math.max(0, Math.min(1, p)));
    mech.style.left = (pt.x / 520 * 100) + '%'; mech.style.top = (pt.y / 360 * 100) + '%';
  }
  const ease = x => x < .5 ? 2 * x * x : 1 - Math.pow(-2 * x + 2, 2) / 2;
  function frame(t){            // t: ms into the loop
    const drive = Math.max(0, Math.min(1, (t - 1200) / 6000));
    place(ease(drive));
    scene.classList.toggle('lx-driving', t >= 1200 && t < 7200);
    if(t < 1200){ setStatus('assigned', 'Assigned'); accept.textContent = 'Waiting to accept'; accept.className = ''; eta.classList.remove('show', 'arrived'); }
    else { accept.textContent = 'Accepted'; accept.className = 'ok'; }
    if(t >= 1200 && t < 7200){ setStatus('enroute', 'En route'); eta.classList.add('show'); eta.classList.remove('arrived'); etaMin.textContent = String(Math.max(1, Math.round(18 * (1 - ease(drive))))); eta.lastElementChild.textContent = 'min away'; }
    if(t >= 7200){ eta.classList.add('show', 'arrived'); etaMin.textContent = '✓'; eta.lastElementChild.textContent = 'Arrived'; }
    if(t >= 7200 && t < 8200) setStatus('onsite', 'On site');
    const workMin = t < 8200 ? 0 : Math.min(75, (t - 8200) / 3300 * 75);   // 1 h 15 m of labor, sped up
    if(t >= 8200 && t < 11500) setStatus('repairing', 'Repairing');
    labor.textContent = Math.floor(workMin / 60) + ':' + String(Math.floor(workMin % 60)).padStart(2, '0');
    const hasPart = t >= 9300;
    parts.textContent = hasPart ? 'Steer tire · ' + money(TIRE) : '—';
    total.textContent = money(workMin / 60 * RATE + (hasPart ? TIRE : 0));
    if(t >= 11500){ setStatus('done', 'Completed'); foot.textContent = 'Invoice #1048 sent · ' + money(75 / 60 * RATE + TIRE); foot.classList.add('sent'); }
    else { foot.textContent = t >= 7200 ? 'ABC Logistics sees the repair live' : t >= 1200 ? 'ABC Logistics is watching the ETA' : 'Customer can follow along'; foot.classList.remove('sent'); }
  }
  const reduced = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if(reduced || !LEN){ frame(13000); return; }
  let start = null, raf = null, visible = true, paused = 0;
  function loop(now){
    if(start === null) start = now - paused;
    const t = (now - start) % LOOP;
    paused = t; frame(t);
    raf = requestAnimationFrame(loop);
  }
  const run = () => { if(raf === null && visible && !document.hidden){ start = null; raf = requestAnimationFrame(loop); } };
  const stop = () => { if(raf !== null){ cancelAnimationFrame(raf); raf = null; } };
  if('IntersectionObserver' in window) new IntersectionObserver(es => { visible = es[0].isIntersecting; visible ? run() : stop(); }, { threshold: .15 }).observe(scene);
  document.addEventListener('visibilitychange', () => document.hidden ? stop() : run());
  frame(0); run();
})();
