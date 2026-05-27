const { format } = require('date-fns');
const { ptBR } = require('date-fns/locale');
const { SUPABASE_URL, SUPABASE_ANON_KEY } = require('./config');

const ORDER_TYPE_LABEL = {
  delivery: 'ENTREGA',
  pickup: 'RETIRADA',
  dine_in: 'MESA',
  counter: 'BALCAO',
};

const fmt = (n) => `R$ ${Number(n || 0).toFixed(2).replace('.', ',')}`;

const esc = (s) =>
  String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');

function normalizeAddons(addons) {
  if (!addons || !Array.isArray(addons)) return [];
  return addons
    .map((a) => {
      if (typeof a === 'string') return { name: a.trim(), qty: 1 };
      if (a && typeof a === 'object') {
        const name = (a.option_name || a.name || '').trim();
        if (!name) return null;
        return { name, qty: Math.max(1, Number(a.quantity) || 1) };
      }
      return null;
    })
    .filter(Boolean);
}

function renderTicket({ restaurantName, order, items, categoryHeader }) {
  const shortId = order.id.slice(0, 8).toUpperCase();
  const created = format(new Date(order.created_at), "dd/MM/yyyy HH:mm", { locale: ptBR });
  const typeLabel = ORDER_TYPE_LABEL[order.order_type] || 'PEDIDO';
  const scheduled = order.scheduled_for
    ? format(new Date(order.scheduled_for), "dd/MM/yyyy 'às' HH:mm", { locale: ptBR })
    : null;

  const itemsText = items
    .map((it) => {
      const addons = normalizeAddons(it.addons)
        .map((a) => `  + ${a.name}${a.qty > 1 ? ` (${a.qty}x)` : ''}`)
        .join('\n');
      const obs = it.notes ? `  Obs: ${it.notes}` : '';
      return [`${it.quantity}x ${it.product_name}  ${fmt(it.subtotal)}`, addons, obs]
        .filter(Boolean)
        .join('\n');
    })
    .join('\n\n');

  const notes = order.notes || '';
  const paymentMatch = notes.match(/Pagamento:\s*([^\n*·]+)/i);
  const changeMatch = notes.match(/Troco para:\s*R?\$\s*([\d.,]+)/i);
  const deliveryFeeMatch = notes.match(/Taxa de entrega:\s*R?\$\s*([\d.,]+)/i);
  const deliveryFee = deliveryFeeMatch ? parseFloat(deliveryFeeMatch[1].replace(',', '.')) : 0;
  const subtotal = items.reduce((s, i) => s + i.subtotal, 0);

  let obsBlock = '';
  if (paymentMatch || changeMatch) {
    let lines = '';
    if (paymentMatch) lines += `Pagamento: ${paymentMatch[1].trim()}\n`;
    if (changeMatch) lines += `Troco: R$ ${changeMatch[1].trim()}`;
    obsBlock = `
<div class="hr"></div>
<div class="bold">Observacoes:</div>
<div class="small" style="white-space:pre-wrap">${esc(lines.trim())}</div>`;
  }

  return `
<div class="ticket">
  <div class="center bold big">${esc(restaurantName)}</div>
  <div class="center small">Pedido #${shortId}</div>
  <div class="center small">${created}</div>
  ${categoryHeader ? `<div class="banner">${esc(categoryHeader.toUpperCase())}</div>` : ''}
  <div class="hr"></div>

  <div class="row"><span>Tipo:</span><span class="bold">${typeLabel}${order.is_manual ? ' (MANUAL)' : ''}</span></div>
  ${order.table_number ? `<div class="row"><span>Mesa:</span><span class="bold">${esc(order.table_number)}</span></div>` : ''}
  ${scheduled ? `<div class="hi center bold">AGENDADO: ${scheduled}</div>` : ''}
  <div class="row"><span>Cliente:</span><span>${esc(order.customer_name)}</span></div>
  ${order.customer_phone ? `<div class="row"><span>Tel:</span><span>${esc(order.customer_phone)}</span></div>` : ''}
  ${order.customer_address ? `<div><span>End: </span><span>${esc(order.customer_address)}</span></div>` : ''}

  <div class="hr"></div>
  <div class="center bold">ITENS</div>
  <div class="hr-dash"></div>
  <pre class="items">${esc(itemsText)}</pre>
  <div class="hr-dash"></div>

  ${!categoryHeader ? `<div class="total-row"><span>TOTAL</span><span>${fmt(order.total_amount)}</span></div>` : ''}

  ${obsBlock}

  <div class="hr"></div>
  <div class="center bold">FINANCEIRO</div>
  <div class="hr"></div>
  <div class="row"><span>Subtotal:</span><span>${fmt(subtotal)}</span></div>
  <div class="row"><span>Entrega:</span><span>${fmt(deliveryFee)}</span></div>
  <div class="total-row"><span>TOTAL:</span><span>${fmt(order.total_amount)}</span></div>

  <div class="hr"></div>
  <div class="center small">Obrigado pela preferencia!</div>
  <div class="cut"></div>
</div>`;
}

