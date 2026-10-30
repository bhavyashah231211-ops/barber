// Customer booking page: /customer/?b=<business-slug>
import { sb, must, rpc } from '../assets/js/core/supa.js';
import { h, field, formData, run, money, modal, statusBadge, confirmBox, toast } from '../assets/js/core/ui.js';
import { authCard, watchRecovery, getUser, signOut } from '../assets/js/core/auth.js';
import { slotPicker } from '../assets/js/core/slots.js';
import { fmtDateTime, fmtTime } from '../assets/js/core/time.js';
import { downloadIcs } from '../assets/js/core/ics.js';

const root = document.getElementById('root'), slug = (new URLSearchParams(location.search).get('b') || '').toLowerCase();
const page = (...k) => root.replaceChildren(h('div', { class: 'wrap' }, ...k));
const center = n => root.replaceChildren(h('div', { class: 'center' }, n));
watchRecovery();

async function start() {
  if (!slug) return center(h('div', { class: 'card auth' }, h('h2', {}, 'Book online'), h('p', { class: 'sub' }, 'Please use the booking link from your salon.')));
  const pub = must(await sb.rpc('sl_public_business', { p_slug: slug }))[0];
  if (!pub) return center(h('div', { class: 'card auth' }, h('h2', {}, 'Not found'), h('p', { class: 'sub' }, 'We could not find that business. Check the link.')));
  document.documentElement.style.setProperty('--ac', pub.accent); document.title = pub.name + ' · Book online';
  if (!pub.open) return center(h('div', { class: 'card auth' }, h('h2', {}, pub.name), h('p', { class: 'sub' }, 'Online booking is currently unavailable. Please contact us' + (pub.phone ? ' on ' + pub.phone : '') + '.')));
  if (!(await getUser())) return center(authCard({ title: pub.name, sub: 'Sign in or create an account to book.', signup: true, phone: true, onSignedIn: start }));
  try { await signedIn(pub); } catch (e) { console.error(e); center(h('div', { class: 'card auth' }, h('p', { class: 'err' }, e.message), h('button', { class: 'btn', onclick: signOut }, 'Sign out'))); }
}

async function signedIn(pub) {
  const user = await getUser(), meta = user.user_metadata || {};
  await rpc('sl_join_business', { p_slug: slug, p_name: meta.full_name || '', p_phone: meta.phone || null });
  const me = must(await sb.from('sl_profiles').select('*').eq('business_id', pub.id).eq('user_id', user.id).single());
  if (me.role !== 'customer') return center(h('div', { class: 'card auth' }, h('p', {}, 'You are signed in as business staff. Please use the staff app to manage bookings.'), h('button', { class: 'btn', onclick: signOut }, 'Sign out')));
  const [biz, services, staff, links, branches] = await Promise.all([
    sb.from('sl_businesses').select('*').eq('id', pub.id).single().then(must), sb.from('sl_services').select('*').eq('business_id', pub.id).eq('active', true).order('category').order('name').then(must),
    sb.from('sl_staff_public').select('*').eq('business_id', pub.id).then(must), sb.from('sl_staff_services').select('staff_id,service_id').eq('business_id', pub.id).then(must),
    sb.from('sl_branches').select('*').eq('business_id', pub.id).eq('active', true).order('created_at').then(must)]);
  const ctx = { biz, services, staff, links, branches, me, cur: biz.currency, tz: biz.timezone };
  const view = h('div', {}); let tab = 'book';
  const tabs = h('div', { class: 'tabs' });
  const show = t => { tab = t; tabs.replaceChildren(...[['book', 'Book'], ['mine', 'My bookings'], ['me', 'Profile']].map(([k, l]) => h('button', { class: 'btn' + (k === tab ? ' on' : ''), onclick: () => show(k) }, l)));
    view.replaceChildren(); Promise.resolve(({ book, mine, me: profile })[t](view, ctx, show)).catch(e => view.append(h('p', { class: 'err' }, e.message))); };
  page(h('div', { class: 'top' }, h('h1', {}, biz.name)), h('p', { class: 'sub' }, [biz.address, biz.phone].filter(Boolean).join(' · ')), tabs, view); show('book');
}

