import { sb, must } from './supa.js';

export async function fetchIn(table, cols, ids, key = 'id') {
  ids = [...new Set(ids.filter(Boolean))]; const out = [];
  for (let i = 0; i < ids.length; i += 100) out.push(...must(await sb.from(table).select(cols).in(key, ids.slice(i, i + 100))));
  return out;
}
export const mapBy = (rows, k = 'id') => new Map(rows.map(r => [r[k], r]));
export const loadStaff = async (biz, activeOnly = false) => must(await sb.from('sl_staff').select('*').eq('business_id', biz.id).order('name')).filter(s => !activeOnly || s.active);
export const loadServices = async (biz, activeOnly = false) => must(await sb.from('sl_services').select('*').eq('business_id', biz.id).order('category', { nullsFirst: false }).order('name')).filter(s => !activeOnly || s.active);
export const loadBranches = async biz => must(await sb.from('sl_branches').select('*').eq('business_id', biz.id).order('created_at'));

// Attach service / staff / customer / payment summary to booking rows (no joins needed in the query).
export async function hydrate(rows) {
  const col = k => rows.map(r => r[k]);
  const [svc, stf, cus, pay] = await Promise.all([
    fetchIn('sl_services', 'id,name,price,duration_min', col('service_id')), fetchIn('sl_staff', 'id,name,color', col('staff_id')),
    fetchIn('sl_customers', 'id,full_name,phone,email', col('customer_id')), fetchIn('sl_booking_payments', 'booking_id,net_paid,pay_status', col('id'), 'booking_id')]);
  const S = mapBy(svc), T = mapBy(stf), C = mapBy(cus), P = mapBy(pay, 'booking_id');
  return rows.map(r => ({ ...r, service: S.get(r.service_id), staff: T.get(r.staff_id), customer: C.get(r.customer_id), pay: P.get(r.id) }));
}
export const who = b => b.customer?.full_name || b.guest_name || 'Walk-in';

// Make the staff<->service assignments for one side match `selected` (a Set of the other side's ids).
export async function syncAssign(bizId, fixedKey, fixedId, otherKey, selected) {
  const cur = must(await sb.from('sl_staff_services').select(otherKey).eq(fixedKey, fixedId)).map(r => r[otherKey]);
  const add = [...selected].filter(x => !cur.includes(x)), del = cur.filter(x => !selected.has(x));
  if (add.length) must(await sb.from('sl_staff_services').insert(add.map(x => ({ business_id: bizId, [fixedKey]: fixedId, [otherKey]: x }))));
  if (del.length) must(await sb.from('sl_staff_services').delete().eq(fixedKey, fixedId).in(otherKey, del));
}
