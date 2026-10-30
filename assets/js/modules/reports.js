import { rpc } from '../core/supa.js';
import { h, field, table, money, chart, run } from '../core/ui.js';
import { todayStr, addDays } from '../core/time.js';

export async function render(root, ctx) {
  const t = todayStr(ctx.tz); let from = addDays(t, -29), to = t; const out = h('div', {});
  const fi = h('input', { type: 'date', value: from, onchange: e => { from = e.target.value; load(); } }), ti = h('input', { type: 'date', value: to, onchange: e => { to = e.target.value; load(); } });
  const preset = (a, b) => () => { from = a; to = b; fi.value = a; ti.value = b; load(); };
  root.append(h('div', { class: 'bar' }, field('From', fi), field('To', ti), h('button', { class: 'btn', onclick: preset(t, t) }, 'Today'), h('button', { class: 'btn', onclick: preset(addDays(t, -6), t) }, '7 days'),
    h('button', { class: 'btn', onclick: preset(addDays(t, -29), t) }, '30 days'), h('button', { class: 'btn', onclick: preset(t.slice(0, 8) + '01', t) }, 'This month')), out);
  async function load() {
    out.replaceChildren(h('p', { class: 'sub' }, 'Loading…'));
    try {
      const r = await rpc('sl_report', { p_business: ctx.biz.id, p_from: from, p_to: to }), cur = ctx.cur, sum = a => a.reduce((s, x) => s + Number(x.amount), 0);
      const svc = sum(r.services_by_day), prd = sum(r.products_by_day), st = r.bookings_by_status, tot = Object.values(st).reduce((a, b) => a + b, 0), days = {};
      [...r.services_by_day, ...r.products_by_day].forEach(x => { days[x.day] = (days[x.day] || 0) + Number(x.amount); });
      const stat = (v, l) => h('div', { class: 'stat' }, h('b', {}, v), h('span', {}, l));
      out.replaceChildren(
        h('div', { class: 'cards' }, stat(money(svc + prd, cur), 'Total revenue'), stat(money(svc, cur), 'Services (net of refunds)'), stat(money(prd, cur), 'Product sales'), stat(money(r.refunds, cur), 'Refunds'),
          stat(tot, 'Bookings'), stat(st.completed || 0, 'Completed'), stat((st.cancelled || 0) + (st.no_show || 0), 'Cancelled / no-show'), stat(r.new_customers, 'New customers')),
        h('div', { class: 'card' }, h('h2', {}, 'Revenue by day'), Object.keys(days).length ? chart(Object.keys(days).sort().map(d => ({ label: d, value: days[d] })), cur) : h('p', { class: 'sub' }, 'No revenue in this period.')),
        h('div', { class: 'cards' },
          h('div', { class: 'card' }, h('h2', {}, 'Payment methods'), table([{ h: 'Method', r: x => x.method }, { h: 'Net', cls: 'r', r: x => money(x.amount, cur) }], r.by_method, 'No payments.')),
          h('div', { class: 'card' }, h('h2', {}, 'Top services'), table([{ h: 'Service', r: x => x.name }, { h: 'Done', cls: 'r', r: x => x.n }, { h: 'Value', cls: 'r', r: x => money(x.amount, cur) }], r.top_services, 'No completed bookings.')),
          h('div', { class: 'card' }, h('h2', {}, 'Staff'), table([{ h: 'Name', r: x => x.name }, { h: 'Done', cls: 'r', r: x => x.n }, { h: 'Value', cls: 'r', r: x => money(x.amount, cur) }], r.top_staff, 'No completed bookings.'))));
    } catch (e) { out.replaceChildren(h('p', { class: 'err' }, e.message)); }
  }
  load();
}
