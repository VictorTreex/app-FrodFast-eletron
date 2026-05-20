/* ============================================================
   Impressão de pedidos (impressora térmica 80mm ou comum)
   - Abre nova janela com HTML otimizado e dispara window.print()
   - Suporta separação por categoria (uma folha por categoria)
============================================================ */

import { format } from "date-fns";
import { ptBR } from "date-fns/locale";

export interface PrintItem {
  product_name: string;
  quantity: number;
  unit_price: number;
  subtotal: number;
  category_name?: string | null;
  addons?: Array<{ name: string; quantity: number; price: number }>;
  notes?: string | null;
}

export interface PrintOrder {
  id: string;
  customer_name: string;
  customer_phone?: string | null;
  customer_address?: string | null;
  total_amount: number;
  notes?: string | null;
  created_at: string;
  order_type?: string | null;
  is_scheduled?: boolean;
  is_manual?: boolean;
  scheduled_for?: string | null;
  table_number?: string | null;
}

const ORDER_TYPE_LABEL: Record<string, string> = {
  delivery: "ENTREGA",
  pickup: "RETIRADA",
  dine_in: "MESA",
  counter: "BALCAO",
};

const fmt = (n: number) => `R$ ${Number(n || 0).toFixed(2).replace(".", ",")}`;

const escapeHtml = (s: string) =>
  String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");

