import { sb, must } from '../core/supa.js';
import { h, field, formData, run, table, modal, select, toast } from '../core/ui.js';
import { loadServices, loadStaff, loadBranches, syncAssign } from '../core/data.js';
import { DAYS, hhmm } from '../core/time.js';

const ORDER = [1, 2, 3, 4, 5, 6, 0];

export async function render(root, ctx) {
  const out = h('div', { class: 'card' });
  root.append(h('div', { class: 'bar' }, h('div', { class: 'grow' }), h('button', { class: 'btn pri', onclick: () => edit(null) }, '+ New staff member')), out);
  let staff = [], branches = [], services = [], links = [];
  async function load() {
    try {
      [staff, branches, services, links] = await Promise.all([loadStaff(ctx.biz), loadBranches(ctx.biz), loadServices(ctx.biz, true), sb.from('sl_staff_services').select('staff_id,service_id').eq('business_id', ctx.biz.id).then(must)]);
      const B = new Map(branches.map(b => [b.id, b.name]));
      out.replaceChildren(table([{ h: 'Name', r: s => [h('span', { class: 'badge', style: { background: s.color, color: '#06141a' } }, ' '), ' ', h('b', {}, s.name), s.title ? h('span', { class: 'sub' }, ' · ' + s.title) : ''] },
        ...(branches.length > 1 ? [{ h: 'Branch', r: s => B.get(s.branch_id) }] : []), { h: 'Services', r: s => links.filter(l => l.staff_id === s.id).length || h('span', { class: 'badge warn' }, 'none') },
        { h: 'Login', r: s => (s.profile_id ? h('span', { class: 'badge ok' }, 'Signed up') : s.email ? h('span', { class: 'badge info' }, 'Invited') : h('span', { class: 'sub' }, 'No email')) },
        { h: 'Status', r: s => (s.active ? h('span', { class: 'badge ok' }, 'Active') : h('span', { class: 'badge' }, 'Inactive')) },
        { h: '', cls: 'r', r: s => h('button', { class: 'btn sm', onclick: e => { e.stopPropagation(); schedule(ctx, s); } }, 'Schedule') }], staff, 'No staff yet.', edit));
    } catch (e) { out.replaceChildren(h('p', { class: 'err' }, e.message)); }
  }
  function edit(s) {
    const sel = new Set(s ? links.filter(l => l.staff_id === s.id).map(l => l.service_id) : []);
    modal(s ? 'Edit staff member' : 'New staff member', close => {
      const f = h('form', { class: 'form', onsubmit: async e => {
        e.preventDefault(); const d = formData(f);
        const row = { name: d.name.trim(), title: d.title.trim() || null, email: d.email.trim().toLowerCase() || null, phone: d.phone.trim() || null, bio: d.bio.trim() || null, color: d.color, branch_id: d.branch_id, active: d.active };
        const ok = await run(async () => {
          const id = s ? (must(await sb.from('sl_staff').update(row).eq('id', s.id)), s.id) : must(await sb.from('sl_staff').insert({ ...row, business_id: ctx.biz.id }).select('id').single()).id;
          await syncAssign(ctx.biz.id, 'staff_id', id, 'service_id', sel);
        }, 'Saved');
        if (ok) { close(); load(); }
      } },
      field('Name', h('input', { name: 'name', required: true, maxlength: 80, value: s?.name || '' })), field('Job title', h('input', { name: 'title', maxlength: 60, value: s?.title || '' })),
      field('Email (they use it to sign in to the staff app)', h('input', { name: 'email', type: 'email', value: s?.email || '' })), field('Phone', h('input', { name: 'phone', type: 'tel', value: s?.phone || '' })),
      field('Branch', select('branch_id', branches.filter(b => b.active || b.id === s?.branch_id).map(b => [b.id, b.name]), s?.branch_id || branches[0]?.id)), field('Calendar colour', h('input', { name: 'color', type: 'color', value: s?.color || '#2dd4a0' })),
      field('Short bio (shown to customers)', h('textarea', { name: 'bio', value: s?.bio || '' }), 'full'),
      h('label', { class: 'chk full' }, h('input', { type: 'checkbox', name: 'active', checked: s ? s.active : true }), h('span', {}, 'Active (can take bookings)')),
      h('div', { class: 'full' }, h('b', {}, 'Services'), services.length ? h('div', { class: 'checks mt' }, services.map(v => h('label', { class: 'chk' }, h('input', { type: 'checkbox', checked: sel.has(v.id), onchange: e => (e.target.checked ? sel.add(v.id) : sel.delete(v.id)) }), h('span', {}, v.name)))) : h('p', { class: 'sub' }, 'Add services first.')),
      h('div', { class: 'acts full' }, h('button', { type: 'button', class: 'btn', onclick: close }, 'Cancel'), h('button', { class: 'btn pri' }, 'Save')));
      return f;
    });
  }
  load();
}

