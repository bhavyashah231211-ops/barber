// Tiny DOM toolkit: elements are built with h() so user text is never parsed as HTML.
export function h(tag, attrs, ...kids) {
  const e = document.createElement(tag); let val;
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k.startsWith('on') && typeof v === 'function') e.addEventListener(k.slice(2), v);
    else if (k === 'class') e.className = v;
    else if (k === 'style' && typeof v === 'object') Object.assign(e.style, v);
    else if (k === 'value') val = v;
    else if (['checked', 'disabled', 'selected', 'hidden'].includes(k)) e[k] = v;
    else e.setAttribute(k, v === true ? '' : v);
  }
  for (const c of kids.flat(Infinity)) if (c != null && c !== false) e.append(c instanceof Node ? c : document.createTextNode(String(c)));
  if (val !== undefined) e.value = val;
  return e;
}
export const debounce = (fn, ms) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; };
export const money = (n, cur = '£') => { n = Number(n) || 0; return (n < 0 ? '-' : '') + cur + Math.abs(n).toFixed(2); };
export const num = v => (v === '' || v == null ? null : Number(v));

export function toast(msg, type = '') {
  const t = h('div', { class: 'toast ' + type, role: 'status' }, msg); document.body.append(t); setTimeout(() => t.remove(), type ? 5000 : 2500);
}
export async function run(fn, ok) {
  try { const r = await fn(); if (ok) toast(ok); return r === undefined ? true : r; } catch (e) { toast(e.message || 'Something went wrong', 'err'); return false; }
}
export function modal(title, build, { wide = false, onClose } = {}) {
  const ov = h('div', { class: 'ov', onmousedown: e => { if (e.target === ov) close(); } });
  const esc = e => { if (e.key === 'Escape') close(); };
  function close() { document.removeEventListener('keydown', esc); ov.remove(); onClose && onClose(); }
  const box = h('div', { class: 'modal' + (wide ? ' wide' : ''), role: 'dialog', 'aria-modal': 'true' },
    h('div', { class: 'modal-h' }, h('h2', {}, title), h('button', { class: 'btn sm', type: 'button', onclick: close, 'aria-label': 'Close' }, '✕')));
  box.append(build(close)); ov.append(box); document.body.append(ov); document.addEventListener('keydown', esc);
  const f = box.querySelector('input,select,textarea'); if (f && matchMedia('(pointer:fine)').matches) f.focus();
  return close;
}
export const confirmBox = msg => new Promise(res => {
  let answered = false; const ans = (v, close) => { answered = true; res(v); close(); };
  modal('Please confirm', close => h('div', {}, h('p', {}, msg), h('div', { class: 'acts' },
    h('button', { class: 'btn', onclick: () => ans(false, close) }, 'No'), h('button', { class: 'btn pri', onclick: () => ans(true, close) }, 'Yes'))),
  { onClose: () => { if (!answered) res(false); } });
});
export const field = (label, input, cls = '') => h('label', { class: 'fld ' + cls }, h('span', {}, label), input);
export const opts = (list, sel) => list.map(([v, t]) => h('option', { value: v, selected: String(v) === String(sel) }, t));
export const select = (name, list, sel, extra = {}) => h('select', { name, ...extra }, opts(list, sel));
export function formData(form) {
  const o = {}; for (const el of form.elements) { if (!el.name) continue; o[el.name] = el.type === 'checkbox' ? el.checked : el.value; } return o;
}
export function table(cols, rows, empty = 'Nothing here yet.', onRow) {
  if (!rows.length) return h('p', { class: 'sub' }, empty);
  return h('div', { class: 'tw' }, h('table', {}, h('thead', {}, h('tr', {}, cols.map(c => h('th', { class: c.cls || '' }, c.h)))),
    h('tbody', {}, rows.map(r => h('tr', { class: onRow ? 'click' : '', onclick: onRow ? () => onRow(r) : null }, cols.map(c => h('td', { class: c.cls || '' }, c.r(r))))))));
}
const STATUS = { booked: ['Booked', 'info'], confirmed: ['Confirmed', 'ok'], in_progress: ['In progress', 'warn'], completed: ['Completed', 'ok'], cancelled: ['Cancelled', 'bad'], no_show: ['No-show', 'bad'] };
export const statusBadge = s => h('span', { class: 'badge ' + (STATUS[s]?.[1] || '') }, STATUS[s]?.[0] || s);
export const PAY = { paid: ['Paid', 'ok'], partial: ['Part paid', 'warn'], refunded: ['Refunded', 'bad'], unpaid: ['Unpaid', ''] };
export const payBadge = s => h('span', { class: 'badge ' + (PAY[s]?.[1] || '') }, PAY[s]?.[0] || s || '');
export function chart(points, cur) {   // points: [{label, value}]
  const max = Math.max(1, ...points.map(p => p.value));
  return h('div', { class: 'chart', role: 'img', 'aria-label': 'Revenue chart' }, points.map(p =>
    h('div', { style: { height: Math.max(2, (p.value / max) * 100) + '%' }, title: `${p.label}: ${money(p.value, cur)}` })));
}
export const copyText = async t => { try { await navigator.clipboard.writeText(t); toast('Copied'); } catch { toast('Copy failed', 'err'); } };