function book(root, ctx, show) {
  let svc = null, picked = null, branchId = ctx.branches[0]?.id || null;
  const list = h('div', { class: 'list' }), stSel = h('select', { onchange: () => sp.set(params()) }), notes = h('textarea', { maxlength: 500, placeholder: 'Anything we should know? (optional)' });
  const go = h('button', { class: 'btn pri', disabled: true, onclick: async () => {
    go.disabled = true;
    const id = await run(() => rpc('sl_book', { p_business: ctx.biz.id, p_service: svc.id, p_start: picked.start, p_staff: stSel.value || picked.staff_id, p_notes: notes.value, p_branch: branchId }));
    if (!id) { go.disabled = !picked; return; }
    const end = new Date(new Date(picked.start).getTime() + svc.duration_min * 60000).toISOString(), nm = ctx.staff.find(s => s.id === (stSel.value || picked.staff_id))?.name;
    root.replaceChildren(h('div', { class: 'card' }, h('h2', {}, 'You are booked ✓'), h('p', {}, `${svc.name}${nm ? ' with ' + nm : ''}`), h('p', {}, h('b', {}, fmtDateTime(picked.start, ctx.tz))),
      h('div', { class: 'acts', style: { justifyContent: 'flex-start' } }, h('button', { class: 'btn', onclick: () => downloadIcs({ id, start: picked.start, end, title: `${svc.name} – ${ctx.biz.name}`, location: ctx.biz.address }) }, 'Add to calendar'), h('button', { class: 'btn pri', onclick: () => show('mine') }, 'My bookings'))));
  } }, 'Confirm booking');
  const sp = slotPicker({ biz: ctx.biz, onPick: p => { picked = p; go.disabled = !p; } });
  const params = () => ({ serviceId: svc?.id, staffId: stSel.value || null, branchId });
  function pickSvc(s) {
    svc = s; draw();
    const ok = new Set(ctx.links.filter(l => l.service_id === s.id).map(l => l.staff_id));
    stSel.replaceChildren(h('option', { value: '' }, 'Any available'), ...ctx.staff.filter(m => ok.has(m.id) && (!branchId || m.branch_id === branchId)).map(m => h('option', { value: m.id }, m.name + (m.title ? ' · ' + m.title : ''))));
    sp.set(params());
  }
  const cats = [...new Set(ctx.services.map(s => s.category || 'Services'))];
  function draw() {
    list.replaceChildren(...cats.flatMap(c => [h('div', { class: 'svc-cat' }, c), ...ctx.services.filter(s => (s.category || 'Services') === c).map(s =>
      h('button', { class: 'opt' + (svc?.id === s.id ? ' on' : ''), onclick: () => pickSvc(s) }, h('span', {}, h('b', {}, s.name), h('br'), h('span', { class: 'sub' }, `${s.duration_min} min${s.description ? ' · ' + s.description : ''}`)), h('b', {}, money(s.price, ctx.cur))))]));
  }
  draw();
  if (!ctx.services.length) return root.append(h('p', { class: 'sub' }, 'No services are available to book yet.'));
  root.append(h('div', { class: 'card' }, h('h2', {}, '1. Choose a service'), list),
    h('div', { class: 'card' }, h('h2', {}, '2. Choose who and when'),
      ctx.branches.length > 1 ? field('Branch', h('select', { onchange: e => { branchId = e.target.value; if (svc) pickSvc(svc); } }, ctx.branches.map(b => h('option', { value: b.id }, b.name)))) : null,
      field('With', stSel), h('div', { class: 'mt' }, sp.el)),
    h('div', { class: 'card' }, h('h2', {}, '3. Confirm'), notes, h('div', { class: 'acts' }, go)));
}

