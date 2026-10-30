import { sb, must, rpc } from '../core/supa.js';
import { h, field, select, modal, run, money, debounce, formData } from '../core/ui.js';
import { loadServices, loadStaff, loadBranches } from '../core/data.js';
import { slotPicker } from '../core/slots.js';

// Staff/admin: find an existing customer or type a new one.
export function customerPicker(ctx) {
  let sel = null, mode = 'find';
  const q = h('input', { placeholder: 'Search name, phone or email', oninput: debounce(search, 250) }), res = h('div', { class: 'pick-list' });
  const chosen = h('div', { hidden: true });
  const nn = h('input', { placeholder: 'Full name', maxlength: 80 }), np = h('input', { placeholder: 'Phone', type: 'tel' }), ne = h('input', { placeholder: 'Email (optional)', type: 'email' });
  const newBox = h('div', { class: 'form', hidden: true }, h('div', { class: 'full' }, nn), np, ne);
  const findBox = h('div', {}, q, res);
  const toggle = h('button', { type: 'button', class: 'btn sm', onclick: () => { mode = mode === 'find' ? 'new' : 'find'; newBox.hidden = mode !== 'new'; findBox.hidden = mode !== 'find'; toggle.textContent = mode === 'find' ? '+ New customer' : 'Find existing'; } }, '+ New customer');
  async function search() {
    const t = q.value.trim().replace(/[%,()*\\]/g, ''); if (t.length < 2) { res.replaceChildren(); return; }
    try {
      const rows = must(await sb.from('sl_customers').select('id,full_name,email,phone').eq('business_id', ctx.biz.id).or(`full_name.ilike.%${t}%,email.ilike.%${t}%,phone.ilike.%${t}%`).order('full_name').limit(8));
      res.replaceChildren(...rows.map(r => h('button', { type: 'button', class: 'pick', onclick: () => { sel = r; chosen.hidden = false; chosen.replaceChildren(h('span', { class: 'chip' }, r.full_name + (r.phone ? ' · ' + r.phone : ''))); res.replaceChildren(); q.value = ''; } }, r.full_name, h('span', { class: 'sub' }, ' ' + [r.phone, r.email].filter(Boolean).join(' · ')))));
      if (!rows.length) res.replaceChildren(h('p', { class: 'sub' }, 'No match. Use "+ New customer".'));
    } catch (e) { res.replaceChildren(h('p', { class: 'err' }, e.message)); }
  }
  return {
    el: h('div', {}, h('div', { class: 'bar' }, h('b', {}, 'Customer'), toggle), chosen, findBox, newBox),
    async resolve() {
      if (mode === 'new') {
        if (!nn.value.trim()) throw new Error('Enter the customer name');
        return must(await sb.from('sl_customers').insert({ business_id: ctx.biz.id, full_name: nn.value.trim(), phone: np.value.trim() || null, email: ne.value.trim() || null }).select('id').single()).id;
      }
      if (!sel) throw new Error('Choose a customer or add a new one'); return sel.id;
    },
  };
}

// New booking (or walk-in) for staff/admin.
export async function openBookingDialog(ctx, { walkIn = false, staffId = null, date = null, onDone } = {}) {
  const { biz } = ctx;
  let services, staff, branches, ss;
  try {
    [services, staff, branches, ss] = await Promise.all([loadServices(biz, true), loadStaff(biz, true), loadBranches(biz), sb.from('sl_staff_services').select('staff_id,service_id').eq('business_id', biz.id).then(must)]);
  } catch (e) { return run(() => { throw e; }); }
  branches = branches.filter(b => b.active);
  if (!services.length || !staff.length) return run(() => { throw new Error('Add at least one service and one staff member (assigned to a service) first.'); });
  let picked = null;
  const cp = walkIn ? null : customerPicker(ctx);
  const guest = walkIn ? h('input', { name: 'guest', maxlength: 80, placeholder: 'Guest name (optional)' }) : null;
  const svcSel = h('select', { name: 'service', required: true, onchange: refresh }, h('option', { value: '' }, 'Choose service…'), services.map(s => h('option', { value: s.id }, `${s.name} · ${money(s.price, ctx.cur)} · ${s.duration_min} min`)));
  const brSel = branches.length > 1 ? select('branch', branches.map(b => [b.id, b.name]), branches[0].id, { onchange: refresh }) : null;
  const stSel = h('select', { name: 'staff', onchange: () => sp && sp.set(params()) });
  const notes = h('textarea', { name: 'notes', maxlength: 500, placeholder: 'Notes (optional)' });
  const go = h('button', { class: 'btn pri', disabled: true }, walkIn ? 'Start walk-in now' : 'Book');
  const params = () => ({ serviceId: svcSel.value, staffId: stSel.value || null, branchId: brSel ? brSel.value : null });
  const sp = walkIn ? null : slotPicker({ biz, onPick: p => { picked = p; go.disabled = !p; } });
  function refresh() {
    const ok = new Set(ss.filter(x => x.service_id === svcSel.value).map(x => x.staff_id)), br = brSel ? brSel.value : null;
    const list = staff.filter(s => ok.has(s.id) && (!br || s.branch_id === br));
    stSel.replaceChildren(...(walkIn ? [] : [h('option', { value: '' }, 'Any available')]), ...list.map(s => h('option', { value: s.id }, s.name)));
    if (staffId && list.some(s => s.id === staffId)) stSel.value = staffId;
    if (walkIn) go.disabled = !svcSel.value || !list.length; else sp.set(params());
  }
  modal(walkIn ? 'Walk-in' : 'New booking', close => {
    const f = h('form', { class: 'form', onsubmit: async e => {
      e.preventDefault(); go.disabled = true;
      const ok = await run(async () => {
        const start = walkIn ? new Date(Math.floor(Date.now() / 60000) * 60000).toISOString() : picked.start;
        const cust = walkIn ? null : await cp.resolve();
        await rpc('sl_book', { p_business: biz.id, p_service: svcSel.value, p_start: start, p_staff: stSel.value || (picked && picked.staff_id) || null, p_customer: cust,
          p_guest: walkIn ? guest.value : null, p_notes: notes.value, p_walk_in: walkIn, p_branch: brSel ? brSel.value : null });
      }, walkIn ? 'Walk-in started' : 'Booking created');
      go.disabled = !ok && !walkIn ? !picked : false;
      if (ok) { close(); onDone && onDone(); }
    } },
      h('div', { class: 'full' }, walkIn ? field('Guest', guest) : cp.el), field('Service', svcSel, 'full'), brSel ? field('Branch', brSel) : null, field(walkIn ? 'Staff' : 'Staff (optional)', stSel),
      walkIn ? h('p', { class: 'sub full' }, 'Starts now. If the chosen person is already booked right now, pick someone else.') : h('div', { class: 'full' }, sp.el),
      field('Notes', notes, 'full'), h('div', { class: 'acts full' }, h('button', { type: 'button', class: 'btn', onclick: close }, 'Cancel'), go));
    queueMicrotask(() => { if (date && sp) sp.set({ date }); });
    return f;
  });
}
