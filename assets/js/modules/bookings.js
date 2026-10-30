import { sb, must, rpc } from '../core/supa.js';
import { h, field, select, run, table, money, statusBadge, payBadge, modal, confirmBox, toast } from '../core/ui.js';
import { fmtDateTime, fmtTime, fmtDate, todayStr, addDays, dayRange, dateOf } from '../core/time.js';
import { hydrate, who, loadStaff } from '../core/data.js';
import { slotPicker } from '../core/slots.js';
import { paymentPanel } from './payments.js';
import { openBookingDialog } from './booking-form.js';
import { downloadIcs } from '../core/ics.js';

const NEXT = { booked: [['confirmed', 'Confirm'], ['in_progress', 'Start'], ['no_show', 'No-show']], confirmed: [['in_progress', 'Start'], ['completed', 'Complete'], ['no_show', 'No-show']], in_progress: [['completed', 'Complete']] };

// Booking detail: status actions, notes, reschedule, cancel, payments.
export async function openBooking(ctx, row, onChange) {
  const [b] = row.service ? [row] : await hydrate([row]);
  modal(`${b.service?.name || 'Booking'} · ${who(b)}`, close => {
    const changed = () => { onChange && onChange(); };
    const act = (fn, msg) => async () => { if (await run(fn, msg)) { changed(); close(); } };
    const notes = h('textarea', { maxlength: 500 }, b.notes || ''); notes.value = b.notes || '';
    const live = ['booked', 'confirmed', 'in_progress'].includes(b.status);
    return h('div', {},
      h('p', {}, statusBadge(b.status), ' ', h('b', {}, fmtDateTime(b.starts_at, ctx.tz)), ` – ${fmtTime(b.ends_at, ctx.tz)} · ${b.staff?.name || ''}`),
      h('p', { class: 'sub' }, [b.customer?.phone, b.customer?.email, b.source === 'walk_in' ? 'Walk-in' : b.source === 'online' ? 'Booked online' : ''].filter(Boolean).join(' · ')),
      h('div', { class: 'acts', style: { justifyContent: 'flex-start' } },
        (NEXT[b.status] || []).map(([s, t]) => h('button', { class: 'btn sm', onclick: act(async () => must(await sb.from('sl_bookings').update({ status: s }).eq('id', b.id)), 'Updated') }, t)),
        ['booked', 'confirmed'].includes(b.status) ? h('button', { class: 'btn sm', onclick: () => reschedule(ctx, b, () => { changed(); close(); }) }, 'Reschedule') : null,
        live ? h('button', { class: 'btn sm red', onclick: async () => { if (await confirmBox('Cancel this booking?')) act(async () => rpc('sl_cancel', { p_booking: b.id, p_reason: 'Cancelled by staff' }), 'Cancelled')(); } }, 'Cancel booking') : null,
        h('button', { class: 'btn sm', onclick: () => downloadIcs({ id: b.id, start: b.starts_at, end: b.ends_at, title: `${b.service?.name} – ${who(b)}`, location: ctx.biz.address }) }, '.ics')),
      field('Notes', notes), h('div', { class: 'acts' }, h('button', { class: 'btn sm', onclick: act(async () => must(await sb.from('sl_bookings').update({ notes: notes.value || null }).eq('id', b.id)), 'Notes saved') }, 'Save notes')),
      b.status === 'cancelled' ? null : (() => { const holder = h('div', {}); paymentPanel(ctx, b, changed).then(p => holder.replaceChildren(p)); return holder; })());
  }, { wide: true });
}

function reschedule(ctx, b, done) {
  let picked = null;
  modal('Reschedule', close => {
    const go = h('button', { class: 'btn pri', disabled: true, onclick: async () => { if (await run(() => rpc('sl_reschedule', { p_booking: b.id, p_start: picked.start, p_staff: null }), 'Rescheduled')) { close(); done(); } } }, 'Move booking');
    const sp = slotPicker({ biz: ctx.biz, onPick: p => { picked = p; go.disabled = !p; } });
    queueMicrotask(() => sp.set({ serviceId: b.service_id, staffId: b.staff_id, branchId: b.branch_id, excludeId: b.id, date: dateOf(b.starts_at, ctx.tz) > todayStr(ctx.tz) ? dateOf(b.starts_at, ctx.tz) : todayStr(ctx.tz) }));
    return h('div', {}, h('p', { class: 'sub' }, `Keeps ${b.staff?.name || 'the same staff member'} when possible.`), sp.el, h('div', { class: 'acts' }, h('button', { class: 'btn', onclick: close }, 'Close'), go));
  });
}

export async function render(root, ctx) {
  const st = { from: todayStr(ctx.tz), to: addDays(todayStr(ctx.tz), 7), status: '', staff: ctx.role === 'staff' ? ctx.staffId || '' : '', text: '' };
  const staff = await loadStaff(ctx.biz);
  const out = h('div', { class: 'card' });
  const bar = h('div', { class: 'bar' },
    field('From', h('input', { type: 'date', value: st.from, onchange: e => { st.from = e.target.value; load(); } })), field('To', h('input', { type: 'date', value: st.to, onchange: e => { st.to = e.target.value; load(); } })),
    field('Status', select('', [['', 'All'], ['booked', 'Booked'], ['confirmed', 'Confirmed'], ['in_progress', 'In progress'], ['completed', 'Completed'], ['cancelled', 'Cancelled'], ['no_show', 'No-show']], '', { onchange: e => { st.status = e.target.value; load(); } })),
    field('Staff', select('', [['', 'Everyone'], ...staff.map(s => [s.id, s.name])], st.staff, { onchange: e => { st.staff = e.target.value; load(); } })),
    field('Search', h('input', { placeholder: 'Customer name', oninput: e => { st.text = e.target.value.toLowerCase(); draw(); } }), 'grow'),
    h('button', { class: 'btn', onclick: () => openBookingDialog(ctx, { walkIn: true, staffId: ctx.staffId, onDone: load }) }, 'Walk-in'),
    h('button', { class: 'btn pri', onclick: () => openBookingDialog(ctx, { staffId: ctx.staffId, onDone: load }) }, '+ New booking'));
  root.append(bar, out);
  let rows = [];
  function draw() {
    const list = rows.filter(r => !st.text || who(r).toLowerCase().includes(st.text));
    out.replaceChildren(table([{ h: 'When', cls: 'nw', r: b => `${fmtDate(b.starts_at, ctx.tz)} ${fmtTime(b.starts_at, ctx.tz)}` }, { h: 'Customer', r: b => who(b) }, { h: 'Service', r: b => b.service?.name || '' },
      { h: 'Staff', r: b => b.staff?.name || '' }, { h: 'Price', cls: 'r', r: b => money(b.price, ctx.cur) }, { h: 'Status', r: b => statusBadge(b.status) }, { h: 'Payment', r: b => (b.status === 'cancelled' ? '' : payBadge(b.pay?.pay_status)) }],
      list, 'No bookings match.', b => openBooking(ctx, b, load)));
  }
  async function load() {
    out.replaceChildren(h('p', { class: 'sub' }, 'Loading…'));
    try {
      let q = sb.from('sl_bookings').select('*').eq('business_id', ctx.biz.id).gte('starts_at', dayRange(st.from, ctx.tz)[0]).lt('starts_at', dayRange(st.to, ctx.tz)[1]).order('starts_at').limit(500);
      if (st.status) q = q.eq('status', st.status); if (st.staff) q = q.eq('staff_id', st.staff);
      rows = await hydrate(must(await q)); draw();
    } catch (e) { out.replaceChildren(h('p', { class: 'err' }, e.message)); }
  }
  load();
}
