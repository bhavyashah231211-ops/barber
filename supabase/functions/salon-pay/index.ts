// salon-pay: per-tenant Stripe payment links + webhook. Deploy with "Verify JWT" OFF (Stripe calls the webhook without a JWT;
// every other action checks the signed-in user itself). Needs no secrets of yours: each salon stores its own Stripe keys.
// Dependency-free on purpose (plain fetch) so it can be pasted into the Supabase dashboard editor.
const URL_ = Deno.env.get('SUPABASE_URL') || '';
const SRK = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';
const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, content-type, apikey, x-client-info', 'Access-Control-Allow-Methods': 'POST, OPTIONS' };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const json = (o: unknown, status = 200) => new Response(JSON.stringify(o), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });
const fail = (msg: string, status = 400) => json({ error: msg }, status);

async function rest(path: string, init: RequestInit = {}) {
  const r = await fetch(`${URL_}/rest/v1/${path}`, { ...init, headers: { apikey: SRK, Authorization: `Bearer ${SRK}`, 'Content-Type': 'application/json', ...(init.headers || {}) } });
  if (r.status === 409) { const e: any = new Error('duplicate'); e.duplicate = true; throw e; }
  if (!r.ok) throw new Error(`db ${r.status}`);
  return r.status === 204 ? null : await r.json().catch(() => null);
}
async function userId(req: Request): Promise<string | null> {
  const t = (req.headers.get('authorization') || '').replace(/^Bearer\s+/i, '');
  if (!t) return null;
  const r = await fetch(`${URL_}/auth/v1/user`, { headers: { apikey: SRK, Authorization: `Bearer ${t}` } });
  if (!r.ok) return null;
  const u = await r.json(); return UUID.test(u?.id || '') ? u.id : null;
}
const roleOf = async (uid: string, biz: string) => (await rest(`sl_profiles?user_id=eq.${uid}&business_id=eq.${biz}&select=role`))?.[0]?.role || null;
const bizOk = (b: any) => b && (b.sub_status === 'active' || (b.sub_status === 'trial' && new Date(b.trial_ends_at) > new Date()));

// Stripe signature check: header "t=...,v1=..." ; v1 = HMAC-SHA256(secret, `${t}.${rawBody}`)
export async function verifyStripe(raw: string, header: string, secret: string, tolerance = 300, now = Date.now()) {
  const parts = Object.fromEntries((header || '').split(',').map(p => p.split('=').map(s => s.trim()) as [string, string]));
  const t = Number(parts.t); if (!t || Math.abs(now / 1000 - t) > tolerance) return false;
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`${t}.${raw}`)));
  const hex = [...sig].map(b => b.toString(16).padStart(2, '0')).join('');
  const given = (header.split(',').filter(p => p.trim().startsWith('v1=')).map(p => p.trim().slice(3)));
  return given.some(g => g.length === hex.length && [...g].reduce((d, c, i) => d | (c.charCodeAt(0) ^ hex.charCodeAt(i)), 0) === 0);
}

async function stripe(secret: string, path: string, body?: URLSearchParams) {
  const r = await fetch(`https://api.stripe.com/v1/${path}`, { method: body ? 'POST' : 'GET', headers: { Authorization: `Bearer ${secret}`, ...(body ? { 'Content-Type': 'application/x-www-form-urlencoded' } : {}) }, body });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j?.error?.message || `Stripe error ${r.status}`);
  return j;
}

