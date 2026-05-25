import { supabase } from '@/integrations/supabase/client';
import { buildHtml, printOrder as printOrderWeb } from '@/lib/printOrder';

export interface ElectronAPI {
  printOrder: (html: string, metadata?: any) => Promise<any>;
  getPrinters: () => Promise<{ success: boolean; printers?: string[]; error?: string }>;
  setPrinter: (printerName: string) => Promise<{ success: boolean; printer?: string; error?: string }>;
  setSilentMode: (enabled: boolean) => Promise<{ success: boolean; useSilent?: boolean }>;
  setPrinterType: (printerType: 'thermal' | 'normal') => Promise<{ success: boolean; printerType?: string }>;
  getPrinterConfig: () => Promise<any>;
  onPrintSuccess: (callback: (data: any) => void) => () => void;
  onPrintError: (callback: (data: any) => void) => () => void;
  onPrintQueueUpdate: (callback: (data: any) => void) => () => void;
  onPrintJobComplete: (callback: (data: any) => void) => () => void;
  onUpdateStatus: (callback: (data: any) => void) => () => void;
  onUpdateProgress: (callback: (data: any) => void) => () => void;
  checkForUpdates: () => Promise<{ success: boolean }>;
  installUpdateNow: () => Promise<any>;
  checkStatus: () => Promise<any>;
}

export const isElectron = (): boolean => {
  return window.electronAPI !== undefined;
};

// Busca dados do pedido e imprime: via Electron (silencioso) ou popup no navegador
export const printOrder = async (orderId: string, customerName?: string): Promise<void> => {
  try {
    console.log('🖨️ [PRINT] Iniciando impressão do pedido:', { orderId, customerName });

    const { data: order, error: orderError } = await supabase
      .from('orders')
      .select('*')
      .eq('id', orderId)
      .single();

    if (orderError || !order) {
      console.error('❌ [PRINT] Erro ao buscar pedido:', orderError);
      return;
    }

    const { data: items, error: itemsError } = await supabase
      .from('order_items')
      .select('*')
      .eq('order_id', orderId);

    if (itemsError) {
      console.error('❌ [PRINT] Erro ao buscar itens:', itemsError);
      return;
    }

    const { data: settings } = await supabase
      .from('menu_settings')
      .select('display_name, menus(name)')
      .eq('user_id', order.user_id)
      .limit(1)
      .maybeSingle();

    const restaurantName =
      settings?.display_name ||
      (settings?.menus as any)?.name ||
      'Restaurante';

    const printItems = (items || []).map((item) => ({
      product_name: item.product_name,
      quantity: item.quantity,
      unit_price: Number(item.unit_price),
      subtotal: Number(item.subtotal),
      category_name: item.category_name || null,
      notes: item.notes || null,
      addons: item.addons
        ? (typeof item.addons === 'string' ? JSON.parse(item.addons) : item.addons)
        : undefined,
    }));

    const orderData = {
      id: order.id,
      customer_name: order.customer_name,
      customer_phone: order.customer_phone,
      customer_address: order.customer_address,
      total_amount: Number(order.total_amount),
      notes: order.notes,
      created_at: order.created_at,
      order_type: (order as any).order_type || 'delivery',
      is_scheduled: (order as any).is_scheduled || false,
      is_manual: (order as any).is_manual || false,
      scheduled_for: (order as any).scheduled_for || null,
      table_number: (order as any).table_number || null,
    };

    const html = buildHtml({
      restaurantName,
      order: orderData,
      items: printItems,
      splitByCategory: false,
    });

    if (isElectron()) {
      if (!window.electronAPI?.printOrder) {
        console.error('❌ [PRINT] Função printOrder não encontrada no Electron');
        return;
      }
      await new Promise((resolve) => setTimeout(resolve, 500));
      const result = await window.electronAPI.printOrder(html, {
        orderId: order.id,
        timestamp: new Date().toISOString(),
      });
      console.log('✅ [PRINT] Impressão enviada para fila:', result);
    } else {
      printOrderWeb({
        restaurantName,
        order: orderData,
        items: printItems,
        splitByCategory: false,
      });
    }
  } catch (error) {
    console.error('❌ [PRINT] Erro na impressão:', error);
  }
};

declare global {
  interface Window {
    electronAPI?: ElectronAPI;
  }
}
