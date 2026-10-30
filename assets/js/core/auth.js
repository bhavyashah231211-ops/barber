import { sb } from './supa.js';
import { h, field, formData, run, modal, toast } from './ui.js';

const back = () => location.origin + location.pathname + location.search;
export const getUser = async () => (await sb.auth.getSession()).data.session?.user || null;
export const signOut = async () => { await sb.auth.signOut(); location.reload(); };

// Sign in / create account / reset password card. onSignedIn() runs once a session exists.
export function authCard({ title, sub, signup = true, phone = false, onSignedIn }) {
  const msg = h('p', { class: 'sub' }); let mode = 'in';
  const form = h('form', { class: 'form', onsubmit: submit });
  const name = field('Full name', h('input', { name: 'full_name', autocomplete: 'name' }), 'full');
  const ph = field('Phone (optional)', h('input', { name: 'phone', type: 'tel', autocomplete: 'tel' }), 'full');
  const em = field('Email', h('input', { name: 'email', type: 'email', required: true, autocomplete: 'email' }), 'full');
  const pw = field('Password', h('input', { name: 'password', type: 'password', required: true, minlength: 8, autocomplete: 'current-password' }), 'full');
  const go = h('button', { class: 'btn pri full' }, 'Sign in');
  const tabs = h('div', { class: 'tabs' });
  function setMode(m) {
    mode = m; msg.textContent = '';
    name.hidden = m !== 'up'; ph.hidden = m !== 'up' || !phone; pw.hidden = m === 'reset';
    go.textContent = { in: 'Sign in', up: 'Create account', reset: 'Send reset link' }[m];
    pw.querySelector('input').autocomplete = m === 'up' ? 'new-password' : 'current-password';
    pw.querySelector('input').required = m !== 'reset'; name.querySelector('input').required = m === 'up';
    tabs.replaceChildren(...[['in', 'Sign in'], signup && ['up', 'Create account'], ['reset', 'Forgot password']].filter(Boolean)
      .map(([k, t]) => h('button', { type: 'button', class: 'btn sm' + (k === m ? ' on' : ''), onclick: () => setMode(k) }, t)));
  }
  async function submit(e) {
    e.preventDefault(); const d = formData(form); go.disabled = true; msg.className = 'sub';
    try {
      if (mode === 'in') {
        const { error } = await sb.auth.signInWithPassword({ email: d.email.trim(), password: d.password });
        if (error) throw error; await onSignedIn();
      } else if (mode === 'up') {
        const { data, error } = await sb.auth.signUp({ email: d.email.trim(), password: d.password, options: { data: { full_name: d.full_name.trim(), phone: d.phone || '' }, emailRedirectTo: back() } });
        if (error) throw error;
        if (data.session) await onSignedIn(); else msg.textContent = 'Check your email and click the confirmation link, then sign in.';
      } else {
        const { error } = await sb.auth.resetPasswordForEmail(d.email.trim(), { redirectTo: back() });
        if (error) throw error; msg.textContent = 'If that email has an account, a reset link is on its way.';
      }
    } catch (x) { msg.className = 'err'; msg.textContent = /invalid login/i.test(x.message) ? 'Wrong email or password.' : x.message; }
    go.disabled = false;
  }
  form.append(name, ph, em, pw, go); setMode('in');
  return h('div', { class: 'card auth' }, h('h2', {}, title), sub ? h('p', { class: 'sub' }, sub) : null, tabs, form, msg);
}

// Shows "set a new password" when the user arrives from a reset email.
export function watchRecovery() {
  sb.auth.onAuthStateChange(ev => {
    if (ev !== 'PASSWORD_RECOVERY') return;
    setTimeout(() => modal('Set a new password', close => {
      const f = h('form', { class: 'form', onsubmit: async e => { e.preventDefault(); const ok = await run(async () => { const { error } = await sb.auth.updateUser({ password: formData(f).password }); if (error) throw error; }, 'Password updated'); if (ok) close(); } },
        field('New password', h('input', { name: 'password', type: 'password', minlength: 8, required: true, autocomplete: 'new-password' }), 'full'),
        h('button', { class: 'btn pri full' }, 'Save password'));
      return f;
    }), 0);
  });
}
