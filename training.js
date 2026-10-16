// ============================================================
// RelayFleet — in-app training. Help & support opens this guide.
// Short, plain steps. Shown by role: shop owner/office, mechanic, fleet.
// Keep each step to one action, using the exact button names in the app.
// ============================================================
const TRAINING = [
 { id:'start', title:'Getting started', roles:['shop','mechanic','fleet'], items:[
   { q:'Set up your company', roles:['shop'], steps:['Click **Settings** and add your company name, address, phone and logo.','Set your **labor rate** and **sales tax**.','Check the **Get your shop ready** list on the Dashboard — it ticks off as you go.'] },
   { q:'Invite your mechanics and office', roles:['shop'], steps:['Click **More** → **Technicians & team**.','Share your shop code with each person.','They sign up, enter the code, and you set their role.'] },
   { q:'Put Relay on your phone', roles:['shop','mechanic'], steps:['**iPhone:** open relayfleet.us in Safari → **Share** → **Add to Home Screen**.','**Android:** open relayfleet.us in Chrome → menu → **Install app**.','Open Relay from its icon.'] },
   { q:'Turn on alerts', roles:['shop','mechanic'], steps:['Open Relay from its home-screen icon.','Go to **Settings** → **Notifications**.','Tap **Turn on alerts on this phone**, then **Allow**.'] },
   { q:'Bring in your customers, trucks and parts', roles:['shop'], steps:['Export your data from your old system as CSV or Excel.','Click **More** → **Integrations** → **Import from a spreadsheet**.','Click **Bring everything over**, add the files, then **Import**.'] } ]},
 { id:'office', title:'Office', roles:['shop'], items:[
   { q:'Create a work order', steps:['Click **Work orders** → **+ New work order**.','Choose the customer, the unit and the problem. Priority and VIN are under **More details**.','Click **Create work order**.'] },
   { q:'Assign a mechanic', steps:['Open the work order.','Choose a mechanic in **Assign mechanic**.','The mechanic gets an alert on their phone.'] },
   { q:'Work order tabs', steps:['**Overview** shows status and details.','**Diagnosis**, **Labor**, **Parts**, **Photos** and **History** hold the job\'s work.','**Estimate & invoice** holds the money.'] },
   { q:'Use the shop board', steps:['Open the **Dashboard** and scroll to **Shop board**.','Drag a card to the next column to change its status. Tap **Undo** if you made a mistake.','Click a card to open it.'] },
   { q:'Service requests from customers', steps:['A new request appears as **new** in Relay, with an alert.','Open it and check the details.','Click **Convert to work order**.'] },
   { q:'Ask Natasha', steps:['Click **Ask Natasha** at the bottom right.','Read today\'s briefing, or type a question.','Tap a work order number in her answer to open it.'] } ]},
 { id:'dispatch', title:'Road calls and dispatch', roles:['shop'], items:[
   { q:'See road calls on the map', steps:['Click **Dispatch**.','Road calls waiting for a mechanic are pinned on the map.','Click one to see the mechanics ranked by distance.'] },
   { q:'Send a road call to a mechanic', steps:['Select the road call on **Dispatch**.','Click **Assign** next to the nearest available mechanic.','They get an alert and have to accept.'] } ]},
 { id:'phone', title:'On the mechanic\'s phone', roles:['mechanic'], items:[
   { q:'Accept a road call', steps:['Open the alert, or go to **My jobs**.','Tap **Accept**, or **Decline** and give a reason.'] },
   { q:'Go on the job', steps:['Tap **On my way** when you leave. Location sharing starts.','Keep Relay open: phones pause location when the app is closed or the screen is locked.','Tap **Arrived** when you get there, then **Start repair** to start the labor timer.'] },
   { q:'Add parts', steps:['Open the job and go to **Parts**.','Type the part, or tap **Scan** and scan its barcode.','Set the quantity and tap **Add part**.'] },
   { q:'Add photos and notes', steps:['Go to **Photos** and take a picture.','Write what you found under **Diagnosis**.','Parts and photos are saved to the job as you add them.'] },
   { q:'Finish the job', steps:['Tap **Stop repair** when the work is done.','Tap **Complete job**.'] },
   { q:'Use your voice', steps:['Tap the **mic** and wait for the chime.','Say "start repair", "add two brake drums" or "what\'s wrong?"','Relay answers out loud, and asks before adding parts.'] },
   { q:'Clock in and out', steps:['Tap **Clock in** at the start of your shift.','Tap **Clock out** at the end.'] } ]},
 { id:'money', title:'Estimates, invoices and payments', roles:['shop'], items:[
   { q:'Create an estimate', steps:['Open the work order and click **Create estimate**.','Add the labor and parts. Or click **Draft with Natasha**.','Check the lines and click **Save**.'] },
   { q:'Send an estimate for approval', steps:['Click **Send**, or **Copy approval link** to text it.','The customer taps **Approve** or **Decline** on their phone.','You see the answer on the work order.'] },
   { q:'Record a phone approval', steps:['Open the estimate.','Click **Approved by phone**.','Enter who approved it.'] },
   { q:'Create an invoice', steps:['Open the approved estimate.','Click **Create invoice** from the approved lines.','Check the invoice number, like INV-0042.'] },
   { q:'Send an invoice and record payment', steps:['Click **PDF** to view or share it.','Click **Email invoice** to send it.','When paid, click **Record payment** and enter the amount.'] } ]},
 { id:'parts', title:'Parts and inventory', roles:['shop'], items:[
   { q:'Add a part', steps:['Click **Inventory** → **Add part or service**.','Enter the name, part number, cost, price and minimum quantity.','Click **Save**.'] },
   { q:'Find a part by scanning', steps:['In **Inventory**, click **Scan part**.','Point the camera at the barcode, or type the code.','If Relay doesn\'t know the barcode, link it to a part once.'] },
   { q:'Scan a vendor invoice', steps:['Click **Scan vendor invoice**.','Take a photo or choose the PDF.','Check each line, then confirm. Stock goes up.'] },
   { q:'Check a part fits a truck', steps:['Add the part to a job from its **Parts** tab.','Relay shows **Fits**, **Doesn\'t match** or **Unknown**.','If it doesn\'t match, Relay asks before adding it.'] } ]},
 { id:'customers', title:'Customers, trucks and history', roles:['shop'], items:[
   { q:'Add a customer', steps:['Click **Customers** → **Add customer**.','Enter the company, contact, phone and email.','Click **Save**.'] },
   { q:'Add a truck or trailer', steps:['Click **Units** → **Add unit**.','Enter the unit number, type and VIN.','Click **VIN details** to fill in the year, make and model from the VIN.'] },
   { q:'See a truck\'s repair history', steps:['Click **Units** and open the unit.','Every past job is listed. Tap one to open it.'] } ]},
 { id:'business', title:'Running the business', roles:['shop'], items:[
   { q:'See reports and profit', steps:['Click **More** → **Reports**.','Choose a date range.','Check profit by customer, technician and location.'] },
   { q:'Add a second location', steps:['Click **Settings** → **Locations** → **Add location**.','Enter its address and drag the pin into place.','Choose who works there.'] },
   { q:'Your plan and billing', steps:['Click **Settings** → **Plan & billing**.','See your plan and trial days left.','Click **Subscribe** or **Contact Relay** to change it.'] } ]},
 { id:'fleet', title:'Fleet portal', roles:['fleet'], items:[
   { q:'Request service', steps:['Click **My shops** and choose a shop.','Click **Request service** and fill in the truck and the problem.','Click **Send**.'] },
   { q:'Follow a repair', steps:['Open **Repairs** to see active jobs.','Watch the mechanic\'s ETA on the job.'] },
   { q:'Approve an estimate', steps:['When the **Dashboard** shows "needs your approval", click **Review & approve**.','Tap **Approve** or **Decline**.'] },
   { q:'Find a shop', steps:['Click **Find shops** to see shops on the map.','Tap a shop to call it, get directions, or request service.'] } ]}
];
let trainingRole = null;
function trainingRoleNow(){ return (session && session.role) || 'shop'; }
function trainingStep(s){ return esc(s).replace(/\*\*(.+?)\*\*/g, '<b>$1</b>'); }
function trainingHtml(query){
  const role = trainingRoleNow(), q = (query || '').trim().toLowerCase();
  let out = '';
  TRAINING.filter(sec => sec.roles.includes(role)).forEach(sec => {
    const items = sec.items.filter(it => (it.roles || sec.roles).includes(role))
      .filter(it => !q || (it.q + ' ' + it.steps.join(' ')).toLowerCase().includes(q));
    if(!items.length) return;
    out += `<h3 class="tr-sec">${esc(sec.title)}</h3>` + items.map(it =>
      `<details class="tr-item"><summary>${esc(it.q)}</summary><ol>${it.steps.map(s => `<li>${trainingStep(s)}</li>`).join('')}</ol></details>`).join('');
  });
  return out || `<p class="meta">Nothing matches "${esc(query)}". Try a shorter word.</p>`;
}
function openTraining(query){
  const node = document.createElement('div'); node.className = 'tr-box';
  node.innerHTML = `<p class="meta tr-intro">Short steps for the things you do every day. Tap a question to open it.</p>
    <input type="search" class="tr-search" id="trSearch" placeholder="Search, e.g. invoice, parts, phone" aria-label="Search training">
    <div id="trList">${trainingHtml(query || '')}</div>
    <div class="tr-foot"><span class="meta">Still stuck?</span><button type="button" class="ghost-btn" id="trContact">Contact support</button></div>`;
  openFormSheet('Training', [node], () => node.remove());
  if(query){ node.querySelector('#trSearch').value = query; }
  node.querySelector('#trSearch').addEventListener('input', (e) => { node.querySelector('#trList').innerHTML = trainingHtml(e.target.value); });
  node.querySelector('#trContact').onclick = () => { closeFormSheet(); const c = document.getElementById('contactUsBtn'); if(c) c.click(); };
}
document.addEventListener('click', (e) => { if(e.target.closest && e.target.closest('.nav-help')){ e.preventDefault(); openTraining(); } }, true);