async function webhook(req: Request, biz: string) {
  const sec = (await rest(`sl_payment_secrets?business_id=eq.${biz}&select=stripe_webhook_secret`))?.[0]?.stripe_webhook_secret;
  if (!sec) return fail('Webhook not configured', 400);
  const raw = await req.text();
  if (!(await verifyStripe(raw, req.headers.get('stripe-signature') || '', sec))) return fail('Bad signature', 400);
  const ev = JSON.parse(raw), s = ev?.data?.object;
  if (['checkout.session.completed', 'checkout.session.async_payment_succeeded'].includes(ev.type) && s?.payment_status === 'paid') {
    const m = s.metadata || {};
    if (m.business_id === biz && UUID.test(m.booking_id || '')) {
      const bk = (await rest(`sl_bookings?id=eq.${m.booking_id}&business_id=eq.${biz}&select=id`))?.[0];
      if (bk) {
        try {
          await rest('sl_payments', { method: 'POST', headers: { Prefer: 'return=minimal' }, body: JSON.stringify({ business_id: biz, booking_id: bk.id, kind: m.kind === 'deposit' ? 'deposit' : 'payment', method: 'card', amount: (s.amount_total || 0) / 100, status: 'paid', reference: 'Stripe payment link', external_id: s.id }) });
        } catch (e: any) { if (!e.duplicate) throw e; }
      }
    }
  }
  return json({ received: true });
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  try {
    const hook = new URL(req.url).searchParams.get('hook');
    if (hook) return UUID.test(hook) ? await webhook(req, hook) : fail('Bad request');
    if (req.method !== 'POST') return fail('Method not allowed', 405);
    const uid = await userId(req); if (!uid) return fail('Sign in again', 401);
    const b = await req.json().catch(() => ({})), biz = String(b.business_id || '');
    if (!UUID.test(biz)) return fail('Bad business');
    const role = await roleOf(uid, biz);

    if (b.action === 'save_keys') {
      if (role !== 'admin') return fail('Admins only', 403);
      const sk = String(b.secret_key || '').trim(), wh = String(b.webhook_secret || '').trim();
      if (wh && !/^whsec_[A-Za-z0-9+/=_-]{10,}$/.test(wh)) return fail('Webhook signing secret should start with whsec_');
      if (!sk && !wh) return fail('Enter your Stripe secret key');
      if (sk) {
        if (!/^(sk|rk)_(live|test)_[A-Za-z0-9]{10,}$/.test(sk)) return fail('That does not look like a Stripe secret or restricted key (sk_… / rk_…)');
        try { await stripe(sk, 'balance'); } catch (e: any) { return fail('Stripe rejected that key: ' + e.message); }
      } else if (!(await rest(`sl_payment_secrets?business_id=eq.${biz}&select=stripe_secret`))?.[0]?.stripe_secret) return fail('Enter your Stripe secret key first');
      await rest('sl_payment_secrets?on_conflict=business_id', { method: 'POST', headers: { Prefer: 'resolution=merge-duplicates,return=minimal' }, body: JSON.stringify({ business_id: biz, ...(sk ? { stripe_secret: sk } : {}), ...(wh ? { stripe_webhook_secret: wh } : {}) }) });
      await rest('sl_pay_settings?on_conflict=business_id', { method: 'POST', headers: { Prefer: 'resolution=merge-duplicates,return=minimal' }, body: JSON.stringify({ business_id: biz, stripe_enabled: true }) });
      return json({ ok: true, webhook_url: `${URL_}/functions/v1/salon-pay?hook=${biz}`, has_webhook: !!wh });
    }
    if (b.action === 'remove_keys') {
      if (role !== 'admin') return fail('Admins only', 403);
      await rest(`sl_payment_secrets?business_id=eq.${biz}`, { method: 'DELETE', headers: { Prefer: 'return=minimal' } });
      await rest(`sl_pay_settings?business_id=eq.${biz}`, { method: 'PATCH', headers: { Prefer: 'return=minimal' }, body: JSON.stringify({ stripe_enabled: false }) });
      return json({ ok: true });
    }
    if (b.action === 'create_link') {
      if (role !== 'admin' && role !== 'staff') return fail('Not allowed', 403);
      const bookingId = String(b.booking_id || ''); if (!UUID.test(bookingId)) return fail('Bad booking');
      const biz_ = (await rest(`sl_businesses?id=eq.${biz}&select=name,sub_status,trial_ends_at`))?.[0];
      if (!bizOk(biz_)) return fail('Subscription is not active', 403);
      const bk = (await rest(`sl_bookings?id=eq.${bookingId}&business_id=eq.${biz}&select=id,price,service_id,status`))?.[0];
      if (!bk || ['cancelled', 'no_show'].includes(bk.status)) return fail('Booking not found or cancelled');
      const keys = (await rest(`sl_payment_secrets?business_id=eq.${biz}&select=stripe_secret`))?.[0];
      if (!keys?.stripe_secret) return fail('Stripe is not connected for this business');
      const net = Number((await rest(`sl_booking_payments?booking_id=eq.${bookingId}&select=net_paid`))?.[0]?.net_paid || 0);
      const due = Math.round((Number(bk.price) - net) * 100) / 100;
      const amount = b.amount == null || b.amount === '' ? due : Math.round(Number(b.amount) * 100) / 100;
      if (!(due > 0)) return fail('Nothing left to pay on this booking');
      if (!(amount > 0) || amount > due) return fail(`Amount must be between 0.01 and ${due.toFixed(2)}`);
      const ret = String(b.return_url || ''); if (!/^https:\/\/|^http:\/\/localhost/.test(ret)) return fail('Bad return address');
      const cur = (await rest(`sl_pay_settings?business_id=eq.${biz}&select=currency_code`))?.[0]?.currency_code || 'gbp';
      const svc = (await rest(`sl_services?id=eq.${bk.service_id}&select=name`))?.[0]?.name || 'Booking';
      const kind = b.kind === 'deposit' ? 'deposit' : 'payment';
      const p = new URLSearchParams({ mode: 'payment', success_url: ret, cancel_url: ret, 'line_items[0][quantity]': '1', 'line_items[0][price_data][currency]': cur,
        'line_items[0][price_data][unit_amount]': String(Math.round(amount * 100)), 'line_items[0][price_data][product_data][name]': `${kind === 'deposit' ? 'Deposit: ' : ''}${svc} – ${biz_.name}`.slice(0, 120),
        'metadata[booking_id]': bookingId, 'metadata[business_id]': biz, 'metadata[kind]': kind });
      const s = await stripe(keys.stripe_secret, 'checkout/sessions', p);
      return json({ url: s.url, session_id: s.id, amount });
    }
    return fail('Unknown action');
  } catch (e: any) { console.error(e); return fail('Server error', 500); }
});