function ticketSection({
  restaurantName,
  order,
  items,
  categoryHeader,
}: {
  restaurantName: string;
  order: PrintOrder;
  items: PrintItem[];
  categoryHeader?: string;
}): string {
  const shortId = order.id.slice(0, 8).toUpperCase();
  const created = format(new Date(order.created_at), "dd/MM/yyyy HH:mm", { locale: ptBR });
  const scheduled = order.scheduled_for
    ? format(new Date(order.scheduled_for), "dd/MM/yyyy 'às' HH:mm", { locale: ptBR })
    : null;
  const typeLabel = ORDER_TYPE_LABEL[order.order_type || "delivery"] || "PEDIDO";

const itemsHtml = items
  .map((it) => {
    // Função para normalizar e validar estrutura de adicionais
    const normalizeAddons = (addons: any): Array<{name: string; quantity: number; price?: number}> => {
      if (!addons || !Array.isArray(addons)) return [];
      
      return addons
        .map((addon) => {
          // Se for string, converter para objeto
          if (typeof addon === 'string') {
            return {
              name: addon.trim(),
              quantity: 1
            };
          }
          
          // Se for objeto, validar estrutura
          if (typeof addon === 'object' && addon !== null) {
            // Estrutura do carrinho: option_name, não name
            const name = addon.option_name || addon.name || '';
            const quantity = addon.quantity || 1;
            
            // REGRA OBRIGATÓRIA: nome válido
            if (!name || typeof name !== 'string' || name.trim() === '') {
              return null;
            }
            
            // REGRA OBRIGATÓRIA: quantidade válida (mínimo 1)
            const validQuantity = Math.max(1, Number(quantity) || 1);
            
            return {
              name: name.trim(),
              quantity: validQuantity,
              price: addon.price
            };
          }
          
          return null;
        })
        .filter(Boolean) as Array<{name: string; quantity: number; price?: number}>;
    };

    // Normalizar adicionais do item
    const normalizedAddons = normalizeAddons(it.addons);
    
    // Gerar HTML dos adicionais com estrutura garantida
    const addons =
      normalizedAddons.length > 0
        ? normalizedAddons
            .map((addon) => {
              const { name, quantity } = addon;
              return `   • ${escapeHtml(name)}${quantity > 1 ? ` (${quantity}x)` : ""}`;
            })
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
    // Extrair apenas informações de pagamento e troco das observações
    const notes = order.notes || "";
    
    // Procurar por informações de pagamento e troco
    const paymentMatch = notes.match(/Pagamento:\s*([^*·\n]+)/i);
    const changeMatch = notes.match(/Troco para:\s*R?\$\s*([\d.,]+)/i);
    const changeMatch2 = notes.match(/troco para R\$\s*([\d.,]+)/i);
    
    let cleanNotes = "";
    
    if (paymentMatch) {
      cleanNotes += `Pagamento: ${paymentMatch[1].trim()}\n`;
    }
    
    if (changeMatch) {
      cleanNotes += `Troco para: R$ ${changeMatch[1].trim()}`;
    } else if (changeMatch2) {
      cleanNotes += `Troco para: R$ ${changeMatch2[1].trim()}`;
    }
    
    // Se não encontrou informações de pagamento, usa a observação original limpa
    if (!cleanNotes && notes) {
      // Remove informações de itens do pedido da observação
      cleanNotes = notes
        .replace(/\*[^*]*\*[^*]*\*/g, '') // Remove blocos com *
        .replace(/•[^•]*•[^•]*•/g, '')   // Remove blocos com •
        .replace(/\*[^*]*:/g, '')       // Remove linhas que começam com *
        .replace(/•[^•]*:/g, '')       // Remove linhas que começam com •
        .replace(/Itens:.*$/m, '')     // Remove linha de Itens
        .replace(/Subtotal:.*$/m, '')  // Remove linha de Subtotal
        .replace(/Total:.*$/m, '')     // Remove linha de Total
        .replace(/Endereço.*$/m, '')   // Remove linha de Endereço
        .replace(/Complemento:.*$/m, '') // Remove linha de Complemento
        .trim();
    }
    
    return cleanNotes ? `<div class="hr"></div><div class="bold">Observacoes:</div><div class="small">${escapeHtml(cleanNotes)}</div>` : "";
  })() : ""}

  <div class="hr"></div>
  <div class="bold center">RESUMO FINANCEIRO</div>
  <div class="hr"></div>
  ${(() => {
    // Calcular subtotal dos itens
    const subtotal = items.reduce((acc, item) => acc + item.subtotal, 0);
    
    // Extrair taxa de entrega das observações (padrão: "Taxa de entrega: R$ X,XX")
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

export function buildHtml({
  restaurantName,
  order,
  items,
  splitByCategory,
}: {
  restaurantName: string;
  order: PrintOrder;
  items: PrintItem[];
  splitByCategory: boolean;
}): string {
  let sections = "";
  if (splitByCategory) {
    // Agrupa por categoria (snapshot em order_items.category_name; itens sem cat. caem em "Outros")
    const groups = new Map<string, PrintItem[]>();
    items.forEach((it) => {
      const k = (it.category_name || "Outros").trim() || "Outros";
      if (!groups.has(k)) groups.set(k, []);
      groups.get(k)!.push(it);
    });
    for (const [cat, list] of groups) {
      sections += ticketSection({ restaurantName, order, items: list, categoryHeader: cat });
    }
    // Folha resumo no final com TOTAL geral
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
<script>
  window.addEventListener('load', function() {
    setTimeout(function() {
      try { window.print(); } catch (e) {}
    }, 250);
  });
</script>
</body>
</html>`;
}

/** Abre uma nova janela com o pedido formatado e dispara impressão da janela. */
export function printOrder(params: {
  restaurantName: string;
  order: PrintOrder;
  items: PrintItem[];
  splitByCategory?: boolean;
}): boolean {
  console.log("🖨️ printOrder: Iniciando função de impressão");
  console.log("📊 Parâmetros recebidos:", params);
  
  const html = buildHtml({
    restaurantName: params.restaurantName,
    order: params.order,
    items: params.items,
    splitByCategory: !!params.splitByCategory,
  });
  
  console.log("📄 HTML gerado, tamanho:", html.length, "caracteres");
  
  // Tentar abrir nova janela
  console.log("🪟 Tentando abrir nova janela...");
  const w = window.open("", "_blank", "width=420,height=720");
  
  if (!w) {
    console.error("❌ window.open retornou null - popup bloqueado");
    alert("Permita popups para imprimir o pedido");
    return false;
  }
  
  console.log("✅ Janela aberta com sucesso:", w);
  
  // Escrever HTML na nova janela
  console.log("✍️ Escrevendo HTML na janela...");
  w.document.open();
  w.document.write(html);
  w.document.close();
  console.log("✅ HTML escrito e documento fechado");
  
  // Aguardar carregamento e focar antes de imprimir
  console.log("⏰ Aguardando 300ms para carregar...");
  setTimeout(() => {
    try {
      console.log("🎯 Focando janela e iniciando impressão...");
      w.focus();
      w.print();
      console.log("🖨️ w.print() executado com sucesso");
      
      // Opcional: fechar janela após impressão
      setTimeout(() => {
        console.log("🔒 Fechando janela...");
        w.close();
      }, 1000);
    } catch (error) {
      console.error("❌ Erro ao imprimir:", error);
      alert("Erro ao imprimir. Tente novamente.");
    }
  }, 300);
  
  console.log("🚀 Função printOrder concluída, retornando true");
  return true;
}
