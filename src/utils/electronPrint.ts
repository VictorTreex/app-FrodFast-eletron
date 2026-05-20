/**
 * Utilitário para impressão via Electron
 * Detecta automaticamente se está rodando no Electron e chama a função de impressão
 */

import { supabase } from '@/integrations/supabase/client';
import { buildHtml } from '@/lib/printOrder';

export interface ElectronAPI {
  printOrder: (html: string, metadata?: any) => Promise<any>;
  print: (options?: any) => void;
  printSilent: () => void;
  getPrinters: () => Promise<any>;
  debug: (message: string) => void;
  isAvailable: () => boolean;
  checkStatus: () => any;
  onPrintComplete: (callback: (result: any) => void) => void;
}

// Detecta se está rodando no Electron
export const isElectron = (): boolean => {
  return window.electronAPI !== undefined;
};

// Função segura para impressão automática no Electron
export const printOrder = async (orderId: string, customerName?: string): Promise<void> => {
  try {
    console.log('🖨️ [ELECTRON PRINT] Iniciando impressão automática do pedido:', { orderId, customerName });
    
    // Verifica se está no Electron
    if (!isElectron()) {
      console.log('🌐 [ELECTRON PRINT] Não está no Electron, ignorando impressão');
      return;
    }

    // Verifica se a função de impressão existe
    if (!window.electronAPI?.printOrder) {
      console.error('❌ [ELECTRON PRINT] Função printOrder não encontrada no Electron');
      return;
    }

    console.log('📊 [ELECTRON PRINT] Buscando dados do pedido no Supabase...');

    // Buscar dados do pedido
    const { data: order, error: orderError } = await supabase
      .from('orders')
      .select('*')
      .eq('id', orderId)
      .single();

    if (orderError || !order) {
      console.error('❌ [ELECTRON PRINT] Erro ao buscar pedido:', orderError);
      return;
    }

    console.log('✅ [ELECTRON PRINT] Pedido encontrado:', order.customer_name);

    // Buscar itens do pedido
    const { data: items, error: itemsError } = await supabase
      .from('order_items')
      .select('*')
      .eq('order_id', orderId);

    if (itemsError) {
      console.error('❌ [ELECTRON PRINT] Erro ao buscar itens:', itemsError);
      return;
    }

    console.log('✅ [ELECTRON PRINT] Itens encontrados:', items?.length || 0);

    // Buscar configurações do menu para obter nome do restaurante
    const { data: settings } = await supabase
      .from('menu_settings')
      .select('display_name, menus(name)')
      .eq('user_id', order.user_id)
      .limit(1)
      .maybeSingle();

    const restaurantName = 
      settings?.display_name || 
      settings?.menus?.name || 
      'Restaurante';

    console.log('🏪 [ELECTRON PRINT] Nome do restaurante:', restaurantName);

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
      order_type: (order as any).order_type || 'delivery',
      is_scheduled: (order as any).is_scheduled || false,
      is_manual: (order as any).is_manual || false,
      scheduled_for: (order as any).scheduled_for || null,
      table_number: (order as any).table_number || null
    };

    // Gerar HTML usando a função do printOrder.ts
    console.log('📄 [ELECTRON PRINT] Gerando HTML do pedido...');
    const html = buildHtml({
      restaurantName,
      order: printOrder,
      items: printItems,
      splitByCategory: false
    });

    console.log('✅ [ELECTRON PRINT] HTML gerado, tamanho:', html.length, 'caracteres');

    // Aguardar um pequeno delay para garantir que o conteúdo esteja pronto
    await new Promise(resolve => setTimeout(resolve, 500));

    console.log('🖨️ [ELECTRON PRINT] Enviando HTML para impressão do Electron...');

    // Chamar a função de impressão do Electron com o HTML
    const result = await window.electronAPI.printOrder(html, {
      orderId: order.id,
      timestamp: new Date().toISOString()
    });

    console.log('✅ [ELECTRON PRINT] Impressão enviada para fila:', result);
    
  } catch (error) {
    console.error('❌ [ELECTRON PRINT] Erro na impressão:', error);
  }
};

// Função para impressão de qualquer conteúdo
export const printContent = async (): Promise<void> => {
  try {
    console.log('🖨️ [PRINT DEBUG] Iniciando impressão de conteúdo');
    
    if (!isElectron()) {
      console.log('🌐 [PRINT DEBUG] Não está no Electron, ignorando impressão');
      return;
    }

    if (!window.electronAPI?.print) {
      console.error('❌ [PRINT DEBUG] Função de impressão não encontrada');
      return;
    }

    await new Promise(resolve => setTimeout(resolve, 500));
    
    console.log('🖨️ [PRINT DEBUG] Chamando impressão de conteúdo');
    window.electronAPI.print();
    console.log('✅ [PRINT DEBUG] Impressão de conteúdo concluída');
    
  } catch (error) {
    console.error('❌ [PRINT DEBUG] Erro na impressão de conteúdo:', error);
  }
};

// Adiciona tipagem global para o window
declare global {
  interface Window {
    electronAPI?: ElectronAPI;
  }
}