function buildHtml({ restaurantName, order, items, splitByCategory }) {
  let body = '';
  if (splitByCategory) {
    const groups = new Map();
    items.forEach((it) => {
      const k = (it.category_name || 'Outros').trim();
      if (!groups.has(k)) groups.set(k, []);
      groups.get(k).push(it);
    });
    for (const [cat, list] of groups) {
      body += renderTicket({ restaurantName, order, items: list, categoryHeader: cat });
    }
    body += renderTicket({ restaurantName, order, items, categoryHeader: 'RESUMO' });
  } else {
    body = renderTicket({ restaurantName, order, items, categoryHeader: null });
  }

  return `<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<title>Pedido #${order.id.slice(0, 8)}</title>
<style>
* { box-sizing: border-box; margin: 0; padding: 0; }
html, body {
  width: 80mm;
  background: #fff;
  color: #000;
  overflow: visible;
}
body {
  font-family: 'Courier New', Courier, monospace;
  font-size: 12px;
  line-height: 1.4;
}
.ticket {
  width: 100%;
  padding: 3mm 4mm 4mm;
  /* Impede que o ticket seja partido entre páginas caso haja paginação residual */
  page-break-inside: avoid;
  break-inside: avoid;
}
.center { text-align: center; }
.bold { font-weight: bold; }
.big { font-size: 14px; }
.small { font-size: 11px; }
.hr { border-top: 1px solid #000; margin: 3px 0; }
.hr-dash { border-top: 1px dashed #000; margin: 3px 0; }
.row { display: flex; justify-content: space-between; gap: 4px; margin: 2px 0; }
.hi { background: #000; color: #fff; padding: 2px 4px; text-align: center; margin: 3px 0; }
.total-row { display: flex; justify-content: space-between; font-size: 14px; font-weight: bold; margin: 4px 0; }
.banner { text-align: center; font-weight: bold; border: 2px solid #000; padding: 3px; margin: 4px 0; font-size: 13px; }
.items { font-family: 'Courier New', Courier, monospace; font-size: 12px; white-space: pre-wrap; word-break: break-word; margin: 2px 0; }
.cut { border-top: 1px dashed #000; margin: 8px 0 2px; }
</style>
</head>
<body>
${body}
</body>
</html>`;
}

async function fetchOrderData(orderId) {
  try {
    const headers = {
      'apikey': SUPABASE_ANON_KEY,
      'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
      'Content-Type': 'application/json',
    };

    const [orderRes, itemsRes] = await Promise.all([
      fetch(`${SUPABASE_URL}/rest/v1/orders?id=eq.${orderId}&select=*`, { headers }),
      fetch(`${SUPABASE_URL}/rest/v1/order_items?order_id=eq.${orderId}&select=*`, { headers }),
    ]);

    if (!orderRes.ok || !itemsRes.ok) return null;

    const [orders, rawItems] = await Promise.all([orderRes.json(), itemsRes.json()]);
    const order = orders[0];
    if (!order) return null;

    const settingsRes = await fetch(
      `${SUPABASE_URL}/rest/v1/menu_settings?user_id=eq.${order.user_id}&select=display_name,menus(name)&limit=1`,
      { headers }
    );
    let restaurantName = 'Restaurante';
    if (settingsRes.ok) {
      const s = await settingsRes.json();
      restaurantName = s[0]?.display_name || s[0]?.menus?.name || restaurantName;
    }

    const items = rawItems.map((it) => ({
      product_name: it.product_name,
      quantity: it.quantity,
      unit_price: Number(it.unit_price),
      subtotal: Number(it.subtotal),
      category_name: it.category_name || null,
      notes: it.notes || null,
      addons: it.addons
        ? typeof it.addons === 'string'
          ? JSON.parse(it.addons)
          : it.addons
        : [],
    }));

    const printOrder = {
      id: order.id,
      customer_name: order.customer_name,
      customer_phone: order.customer_phone,
      customer_address: order.customer_address,
      total_amount: Number(order.total_amount),
      notes: order.notes,
      created_at: order.created_at,
      order_type: order.order_type || 'delivery',
      is_scheduled: order.is_scheduled || false,
      is_manual: order.is_manual || false,
      scheduled_for: order.scheduled_for || null,
      table_number: order.table_number || null,
    };

    console.log('[PRINT SERVICE] Dados carregados:', restaurantName, '| itens:', items.length);
    return { restaurantName, order: printOrder, items };
  } catch (err) {
    console.error('[PRINT SERVICE] fetchOrderData error:', err);
    return null;
  }
}

async function printOrder(orderId, splitByCategory = false) {
  const data = await fetchOrderData(orderId);
  if (!data) return null;
  return buildHtml({ ...data, splitByCategory });
}

module.exports = { printOrder, fetchOrderData, buildHtml };
