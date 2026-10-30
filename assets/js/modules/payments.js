import { sb, must } from '../core/supa.js';
import { h, field, formData, run, table, money, toast, confirmBox, select, modal, payBadge } from '../core/ui.js';
import { fmtDateTime, todayStr, addDays, dayRange } from '../core/time.js';
import { hydrate, who } from '../core/data.js';

const KIND = { payment: 'Payment', deposit: 'Deposit', refund: 'Refund' };
const net = rows => rows.filter(p => p.status === 'paid').reduce((t, p) => t + (p.kind === 'refund' ? -1 : 1) * Number(p.amount), 0);

// Payments for one booking: history + take payment / deposit / refund. Card = taken on your own card terminal.
export async function paymentPanel(ctx, booking, onChange) {
  const box = h('div', {});
  async function draw() {
    const rows = must(await sb.from('sl_payments').select('*').eq('booking_id', booking.id).order('created_at'));
    const paid = net(rows), due = Math.max(0, Number(booking.price) - paid);
    const f = h('form', { class: 'form', onsubmit: async e => {
      e.preventDefault(); const d = formData(f);
      const ok = await run(async () => must(await sb.from('sl_payments').insert({ business_id: ctx.biz.id, booking_id: booking.id, kind: d.kind, method: d.method, amount: Number(d.amount), reference: d.reference || null, created_by: ctx.user.id })), 'Saved');
      if (ok) { await draw(); onChange && onChange(); }
    } },
      field('Type', select('kind', [['payment', 'Payment'], ['deposit', 'Deposit'], ...(paid > 0 ? [['refund', 'Refund']] : [])], due > 0 ? 'payment' : 'refund', { onchange: e => { f.elements.amount.value = (e.target.value === 'refund' ? paid : due).toFixed(2); } })),
      field('Method', select('method', [['cash', 'Cash'], ['card', 'Card']], 'cash')),
      field('Amount', h('input', { name: 'amount', type: 'number', step: '0.01', min: '0.01', required: true, value: (due > 0 ? due : paid).toFixed(2) })),
      field('Reference (optional)', h('input', { name: 'reference', maxlength: 60 })), h('button', { class: 'btn pri full' }, 'Record'));
    box.replaceChildren(h('h3', {}, 'Payments'),
      h('p', { class: 'sub' }, `Price ${money(booking.price, ctx.cur)} · Paid ${money(paid, ctx.cur)} · Balance ${money(due, ctx.cur)}`),
      rows.length ? table([{ h: 'When', r: p => fmtDateTime(p.created_at, ctx.tz) }, { h: 'Type', r: p => KIND[p.kind] }, { h: 'Method', r: p => p.method }, { h: 'Amount', cls: 'r', r: p => money(p.kind === 'refund' ? -p.amount : p.amount, ctx.cur) },
        { h: '', r: p => (p.status === 'void' ? h('span', { class: 'badge bad' }, 'Void') : ctx.isAdmin ? h('button', { class: 'btn sm red', onclick: async () => { if (await confirmBox('Void this payment?') && await run(async () => must(await sb.from('sl_payments').update({ status: 'void' }).eq('id', p.id)), 'Voided')) { await draw(); onChange && onChange(); } } }, 'Void') : '') }], rows) : h('p', { class: 'sub' }, 'No payments yet.'),
      f);
  }
  await draw(); return box;
}

export async function render(root, ctx) {
  let from = addDays(todayStr(ctx.tz), -6), to = todayStr(ctx.tz), method = '', kind = '';
  const out = h('div', {});
  const q = h('div', { class: 'bar' },
    field('From', h('input', { type: 'date', value: from, onchange: e => { from = e.target.value; load(); } })), field('To', h('input', { type: 'date', value: to, onchange: e => { to = e.target.value; load(); } })),
    field('Method', select('', [['', 'All'], ['cash', 'Cash'], ['card', 'Card']], '', { onchange: e => { method = e.target.value; load(); } })),
    field('Type', select('', [['', 'All'], ['payment', 'Payment'], ['deposit', 'Deposit'], ['refund', 'Refund']], '', { onchange: e => { kind = e.target.value; load(); } })));
  root.append(q, out);
  async function load() {
    out.replaceChildren(h('p', { class: 'sub' }, 'Loading…'));
    try {
      let qy = sb.from('sl_payments').select('*').eq('business_id', ctx.biz.id).gte('created_at', dayRange(from, ctx.tz)[0]).lt('created_at', dayRange(to, ctx.tz)[1]).order('created_at', { ascending: false }).limit(500);
      if (method) qy = qy.eq('method', method); if (kind) qy = qy.eq('kind', kind);
      const rows = must(await qy);
      const bks = await hydrate(must(await sb.from('sl_bookings').select('*').in('id', [...new Set(rows.map(r => r.booking_id))].slice(0, 200))));
      const B = new Map(bks.map(b => [b.id, b])), live = rows.filter(r => r.status === 'paid');
      const sum = f => live.filter(f).reduce((t, p) => t + (p.kind === 'refund' ? -1 : 1) * Number(p.amount), 0);
      out.replaceChildren(
        h('div', { class: 'cards' }, [['Net collected', sum(() => true)], ['Cash', sum(p => p.method === 'cash')], ['Card', sum(p => p.method === 'card')], ['Refunds', live.filter(p => p.kind === 'refund').reduce((t, p) => t + Number(p.amount), 0)]]
          .map(([l, v]) => h('div', { class: 'stat' }, h('b', {}, money(v, ctx.cur)), h('span', {}, l)))),
        h('div', { class: 'card' }, table([{ h: 'When', cls: 'nw', r: p => fmtDateTime(p.created_at, ctx.tz) }, { h: 'Customer', r: p => { const b = B.get(p.booking_id); return b ? who(b) : ''; } },
          { h: 'Service', r: p => B.get(p.booking_id)?.service?.name || '' }, { h: 'Type', r: p => KIND[p.kind] }, { h: 'Method', r: p => p.method }, { h: 'Amount', cls: 'r', r: p => money(p.kind === 'refund' ? -p.amount : p.amount, ctx.cur) },
          { h: 'Status', r: p => (p.status === 'paid' ? h('span', { class: 'badge ok' }, 'Paid') : h('span', { class: 'badge bad' }, p.status)) }], rows, 'No payments in this period.',
          p => { const b = B.get(p.booking_id); if (b) import('./bookings.js').then(m => m.openBooking(ctx, b, load)); })));
    } catch (e) { out.replaceChildren(h('p', { class: 'err' }, e.message)); }
  }
  load();
}
