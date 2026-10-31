import { sb, must } from '../core/supa.js';
import { h, field, formData, run, select, copyText, confirmBox } from '../core/ui.js';
import { callPay, webhookUrl } from '../core/pay.js';
import { paySettings, clearPaySettings, printTestReceipt } from '../core/receipt.js';

// Settings card: every salon connects its own card terminal / payment link provider and sets up its receipts.
export function paymentSettingsCard(ctx) {
  const box = h('div', { class: 'card' }, h('h2', {}, 'Payments & receipts'), h('p', { class: 'sub' }, 'Loading…'));
  const load = async () => draw(await paySettings(ctx.biz, true));
  load().catch(e => box.replaceChildren(h('p', { class: 'err' }, e.message)));
  return box;

  function draw(set) {
    const f = h('form', { class: 'form', onsubmit: async e => {
      e.preventDefault(); const d = formData(f);
      const row = { business_id: ctx.biz.id, currency_code: d.currency_code.trim().toLowerCase() || 'gbp', link_template: d.link_template.trim() || null, terminal_name: d.terminal_name.trim() || null, terminal_url: d.terminal_url.trim() || null,
        receipt_paper: d.receipt_paper, receipt_copies: Number(d.receipt_copies), receipt_auto_print: d.receipt_auto_print, receipt_header: d.receipt_header.trim() || null, receipt_footer: d.receipt_footer.trim() || null, vat_number: d.vat_number.trim() || null };
      if (await run(async () => must(await sb.from('sl_pay_settings').upsert(row, { onConflict: 'business_id' })), 'Saved')) { clearPaySettings(ctx.biz); load(); }
    } },
      h('h3', { class: 'full' }, 'Card terminal'),
      field('Terminal name (shown to staff)', h('input', { name: 'terminal_name', maxlength: 40, placeholder: 'e.g. SumUp Air, Zettle, Square', value: set.terminal_name || '' })),
      field('Currency code', h('input', { name: 'currency_code', maxlength: 3, required: true, pattern: '[A-Za-z]{3}', value: (set.currency_code || 'gbp').toUpperCase() })),
      field('Open-terminal link (optional)', h('input', { name: 'terminal_url', maxlength: 500, placeholder: 'https://… or your terminal app\'s link', value: set.terminal_url || '' }), 'full'),
      h('p', { class: 'sub full' }, 'Use your terminal provider\'s own app link or web page. Placeholders: {amount} {amount_minor} {currency} {ref} {name} {service}. After the customer pays on the terminal, staff records it as Card on the booking.'),
      h('h3', { class: 'full' }, 'Payment link'),
      field('Link template (https only)', h('input', { name: 'link_template', maxlength: 500, placeholder: 'https://pay.example.com/your-shop?amount={amount}&ref={ref}', value: set.link_template || '' }), 'full'),
      h('p', { class: 'sub full' }, 'Works with any provider that gives you a payment page or link (PayPal.me, Revolut, SumUp, Mollie, Square…). Staff gets a ready link for each booking to send to the customer. For automatic "paid" recording, connect Stripe below instead.'),
      h('h3', { class: 'full' }, 'Receipts'),
      field('Paper', select('receipt_paper', [['80mm', '80 mm thermal'], ['58mm', '58 mm thermal'], ['a4', 'A4 page']], set.receipt_paper)), field('Copies', select('receipt_copies', [1, 2, 3].map(n => [n, String(n)]), set.receipt_copies)),
      field('Header text', h('input', { name: 'receipt_header', maxlength: 200, value: set.receipt_header || '' })), field('Footer text', h('input', { name: 'receipt_footer', maxlength: 200, placeholder: 'Thank you!', value: set.receipt_footer || '' })),
      field('VAT number (optional)', h('input', { name: 'vat_number', maxlength: 30, value: set.vat_number || '' })),
      h('label', { class: 'chk' }, h('input', { type: 'checkbox', name: 'receipt_auto_print', checked: !!set.receipt_auto_print }), h('span', {}, 'Print automatically after a payment or sale')),
      h('div', { class: 'acts full' }, h('button', { type: 'button', class: 'btn', onclick: () => printTestReceipt(ctx, { ...set, ...formDataSet(f) }) }, 'Print test receipt'), h('button', { class: 'btn pri' }, 'Save')),
      h('p', { class: 'sub full' }, 'Receipts print through your browser, so any printer installed on that computer, tablet or phone works, including USB and Bluetooth thermal printers. Choose the printer once in the print window (turn on "kiosk"/silent printing in your browser for one-tap printing).'));
    box.replaceChildren(h('h2', {}, 'Payments & receipts'), f, h('h3', {}, 'Stripe (automatic payment links)'), stripeBox(set));
  }
  const formDataSet = f => { const d = formData(f); return { receipt_paper: d.receipt_paper, receipt_copies: Number(d.receipt_copies), receipt_header: d.receipt_header, receipt_footer: d.receipt_footer, vat_number: d.vat_number }; };

  function stripeBox(set) {
    const url = webhookUrl(ctx.biz);
    const f = h('form', { class: 'form', onsubmit: async e => {
      e.preventDefault(); const d = formData(f);
      const r = await run(() => callPay({ action: 'save_keys', business_id: ctx.biz.id, secret_key: d.secret_key, webhook_secret: d.webhook_secret }), 'Stripe saved');
      if (r) { clearPaySettings(ctx.biz); load(); }
    } },
      field(set.stripe_enabled ? 'Replace secret key (optional)' : 'Stripe secret or restricted key', h('input', { name: 'secret_key', type: 'password', autocomplete: 'off', placeholder: 'sk_live_… or rk_live_…' }), 'full'),
      field('Webhook signing secret', h('input', { name: 'webhook_secret', type: 'password', autocomplete: 'off', placeholder: 'whsec_…' }), 'full'),
      h('div', { class: 'acts full' }, set.stripe_enabled ? h('button', { type: 'button', class: 'btn red', onclick: async () => { if (await confirmBox('Disconnect Stripe and delete the stored keys?') && await run(() => callPay({ action: 'remove_keys', business_id: ctx.biz.id }), 'Disconnected')) { clearPaySettings(ctx.biz); load(); } } }, 'Disconnect') : null, h('button', { class: 'btn pri' }, 'Save Stripe')));
    return h('div', {}, h('p', {}, set.stripe_enabled ? h('span', { class: 'badge ok' }, 'Connected') : h('span', { class: 'badge' }, 'Not connected')),
      h('p', { class: 'sub' }, 'Each salon uses its own Stripe account, so money goes straight to you. Use a restricted key that only allows Checkout Sessions (write). The key is stored where the app itself can never read it back.'),
      h('ol', { class: 'sub' }, h('li', {}, 'In Stripe: Developers → API keys → create the key and paste it below.'),
        h('li', {}, 'Developers → Webhooks → Add endpoint → paste this address, choose the event "checkout.session.completed" (and "checkout.session.async_payment_succeeded"):'),
        h('li', {}, 'Copy the endpoint\'s signing secret (whsec_…) and paste it below, then save.')),
      h('div', { class: 'bar' }, h('input', { class: 'grow', readonly: true, value: url, onfocus: e => e.target.select() }), h('button', { type: 'button', class: 'btn', onclick: () => copyText(url) }, 'Copy')), f);
  }
}
