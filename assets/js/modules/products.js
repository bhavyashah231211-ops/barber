import { sb, must } from '../core/supa.js';
import { h, field, formData, run, table, money, modal, select, num } from '../core/ui.js';
import { fmtDateTime } from '../core/time.js';

export async function render(root, ctx) {
  const out = h('div', {}), banner = h('div', { class: 'banner', hidden: true });
  root.append(h('div', { class: 'bar' }, h('div', { class: 'grow' }), ctx.isAdmin ? h('button', { class: 'btn pri', onclick: () => edit(null) }, '+ New product') : null), banner, out);
  let prods = [];
  async function load() {
    try {
      prods = must(await sb.from('sl_products').select('*').eq('business_id', ctx.biz.id).order('name'));
      const sales = must(await sb.from('sl_product_sales').select('*').eq('business_id', ctx.biz.id).order('created_at', { ascending: false }).limit(30)), P = new Map(prods.map(p => [p.id, p]));
      const low = prods.filter(p => p.active && p.stock <= p.low_stock_at); banner.hidden = !low.length; banner.textContent = 'Low stock: ' + low.map(p => `${p.name} (${p.stock} left)`).join(', ');
      out.replaceChildren(
        h('div', { class: 'card' }, table([{ h: 'Product', r: p => h('b', {}, p.name) }, { h: 'SKU', r: p => p.sku || '' }, { h: 'Price', cls: 'r', r: p => money(p.price, ctx.cur) },
          { h: 'Stock', cls: 'r', r: p => h('span', { class: 'badge ' + (p.stock <= p.low_stock_at ? 'bad' : 'ok') }, p.stock) }, { h: 'Status', r: p => (p.active ? '' : h('span', { class: 'badge' }, 'Hidden')) },
          { h: '', cls: 'r nw', r: p => [h('button', { class: 'btn sm pri', disabled: !p.active || p.stock < 1, onclick: () => sell(p) }, 'Sell'), ' ', ctx.isAdmin ? h('button', { class: 'btn sm', onclick: () => edit(p) }, 'Edit') : ''] }], prods, 'No products yet.')),
        h('div', { class: 'card' }, h('h2', {}, 'Recent sales'), table([{ h: 'When', cls: 'nw', r: s => fmtDateTime(s.created_at, ctx.tz) }, { h: 'Product', r: s => P.get(s.product_id)?.name || '' }, { h: 'Qty', cls: 'r', r: s => s.qty },
          { h: 'Total', cls: 'r', r: s => money(s.qty * s.unit_price, ctx.cur) }, { h: 'Method', r: s => s.method }], sales, 'No sales yet.')));
    } catch (e) { out.replaceChildren(h('p', { class: 'err' }, e.message)); }
  }
  function sell(p) {
    modal(`Sell ${p.name}`, close => {
      const f = h('form', { class: 'form', onsubmit: async e => {
        e.preventDefault(); const d = formData(f);
        const ok = await run(async () => must(await sb.from('sl_product_sales').insert({ business_id: ctx.biz.id, product_id: p.id, qty: Number(d.qty), unit_price: p.price, method: d.method, created_by: ctx.user.id })), 'Sale recorded');
        if (ok) { close(); load(); }
      } }, field('Quantity', h('input', { name: 'qty', type: 'number', min: '1', max: p.stock, value: 1, required: true })), field('Method', select('method', [['cash', 'Cash'], ['card', 'Card']], 'cash')),
      h('p', { class: 'sub full' }, `${money(p.price, ctx.cur)} each · ${p.stock} in stock. The price and stock are checked by the database.`), h('div', { class: 'acts full' }, h('button', { type: 'button', class: 'btn', onclick: close }, 'Cancel'), h('button', { class: 'btn pri' }, 'Record sale')));
      return f;
    });
  }
  function edit(p) {
    modal(p ? 'Edit product' : 'New product', close => {
      const f = h('form', { class: 'form', onsubmit: async e => {
        e.preventDefault(); const d = formData(f);
        const row = { name: d.name.trim(), sku: d.sku.trim() || null, price: Number(d.price), cost: num(d.cost), stock: Number(d.stock), low_stock_at: Number(d.low_stock_at), active: d.active };
        const ok = await run(async () => (p ? must(await sb.from('sl_products').update(row).eq('id', p.id)) : must(await sb.from('sl_products').insert({ ...row, business_id: ctx.biz.id }))), 'Saved');
        if (ok) { close(); load(); }
      } }, field('Name', h('input', { name: 'name', required: true, maxlength: 80, value: p?.name || '' }), 'full'), field('SKU', h('input', { name: 'sku', maxlength: 40, value: p?.sku || '' })),
      field('Price', h('input', { name: 'price', type: 'number', step: '0.01', min: '0', required: true, value: p?.price ?? '' })), field('Cost (optional)', h('input', { name: 'cost', type: 'number', step: '0.01', min: '0', value: p?.cost ?? '' })),
      field('Stock', h('input', { name: 'stock', type: 'number', min: '0', required: true, value: p?.stock ?? 0 })), field('Alert when stock is at or below', h('input', { name: 'low_stock_at', type: 'number', min: '0', required: true, value: p?.low_stock_at ?? 3 })),
      h('label', { class: 'chk full' }, h('input', { type: 'checkbox', name: 'active', checked: p ? p.active : true }), h('span', {}, 'Available to sell')),
      h('div', { class: 'acts full' }, h('button', { type: 'button', class: 'btn', onclick: close }, 'Cancel'), h('button', { class: 'btn pri' }, 'Save')));
      return f;
    });
  }
  load();
}