async function mine(root, ctx) {
  root.append(h('p', { class: 'sub' }, 'Loading…'));
  const rows = must(await sb.from('sl_bookings').select('*').order('starts_at', { ascending: false }).limit(100)), S = new Map(ctx.services.map(s => [s.id, s])), T = new Map(ctx.staff.map(s => [s.id, s]));
  const now = Date.now(), up = rows.filter(r => new Date(r.ends_at) >= now && ['booked', 'confirmed'].includes(r.status)).reverse(), past = rows.filter(r => !up.includes(r));
  const reload = () => { root.replaceChildren(); mine(root, ctx); };
  const card = r => h('div', { class: 'card' }, h('div', { class: 'bar' }, h('b', { class: 'grow' }, S.get(r.service_id)?.name || 'Booking'), statusBadge(r.status)),
    h('p', {}, fmtDateTime(r.starts_at, ctx.tz), T.get(r.staff_id) ? ' · ' + T.get(r.staff_id).name : ''),
    ['booked', 'confirmed'].includes(r.status) && new Date(r.ends_at) >= now ? h('div', { class: 'acts', style: { justifyContent: 'flex-start' } },
      h('button', { class: 'btn sm', onclick: () => downloadIcs({ id: r.id, start: r.starts_at, end: r.ends_at, title: `${S.get(r.service_id)?.name} – ${ctx.biz.name}`, location: ctx.biz.address }) }, 'Add to calendar'),
      h('button', { class: 'btn sm', onclick: () => move(ctx, r, reload) }, 'Reschedule'),
      h('button', { class: 'btn sm red', onclick: async () => { if (await confirmBox('Cancel this booking?') && await run(() => rpc('sl_cancel', { p_booking: r.id, p_reason: 'Cancelled by customer' }), 'Booking cancelled')) reload(); } }, 'Cancel')) : null);
  root.replaceChildren(h('h2', {}, 'Upcoming'), ...(up.length ? up.map(card) : [h('p', { class: 'sub' }, 'No upcoming bookings.')]), h('h2', { class: 'mt' }, 'Past'), ...(past.length ? past.map(card) : [h('p', { class: 'sub' }, 'Nothing yet.')]));
}

function move(ctx, r, done) {
  let picked = null;
  modal('Reschedule', close => {
    const go = h('button', { class: 'btn pri', disabled: true, onclick: async () => { if (await run(() => rpc('sl_reschedule', { p_booking: r.id, p_start: picked.start, p_staff: null }), 'Booking moved')) { close(); done(); } } }, 'Move booking');
    const sp = slotPicker({ biz: ctx.biz, onPick: p => { picked = p; go.disabled = !p; } });
    queueMicrotask(() => sp.set({ serviceId: r.service_id, staffId: r.staff_id, branchId: r.branch_id, excludeId: r.id }));
    return h('div', {}, h('p', { class: 'sub' }, 'We try to keep the same person; if they are busy, someone else is offered.'), sp.el, h('div', { class: 'acts' }, h('button', { class: 'btn', onclick: close }, 'Close'), go));
  });
}

function profile(root, ctx) {
  const f = h('form', { class: 'form', onsubmit: async e => { e.preventDefault(); const d = formData(f); await run(() => rpc('sl_update_my_profile', { p_business: ctx.biz.id, p_name: d.full_name, p_phone: d.phone }), 'Saved'); } },
    field('Name', h('input', { name: 'full_name', required: true, maxlength: 80, value: ctx.me.full_name })), field('Phone', h('input', { name: 'phone', type: 'tel', value: ctx.me.phone || '' })),
    field('Email', h('input', { value: ctx.me.email || '', readonly: true }), 'full'), h('div', { class: 'acts full' }, h('button', { type: 'button', class: 'btn', onclick: signOut }, 'Sign out'), h('button', { class: 'btn pri' }, 'Save')));
  root.append(h('div', { class: 'card' }, h('h2', {}, 'Your details'), f));
}

start().catch(e => { console.error(e); center(h('p', { class: 'err' }, e.message)); });
