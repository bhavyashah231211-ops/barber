const z = d => new Date(d).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
const esc = s => String(s || '').replace(/[\\;,]/g, m => '\\' + m).replace(/\r?\n/g, '\\n');
// Integration: "add to calendar" file that works with Google/Apple/Outlook calendars.
export function downloadIcs({ id, start, end, title, location, desc }) {
  const body = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//CBSystem//Salon//EN', 'BEGIN:VEVENT', `UID:${id}@cbsystem`, `DTSTAMP:${z(new Date())}`,
    `DTSTART:${z(start)}`, `DTEND:${z(end)}`, `SUMMARY:${esc(title)}`, location && `LOCATION:${esc(location)}`, desc && `DESCRIPTION:${esc(desc)}`, 'END:VEVENT', 'END:VCALENDAR'].filter(Boolean).join('\r\n');
  const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([body], { type: 'text/calendar' })); a.download = 'booking.ics'; a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
