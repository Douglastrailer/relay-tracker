// ============================================================
// RelayFleet — filters for the shop board: technician, roadside or in-shop, and urgent only.
// Filtering hides cards in place (nothing is reloaded) and the column counts follow.
// ============================================================
const boardFilter = { tech: '', type: '', urgent: false };

function ensureBoardFilters(){
  const board = document.getElementById('shopKanbanBoard'); if(!board || document.getElementById('boardFilters')) return;
  const bar = document.createElement('div');
  bar.id = 'boardFilters'; bar.className = 'board-filters'; bar.setAttribute('role', 'group'); bar.setAttribute('aria-label', 'Filter the board');
  bar.innerHTML = `<label class="bf-field"><span>Technician</span><select id="bfTech"><option value="">Everyone</option></select></label>
    <div class="bf-seg" role="radiogroup" aria-label="Kind of job">${[['', 'All'], ['inshop', 'In shop'], ['mobile', 'Roadside']].map(([v, l]) => `<button type="button" role="radio" aria-checked="${v === ''}" data-bftype="${v}" class="${v === '' ? 'is-on' : ''}">${l}</button>`).join('')}</div>
    <label class="bf-check"><input type="checkbox" id="bfUrgent"> Urgent and high only</label>
    <button type="button" class="text-btn hidden" id="bfClear">Clear filters</button>`;
  board.parentElement.insertBefore(bar, board);
  bar.querySelector('#bfTech').onchange = e => { boardFilter.tech = e.target.value; applyBoardFilters(); };
  bar.querySelectorAll('[data-bftype]').forEach(b => b.onclick = () => {
    boardFilter.type = b.dataset.bftype;
    bar.querySelectorAll('[data-bftype]').forEach(x => { x.classList.toggle('is-on', x === b); x.setAttribute('aria-checked', String(x === b)); });
    applyBoardFilters();
  });
  bar.querySelector('#bfUrgent').onchange = e => { boardFilter.urgent = e.target.checked; applyBoardFilters(); };
  bar.querySelector('#bfClear').onclick = () => {
    boardFilter.tech = ''; boardFilter.type = ''; boardFilter.urgent = false;
    bar.querySelector('#bfTech').value = ''; bar.querySelector('#bfUrgent').checked = false;
    bar.querySelectorAll('[data-bftype]').forEach(x => { const on = x.dataset.bftype === ''; x.classList.toggle('is-on', on); x.setAttribute('aria-checked', String(on)); });
    applyBoardFilters();
  };
}

// fill the technician list from the cards on the board
function refreshBoardTechs(names){
  const sel = document.getElementById('bfTech'); if(!sel) return;
  const keep = sel.value;
  sel.innerHTML = '<option value="">Everyone</option>' + Object.entries(names || {}).sort((a, b) => a[1].localeCompare(b[1])).map(([id, n]) => `<option value="${esc(id)}">${esc(n)}</option>`).join('');
  sel.value = Object.prototype.hasOwnProperty.call(names || {}, keep) ? keep : '';
  boardFilter.tech = sel.value;
}

function applyBoardFilters(){
  const board = document.getElementById('shopKanbanBoard'); if(!board) return;
  const active = !!(boardFilter.tech || boardFilter.type || boardFilter.urgent);
  board.querySelectorAll('.wo-card').forEach(card => {
    const ok = (!boardFilter.tech || card.dataset.tech === boardFilter.tech)
      && (!boardFilter.type || card.dataset.jobtype === boardFilter.type)
      && (!boardFilter.urgent || ['urgent', 'high'].includes(card.dataset.prio));
    card.classList.toggle('hidden', !ok);
  });
  Object.keys(typeof BOARD_COLUMNS !== 'undefined' ? BOARD_COLUMNS : {}).forEach(col => {
    const list = document.getElementById('kanban-' + col), count = document.getElementById('kanbanCount-' + col);
    if(list && count) count.textContent = String(list.querySelectorAll('.wo-card:not(.hidden)').length);
  });
  const clear = document.getElementById('bfClear'); if(clear) clear.classList.toggle('hidden', !active);
}
