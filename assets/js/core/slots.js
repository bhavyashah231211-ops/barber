import { h } from './ui.js';
import { rpc } from './supa.js';
import { todayStr, addDays, fmtTime } from './time.js';

// Date + free-time picker backed by the sl_available_slots RPC (server decides what is free).
// picker.set({ serviceId, staffId, branchId, excludeId, date }) reloads; onPick receives {start, staff_id} or null.
export function slotPicker({ biz, onPick }) {
  const tz = biz.timezone, p = {};
  const dateIn = h('input', { type: 'date', value: todayStr(tz), min: todayStr(tz), max: addDays(todayStr(tz), 180), onchange: load });
  const list = h('div', { class: 'slot-list' });
  async function load() {
    onPick(null);
    if (!p.serviceId) { list.replaceChildren(h('p', { class: 'sub' }, 'Choose a service first.')); return; }
    if (!dateIn.value) return;
    list.replaceChildren(h('p', { class: 'sub' }, 'Loading…'));
    try {
      const rows = await rpc('sl_available_slots', { p_business: biz.id, p_service: p.serviceId, p_date: dateIn.value, p_staff: p.staffId || null, p_branch: p.branchId || null, p_exclude: p.excludeId || null });
      const by = new Map(); rows.forEach(r => { if (!by.has(r.slot_start)) by.set(r.slot_start, r.staff_id); });
      if (!by.size) { list.replaceChildren(h('p', { class: 'sub' }, 'No free times on this day. Try another date.')); return; }
      list.replaceChildren(...[...by].map(([t, sid]) => h('button', { type: 'button', class: 'slot', onclick: e => {
        list.querySelectorAll('.slot').forEach(b => b.classList.remove('on')); e.currentTarget.classList.add('on'); onPick({ start: t, staff_id: sid });
      } }, fmtTime(t, tz))));
    } catch (e) { list.replaceChildren(h('p', { class: 'err' }, e.message)); }
  }
  return {
    el: h('div', {}, h('label', { class: 'fld' }, h('span', {}, 'Date'), dateIn), list),
    set(o) { if (o.date) dateIn.value = o.date; Object.assign(p, o); return load(); },
  };
}
