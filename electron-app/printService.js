const { format } = require('date-fns');
const { ptBR } = require('date-fns/locale');

// Configurações do Supabase
const SUPABASE_URL = 'https://kfujkvihymclesabqmsz.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImtmdWprdmloeW1jbGVzYWJxbXN6Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3MDAwMDAwMDAsImV4cCI6MjAxNTU1NTU1NTV9.fake-key-for-development';

// ========================= GERAÇÃO DE HTML (COPIADO DO WEB) =========================

const ORDER_TYPE_LABEL = {
  delivery: "ENTREGA",
  pickup: "RETIRADA",
  dine_in: "MESA",
  counter: "BALCAO",
};

const fmt = (n) => `R$ ${Number(n || 0).toFixed(2).replace(".", ",")}`;

const escapeHtml = (s) =>
  String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");

function ticketSection({
  restaurantName,
  order,
  items,
  categoryHeader,
}) {
  const shortId = order.id.slice(0, 8).toUpperCase();
  const created = format(new Date(order.created_at), "dd/MM/yyyy HH:mm", { locale: ptBR });
  const scheduled = order.scheduled_for
    ? format(new Date(order.scheduled_for), "dd/MM/yyyy 'às' HH:mm", { locale: ptBR })
    : null;
  const typeLabel = ORDER_TYPE_LABEL[order.order_type || "delivery"] || "PEDIDO";

  const itemsHtml = items
    .map((it) => {
      // Função para normalizar adicionais
      const normalizeAddons = (addons) => {
        if (!addons || !Array.isArray(addons)) return [];
        
        return addons
          .map((addon) => {
            if (typeof addon === 'string') {
              return { name: addon.trim(), quantity: 1 };
            }
            
            if (typeof addon === 'object' && addon !== null) {
              const name = addon.option_name || addon.name || '';
              const quantity = addon.quantity || 1;
              
              if (!name || typeof name !== 'string' || name.trim() === '') {
                return null;
              }
              
              return { name: name.trim(), quantity: Math.max(1, Number(quantity) || 1) };
            }
            
            return null;
          })
          .filter(Boolean);
      };

      const normalizedAddons = normalizeAddons(it.addons);
      
      const addons =
        normalizedAddons.length > 0
          ? normalizedAddons
              .map((addon) => `   • ${escapeHtml(addon.name)}${addon.quantity > 1 ? ` (${addon.quantity}x)` : ""}`)
              .join("\n")
          : "";

      const obs = it.notes ? `   Obs: ${escapeHtml(it.notes)}` : "";

      return [
        `${it.quantity}x ${escapeHtml(it.product_name)}`,
        `${" ".repeat(2)}${fmt(it.subtotal)}`,
        addons,
        obs,
      ]
        .filter(Boolean)
        .join("\n");
    })
    .join("\n\n");

  return `
<section class="ticket">
  <div class="center bold big">${escapeHtml(restaurantName)}</div>
  <div class="center small">Pedido #${shortId}</div>
  <div class="center small">${created}</div>
  ${categoryHeader ? `<div class="banner">== ${escapeHtml(categoryHeader.toUpperCase())} ==</div>` : ""}
  <div class="hr"></div>

  <div class="row"><span class="lbl">Tipo:</span><span class="val bold">${typeLabel}${order.is_manual ? " (BALCAO)" : ""}</span></div>
  ${order.table_number ? `<div class="row"><span class="lbl">Mesa:</span><span class="val bold">${escapeHtml(order.table_number)}</span></div>` : ""}
  ${scheduled ? `<div class="row hi"><span class="lbl">AGENDADO:</span><span class="val bold">${scheduled}</span></div>` : ""}
  <div class="row"><span class="lbl">Cliente:</span><span class="val">${escapeHtml(order.customer_name)}</span></div>
  ${order.customer_phone ? `<div class="row"><span class="lbl">Tel:</span><span class="val">${escapeHtml(order.customer_phone)}</span></div>` : ""}
  ${order.customer_address ? `<div class="row stack"><span class="lbl">End:</span><span class="val">${escapeHtml(order.customer_address)}</span></div>` : ""}

  <div class="hr"></div>
  <div class="bold center">ITENS</div>
  <div class="hr dashed"></div>
  <pre class="items">${itemsHtml}</pre>
  <div class="hr dashed"></div>

  ${!categoryHeader ? `<div class="row total"><span class="bold">TOTAL</span><span class="bold">${fmt(order.total_amount)}</span></div>` : ""}

  ${order.notes ? (() => {
    const notes = order.notes || "";
    const paymentMatch = notes.match(/Pagamento:\s*([^*·\n]+)/i);
    const changeMatch = notes.match(/Troco para:\s*R?\$\s*([\d.,]+)/i);
    
    let cleanNotes = "";
    
    if (paymentMatch) {
      cleanNotes += `Pagamento: ${paymentMatch[1].trim()}\n`;
    }
    
    if (changeMatch) {
      cleanNotes += `Troco para: R$ ${changeMatch[1].trim()}`;
    }
    
    if (!cleanNotes && notes) {
      cleanNotes = notes
        .replace(/\*[^*]*\*[^*]*\*/g, '')
        .replace(/•[^•]*•[^•]*•/g, '')
        .replace(/\*[^*]*:/g, '')
        .replace(/•[^•]*:/g, '')
        .trim();
    }
    
    return cleanNotes ? `<div class="hr"></div><div class="bold">Observacoes:</div><div class="small">${escapeHtml(cleanNotes)}</div>` : "";
  })() : ""}

  <div class="hr"></div>
  <div class="bold center">RESUMO FINANCEIRO</div>
  <div class="hr"></div>
  ${(() => {
    const subtotal = items.reduce((acc, item) => acc + item.subtotal, 0);
    const notes = order.notes || "";
    const deliveryFeeMatch = notes.match(/Taxa de entrega:\s*R?\$\s*([\d.,]+)/i);
    const deliveryFee = deliveryFeeMatch ? parseFloat(deliveryFeeMatch[1].replace(',', '.')) : 0;
    
    return `
      <div class="row"><span class="lbl">SUBTOTAL:</span><span class="val">${fmt(subtotal)}</span></div>
      <div class="row"><span class="lbl">TAXA DE ENTREGA:</span><span class="val">${fmt(deliveryFee)}</span></div>
      <div class="row total"><span class="bold">TOTAL:</span><span class="bold">${fmt(order.total_amount)}</span></div>
    `;
  })()}

  <div class="hr"></div>
  <div class="center small">${restaurantName ? "Obrigado!" : ""}</div>
  <div class="cut"></div>
</section>`;
}

