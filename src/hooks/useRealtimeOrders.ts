/**
 * Hook para escutar novos pedidos em tempo real via Supabase
 * Detecta INSERT na tabela orders e dispara ações automáticas
 */

import { useEffect, useRef } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { printOrder } from '@/utils/electronPrint';
import { toast } from 'sonner';

// Função para tocar som de notificação
const play = () => {
  try {
    const audio = new Audio('/notification.mp3');
    audio.volume = 0.5;
    audio.play().catch(() => {
      // Fallback para som nativo se o arquivo não existir
      const beep = new AudioContext();
      const oscillator = beep.createOscillator();
      const gainNode = beep.createGain();
      oscillator.connect(gainNode);
      gainNode.connect(beep.destination);
      oscillator.frequency.value = 800;
      oscillator.type = 'sine';
      gainNode.gain.value = 0.1;
      oscillator.start();
      oscillator.stop(beep.currentTime + 0.1);
    });
  } catch (error) {
    console.warn('🔔 Erro ao tocar som:', error);
  }
};

interface OrderData {
  id: string;
  customer_name?: string | null;
  total_amount?: number;
  status?: string;
  created_at: string;
  user_id: string;
}

interface UseRealtimeOrdersProps {
  userId: string | null | undefined;
  onNewOrder?: (order: OrderData) => void;
  enabled?: boolean;
}

export function useRealtimeOrders({ 
  userId, 
  onNewOrder, 
  enabled = true 
}: UseRealtimeOrdersProps) {
  const channelRef = useRef<any>(null);
  const lastOrderRef = useRef<string | null>(null);

  useEffect(() => {
    // Não inicializar se não tiver userId ou estiver desabilitado
    if (!userId || !enabled) {
      console.log('📡 [REALTIME] Listener desativado - sem userId ou desabilitado');
      return;
    }

    console.log('📡 [REALTIME] Iniciando listener de pedidos para usuário:', userId);

    // Criar canal para escutar INSERT na tabela orders
    const channel = supabase
      .channel(`orders-realtime-${userId}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'orders',
          filter: `user_id=eq.${userId}`
        },
        (payload) => {
          const newOrder = payload.new as OrderData;
          
          // Evitar duplicação do mesmo pedido
          if (lastOrderRef.current === newOrder.id) {
            console.log('📡 [REALTIME] Pedido duplicado ignorado:', newOrder.id);
            return;
          }
          
          lastOrderRef.current = newOrder.id;

          // Log detalhado do novo pedido
          console.log('📡 [REALTIME] 🆕 NOVO PEDIDO DETECTADO:', {
            id: newOrder.id,
            customer: newOrder.customer_name || 'Não informado',
            total: newOrder.total_amount ? `R$ ${newOrder.total_amount.toFixed(2)}` : 'N/A',
            status: newOrder.status || 'pending',
            created_at: newOrder.created_at,
            user_id: newOrder.user_id
          });

          // Auto-impressão no Electron: envia para fila silenciosa do main process
          // O main.js marca o orderId como impresso via IPC para que o polling não duplique
          if (typeof window !== 'undefined' && window.electronAPI) {
            console.log('📡 [REALTIME] 🖨️ Enviando para impressão automática no Electron...');
            printOrder(newOrder.id, newOrder.customer_name || undefined);
          }

          // Tocar som de notificação e mostrar toast
          console.log('📡 [REALTIME] 🔔 Tocando som de notificação...');
          play();
          
          toast.success(`🔔 Novo pedido de ${newOrder.customer_name || "cliente"}!`, {
            duration: 6000,
          });

          // Chamar callback personalizado se fornecido
          if (onNewOrder) {
            console.log('📡 [REALTIME] 📞 Chamando callback onNewOrder');
            onNewOrder(newOrder);
          }

          // Log de conclusão
          console.log('📡 [REALTIME] ✅ Processamento do novo pedido concluído');
        }
      )
      .subscribe((status) => {
        console.log('📡 [REALTIME] Status do canal:', status);
        
        if (status === 'SUBSCRIBED') {
          console.log('📡 [REALTIME] 🟢 Listener ativo e escutando novos pedidos');
        } else if (status === 'CHANNEL_ERROR') {
          console.error('📡 [REALTIME] ❌ Erro no canal de realtime');
        } else if (status === 'TIMED_OUT') {
          console.warn('📡 [REALTIME] ⏱️ Timeout no canal de realtime');
        }
      });

    channelRef.current = channel;

    // Cleanup ao desmontar
    return () => {
      console.log('📡 [REALTIME] 🛑 Limpando listener de pedidos');
      if (channelRef.current) {
        supabase.removeChannel(channelRef.current);
        channelRef.current = null;
      }
    };
  }, [userId, enabled, onNewOrder]);

  // Função para reconectar manualmente se necessário
  const reconnect = () => {
    console.log('📡 [REALTIME] 🔄 Reconectando listener...');
    if (channelRef.current) {
      supabase.removeChannel(channelRef.current);
    }
    // O useEffect irá recriar o canal automaticamente
  };

  // Função para verificar status da conexão
  const getConnectionStatus = () => {
    return channelRef.current ? 'connected' : 'disconnected';
  };

  return {
    reconnect,
    getConnectionStatus,
    isListening: !!channelRef.current
  };
}
