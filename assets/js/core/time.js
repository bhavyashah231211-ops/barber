// Everything is stored in UTC and shown/edited in the business time zone.
const fmt = (tz, o) => new Intl.DateTimeFormat('en-GB', { timeZone: tz, ...o });
export const todayStr = tz => new Intl.DateTimeFormat('en-CA', { timeZone: tz }).format(new Date());
export const dateOf = (iso, tz) => new Intl.DateTimeFormat('en-CA', { timeZone: tz }).format(new Date(iso));
export const addDays = (s, n) => { const d = new Date(s + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
function offsetMs(ts, tz) {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' })
    .formatToParts(new Date(ts)).map(x => [x.type, x.value]));
  return Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second) - Math.floor(ts / 1000) * 1000;
}
export function zonedToUtc(dateStr, timeStr, tz) {
  const [y, m, d] = dateStr.split('-').map(Number), [hh, mm] = (timeStr || '00:00').split(':').map(Number);
  const guess = Date.UTC(y, m - 1, d, hh, mm); let t = guess - offsetMs(guess, tz); t = guess - offsetMs(t, tz);
  return new Date(t);
}
export const dayRange = (d, tz) => [zonedToUtc(d, '00:00', tz).toISOString(), zonedToUtc(addDays(d, 1), '00:00', tz).toISOString()];
export const fmtTime = (iso, tz) => fmt(tz, { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(iso));
export const fmtDate = (iso, tz) => fmt(tz, { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' }).format(new Date(iso));
export const fmtDateTime = (iso, tz) => `${fmtDate(iso, tz)} ${fmtTime(iso, tz)}`;
export const minsOfDay = (iso, tz) => { const [h, m] = fmtTime(iso, tz).split(':').map(Number); return h * 60 + m; };
export const hhmm = t => (t || '').slice(0, 5);
export const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