function buildHtml({
  restaurantName,
  order,
  items,
  splitByCategory,
}) {
  let sections = "";
  if (splitByCategory) {
    const groups = new Map();
    items.forEach((it) => {
      const k = (it.category_name || "Outros").trim() || "Outros";
      if (!groups.has(k)) groups.set(k, []);
      groups.get(k).push(it);
    });
    for (const [cat, list] of groups) {
      sections += ticketSection({ restaurantName, order, items: list, categoryHeader: cat });
    }
    sections += ticketSection({ restaurantName, order, items, categoryHeader: "RESUMO" });
  } else {
    sections = ticketSection({ restaurantName, order, items });
  }

  return `<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8" />
<title>Pedido #${order.id.slice(0, 8)}</title>
<style>
  @page { size: 80mm auto; margin: 4mm; }
  * { box-sizing: border-box; }
  html, body { margin: 0; padding: 0; background: #fff; color: #000; }
  body { font-family: 'Courier New', ui-monospace, monospace; font-size: 12px; line-height: 1.35; }
  .ticket { width: 72mm; padding: 2mm 0; }
  .center { text-align: center; }
  .bold { font-weight: 700; }
  .big { font-size: 14px; }
  .small { font-size: 11px; }
  .hr { border-top: 1px solid #000; margin: 4px 0; }
  .hr.dashed { border-top: 1px dashed #000; }
  .row { display: flex; justify-content: space-between; gap: 6px; margin: 2px 0; }
  .row.stack { flex-direction: column; }
  .row .lbl { color: #000; min-width: 48px; }
  .row .val { text-align: right; flex: 1; word-break: break-word; }
  .row.stack .val { text-align: left; }
  .row.hi { background: #000; color: #fff; padding: 2px 4px; border-radius: 2px; }
  .row.hi .lbl, .row.hi .val { color: #fff; }
  .row.total { font-size: 14px; margin-top: 6px; }
  .banner { text-align: center; font-weight: 700; padding: 4px 0; border: 2px solid #000; margin: 6px 0; font-size: 13px; }
  pre.items { font-family: inherit; font-size: 12px; white-space: pre-wrap; margin: 0; }
  .cut { margin: 8px 0 4px; border-top: 1px dashed #000; height: 6px; }
  @media screen {
    body { padding: 16px; background: #f3f3f3; }
    .ticket { background: #fff; border: 1px solid #ddd; padding: 10mm 6mm; margin: 0 auto 16px; box-shadow: 0 2px 12px rgba(0,0,0,.1); }
  }
  @media print {
    body { padding: 0; background: #fff; }
    .ticket { page-break-after: always; }
    .ticket:last-child { page-break-after: auto; }
  }
</style>
</head>
<body>
${sections}
</body>
</html>`;
}

