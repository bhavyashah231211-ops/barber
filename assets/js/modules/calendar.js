import { sb, must } from '../core/supa.js';
import { h, field, select } from '../core/ui.js';
import { todayStr, addDays, dayRange, minsOfDay, fmtTime, fmtDate } from '../core/time.js';
import { hydrate, who, loadStaff, loadBranches } from '../core/data.js';
import { openBooking } from './bookings.js';
import { openBookingDialog } from './booking-form.js';

const PPM = 1.4, toMin = t => { const [a, b] = t.split(':').map(Number); return a * 60 + b; };

// Day calendar: one column per staff member. Click a booking to open it, click empty space to book.
export async function render(root, ctx) {
  const { biz, tz } = ctx; let date = todayStr(tz), branch = '', only = ctx.role === 'staff' ? ctx.staffId || '' : '';
  const [staff, branches, hours] = await Promise.all([loadStaff(biz, true), loadBranches(biz), sb.from('sl_business_hours').select('*').eq('business_id', biz.id).then(must)]);
  const host = h('div', {}), dateIn = h('input', { type: 'date', value: date, onchange: e => { date = e.target.value || date; load(); } });
  const step = n => { date = addDays(date, n); dateIn.value = date; load(); };
  root.append(h('div', { class: 'bar' },
    h('button', { class: 'btn', onclick: () => step(-1), 'aria-label': 'Previous day' }, '‹'), field('Day', dateIn), h('button', { class: 'btn', onclick: () => step(1), 'aria-label': 'Next day' }, '›'),
    h('button', { class: 'btn', onclick: () => { date = todayStr(tz); dateIn.value = date; load(); } }, 'Today'),
    branches.filter(b => b.active).length > 1 ? field('Branch', select('', [['', 'All branches'], ...branches.map(b => [b.id, b.name])], '', { onchange: e => { branch = e.target.value; load(); } })) : null,
    field('Staff', select('', [['', 'All staff'], ...staff.map(s => [s.id, s.name])], only, { onchange: e => { only = e.target.value; load(); } })),
    h('div', { class: 'grow' }), h('button', { class: 'btn', onclick: () => openBookingDialog(ctx, { walkIn: true, staffId: ctx.staffId, onDone: load }) }, 'Walk-in'),
    h('button', { class: 'btn pri', onclick: () => openBookingDialog(ctx, { staffId: ctx.staffId, date, onDone: load }) }, '+ New booking')), host);

  async function load() {
    host.replaceChildren(h('p', { class: 'sub' }, 'Loading…'));
    try {
      const [a, b] = dayRange(date, tz);
      const rows = await hydrate(must(await sb.from('sl_bookings').select('*').eq('business_id', biz.id).gte('starts_at', a).lt('starts_at', b).neq('status', 'cancelled').order('starts_at')));
      const cols = staff.filter(s => (!branch || s.branch_id === branch) && (!only || s.id === only));
      if (!cols.length) { host.replaceChildren(h('p', { class: 'sub' }, 'No staff to show.')); return; }
      const dow = new Date(date + 'T12:00:00Z').getUTCDay(), hh = hours.filter(x => x.weekday === dow && !x.is_closed && (!branch || x.branch_id === branch));
      let s0 = hh.length ? Math.min(...hh.map(x => toMin(x.open_time))) : 8 * 60, e0 = hh.length ? Math.max(...hh.map(x => toMin(x.close_time))) : 20 * 60;
      rows.forEach(r => { s0 = Math.min(s0, minsOfDay(r.starts_at, tz)); e0 = Math.max(e0, minsOfDay(r.ends_at, tz) || 1440); });
      s0 = Math.floor(s0 / 60) * 60; e0 = Math.ceil(e0 / 60) * 60; const H = (e0 - s0) * PPM;
      const timeCol = h('div', { class: 'cal-t', style: `height:${H}px` }, Array.from({ length: (e0 - s0) / 60 }, (_, i) => h('i', { style: `top:${i * 60 * PPM + 8}px` }, String((s0 / 60) + i).padStart(2, '0') + ':00')));
      const colEls = cols.map(s => {
        const el = h('div', { class: 'cal-c', style: `height:${H}px;--hh:${60 * PPM}px`, onclick: e => { if (e.target === el) openBookingDialog(ctx, { staffId: s.id, date, onDone: load }); } },
          rows.filter(r => r.staff_id === s.id).map(r => {
            const t0 = minsOfDay(r.starts_at, tz), dur = (new Date(r.ends_at) - new Date(r.starts_at)) / 60000;
            return h('div', { class: 'ev' + (['no_show', 'completed'].includes(r.status) ? ' mut' : ''), style: `top:${(t0 - s0) * PPM}px;height:${Math.max(20, dur * PPM - 2)}px;background:${s.color}`, title: `${r.service?.name} – ${who(r)}`, onclick: () => openBooking(ctx, r, load) },
              h('b', {}, fmtTime(r.starts_at, tz)), ' ', r.service?.name, h('br'), who(r));
          }));
        return el;
      });
      host.replaceChildren(h('p', { class: 'sub' }, fmtDate(a, tz) + ` · ${rows.length} booking(s)`),
        h('div', { class: 'cal', style: `grid-template-columns:56px repeat(${cols.length},minmax(150px,1fr));max-height:75vh` },
          h('div', { class: 'cal-h' }), cols.map(s => h('div', { class: 'cal-h' }, s.name)), timeCol, colEls));
    } catch (e) { host.replaceChildren(h('p', { class: 'err' }, e.message)); }
  }
  load();
}
