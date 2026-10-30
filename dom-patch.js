// ============================================================
// RelayFleet — update only what changed.
// Lists and board columns are refreshed often (live updates, timers). Instead of rebuilding
// everything (which flickers, loses focus and scroll, and re-attaches handlers), each row or
// card is matched by its key: unchanged ones stay exactly as they are, changed ones are
// replaced, new ones are added, gone ones are removed, and the order follows the new list.
// ============================================================
function patchHash(s){ let h = 5381; for(let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0; return String(h >>> 0) + ':' + s.length; }

// items: [{ key, html }] in the order to show; emptyHtml: shown when there are none
function patchChildren(box, items, emptyHtml){
  if(!box) return;
  if(!items.length){
    const sig = patchHash(emptyHtml || '');
    if(box.dataset.emptySig !== sig){ box.innerHTML = emptyHtml || ''; box.dataset.emptySig = sig; }
    return;
  }
  if(box.dataset.emptySig){ box.innerHTML = ''; delete box.dataset.emptySig; }
  const old = new Map();
  [...box.children].forEach(el => { if(el.dataset.pk) old.set(el.dataset.pk, el); else el.remove(); });
  let prev = null;
  for(const { key, html } of items){
    const sig = patchHash(html);
    let el = old.get(key);
    if(el && el.dataset.sig === sig){ old.delete(key); }        // unchanged: keep the very same element
    else {
      const t = document.createElement('template'); t.innerHTML = html.trim();
      const fresh = t.content.firstElementChild; if(!fresh) continue;
      fresh.dataset.pk = key; fresh.dataset.sig = sig;
      if(el){ el.replaceWith(fresh); old.delete(key); }
      el = fresh;
    }
    const want = prev ? prev.nextElementSibling : box.firstElementChild;
    if(want !== el) box.insertBefore(el, want);
    prev = el;
  }
  old.forEach(el => el.remove());
}

// ---- Screen layouts while loading (skeletons) ----
// Grey shapes in the layout of what is coming, instead of "Loading…" text. Screen readers hear
// "Loading"; the shimmer is turned off for people who reduce motion.
function skelRows(n, opts){
  n = n || 4; const w = ['w60', 'w40', 'w75', 'w50', 'w65'];
  return `<div class="skel-wrap" role="status" aria-busy="true" aria-label="Loading"><span class="skel-sr">Loading</span>` +
    Array.from({ length: n }, (_, i) => `<div class="skel-row"><span class="skel ${w[i % w.length]}"></span><span class="skel w25"></span>${opts && opts.wide ? '<span class="skel w15"></span>' : ''}</div>`).join('') + '</div>';
}
function skelTiles(n){
  return `<div class="skel-wrap skel-tiles" role="status" aria-busy="true" aria-label="Loading"><span class="skel-sr">Loading</span>` +
    Array.from({ length: n || 4 }, () => '<div class="skel-tile"><span class="skel w40"></span><span class="skel skel-big w60"></span><span class="skel w50"></span></div>').join('') + '</div>';
}
function skelTableRows(rows, cols){
  return Array.from({ length: rows || 5 }, (_, i) => `<tr class="skel-tr" aria-hidden="${i ? 'true' : 'false'}">` +
    Array.from({ length: cols || 4 }, (_, c) => `<td><span class="skel ${c ? 'w50' : 'w75'}"></span>${!i && !c ? '<span class="skel-sr">Loading</span>' : ''}</td>`).join('') + '</tr>').join('');
}
