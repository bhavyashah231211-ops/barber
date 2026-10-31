// App shell shared by /admin and /staff: auth, business selection, sidebar, hash router, lazy-loaded modules.
import { sb, must, rpc } from './core/supa.js';
import { h, field, formData, run, select } from './core/ui.js';
import { authCard, watchRecovery, getUser, signOut } from './core/auth.js';

const M = n => ({ id: n, file: `./modules/${n}.js` });
export const ADMIN_MODULES = [['dashboard', 'Dashboard'], ['calendar', 'Calendar'], ['bookings', 'Bookings'], ['customers', 'Customers'], ['services', 'Services'], ['staff', 'Staff'],
  ['payments', 'Payments'], ['products', 'Products'], ['reports', 'Reports'], ['settings', 'Settings']].map(([id, title]) => ({ ...M(id), title }));
export const STAFF_MODULES = [['calendar', 'My calendar'], ['bookings', 'Bookings'], ['customers', 'Customers'], ['products', 'Products']].map(([id, title]) => ({ ...M(id), title }));

const subOk = b => b.sub_status === 'active' || (b.sub_status === 'trial' && new Date(b.trial_ends_at) > new Date());
const slugify = s => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 38);

export async function startShell({ app, root, modules, allowed }) {
  watchRecovery();
  const center = node => root.replaceChildren(h('div', { class: 'center' }, node));
  const signOutBtn = h('button', { class: 'btn sm', onclick: signOut }, 'Sign out');

  async function enter() {
    const user = await getUser(); if (!user) return showAuth();
    if (app === 'staff') { try { await rpc('sl_claim_staff'); } catch { /* email not confirmed yet or nothing to claim */ } }
    const profs = must(await sb.from('sl_profiles').select('id,business_id,role,full_name').eq('user_id', user.id).in('role', allowed));
    if (!profs.length) return app === 'admin' ? onboarding(user) : center(h('div', { class: 'card auth' }, h('h2', {}, 'No access yet'),
      h('p', { class: 'sub' }, `Ask your manager to add ${user.email} as a staff member, then sign in again.`), signOutBtn));
    const bizs = must(await sb.from('sl_businesses').select('*').in('id', profs.map(p => p.business_id)));
    const key = 'cbs-biz-' + app; let cur = bizs.find(b => b.id === localStorage.getItem(key)) || bizs[0];
    mount(user, profs, bizs, cur);
  }

  function showAuth() {
    center(authCard({ title: app === 'admin' ? 'CBSystem Salon · Admin' : 'CBSystem Salon · Staff', signup: true, onSignedIn: enter,
      sub: app === 'admin' ? 'Owners and managers. Create an account to set up your business.' : 'Use the email your manager added for you. Create an account the first time.' }));
  }

  function onboarding(user) {
    const f = h('form', { class: 'form', onsubmit: async e => {
      e.preventDefault(); const d = formData(f);
      if (await run(() => rpc('sl_create_business', { p_name: d.name, p_slug: d.slug, p_full_name: d.full_name, p_phone: d.phone || null }))) enter();
    } },
      field('Business name', h('input', { name: 'name', required: true, minlength: 2, maxlength: 80, oninput: e => { f.elements.slug.value = slugify(e.target.value); } }), 'full'),
      field('Web address (used in your booking link)', h('input', { name: 'slug', required: true, pattern: '[a-z0-9][a-z0-9\\-]{1,38}' }), 'full'),
      field('Your name', h('input', { name: 'full_name', required: true, value: user.user_metadata?.full_name || '' })), field('Phone', h('input', { name: 'phone', type: 'tel' })),
      h('button', { class: 'btn pri full' }, 'Create business'));
    center(h('div', { class: 'card auth' }, h('h2', {}, 'Set up your business'), h('p', { class: 'sub' }, 'Starts with a 30-day trial. You can add services, staff and opening hours next.'), f, h('div', { class: 'mt' }, signOutBtn)));
  }

  async function mount(user, profs, bizs, biz) {
    const prof = profs.find(p => p.business_id === biz.id);
    document.documentElement.style.setProperty('--ac', biz.accent);
    const staffRow = prof.role === 'staff' ? must(await sb.from('sl_staff').select('id').eq('profile_id', prof.id).maybeSingle()) : null;
    const go = id => { location.hash = '#/' + id; };
    const ctx = { biz, user, profile: prof, role: prof.role, isAdmin: prof.role === 'admin', staffId: staffRow?.id || null, tz: biz.timezone, cur: biz.currency, go,
      async reloadBiz() { Object.assign(biz, must(await sb.from('sl_businesses').select('*').eq('id', biz.id).single())); document.documentElement.style.setProperty('--ac', biz.accent); ctx.tz = biz.timezone; ctx.cur = biz.currency; } };
    const view = h('section', { id: 'view' }), title = h('h1', {});
    const nav = h('nav', {}, modules.map(m => h('a', { href: '#/' + m.id, 'data-id': m.id }, m.title)));
    const switcher = bizs.length > 1 ? select('b', bizs.map(b => [b.id, b.name]), biz.id, { 'aria-label': 'Business', onchange: e => { localStorage.setItem('cbs-biz-' + app, e.target.value); location.hash = ''; enter(); } }) : null;
    const side = h('aside', { class: 'side' }, h('div', { class: 'brand' }, 'CB', h('span', {}, 'System'), h('div', { class: 'sub' }, biz.name)), nav,
      h('div', { class: 'side-foot' }, switcher, h('span', { class: 'sub' }, `${prof.full_name || user.email} · ${prof.role}`), signOutBtn));
    const banner = h('div', { class: 'banner', hidden: true });
    root.replaceChildren(h('div', { class: 'app' }, side, h('main', { class: 'main' },
      h('div', { class: 'top' }, h('button', { class: 'btn burger', 'aria-label': 'Menu', onclick: () => side.classList.toggle('open') }, '☰'), title), banner, view)));
    const days = Math.ceil((new Date(biz.trial_ends_at) - Date.now()) / 864e5);
    if (biz.sub_status === 'pending') { banner.hidden = false; banner.textContent = 'Your account is waiting to be activated by CBSystem. You can set everything up now; online booking and payments open once it is activated.'; }
    else if (!subOk(biz)) { banner.hidden = false; banner.textContent = 'Your subscription is not active: online booking and new payments are paused. Contact CBSystem to reactivate.'; }
    else if (biz.sub_status === 'trial' && days <= 7) { banner.hidden = false; banner.textContent = `Your trial ends in ${Math.max(days, 0)} day(s).`; }

    let token = 0;
    async function route() {
      const m = modules.find(x => x.id === location.hash.replace('#/', '')) || modules[0], my = ++token;
      nav.querySelectorAll('a').forEach(a => a.classList.toggle('on', a.dataset.id === m.id)); title.textContent = m.title; side.classList.remove('open');
      view.replaceChildren(h('p', { class: 'sub' }, 'Loading…'));
      try { const mod = await import(m.file); if (my !== token) return; view.replaceChildren(); await mod.render(view, ctx); }
      catch (e) { if (my === token) view.replaceChildren(h('p', { class: 'err' }, e.message)); console.error(e); }
    }
    if (startShell.off) removeEventListener('hashchange', startShell.off);
    startShell.off = route; addEventListener('hashchange', route); route();
  }

  sb.auth.getSession().then(({ data }) => (data.session ? enter() : showAuth()));
}
