// Platform owner console: control which businesses (tenants) can use the app. Access is enforced in the database (sl_platform_admins).
import { rpc } from '../assets/js/core/supa.js';
import { h, field, run, table, modal, select, toast, debounce } from '../assets/js/core/ui.js';
import { authCard, watchRecovery, getUser, signOut } from '../assets/js/core/auth.js';
import { fmtDate } from '../assets/js/core/time.js';

const root = document.getElementById('root'), center = n => root.replaceChildren(h('div', { class: 'center' }, n));
const STATUS = { pending: ['Awaiting approval', 'warn'], trial: ['Trial', 'info'], active: ['Active', 'ok'], past_due: ['Past due', 'warn'], cancelled: ['Suspended', 'bad'] };
const PLAN = { trial: [3, 1], starter: [5, 1], pro: [25, 5] };
watchRecovery();

async function start() {
  if (!(await getUser())) return center(authCard({ title: 'CBSystem · Platform', sub: 'Platform owner sign-in.', signup: false, onSignedIn: start }));
  let ok = false; try { ok = await rpc('sl_is_platform_admin'); } catch { /* not allowed */ }
  if (!ok) return center(h('div', { class: 'card auth' }, h('h2', {}, 'Not authorised'), h('p', { class: 'sub' }, 'This account is not a platform owner.'), h('button', { class: 'btn', onclick: signOut }, 'Sign out')));
  await consoleView();
}

async function consoleView() {
  let rows = [], text = '', status = '', mode = await rpc('sl_platform_signup_mode', {});
  const out = h('div', { class: 'card' }), stats = h('div', { class: 'cards' });
  const modeSel = select('', [['open', 'Open: new businesses start a 30-day trial'], ['approval', 'Approval: new businesses wait until you activate them']], mode,
    { onchange: async e => { if (await run(() => rpc('sl_platform_signup_mode', { p_mode: e.target.value }), 'Sign-up mode saved')) mode = e.target.value; else e.target.value = mode; } });
  root.replaceChildren(h('div', { class: 'wrap', style: { maxWidth: '1100px' } }, h('div', { class: 'top' }, h('h1', { class: 'grow' }, 'CBSystem · Tenants'), h('button', { class: 'btn sm', onclick: signOut }, 'Sign out')),
    h('div', { class: 'card' }, field('New business sign-ups', modeSel)),
    stats, h('div', { class: 'bar' }, field('Search', h('input', { placeholder: 'Business, address or owner email', oninput: debounce(e => { text = e.target.value.toLowerCase(); draw(); }, 200) }), 'grow'),
      field('Status', select('', [['', 'All'], ...Object.entries(STATUS).map(([k, v]) => [k, v[0]])], '', { onchange: e => { status = e.target.value; draw(); } }))), out));
  async function load() {
    try { rows = await rpc('sl_platform_list', {}); } catch (e) { out.replaceChildren(h('p', { class: 'err' }, e.message)); return; }
    const n = s => rows.filter(r => r.sub_status === s).length, stat = (v, l) => h('div', { class: 'stat' }, h('b', {}, v), h('span', {}, l));
    stats.replaceChildren(stat(rows.length, 'Businesses'), stat(n('active'), 'Active'), stat(n('trial'), 'On trial'), stat(n('pending'), 'Awaiting approval'), stat(n('cancelled') + n('past_due'), 'Suspended / past due'));
    draw();
  }
  function draw() {
    const list = rows.filter(r => (!status || r.sub_status === status) && (!text || `${r.name} ${r.slug} ${r.owner_email || ''}`.toLowerCase().includes(text)));
    out.replaceChildren(table([{ h: 'Business', r: r => [h('b', {}, r.name), h('br'), h('span', { class: 'sub' }, r.slug)] }, { h: 'Owner', r: r => r.owner_email || '' }, { h: 'Plan', r: r => r.plan },
      { h: 'Status', r: r => h('span', { class: 'badge ' + (STATUS[r.sub_status]?.[1] || '') }, STATUS[r.sub_status]?.[0] || r.sub_status) }, { h: 'Trial ends', cls: 'nw', r: r => (r.sub_status === 'trial' ? fmtDate(r.trial_ends_at, 'Europe/London') : '') },
      { h: 'Staff', cls: 'r', r: r => `${r.staff_count}/${r.max_staff}` }, { h: 'Bookings 30d', cls: 'r', r: r => r.bookings_30d }, { h: 'Joined', cls: 'nw', r: r => fmtDate(r.created_at, 'Europe/London') }], list, 'No businesses match.', edit));
  }
  function edit(r) {
    modal(r.name, close => {
      const plan = select('plan', Object.keys(PLAN).map(k => [k, k]), r.plan), st = select('status', Object.entries(STATUS).map(([k, v]) => [k, v[0]]), r.sub_status);
      const trial = h('input', { type: 'date', value: (r.trial_ends_at || '').slice(0, 10) }), ms = h('input', { type: 'number', min: '1', value: r.max_staff }), mb = h('input', { type: 'number', min: '1', value: r.max_branches });
      plan.onchange = () => { ms.value = PLAN[plan.value][0]; mb.value = PLAN[plan.value][1]; };
      const save = (over = {}) => async () => {
        const status = over.status || st.value;
        if (await run(() => rpc('sl_platform_update', { p_business: r.id, p_plan: plan.value, p_status: status, p_trial_ends: trial.value ? new Date(trial.value + 'T23:59:00Z').toISOString() : null, p_max_staff: Number(ms.value), p_max_branches: Number(mb.value) }), 'Saved')) { close(); load(); }
      };
      return h('div', {}, h('p', { class: 'sub' }, `${r.owner_email || ''} · booking link: ../customer/?b=${r.slug}`),
        h('div', { class: 'form' }, field('Plan', plan), field('Status', st), field('Trial ends', trial), h('span'), field('Max staff', ms), field('Max branches', mb)),
        h('div', { class: 'acts' }, h('button', { class: 'btn red', onclick: save({ status: 'cancelled' }) }, 'Suspend'), h('button', { class: 'btn', onclick: save() }, 'Save'), h('button', { class: 'btn pri', onclick: save({ status: 'active' }) }, 'Activate & save')));
    });
  }
  load();
}

start().catch(e => { console.error(e); center(h('p', { class: 'err' }, e.message)); });
