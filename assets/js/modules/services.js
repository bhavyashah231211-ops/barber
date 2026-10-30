import { sb, must } from '../core/supa.js';
import { h, field, formData, run, table, money, modal } from '../core/ui.js';
import { loadServices, loadStaff, syncAssign } from '../core/data.js';

export async function render(root, ctx) {
  const out = h('div', { class: 'card' });
  root.append(h('div', { class: 'bar' }, h('div', { class: 'grow' }), h('button', { class: 'btn pri', onclick: () => edit(null) }, '+ New service')), out);
  let services = [], staff = [], links = [];
  async function load() {
    try {
      [services, staff, links] = await Promise.all([loadServices(ctx.biz), loadStaff(ctx.biz, true), sb.from('sl_staff_services').select('staff_id,service_id').eq('business_id', ctx.biz.id).then(must)]);
      out.replaceChildren(table([{ h: 'Service', r: s => h('b', {}, s.name) }, { h: 'Category', r: s => s.category || '' }, { h: 'Price', cls: 'r', r: s => money(s.price, ctx.cur) }, { h: 'Minutes', cls: 'r', r: s => s.duration_min },
        { h: 'Staff', r: s => links.filter(l => l.service_id === s.id).length || h('span', { class: 'badge warn' }, 'none') }, { h: 'Status', r: s => (s.active ? h('span', { class: 'badge ok' }, 'Active') : h('span', { class: 'badge' }, 'Hidden')) }],
        services, 'No services yet. Add your first one.', edit));
    } catch (e) { out.replaceChildren(h('p', { class: 'err' }, e.message)); }
  }
  function edit(s) {
    const sel = new Set(s ? links.filter(l => l.service_id === s.id).map(l => l.staff_id) : staff.length === 1 ? [staff[0].id] : []);
    modal(s ? 'Edit service' : 'New service', close => {
      const cats = [...new Set(services.map(x => x.category).filter(Boolean))];
      const f = h('form', { class: 'form', onsubmit: async e => {
        e.preventDefault(); const d = formData(f);
        const row = { name: d.name.trim(), category: d.category.trim() || null, price: Number(d.price), duration_min: Number(d.duration_min), description: d.description.trim() || null, active: d.active };
        const ok = await run(async () => {
          const id = s ? (must(await sb.from('sl_services').update(row).eq('id', s.id)), s.id) : must(await sb.from('sl_services').insert({ ...row, business_id: ctx.biz.id }).select('id').single()).id;
          await syncAssign(ctx.biz.id, 'service_id', id, 'staff_id', sel);
        }, 'Saved');
        if (ok) { close(); load(); }
      } },
      field('Name', h('input', { name: 'name', required: true, maxlength: 80, value: s?.name || '' }), 'full'),
      field('Category', h('input', { name: 'category', list: 'cats', maxlength: 40, value: s?.category || '' })), h('datalist', { id: 'cats' }, cats.map(c => h('option', { value: c }))),
      field('Price', h('input', { name: 'price', type: 'number', step: '0.01', min: '0', required: true, value: s?.price ?? '' })), field('Duration (minutes)', h('input', { name: 'duration_min', type: 'number', min: '5', max: '720', step: '5', required: true, value: s?.duration_min ?? 30 })),
      field('Description', h('textarea', { name: 'description', value: s?.description || '' }), 'full'),
      h('label', { class: 'chk full' }, h('input', { type: 'checkbox', name: 'active', checked: s ? s.active : true }), h('span', {}, 'Bookable (untick to hide)')),
      h('div', { class: 'full' }, h('b', {}, 'Staff who do this service'), staff.length ? h('div', { class: 'checks mt' }, staff.map(m => h('label', { class: 'chk' }, h('input', { type: 'checkbox', checked: sel.has(m.id), onchange: e => (e.target.checked ? sel.add(m.id) : sel.delete(m.id)) }), h('span', {}, m.name)))) : h('p', { class: 'sub' }, 'Add staff first.')),
      h('div', { class: 'acts full' }, h('button', { type: 'button', class: 'btn', onclick: close }, 'Cancel'), h('button', { class: 'btn pri' }, 'Save')));
      return f;
    });
  }
  load();
}
