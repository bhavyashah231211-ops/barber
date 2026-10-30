import { sb, must } from '../core/supa.js';
import { h, field, formData, run, table, modal, select, copyText, toast } from '../core/ui.js';
import { loadStaff, loadBranches } from '../core/data.js';
import { DAYS, hhmm, fmtDate } from '../core/time.js';

const ORDER = [1, 2, 3, 4, 5, 6, 0], EVENTS = [['booking.created', 'Booking created'], ['booking.cancelled', 'Booking cancelled'], ['payment.created', 'Payment recorded']];

export async function render(root, ctx) {
  const { biz } = ctx, zones = (Intl.supportedValuesOf ? Intl.supportedValuesOf('timeZone') : []).concat(['Europe/London', 'UTC']).filter((z, i, a) => a.indexOf(z) === i);
  const link = new URL('../customer/?b=' + biz.slug, location.href).href;

  const pf = h('form', { class: 'form', onsubmit: async e => {
    e.preventDefault(); const d = formData(pf);
    const row = { name: d.name.trim(), phone: d.phone.trim() || null, address: d.address.trim() || null, currency: d.currency.trim() || '£', timezone: d.timezone, slot_minutes: Number(d.slot_minutes),
      min_notice_minutes: Number(d.min_notice_minutes), cancel_notice_hours: Number(d.cancel_notice_hours), accent: d.accent };
    if (await run(async () => { must(await sb.from('sl_businesses').update(row).eq('id', biz.id)); await ctx.reloadBiz(); }, 'Settings saved')) root.replaceChildren(), render(root, ctx);
  } },
    field('Business name', h('input', { name: 'name', required: true, minlength: 2, maxlength: 80, value: biz.name })), field('Phone', h('input', { name: 'phone', type: 'tel', value: biz.phone || '' })),
    field('Address', h('input', { name: 'address', value: biz.address || '' }), 'full'),
    field('Currency symbol', h('input', { name: 'currency', maxlength: 4, value: biz.currency })), field('Time zone', select('timezone', zones.map(z => [z, z]), biz.timezone)),
    field('Booking slot length', select('slot_minutes', [5, 10, 15, 20, 30, 60].map(m => [m, m + ' minutes']), biz.slot_minutes)), field('Earliest booking (minutes from now)', h('input', { name: 'min_notice_minutes', type: 'number', min: '0', value: biz.min_notice_minutes })),
    field('Customers can cancel/move up to (hours before)', h('input', { name: 'cancel_notice_hours', type: 'number', min: '0', value: biz.cancel_notice_hours })), field('Brand colour', h('input', { name: 'accent', type: 'color', value: biz.accent })),
    h('div', { class: 'acts full' }, h('button', { class: 'btn pri' }, 'Save settings')));

  const brOut = h('div', {}), subOut = h('div', {});
  async function loadBranchesCard() {
    const [branches, staff] = await Promise.all([loadBranches(biz), loadStaff(biz, true)]), activeB = branches.filter(b => b.active).length;
    brOut.replaceChildren(table([{ h: 'Branch', r: b => h('b', {}, b.name) }, { h: 'Address', r: b => b.address || '' }, { h: 'Status', r: b => (b.active ? h('span', { class: 'badge ok' }, 'Active') : h('span', { class: 'badge' }, 'Closed')) },
      { h: '', cls: 'r nw', r: b => [h('button', { class: 'btn sm', onclick: () => hours(b) }, 'Opening hours'), ' ', h('button', { class: 'btn sm', onclick: () => editBranch(b) }, 'Edit')] }], branches, 'No branches.'));
    subOut.replaceChildren(h('p', {}, h('span', { class: 'badge info' }, biz.plan), ' ', h('span', { class: 'badge ' + (biz.sub_status === 'active' || biz.sub_status === 'trial' ? 'ok' : 'bad') }, biz.sub_status),
      biz.sub_status === 'trial' ? h('span', { class: 'sub' }, ' · trial ends ' + fmtDate(biz.trial_ends_at, biz.timezone)) : ''),
      h('p', { class: 'sub' }, `Staff: ${staff.length} of ${biz.max_staff} · Branches: ${activeB} of ${biz.max_branches}`), h('p', { class: 'sub' }, 'To change your plan or limits, contact CBSystem.'));
  }
  function editBranch(b) {
    modal(b ? 'Edit branch' : 'New branch', close => {
      const f = h('form', { class: 'form', onsubmit: async e => {
        e.preventDefault(); const d = formData(f), row = { name: d.name.trim(), address: d.address.trim() || null, phone: d.phone.trim() || null, active: d.active };
        const ok = await run(async () => {
          if (b) must(await sb.from('sl_branches').update(row).eq('id', b.id));
          else { const id = must(await sb.from('sl_branches').insert({ ...row, business_id: biz.id }).select('id').single()).id;
            must(await sb.from('sl_business_hours').insert(ORDER.map(wd => ({ business_id: biz.id, branch_id: id, weekday: wd, open_time: '09:00', close_time: '18:00', is_closed: wd === 0 })))); }
        }, 'Saved');
        if (ok) { close(); loadBranchesCard(); }
      } }, field('Name', h('input', { name: 'name', required: true, maxlength: 80, value: b?.name || '' }), 'full'), field('Address', h('input', { name: 'address', value: b?.address || '' })), field('Phone', h('input', { name: 'phone', type: 'tel', value: b?.phone || '' })),
      h('label', { class: 'chk full' }, h('input', { type: 'checkbox', name: 'active', checked: b ? b.active : true }), h('span', {}, 'Open for bookings')),
      h('div', { class: 'acts full' }, h('button', { type: 'button', class: 'btn', onclick: close }, 'Cancel'), h('button', { class: 'btn pri' }, 'Save')));
      return f;
    });
  }
  async function hours(b) {
    const cur = must(await sb.from('sl_business_hours').select('*').eq('branch_id', b.id)), H = {};
    ORDER.forEach(d => { const r = cur.find(x => x.weekday === d); H[d] = { closed: r ? r.is_closed : d === 0, a: r ? hhmm(r.open_time) : '09:00', b: r ? hhmm(r.close_time) : '18:00' }; });
    modal(`Opening hours · ${b.name}`, close => h('div', {}, h('div', { class: 'list' }, ORDER.map(d => h('div', { class: 'bar' }, h('span', { style: { width: '100px' } }, DAYS[d]),
      h('label', { class: 'chk' }, h('input', { type: 'checkbox', checked: H[d].closed, onchange: e => { H[d].closed = e.target.checked; } }), h('span', {}, 'Closed')),
      h('input', { type: 'time', value: H[d].a, onchange: e => { H[d].a = e.target.value; } }), h('input', { type: 'time', value: H[d].b, onchange: e => { H[d].b = e.target.value; } })))),
    h('div', { class: 'acts' }, h('button', { class: 'btn', onclick: close }, 'Cancel'), h('button', { class: 'btn pri', onclick: async () => {
      const rows = ORDER.map(d => ({ business_id: biz.id, branch_id: b.id, weekday: d, open_time: H[d].a, close_time: H[d].b, is_closed: H[d].closed }));
      if (rows.some(r => !r.is_closed && r.close_time <= r.open_time)) return toast('Closing time must be after opening time.', 'err');
      if (await run(async () => must(await sb.from('sl_business_hours').upsert(rows, { onConflict: 'branch_id,weekday' })), 'Hours saved')) close();
    } }, 'Save hours'))));
  }

  const intOut = h('div', {});
  async function loadIntegration() {
    const cur = must(await sb.from('sl_integrations').select('*').eq('business_id', biz.id).maybeSingle()), ev = new Set(cur?.events || EVENTS.map(e => e[0]));
    const f = h('form', { class: 'form', onsubmit: async e => {
      e.preventDefault(); const d = formData(f);
      await run(async () => must(await sb.from('sl_integrations').upsert({ business_id: biz.id, webhook_url: d.url.trim() || null, webhook_secret: d.secret.trim() || null, events: [...ev], active: d.active }, { onConflict: 'business_id' })), 'Integration saved');
    } },
      field('Webhook URL (https only)', h('input', { name: 'url', type: 'url', pattern: 'https://.*', placeholder: 'https://hooks.example.com/…', value: cur?.webhook_url || '' }), 'full'),
      field('Secret (sent in the x-cbs-secret header)', h('input', { name: 'secret', value: cur?.webhook_secret || '', autocomplete: 'off' }), 'full'),
      h('div', { class: 'full checks' }, EVENTS.map(([k, t]) => h('label', { class: 'chk' }, h('input', { type: 'checkbox', checked: ev.has(k), onchange: e => (e.target.checked ? ev.add(k) : ev.delete(k)) }), h('span', {}, t)))),
      h('label', { class: 'chk full' }, h('input', { type: 'checkbox', name: 'active', checked: cur ? cur.active : true }), h('span', {}, 'Send events')),
      h('div', { class: 'acts full' }, h('button', { class: 'btn pri' }, 'Save integration')));
    intOut.replaceChildren(h('p', { class: 'sub' }, 'Send booking and payment events to Zapier, Make, n8n or your own server. Every booking also has an "add to calendar" (.ics) download.'), f);
  }

  root.append(
    h('div', { class: 'card' }, h('h2', {}, 'Your booking link'), h('p', { class: 'sub' }, 'Share this link or put it on your website and social profiles.'), h('div', { class: 'bar' }, h('input', { class: 'grow', readonly: true, value: link, onfocus: e => e.target.select() }), h('button', { class: 'btn', onclick: () => copyText(link) }, 'Copy'))),
    h('div', { class: 'card' }, h('h2', {}, 'Business'), pf),
    h('div', { class: 'card' }, h('div', { class: 'bar' }, h('h2', { class: 'grow' }, 'Branches & opening hours'), h('button', { class: 'btn pri', onclick: () => editBranch(null) }, '+ Add branch')), brOut),
    h('div', { class: 'card' }, h('h2', {}, 'Subscription'), subOut), h('div', { class: 'card' }, h('h2', {}, 'Integrations'), intOut));
  loadBranchesCard().catch(e => brOut.replaceChildren(h('p', { class: 'err' }, e.message))); loadIntegration().catch(e => intOut.replaceChildren(h('p', { class: 'err' }, e.message)));
}
