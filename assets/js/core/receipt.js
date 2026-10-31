import { sb, must } from './supa.js';
import { fmtDateTime } from './time.js';

const cache = new Map();
export async function paySettings(biz, force = false) {
  if (!force && cache.has(biz.id)) return cache.get(biz.id);
  const r = must(await sb.from('sl_pay_settings').select('*').eq('business_id', biz.id).maybeSingle()) || {};
  const s = { currency_code: 'gbp', receipt_paper: '80mm', receipt_copies: 1, receipt_auto_print: false, ...r };
  cache.set(biz.id, s); return s;
}
export const clearPaySettings = biz => cache.delete(biz.id);

const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const money = (n, cur) => (Number(n) < 0 ? '-' : '') + cur + Math.abs(Number(n)).toFixed(2);

// lines: [{label, amount}] · totals: [{label, amount, bold}] · everything is escaped; the page is printed from a hidden iframe.
export function receiptHtml({ biz, set, no, when, who, staff, lines, payments, totals }) {
  const a4 = set.receipt_paper === 'a4', cur = biz.currency, row = (l, r, b) => `<div class="row${b ? ' b' : ''}"><span>${esc(l)}</span><span>${esc(r)}</span></div>`;
  const one = `<section>
    <h1>${esc(biz.name)}</h1>
    <div class="c">${esc(biz.address)}${biz.phone ? '<br>' + esc(biz.phone) : ''}${set.vat_number ? '<br>VAT no. ' + esc(set.vat_number) : ''}</div>
    ${set.receipt_header ? `<div class="c">${esc(set.receipt_header)}</div>` : ''}<hr>
    ${row('Receipt', no)}${row('Date', when)}${who ? row('Customer', who) : ''}${staff ? row('Served by', staff) : ''}<hr>
    ${lines.map(l => row(l.label, money(l.amount, cur))).join('')}
    ${payments && payments.length ? '<hr>' + payments.map(p => row(p.label, money(p.amount, cur))).join('') : ''}<hr>
    ${totals.map(t => row(t.label, money(t.amount, cur), t.bold)).join('')}
    ${set.receipt_footer ? `<hr><div class="c">${esc(set.receipt_footer)}</div>` : '<hr><div class="c">Thank you!</div>'}
  </section>`;
  const w = a4 ? '170mm' : set.receipt_paper === '58mm' ? '52mm' : '74mm';
  return `<!doctype html><html><head><meta charset="utf-8"><title>Receipt ${esc(no)}</title><style>
    @page{margin:${a4 ? '15mm' : '2mm'}${a4 ? ';size:A4' : ''}}body{font:${a4 ? '14px' : '12px'}/1.4 "Courier New",monospace;width:${w};margin:0 auto;color:#000;background:#fff}
    h1{font-size:1.25em;text-align:center;margin:0 0 4px}.c{text-align:center}.row{display:flex;justify-content:space-between;gap:8px}.b{font-weight:bold}
    hr{border:0;border-top:1px dashed #000;margin:6px 0}section{page-break-after:always}section:last-child{page-break-after:auto}</style></head>
    <body>${Array.from({ length: set.receipt_copies || 1 }, () => one).join('')}</body></html>`;
}

export function printHtml(html) {
  const f = document.createElement('iframe'); f.setAttribute('aria-hidden', 'true'); f.style.cssText = 'position:fixed;width:0;height:0;border:0;right:0;bottom:0';
  f.onload = () => { try { f.contentWindow.focus(); f.contentWindow.print(); } finally { setTimeout(() => f.remove(), 60000); } };
  f.srcdoc = html; document.body.append(f);
}

const labels = { payment: 'Payment', deposit: 'Deposit', refund: 'Refund' };
export async function printBookingReceipt(ctx, b) {
  const set = await paySettings(ctx.biz);
  const pays = must(await sb.from('sl_payments').select('*').eq('booking_id', b.id).eq('status', 'paid').order('created_at'));
  const net = pays.reduce((t, p) => t + (p.kind === 'refund' ? -1 : 1) * Number(p.amount), 0);
  printHtml(receiptHtml({ biz: ctx.biz, set, no: 'R' + b.id.slice(0, 8).toUpperCase(), when: fmtDateTime(b.starts_at, ctx.tz), who: b.customer?.full_name || b.guest_name || '', staff: b.staff?.name || '',
    lines: [{ label: b.service?.name || 'Service', amount: b.price }], payments: pays.map(p => ({ label: `${labels[p.kind]} (${p.method})`, amount: p.kind === 'refund' ? -p.amount : p.amount })),
    totals: [{ label: 'Total', amount: b.price, bold: true }, { label: 'Paid', amount: net }, { label: 'Balance', amount: Math.max(0, Number(b.price) - net), bold: true }] }));
}
export async function printSaleReceipt(ctx, sale, product) {
  const set = await paySettings(ctx.biz), total = sale.qty * sale.unit_price;
  printHtml(receiptHtml({ biz: ctx.biz, set, no: 'S' + sale.id.slice(0, 8).toUpperCase(), when: fmtDateTime(sale.created_at, ctx.tz),
    lines: [{ label: `${product.name} x${sale.qty}`, amount: total }], payments: [{ label: `Paid (${sale.method})`, amount: total }], totals: [{ label: 'Total', amount: total, bold: true }] }));
}
export function printTestReceipt(ctx, set) {
  printHtml(receiptHtml({ biz: ctx.biz, set, no: 'TEST0001', when: fmtDateTime(new Date().toISOString(), ctx.tz), who: 'Sample Customer', staff: 'Sample Staff',
    lines: [{ label: 'Haircut', amount: 20 }, { label: 'Beard trim', amount: 10 }], payments: [{ label: 'Deposit (card)', amount: 10 }, { label: 'Payment (cash)', amount: 20 }],
    totals: [{ label: 'Total', amount: 30, bold: true }, { label: 'Paid', amount: 30 }, { label: 'Balance', amount: 0, bold: true }] }));
}