// ========================= BUSCA DE DADOS DO PEDIDO =========================

async function fetchOrderData(orderId) {
  console.log('📊 [PRINT SERVICE] Buscando dados do pedido:', orderId);

  try {
    // Buscar pedido
    const orderResponse = await fetch(`${SUPABASE_URL}/rest/v1/orders?id=eq.${orderId}&select=*`, {
      headers: {
        'apikey': SUPABASE_ANON_KEY,
        'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
        'Content-Type': 'application/json'
      }
    });

    if (!orderResponse.ok) {
      console.error('❌ [PRINT SERVICE] Erro ao buscar pedido:', orderResponse.status);
      return null;
    }

    const orders = await orderResponse.json();
    const order = orders[0];

    if (!order) {
      console.error('❌ [PRINT SERVICE] Pedido não encontrado');
      return null;
    }

    // Buscar itens
    const itemsResponse = await fetch(`${SUPABASE_URL}/rest/v1/order_items?order_id=eq.${orderId}&select=*`, {
      headers: {
        'apikey': SUPABASE_ANON_KEY,
        'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
        'Content-Type': 'application/json'
      }
    });

    if (!itemsResponse.ok) {
      console.error('❌ [PRINT SERVICE] Erro ao buscar itens:', itemsResponse.status);
      return null;
    }

    const items = await itemsResponse.json();

    // Buscar configurações do menu
    const settingsResponse = await fetch(`${SUPABASE_URL}/rest/v1/menu_settings?user_id=eq.${order.user_id}&select=display_name,menus(name)&limit=1`, {
      headers: {
        'apikey': SUPABASE_ANON_KEY,
        'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
        'Content-Type': 'application/json'
      }
    });

    let settings = null;
    if (settingsResponse.ok) {
      const settingsData = await settingsResponse.json();
      settings = settingsData[0] || null;
    }

    const restaurantName = 
      settings?.display_name || 
      settings?.menus?.name || 
      'Restaurante';

    // Converter itens para formato PrintItem
    const printItems = (items || []).map(item => ({
      product_name: item.product_name,
      quantity: item.quantity,
      unit_price: Number(item.unit_price),
      subtotal: Number(item.subtotal),
      category_name: item.category_name || null,
      notes: item.notes || null,
      addons: item.addons ? (typeof item.addons === 'string' ? JSON.parse(item.addons) : item.addons) : undefined
    }));

    // Converter order para formato PrintOrder
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
      table_number: order.table_number || null
    };

    console.log('✅ [PRINT SERVICE] Dados do pedido carregados:', restaurantName);

    return {
      restaurantName,
      order: printOrder,
      items: printItems
    };
  } catch (error) {
    console.error('❌ [PRINT SERVICE] Erro ao buscar dados:', error);
    return null;
  }
}

// ========================= FUNÇÃO PRINCIPAL DE IMPRESSÃO =========================

async function printOrder(orderId, splitByCategory = false) {
  console.log('🖨️ [PRINT SERVICE] Iniciando impressão do pedido:', orderId);

  try {
    // Buscar dados do pedido
    const data = await fetchOrderData(orderId);
    if (!data) {
      console.error('❌ [PRINT SERVICE] Não foi possível buscar dados do pedido');
      return null;
    }

    // Gerar HTML
    const html = buildHtml({
      restaurantName: data.restaurantName,
      order: data.order,
      items: data.items,
      splitByCategory
    });

    console.log('✅ [PRINT SERVICE] HTML gerado, tamanho:', html.length, 'caracteres');

    return html;
  } catch (error) {
    console.error('❌ [PRINT SERVICE] Erro na impressão:', error);
    return null;
  }
}

module.exports = {
  printOrder,
  fetchOrderData,
  buildHtml
};
