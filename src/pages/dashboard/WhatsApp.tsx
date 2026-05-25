import { useEffect, useState, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";
import { useWhatsappAddon } from "@/hooks/useWhatsappAddon";
import { whatsappApi } from "@/config/whatsapp-api";
import {
  MessageSquare,
  Smartphone,
  RefreshCw,
  PowerOff,
  QrCode,
  Loader2,
  CheckCircle2,
  XCircle,
  Bot,
  Send,
  Clock,
  Zap,
  Wifi,
  Settings,
  MessageCircle,
  Shield,
  Lock,
} from "lucide-react";

const WHATSAPP_SUPPORT_NUMBER = "5518991913165";
const openSupportWhatsApp = () => {
  const msg =
    "Olá! Quero adicionar o WhatsApp Automático ao meu plano TreexMenu.";
  window.open(
    `https://wa.me/${WHATSAPP_SUPPORT_NUMBER}?text=${encodeURIComponent(msg)}`,
    "_blank",
    "noopener,noreferrer",
  );
};

interface AutoMessage {
  id: string;
  store_id: string;
  message_text: string;
  cooldown_hours: number;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export default function WhatsAppPage() {
  const { user } = useAuth();
  const addon = useWhatsappAddon();
  const [autoMessage, setAutoMessage] = useState<AutoMessage | null>(null);
  const [loading, setLoading] = useState(true);
  const [connecting, setConnecting] = useState(false);
  const [saving, setSaving] = useState(false);
  const [messageText, setMessageText] = useState("");
  const [cooldownHours, setCooldownHours] = useState("24");
  const [isActive, setIsActive] = useState(true);
  const [phoneNumber, setPhoneNumber] = useState("");
  
  // Estados para integração com WhatsApp Engine
  const [connectionState, setConnectionState] = useState({
    status: 'idle',
    qr: null as string | null,
    phone: null as string | null,
    profileName: null as string | null
  });
  
  // Ref para polling unificado
  const pollingRef = useRef<NodeJS.Timeout | null>(null);
  const stoppedRef = useRef<boolean>(false);
  const attemptCountRef = useRef<number>(0);
  const backoffDelayRef = useRef<number>(5000);
  
  // Configurações de polling
  const MAX_ATTEMPTS = 30; // 30 tentativas = 2min30s
  const BASE_DELAY = 5000; // 5 segundos
  const MAX_BACKOFF_DELAY = 30000; // 30 segundos máximo
  const FINAL_STATES = ['connected', 'failed', 'destroyed', 'logged_out', 'session_not_found'];
  
  // Delays por status
  const getDelayByStatus = (status: string) => {
    switch (status) {
      case 'connecting': return 3000;
      case 'qr': return 8000;
      case 'disconnected': return 15000;
      default: return BASE_DELAY;
    }
  };
  
  const isDev = process.env.NODE_ENV === 'development';

  // Função de polling de Status (setTimeout recursivo)
  const pollStatus = async (storeId: string) => {
    // Verificar timeout global
    if (attemptCountRef.current >= MAX_ATTEMPTS) {
      if (isDev) debugLog('⏰ Timeout global atingido, parando polling');
      stopPolling();
      toast.error('Timeout da conexão. Tente novamente.');
      return;
    }
    
    attemptCountRef.current++;
    
    if (isDev) debugLog(`📥 Polling attempt ${attemptCountRef.current}/${MAX_ATTEMPTS}`);
    
    try {
      const result = await whatsappApi.getStatus(storeId);
      if (isDev) debugLog('📥 Status polling response', result);
      
      if (result.success) {
        const payload = result.data || result;
        const connectionStatus =
          payload.connection_status ||
          payload.state ||
          payload.status ||
          'disconnected';
        
        // Verificar estados finais
        if (FINAL_STATES.includes(connectionStatus) || payload.connected) {
          if (isDev) debugLog('🏁 Estado final alcançado:', connectionStatus);
          
          if (payload.connected || connectionStatus === 'connected') {
            setConnectionState(prev => {
              if (prev.status === 'connected' && prev.phone === payload.phone) {
                return prev;
              }
              return {
                status: 'connected',
                qr: null,
                phone: payload.phone,
                profileName: payload.profile_name || payload.profileName || null
              };
            });
            // Evitar toast duplicado
            if (connectionState.status !== 'connected') {
              toast.success('WhatsApp conectado com sucesso!');
            }
          } else if (connectionStatus === 'failed' || connectionStatus === 'destroyed') {
            toast.error('Falha na conexão do WhatsApp.');
          } else if (connectionStatus === 'logged_out') {
            toast.error('WhatsApp desconectado.');
          }
          
          stopPolling();
          return;
        }
        
        // Status não conectado - verificar se há QR code
        setConnectionState(prev => {
          const newQr =
            payload.qr ||
            payload.qr_code ||
            payload.qrcode?.base64 ||
            payload.base64 ||
            payload.qrCode ||
            null;
          
          let normalizedStatus = connectionStatus;
          
          if (newQr && connectionStatus === 'connecting') {
            normalizedStatus = 'qr';
          }
          
          if (prev.status === normalizedStatus && prev.qr === newQr) {
            return prev;
          }
          
          return {
            status: normalizedStatus,
            qr: newQr,
            phone:
              payload.phone ||
              payload.number ||
              null,
            profileName:
              payload.profile_name ||
              payload.profileName ||
              null
          };
        });
        
        // Ajustar delay baseado no status
        backoffDelayRef.current = getDelayByStatus(connectionStatus);
      }
    } catch (error) {
      if (isDev) debugLog('❌ Status polling error', { error: error.message });
      
      // Backoff exponencial em erro
      backoffDelayRef.current = Math.min(backoffDelayRef.current * 2, MAX_BACKOFF_DELAY);
      if (isDev) debugLog(`⏱️ Backoff aumentado para ${backoffDelayRef.current}ms`);
    } finally {
      // Continuar polling se não foi parado explicitamente
      if (!stoppedRef.current) {
        pollingRef.current = setTimeout(() => pollStatus(storeId), backoffDelayRef.current);
      }
    }
  };
  
  const startStatusPolling = (storeId: string) => {
    // Limpar polling anterior antes de iniciar novo
    stopPolling();

    // Resetar contadores
    attemptCountRef.current = 0;
    backoffDelayRef.current = BASE_DELAY;
    stoppedRef.current = false;

    if (isDev) debugLog('🚀 Iniciando polling de status');

    // Iniciar polling recursivo
    pollingRef.current = setTimeout(() => pollStatus(storeId), BASE_DELAY);
  };
  
  // Função para parar polling
  const stopPolling = () => {
    stoppedRef.current = true;
    if (pollingRef.current) {
      clearTimeout(pollingRef.current);
      pollingRef.current = null;
    }
    if (isDev) debugLog('🛑 Polling parado');
  };
  
  const debugLog = (message: string, data?: any) => {
    if (!isDev) return;
    const time = new Date().toLocaleTimeString();
    const formatted = data
      ? `[${time}] ${message} - ${JSON.stringify(data)}`
      : `[${time}] ${message}`;
    console.log('📡 [WHATSAPP DEBUG]', formatted);
  };

  const DEFAULT_MESSAGE =
    `Olá! 👋 Seja bem-vindo ao nosso atendimento!\n\n` +
    `Obrigado por entrar em contato. 😊\n\n` +
    `🍽️ Confira nosso cardápio digital e faça seu pedido:\n` +
    `[cole aqui o link do seu cardápio]\n\n` +
    `Ficamos à disposição para qualquer dúvida!`;

  // Sincroniza a mensagem do Supabase para o banco do backend do bot
  const syncToBackend = async (
    text: string,
    hours: number,
    active: boolean
  ): Promise<boolean> => {
    if (!user || !text.trim()) return false;
    try {
      await whatsappApi.saveConfig(user.id, text, hours, active);
      debugLog('✅ Mensagem sincronizada com backend do bot');
      return true;
    } catch (err: any) {
      debugLog('⚠️ Falha na sincronização com backend', { error: err?.message });
      return false;
    }
  };

  // skipSync evita dupla sincronização quando já foi feita explicitamente antes
  const loadAutoMessage = async (skipSync = false) => {
    if (!user) return;
    const { data } = await supabase
      .from("whatsapp_auto_messages" as any)
      .select("*")
      .eq("store_id", user.id)
      .maybeSingle();

    if (data) {
      const msgText    = (data as any).message_text || '';
      const msgHours   = (data as any).cooldown_hours?.toString() || '24';
      const msgActive  = (data as any).is_active ?? true;

      setAutoMessage(data as unknown as AutoMessage);
      setMessageText(msgText);
      setCooldownHours(msgHours);
      setIsActive(msgActive);

      // Sincronizar com o banco do bot em background (não bloqueia a UI)
      if (!skipSync && msgText.trim()) {
        syncToBackend(msgText, parseInt(msgHours), msgActive);
      }
    } else {
      setMessageText(DEFAULT_MESSAGE);
    }
  };

  useEffect(() => {
    const init = async () => {
      await loadAutoMessage();

      // Verificar status atual da conexão ao carregar/recarregar a página
      try {
        const result = await whatsappApi.getStatus(user.id);
        if (result.success) {
          const payload = result.data || result;
          const status =
            payload.connection_status ||
            payload.state ||
            payload.status ||
            'disconnected';

          if (payload.connected || status === 'connected') {
            setConnectionState({
              status: 'connected',
              qr: null,
              phone: payload.phone || payload.number || null,
              profileName: payload.profile_name || payload.profileName || null
            });
          } else if (status === 'qr' || status === 'connecting') {
            // Ainda em processo de conexão — restaurar QR e retomar polling
            setConnectionState(prev => ({
              ...prev,
              status,
              qr:
                payload.qr ||
                payload.qr_code ||
                payload.qrcode?.base64 ||
                null
            }));
            startStatusPolling(user.id);
          }
          // disconnected/idle → mantém estado padrão sem polling
        }
      } catch {
        // API indisponível ou sem sessão existente — manter status idle
      }

      setLoading(false);
    };

    if (user) {
      init();
    } else {
      setLoading(false);
    }

    return () => {
      stopPolling();
    };
  }, [user]);

  // Realtime updates para mensagens (WebSocket cuida do status)
  useEffect(() => {
    if (!user) return;
    
    const messageChannel = supabase
      .channel("whatsapp_auto_messages")
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "whatsapp_auto_messages" as any,
          filter: `store_id=eq.${user.id}`,
        },
        (payload) => {
          if (payload.new) {
            setAutoMessage(payload.new as AutoMessage);
            setMessageText((payload.new as any).message_text || '');
            setCooldownHours((payload.new as any).cooldown_hours?.toString() || '24');
            setIsActive((payload.new as any).is_active);
          }
        },
      )
      .subscribe();

    return () => {
      supabase.removeChannel(messageChannel);
    };
  }, [user]);

  const handleConnect = async () => {
    if (!user) return;
    
    if (!phoneNumber.trim()) {
      toast.error("Digite seu número de WhatsApp com DDI");
      return;
    }
    
    // Validar formato do número (DDI + DDD + número)
    const phoneRegex = /^\d{10,15}$/;
    const cleanPhone = phoneNumber.replace(/\D/g, '');
    
    if (!phoneRegex.test(cleanPhone)) {
      toast.error("Formato inválido. Use: 559999999999");
      return;
    }
    
    debugLog('🚀 Connect clicked', { storeId: user.id, phoneNumber: cleanPhone });
    setConnecting(true);
    try {
      // 1. POST /connect: Inicia conexão com número
      const result = await whatsappApi.connect(user.id, cleanPhone);
      debugLog('📡 Connect API response', result);
      
      if (result.success) {
        // 2. Iniciar polling de status unificado (busca QR e status a cada 5s)
        startStatusPolling(user.id);
        toast.success("Conexão iniciada! Aguarde o QR Code...");
        debugLog('🔁 Status polling started for connection flow');
      }
    } catch (error: any) {
      debugLog('❌ Connect error', { error: error.message });
      toast.error("Erro ao conectar: " + (error.message || "Tente novamente"));
    } finally {
      setConnecting(false);
    }
  };

  const handleDisconnect = async () => {
    if (!user || !confirm("Desconectar o WhatsApp?")) return;
    
    debugLog('🔌 Disconnect clicked', { storeId: user.id });
    setConnecting(true);
    try {
      await whatsappApi.disconnect(user.id);
      toast.success("WhatsApp desconectado!");
      debugLog('🔌 Disconnect API called successfully');
      
      // Resetar estado para disconnected
      setConnectionState({
        status: 'disconnected',
        qr: null,
        phone: null,
        profileName: null
      });
      
      // Parar polling
      stopPolling();
    } catch (error: any) {
      debugLog('❌ Disconnect error', { error: error.message });
      toast.error("Erro ao desconectar: " + (error.message || "Tente novamente"));
    } finally {
      setConnecting(false);
    }
  };

  const handleSaveConfig = async () => {
    if (!messageText.trim()) {
      toast.error("Digite uma mensagem de boas-vindas");
      return;
    }

    setSaving(true);
    try {
      // 1. Salvar no Supabase (banco principal do sistema)
      const { error } = await supabase
        .from("whatsapp_auto_messages" as any)
        .upsert({
          store_id: user?.id,
          message_text: messageText,
          cooldown_hours: parseInt(cooldownHours),
          is_active: isActive
        }, {
          onConflict: 'store_id'
        });

      if (error) {
        console.error('Erro ao salvar:', error);
        toast.error("Erro ao salvar: " + error.message);
        return;
      }

      // 2. Sincronizar com o banco do backend do bot
      const synced = await syncToBackend(messageText, parseInt(cooldownHours), isActive);

      if (synced) {
        toast.success("Mensagem salva e sincronizada com o bot! ✅");
      } else {
        toast.success("Mensagem salva no sistema.");
        toast.warning("Não foi possível sincronizar com o bot agora. Tente recarregar a página.");
      }

      // Recarregar estado sem re-sincronizar (já feito acima)
      await loadAutoMessage(true);
    } catch (error: any) {
      toast.error("Erro ao salvar: " + (error.message || "Tente novamente"));
    } finally {
      setSaving(false);
    }
  };

  if (loading || addon.loading) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!addon.active) {
    return (
      <div className="container mx-auto p-4 lg:p-8 max-w-4xl space-y-6">
        <div className="flex items-center gap-3">
          <div className="w-12 h-12 rounded-xl bg-primary/10 flex items-center justify-center">
            <MessageSquare className="w-6 h-6 text-primary" />
          </div>
          <div>
            <h1 className="text-2xl lg:text-3xl font-bold">WhatsApp Automático</h1>
            <p className="text-sm text-muted-foreground">
              Sistema profissional de auto resposta
            </p>
          </div>
        </div>

        <Card className="overflow-hidden border-primary/30">
          <div className="gradient-brand px-6 py-8 text-primary-foreground sm:px-10 sm:py-10">
            <div className="flex flex-col items-start gap-4 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex items-center gap-4">
                <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-background/15 backdrop-blur">
                  <Lock className="h-7 w-7" />
                </div>
                <div>
                  <Badge className="mb-2 bg-background/20 text-primary-foreground hover:bg-background/30">
                    <Shield className="mr-1 h-3 w-3" />
                    Adicional bloqueado
                  </Badge>
                  <h2 className="text-2xl font-bold tracking-tight sm:text-3xl">
                    WhatsApp Automático
                  </h2>
                  <p className="mt-1 text-sm opacity-90">
                    Conecte seu WhatsApp e configure respostas automáticas
                  </p>
                </div>
              </div>
              <Button
                size="lg"
                variant="secondary"
                onClick={openSupportWhatsApp}
                className="shrink-0 font-semibold shadow-lg"
              >
                <MessageCircle className="mr-2 h-4 w-4" />
                Ativar agora
              </Button>
            </div>
          </div>

          <CardContent className="space-y-6 p-6 sm:p-10">
            <div className="rounded-xl border border-dashed border-border bg-muted/40 p-5 text-sm">
              <p className="font-medium text-foreground">
                Este é um <span className="text-primary">adicional premium</span>{" "}
                do TreexMenu.
              </p>
              <p className="mt-1 text-muted-foreground">
                Fale com nosso time pelo WhatsApp para ativar o WhatsApp Automático
                em seu plano.
              </p>
            </div>

            <div>
              <h3 className="text-lg font-bold tracking-tight">
                O que você ganha com o WhatsApp Automático
              </h3>
              <p className="text-sm text-muted-foreground">
                Atendimento 24/7 com respostas automáticas personalizadas.
              </p>

              <div className="mt-5 grid gap-4 sm:grid-cols-2">
                {[
                  {
                    icon: Bot,
                    title: "Respostas automáticas 24/7",
                    desc: "Configure uma mensagem de boas-vindas e o sistema responde automaticamente qualquer cliente que contatar seu WhatsApp.",
                  },
                  {
                    icon: QrCode,
                    title: "Conexão por QR Code",
                    desc: "Conecte seu WhatsApp oficial de forma segura escaneando um QR Code diretamente no painel.",
                  },
                  {
                    icon: Clock,
                    title: "Cooldown inteligente",
                    desc: "Evite spam com sistema de cooldown configurável (1, 6, 12 ou 24 horas) por cliente.",
                  },
                  {
                    icon: Settings,
                    title: "Configuração simples",
                    desc: "Interface intuitiva para configurar sua mensagem automática e gerenciar a conexão.",
                  },
                ].map((f) => (
                  <div
                    key={f.title}
                    className="rounded-xl border border-border bg-card p-4"
                  >
                    <div className="flex items-start gap-3">
                      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                        <f.icon className="h-5 w-5" />
                      </div>
                      <div>
                        <p className="font-semibold leading-tight">
                          {f.title}
                        </p>
                        <p className="mt-1 text-sm text-muted-foreground">
                          {f.desc}
                        </p>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }


  const isConnected = connectionState.status === 'connected';
  const isConnecting = connectionState.status === 'connecting';
  const isQr = connectionState.status === 'qr';

  return (
    <div className="container mx-auto p-4 lg:p-8 max-w-4xl space-y-6">

      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className={`w-12 h-12 rounded-2xl flex items-center justify-center border ${isConnected ? 'bg-green-500/10 border-green-500/20' : 'bg-primary/10 border-primary/10'}`}>
            <MessageSquare className={`w-6 h-6 ${isConnected ? 'text-green-600' : 'text-primary'}`} />
          </div>
          <div>
            <h1 className="text-2xl lg:text-3xl font-bold">WhatsApp Automático</h1>
            <p className="text-sm text-muted-foreground">Sistema profissional de auto resposta</p>
          </div>
        </div>
        {isConnected && (
          <Badge className="bg-green-500/15 text-green-600 border-green-500/30 px-3 py-1.5 gap-2">
            <span className="w-2 h-2 rounded-full bg-green-500 animate-pulse" />
            Ativo
          </Badge>
        )}
      </div>

      {/* Card de Conexão */}
      <Card className="overflow-hidden">
        {isConnected && <div className="h-1 bg-gradient-to-r from-green-400 to-emerald-500" />}
        {isQr && <div className="h-1 bg-gradient-to-r from-yellow-400 to-amber-500" />}
        {isConnecting && <div className="h-1 bg-gradient-to-r from-blue-400 to-sky-500 animate-pulse" />}

        <CardContent className="p-6 lg:p-8">
          <div className="grid lg:grid-cols-2 gap-8 items-center">

            {/* Esquerda — info e ações */}
            <div className="space-y-5">
              <div className="flex items-center gap-2 text-muted-foreground">
                <Smartphone className="w-4 h-4" />
                <span className="text-xs font-semibold uppercase tracking-widest">Conexão</span>
              </div>

              {/* Badge de status */}
              {isConnected ? (
                <Badge className="bg-green-500/15 text-green-600 border-green-500/30 text-sm py-1 px-3">
                  <CheckCircle2 className="w-4 h-4 mr-1.5" />
                  Conectado
                  {connectionState.phone && (
                    <span className="ml-2 font-mono opacity-70">+{connectionState.phone}</span>
                  )}
                </Badge>
              ) : isQr ? (
                <Badge className="bg-yellow-500/15 text-yellow-600 border-yellow-500/30 text-sm py-1 px-3">
                  <QrCode className="w-4 h-4 mr-1.5" />
                  Aguardando leitura do QR Code
                </Badge>
              ) : isConnecting ? (
                <Badge className="bg-blue-500/15 text-blue-600 border-blue-500/30 text-sm py-1 px-3">
                  <Loader2 className="w-4 h-4 mr-1.5 animate-spin" />
                  Conectando...
                </Badge>
              ) : (
                <Badge variant="outline" className="text-muted-foreground text-sm py-1 px-3">
                  <XCircle className="w-4 h-4 mr-1.5" />
                  Desconectado
                </Badge>
              )}

              {/* Descrição contextual */}
              {isConnected ? (
                <div className="rounded-xl bg-green-500/5 border border-green-500/20 p-4 space-y-1">
                  <p className="text-sm font-medium text-green-700 dark:text-green-400">
                    ✅ Respondendo automaticamente aos clientes
                  </p>
                  {connectionState.profileName && (
                    <p className="text-xs text-muted-foreground">Conta: {connectionState.profileName}</p>
                  )}
                </div>
              ) : (
                <p className="text-sm text-muted-foreground leading-relaxed">
                  Escaneie o QR Code com o seu celular para conectar.
                  <br />
                  <span className="text-xs">WhatsApp → Aparelhos conectados → Conectar um aparelho</span>
                </p>
              )}

              {/* Input de número */}
              {!isConnected && !isConnecting && !isQr && (
                <div className="space-y-1.5">
                  <Label htmlFor="phone" className="text-sm">Número com DDI</Label>
                  <Input
                    id="phone"
                    type="tel"
                    placeholder="5511999999999"
                    value={phoneNumber}
                    onChange={(e) => setPhoneNumber(e.target.value)}
                    disabled={connecting}
                    className="font-mono"
                  />
                  <p className="text-xs text-muted-foreground">Inclua o código do país (ex: 55 para Brasil)</p>
                </div>
              )}

              {/* Botões de ação */}
              <div className="flex flex-wrap gap-2">
                {!isConnected && !isConnecting && !isQr && (
                  <Button onClick={handleConnect} disabled={connecting || !phoneNumber.trim()}>
                    {connecting
                      ? <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                      : <QrCode className="w-4 h-4 mr-2" />}
                    Conectar WhatsApp
                  </Button>
                )}
                <Button
                  variant="outline"
                  size="icon"
                  onClick={() => user && startStatusPolling(user.id)}
                  disabled={connecting}
                  title="Verificar status"
                >
                  <RefreshCw className={`w-4 h-4 ${connecting ? 'animate-spin' : ''}`} />
                </Button>
                {isConnected && (
                  <Button variant="destructive" onClick={handleDisconnect} disabled={connecting}>
                    <PowerOff className="w-4 h-4 mr-2" />
                    Desconectar
                  </Button>
                )}
              </div>
            </div>

            {/* Direita — QR Code / estado visual */}
            <div className="flex items-center justify-center">
              {isConnected ? (
                <div className="rounded-2xl border-2 border-dashed border-green-500/30 bg-green-500/5 p-14 text-center">
                  <Wifi className="w-16 h-16 mx-auto mb-3 text-green-500" />
                  <p className="font-semibold text-green-700 dark:text-green-400">Conectado!</p>
                  <p className="text-sm text-muted-foreground mt-1">WhatsApp ativo e funcionando</p>
                </div>
              ) : isQr ? (
                <div className="rounded-2xl bg-white p-4 shadow-md border">
                  <img
                    src={connectionState.qr!}
                    alt="QR Code"
                    className="w-60 h-60 object-contain"
                  />
                  <p className="text-center text-xs text-muted-foreground mt-2">
                    Escaneie com seu WhatsApp
                  </p>
                </div>
              ) : isConnecting ? (
                <div className="rounded-2xl border-2 border-dashed border-blue-500/30 bg-blue-500/5 p-14 text-center">
                  <Loader2 className="w-16 h-16 mx-auto mb-3 text-blue-500 animate-spin" />
                  <p className="font-semibold">Aguardando QR Code...</p>
                  <p className="text-sm text-muted-foreground mt-1">Isso pode levar alguns segundos</p>
                </div>
              ) : (
                <div className="rounded-2xl border-2 border-dashed p-14 text-center text-muted-foreground">
                  <QrCode className="w-16 h-16 mx-auto mb-3 opacity-25" />
                  <p className="text-sm">O QR Code aparecerá aqui</p>
                </div>
              )}
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Card de Configuração da Mensagem */}
      <Card>
        <CardContent className="p-6 lg:p-8 space-y-6">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 text-muted-foreground">
              <Send className="w-4 h-4" />
              <span className="text-xs font-semibold uppercase tracking-widest">Mensagem automática</span>
            </div>
            <div className="flex items-center gap-2">
              <Switch id="active" checked={isActive} onCheckedChange={setIsActive} />
              <Label htmlFor="active" className="text-sm cursor-pointer">
                {isActive ? (
                  <span className="text-green-600 font-medium">Ativa</span>
                ) : (
                  <span className="text-muted-foreground">Pausada</span>
                )}
              </Label>
            </div>
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label htmlFor="message">Mensagem de boas-vindas</Label>
              <span className="text-xs text-muted-foreground">{messageText.length} caracteres</span>
            </div>
            <Textarea
              id="message"
              value={messageText}
              onChange={(e) => setMessageText(e.target.value)}
              rows={7}
              className="resize-none font-mono text-sm leading-relaxed"
            />
            <p className="text-xs text-muted-foreground">
              Enviada automaticamente para quem contatar seu WhatsApp.
            </p>
          </div>

          <div className="flex items-end gap-4">
            <div className="space-y-1.5 flex-1">
              <Label className="text-sm">Intervalo entre respostas</Label>
              <Select value={cooldownHours} onValueChange={setCooldownHours}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="1">1 hora</SelectItem>
                  <SelectItem value="6">6 horas</SelectItem>
                  <SelectItem value="12">12 horas</SelectItem>
                  <SelectItem value="24">24 horas</SelectItem>
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">Por cliente</p>
            </div>

            <Button
              onClick={handleSaveConfig}
              disabled={saving || !messageText.trim()}
              className="px-8"
            >
              {saving
                ? <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                : <Zap className="w-4 h-4 mr-2" />}
              Salvar
            </Button>
          </div>
        </CardContent>
      </Card>

    </div>
  );
}
