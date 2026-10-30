import { sb, must, rpc } from '../core/supa.js';
import { h, table, money, chart, statusBadge, payBadge } from '../core/ui.js';
import { todayStr, addDays, dayRange, fmtTime } from '../core/time.js';
import { hydrate, who } from '../core/data.js';
import { openBooking } from './bookings.js';

const count = q => q.then(r => { if (r.error) throw new Error(r.error.message); return r.count || 0; });

export async function render(root, ctx) {
  const { biz, tz, cur } = ctx, t = todayStr(tz), [a, b] = dayRange(t, tz), W = { count: 'exact', head: true };
  const [raw, rep, customers, staff, prods] = await Promise.all([
    sb.from('sl_bookings').select('*').eq('business_id', biz.id).gte('starts_at', a).lt('starts_at', b).order('starts_at').then(must),
    rpc('sl_report', { p_business: biz.id, p_from: addDays(t, -6), p_to: t }),
    count(sb.from('sl_customers').select('id', W).eq('business_id', biz.id)), count(sb.from('sl_staff').select('id', W).eq('business_id', biz.id).eq('active', true)),
    sb.from('sl_products').select('name,stock,low_stock_at').eq('business_id', biz.id).eq('active', true).then(must)]);
  const rows = await hydrate(raw), live = rows.filter(r => r.status !== 'cancelled');
  const day = {}; for (let i = 6; i >= 0; i--) day[addDays(t, -i)] = 0;
  [...rep.services_by_day, ...rep.products_by_day].forEach(x => { if (x.day in day) day[x.day] += Number(x.amount); });
  const low = prods.filter(p => p.stock <= p.low_stock_at), by = {}; rows.forEach(r => { by[r.status] = (by[r.status] || 0) + 1; });
  const stat = (v, l) => h('div', { class: 'stat' }, h('b', {}, v), h('span', {}, l));
  root.append(
    h('div', { class: 'cards' }, stat(live.length, "Today's bookings"), stat(money(day[t], cur), 'Revenue today'), stat(money(Object.values(day).reduce((x, y) => x + y, 0), cur), 'Revenue, 7 days'), stat(customers, 'Customers'), stat(staff, 'Active staff'), stat(low.length, 'Low-stock products')),
    h('div', { class: 'card' }, h('h2', {}, 'Last 7 days'), chart(Object.entries(day).map(([label, value]) => ({ label, value })), cur)),
    low.length ? h('div', { class: 'banner' }, 'Low stock: ' + low.map(p => `${p.name} (${p.stock})`).join(', ')) : '',
    h('div', { class: 'card' }, h('h2', {}, "Today's bookings"), h('p', { class: 'sub' }, Object.entries(by).map(([s, n]) => [statusBadge(s), ` ${n}  `])),
      table([{ h: 'Time', cls: 'nw', r: r => fmtTime(r.starts_at, tz) }, { h: 'Customer', r: r => who(r) }, { h: 'Service', r: r => r.service?.name || '' }, { h: 'Staff', r: r => r.staff?.name || '' },
        { h: 'Status', r: r => statusBadge(r.status) }, { h: 'Payment', r: r => (r.status === 'cancelled' ? '' : payBadge(r.pay?.pay_status)) }], rows, 'No bookings today.', r => openBooking(ctx, r, () => { root.replaceChildren(); render(root, ctx); }))));
}
