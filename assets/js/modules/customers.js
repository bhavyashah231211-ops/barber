import { sb, must } from '../core/supa.js';
import { h, field, formData, run, table, money, modal, statusBadge, debounce } from '../core/ui.js';
import { fmtDateTime } from '../core/time.js';
import { hydrate } from '../core/data.js';
import { openBooking } from './bookings.js';

function form(ctx, c, onSaved) {
  modal(c ? 'Edit customer' : 'New customer', close => {
    const f = h('form', { class: 'form', onsubmit: async e => {
      e.preventDefault(); const d = formData(f);
      const row = { full_name: d.full_name.trim(), email: d.email.trim() || null, phone: d.phone.trim() || null, notes: d.notes.trim() || null };
      const ok = await run(async () => (c ? must(await sb.from('sl_customers').update(row).eq('id', c.id)) : must(await sb.from('sl_customers').insert({ ...row, business_id: ctx.biz.id }))), 'Saved');
      if (ok) { close(); onSaved(); }
    } }, field('Full name', h('input', { name: 'full_name', required: true, maxlength: 80, value: c?.full_name || '' }), 'full'), field('Email', h('input', { name: 'email', type: 'email', value: c?.email || '' })),
    field('Phone', h('input', { name: 'phone', type: 'tel', value: c?.phone || '' })), field('Notes (staff only)', h('textarea', { name: 'notes', maxlength: 1000, value: c?.notes || '' }), 'full'),
    h('div', { class: 'acts full' }, h('button', { type: 'button', class: 'btn', onclick: close }, 'Cancel'), h('button', { class: 'btn pri' }, 'Save')));
    return f;
  });
}

async function profile(ctx, c, onChange) {
  const hist = await hydrate(must(await sb.from('sl_bookings').select('*').eq('customer_id', c.id).order('starts_at', { ascending: false }).limit(50)));
  const spent = hist.reduce((t, b) => t + Number(b.pay?.net_paid || 0), 0);
  modal(c.full_name, close => h('div', {},
    h('p', { class: 'sub' }, [c.phone, c.email].filter(Boolean).join(' · ') || 'No contact details'),
    c.notes ? h('p', {}, c.notes) : null,
    h('p', {}, h('b', {}, hist.length), ' bookings · ', h('b', {}, money(spent, ctx.cur)), ' paid'),
    table([{ h: 'When', cls: 'nw', r: b => fmtDateTime(b.starts_at, ctx.tz) }, { h: 'Service', r: b => b.service?.name || '' }, { h: 'Staff', r: b => b.staff?.name || '' }, { h: 'Status', r: b => statusBadge(b.status) }], hist, 'No bookings yet.',
      b => openBooking(ctx, b, () => { close(); onChange(); })),
    h('div', { class: 'acts' }, h('button', { class: 'btn', onclick: () => { close(); form(ctx, c, onChange); } }, 'Edit'))), { wide: true });
}

export async function render(root, ctx) {
  let text = ''; const out = h('div', { class: 'card' });
  root.append(h('div', { class: 'bar' }, field('Search', h('input', { placeholder: 'Name, phone or email', oninput: debounce(e => { text = e.target.value.trim().replace(/[%,()*\\]/g, ''); load(); }, 250) }), 'grow'),
    h('button', { class: 'btn pri', onclick: () => form(ctx, null, load) }, '+ New customer')), out);
  async function load() {
    try {
      let q = sb.from('sl_customers').select('*').eq('business_id', ctx.biz.id).order('full_name').limit(100);
      if (text.length >= 2) q = q.or(`full_name.ilike.%${text}%,email.ilike.%${text}%,phone.ilike.%${text}%`);
      const rows = must(await q);
      out.replaceChildren(table([{ h: 'Name', r: c => c.full_name }, { h: 'Phone', r: c => c.phone || '' }, { h: 'Email', r: c => c.email || '' }, { h: 'Account', r: c => (c.user_id ? h('span', { class: 'badge ok' }, 'Online') : '') }],
        rows, 'No customers yet.', c => profile(ctx, c, load)), rows.length === 100 ? h('p', { class: 'sub' }, 'Showing the first 100. Use search to narrow down.') : '');
    } catch (e) { out.replaceChildren(h('p', { class: 'err' }, e.message)); }
  }
  load();
}
