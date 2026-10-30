// Single Supabase client (anon key only; all access is enforced by RLS in supabase/salon.sql).
const C = window.CBS || {};
if (!C.key || !(C.url || C.fn)) throw new Error('config.js is missing the Supabase url/key');
export const sb = window.supabase.createClient(C.url || new URL(C.fn).origin, C.key,
  { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true, storageKey: 'cbs-salon-auth' } });
export const must = ({ data, error }) => { if (error) throw new Error(error.message || 'Request failed'); return data; };
export const rpc = async (fn, args) => must(await sb.rpc(fn, args));