// Working hours, breaks and holidays for one staff member.
async function schedule(ctx, s) {
  const old = must(await sb.from('sl_staff_availability').select('*').eq('staff_id', s.id));
  const work = {}; old.filter(r => r.kind === 'work').forEach(r => { work[r.weekday] = { on: true, a: hhmm(r.start_time), b: hhmm(r.end_time) }; });
  ORDER.forEach(d => { work[d] = work[d] || { on: false, a: '09:00', b: '17:00' }; });
  const breaks = old.filter(r => r.kind === 'break').map(r => ({ wd: r.weekday == null ? '' : String(r.weekday), a: hhmm(r.start_time), b: hhmm(r.end_time) }));
  const hols = old.filter(r => r.kind === 'holiday').map(r => ({ a: r.start_date, b: r.end_date, note: r.note || '' }));
  modal(`Schedule · ${s.name}`, close => {
    const bl = h('div', { class: 'list' }), hl = h('div', { class: 'list' });
    const drawB = () => bl.replaceChildren(...breaks.map((x, i) => h('div', { class: 'bar' }, select('', [['', 'Every day'], ...ORDER.map(d => [String(d), DAYS[d]])], x.wd, { onchange: e => { x.wd = e.target.value; } }),
      h('input', { type: 'time', value: x.a, onchange: e => { x.a = e.target.value; } }), h('input', { type: 'time', value: x.b, onchange: e => { x.b = e.target.value; } }), h('button', { class: 'btn sm red', onclick: () => { breaks.splice(i, 1); drawB(); } }, 'Remove'))));
    const drawH = () => hl.replaceChildren(...hols.map((x, i) => h('div', { class: 'bar' }, h('input', { type: 'date', value: x.a, onchange: e => { x.a = e.target.value; } }), h('input', { type: 'date', value: x.b, onchange: e => { x.b = e.target.value; } }),
      h('input', { placeholder: 'Note', value: x.note, maxlength: 60, onchange: e => { x.note = e.target.value; } }), h('button', { class: 'btn sm red', onclick: () => { hols.splice(i, 1); drawH(); } }, 'Remove'))));
    drawB(); drawH();
    return h('div', {},
      h('h3', {}, 'Working hours'), h('p', { class: 'sub' }, 'Leave every day unticked to follow the business opening hours.'),
      h('div', { class: 'list' }, ORDER.map(d => h('div', { class: 'bar' }, h('label', { class: 'chk', style: { width: '130px' } }, h('input', { type: 'checkbox', checked: work[d].on, onchange: e => { work[d].on = e.target.checked; } }), h('span', {}, DAYS[d])),
        h('input', { type: 'time', value: work[d].a, onchange: e => { work[d].a = e.target.value; } }), h('input', { type: 'time', value: work[d].b, onchange: e => { work[d].b = e.target.value; } })))),
      h('h3', {}, 'Breaks'), bl, h('button', { class: 'btn sm mt', onclick: () => { breaks.push({ wd: '', a: '13:00', b: '13:30' }); drawB(); } }, '+ Add break'),
      h('h3', {}, 'Holidays / days off'), hl, h('button', { class: 'btn sm mt', onclick: () => { const t = new Date().toISOString().slice(0, 10); hols.push({ a: t, b: t, note: '' }); drawH(); } }, '+ Add holiday'),
      h('div', { class: 'acts' }, h('button', { class: 'btn', onclick: close }, 'Cancel'), h('button', { class: 'btn pri', onclick: async () => {
        const base = { business_id: ctx.biz.id, staff_id: s.id }, rows = [];
        for (const d of ORDER) if (work[d].on) rows.push({ ...base, kind: 'work', weekday: d, start_time: work[d].a, end_time: work[d].b });
        for (const x of breaks) rows.push({ ...base, kind: 'break', weekday: x.wd === '' ? null : Number(x.wd), start_time: x.a, end_time: x.b });
        for (const x of hols) rows.push({ ...base, kind: 'holiday', start_date: x.a, end_date: x.b, note: x.note || null });
        const bad = rows.find(r => (r.kind !== 'holiday' && !(r.start_time && r.end_time && r.end_time > r.start_time)) || (r.kind === 'holiday' && !(r.start_date && r.end_date && r.end_date >= r.start_date)));
        if (bad) return toast('Check the times and dates: each end must be after its start.', 'err');
        const ok = await run(async () => {   // insert the new rows first, then remove the old ones, so a failure never loses the schedule
          if (rows.length) must(await sb.from('sl_staff_availability').insert(rows));
          if (old.length) must(await sb.from('sl_staff_availability').delete().in('id', old.map(r => r.id)));
        }, 'Schedule saved');
        if (ok) close();
      } }, 'Save schedule'))); }, { wide: true });
}
