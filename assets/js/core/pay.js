import { sb } from './supa.js';
import { h, toast, copyText } from './ui.js';

// Calls the salon-pay edge function with the signed-in user's token.
export async function callPay(body) {
  const { data } = await sb.auth.getSession(), C = window.CBS;
  const r = await fetch(`${C.url}/functions/v1/salon-pay`, { method: 'POST', headers: { 'Content-Type': 'application/json', apikey: C.key, Authorization: 'Bearer ' + (data.session?.access_token || '') }, body: JSON.stringify(body) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || 'Payment service is not reachable. Is the salon-pay function deployed?');
  return j;
}
export const webhookUrl = biz => `${window.CBS.url}/functions/v1/salon-pay?hook=${biz.id}`;

// {amount} {amount_minor} {currency} {ref} {booking} {name} {service} are replaced (URL-encoded) in a template.
export function fillTemplate(tpl, v) {
  return String(tpl || '').replace(/\{(\w+)\}/g, (_, k) => (k in v ? encodeURIComponent(v[k]) : ''));
}
export function openLink(url) {
  const a = document.createElement('a'); a.href = url; a.rel = 'noopener';
  if (/^https?:/i.test(url)) a.target = '_blank';
  document.body.append(a); a.click(); a.remove();
}
export function linkBox(url, note) {
  return h('div', { class: 'card' }, h('div', { class: 'bar' }, h('input', { class: 'grow', readonly: true, value: url, onfocus: e => e.target.select() }),
    h('button', { type: 'button', class: 'btn', onclick: () => copyText(url) }, 'Copy'), h('button', { type: 'button', class: 'btn', onclick: () => openLink(url) }, 'Open')), note ? h('p', { class: 'sub' }, note) : null);
}
