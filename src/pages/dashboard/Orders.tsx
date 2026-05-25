import { useEffect, useMemo, useRef, useState } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Calendar } from "@/components/ui/calendar";
import { Search, MessageCircle, CheckCircle2, XCircle, MapPin, Phone, User, Package, Clock, CalendarIcon, Sparkles, Printer, Plus, Settings as SettingsIcon, AlarmClock } from "lucide-react";
import { format, startOfDay, endOfDay, subDays } from "date-fns";
import { ptBR } from "date-fns/locale";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { Order, OrderItem, autoCancelStale, formatCurrency } from "@/lib/salesAnalytics";
import { Switch } from "@/components/ui/switch";
import { ManualOrderDialog } from "@/components/orders/ManualOrderDialog";
import { EditOpenTabDialog } from "@/components/orders/EditOpenTabDialog";
import { printOrder, PrintItem } from "@/lib/printOrder";
import { printOrder as printOrderElectron } from "@/utils/electronPrint";
import { useEditing } from "@/contexts/EditingContext";

type Period = "today" | "yesterday" | "7d" | "30d" | "custom";

const STATUS_META: Record<string, { label: string; pill: string; dot: string }> = {
  new: {
    label: "Pedido criado",
    pill: "bg-orange-500/10 text-orange-700 border-orange-500/30 dark:text-orange-300",
    dot: "bg-orange-500",
  },
  finished: {
    label: "Pedido concluído",
    pill: "bg-emerald-500/10 text-emerald-700 border-emerald-500/30 dark:text-emerald-300",
    dot: "bg-emerald-500",
  },
  cancelled: {
    label: "Pedido cancelado",
    pill: "bg-rose-500/10 text-rose-700 border-rose-500/30 dark:text-rose-300",
    dot: "bg-rose-500",
  },
};

const ORDER_TYPE_META: Record<string, { label: string; className: string }> = {
  delivery: {
    label: "ENTREGA",
    className: "bg-blue-500/10 text-blue-700 border-blue-500/30 dark:text-blue-300",
  },
  pickup: {
    label: "RETIRADA",
    className: "bg-violet-500/10 text-violet-700 border-violet-500/30 dark:text-violet-300",
  },
  dine_in: {
    label: "COMER NO LOCAL",
    className: "bg-amber-500/10 text-amber-700 border-amber-500/30 dark:text-amber-300",
  },
};

const getOrderTypeMeta = (type?: string | null) =>
  ORDER_TYPE_META[type || "delivery"] || ORDER_TYPE_META.delivery;

const OPEN_TAB_META = {
  label: "COMANDA ABERTA",
  pill: "bg-sky-500/10 text-sky-700 border-sky-500/30 dark:text-sky-300",
  dot: "bg-sky-500",
};

const getStatusMeta = (order: { status: string; is_open_tab?: boolean | null }) => {
  if (order.is_open_tab && order.status === "new") return OPEN_TAB_META;
  return STATUS_META[order.status] || STATUS_META.new;
};

const OrdersPage = () => {
  const { user } = useAuth();
  const { isEditingOrder, setIsEditingOrder } = useEditing();
  const [orders, setOrders] = useState<Order[]>([]);
  const [items, setItems] = useState<OrderItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [period, setPeriod] = useState<Period>("today");
  const [customRange, setCustomRange] = useState<{ from?: Date; to?: Date }>({});
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [scheduleFilter, setScheduleFilter] = useState<"all" | "immediate" | "scheduled">("all");
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<Order | null>(null);
  const [confirm, setConfirm] = useState<{ id: string; action: "finish" | "cancel" } | null>(null);
  const [highlightIds, setHighlightIds] = useState<Set<string>>(new Set());
  const [manualOpen, setManualOpen] = useState(false);
  const [appendTarget, setAppendTarget] = useState<{ id: string; menu_id: string; total_amount: number; label?: string } | null>(null);
  const [editTabOrder, setEditTabOrder] = useState<Order | null>(null);
  const [printSettings, setPrintSettings] = useState<{
    auto_print: boolean;
    print_split_by_category: boolean;
    menu_id: string | null;
    restaurant_name: string;
  }>({ auto_print: false, print_split_by_category: false, menu_id: null, restaurant_name: "" });
  const printedIdsRef = useRef<Set<string>>(new Set());
  const loadInFlightRef = useRef(false);
  const loadQueuedRef = useRef(false);
  const loadRef = useRef<() => void>(() => {});

  const load = async () => {
    if (!user) return;
    if (loadInFlightRef.current) {
      loadQueuedRef.current = true;
      return;
    }
    loadInFlightRef.current = true;
    try {
      const [{ data: ordersData }, { data: itemsData }, { data: settingsData }] = await Promise.all([
        supabase.from("orders").select("*").eq("user_id", user.id).order("created_at", { ascending: false }),
        supabase.from("order_items").select("*, orders!inner(user_id)").eq("orders.user_id", user.id),
        supabase
          .from("menu_settings")
          .select("menu_id,auto_print,print_split_by_category,display_name,menus(name,user_id)")
          .eq("user_id", user.id)
          .limit(1)
          .maybeSingle() as any,
      ]);
      const raw = (ordersData as Order[]) || [];
      const { orders: normalized, staleIds } = autoCancelStale(raw);
      if (staleIds.length) await supabase.from("orders").update({ status: "cancelled" }).in("id", staleIds);
      setOrders(normalized);
      setItems(((itemsData as any[]) || []).map(({ orders: _o, ...rest }) => rest as OrderItem));
      if (settingsData) {
        setPrintSettings({
          auto_print: !!(settingsData as any).auto_print,
          print_split_by_category: !!(settingsData as any).print_split_by_category,
          menu_id: (settingsData as any).menu_id,
          restaurant_name:
            (settingsData as any).display_name ||
            (settingsData as any).menus?.name ||
            "Restaurante",
        });
      }
      setLoading(false);
    } finally {
      loadInFlightRef.current = false;
      if (loadQueuedRef.current) {
        loadQueuedRef.current = false;
        window.setTimeout(() => loadRef.current(), 0);
      }
    }
  };

  useEffect(() => {
    loadRef.current = load;
  });

  useEffect(() => {
    load();
  }, [user]);

  // Helper: dispara impressão de um pedido específico
  const doPrint = (order: Order, ordItems: OrderItem[]) => {
    if (window.electronAPI !== undefined) {
      printOrderElectron(order.id, order.customer_name);
    } else {
      printOrder({
        restaurantName: printSettings.restaurant_name || 'Restaurante',
        order: {
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
        },
        items: ordItems.map((item) => ({
          product_name: item.product_name,
          quantity: item.quantity,
          unit_price: Number(item.unit_price),
          subtotal: Number(item.subtotal),
          category_name: item.category_name || null,
          notes: item.notes || null,
          addons: item.addons ?? undefined,
        })),
        splitByCategory: printSettings.print_split_by_category,
      });
    }
    toast.success("Enviado para impressão");
  };

  // Realtime
  useEffect(() => {
    if (!user) return;
    const channel = supabase
      .channel("orders-rt")
      .on("postgres_changes", { event: "*", schema: "public", table: "orders", filter: `user_id=eq.${user.id}` }, async (payload) => {
        if (payload.eventType === "INSERT") {
          const o = payload.new as Order;
          setOrders((current) => (current.some((order) => order.id === o.id) ? current : [o, ...current]));
          setHighlightIds((s) => new Set(s).add(o.id));
          setTimeout(() => setHighlightIds((s) => { const n = new Set(s); n.delete(o.id); return n; }), 4000);
          toast.success(`Novo pedido de ${o.customer_name}`);
          // Auto-print (apenas no web, no Electron o useRealtimeOrders cuida disso)
          const isElectron = window.electronAPI !== undefined;
          if (!isElectron && printSettings.auto_print && !printedIdsRef.current.has(o.id)) {
            printedIdsRef.current.add(o.id);
            // Aguarda items chegarem (best-effort)
            setTimeout(async () => {
              const { data: its } = await supabase
                .from("order_items").select("*").eq("order_id", o.id);
              doPrint(o, (its || []) as OrderItem[]);
            }, 600);
          }
        }
        // Só recarregar se não estiver editando
        if (!isEditingOrder) {
          loadRef.current();
        }
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "order_items" }, () => {
        // Só recarregar se não estiver editando
        if (!isEditingOrder) {
          loadRef.current();
        }
      })
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [user, printSettings.auto_print, printSettings.restaurant_name, printSettings.print_split_by_category, isEditingOrder]);

  useEffect(() => {
    if (!user) return;
    const intervalId = window.setInterval(() => {
      // Só recarregar se não estiver editando
      if (!isEditingOrder) {
        loadRef.current();
      }
    }, 2000);
    return () => window.clearInterval(intervalId);
  }, [user, isEditingOrder]);

  // Toggles de impressão (persistidos em menu_settings do menu de referência)
  const updatePrintSetting = async (patch: Partial<{ auto_print: boolean; print_split_by_category: boolean }>) => {
    setPrintSettings((s) => ({ ...s, ...patch }));
    if (!printSettings.menu_id || !user) return;
    await supabase
      .from("menu_settings")
      .update(patch)
      .eq("menu_id", printSettings.menu_id);
  };

  const range = useMemo(() => {
    const now = new Date();
    if (period === "today") return { from: startOfDay(now), to: endOfDay(now) };
    if (period === "yesterday") {
      const y = subDays(now, 1);
      return { from: startOfDay(y), to: endOfDay(y) };
    }
    if (period === "7d") return { from: startOfDay(subDays(now, 6)), to: endOfDay(now) };
    if (period === "30d") return { from: startOfDay(subDays(now, 29)), to: endOfDay(now) };
    return {
      from: customRange.from ? startOfDay(customRange.from) : startOfDay(subDays(now, 30)),
      to: customRange.to ? endOfDay(customRange.to) : endOfDay(now),
    };
  }, [period, customRange]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return orders.filter((o) => {
      const d = new Date(o.created_at);
      if (d < range.from || d > range.to) return false;
      if (statusFilter !== "all" && o.status !== statusFilter) return false;
      const isSched = !!(o as any).is_scheduled;
      if (scheduleFilter === "scheduled" && !isSched) return false;
      if (scheduleFilter === "immediate" && isSched) return false;
      if (q) {
        const hay = `${o.customer_name} ${o.customer_phone || ""}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [orders, range, statusFilter, scheduleFilter, search]);

  const scheduledOrders = useMemo(
    () => filtered.filter((o) => (o as any).is_scheduled).sort((a, b) => {
      const ta = new Date((a as any).scheduled_for || a.created_at).getTime();
      const tb = new Date((b as any).scheduled_for || b.created_at).getTime();
      return ta - tb;
    }),
    [filtered],
  );
  const immediateOrders = useMemo(() => filtered.filter((o) => !(o as any).is_scheduled), [filtered]);

  const counts = useMemo(() => {
    const inRange = orders.filter((o) => {
      const d = new Date(o.created_at);
      return d >= range.from && d <= range.to;
    });
    return {
      total: inRange.length,
      new: inRange.filter((o) => o.status === "new").length,
      finished: inRange.filter((o) => o.status === "finished").length,
      cancelled: inRange.filter((o) => o.status === "cancelled").length,
    };
  }, [orders, range]);

  const itemsOf = (orderId: string) => items.filter((i) => i.order_id === orderId);
  const itemsCount = (orderId: string) => itemsOf(orderId).reduce((a, i) => a + i.quantity, 0);
  const selectedItems = useMemo(() => (selected ? itemsOf(selected.id) : []), [items, selected]);

  const performAction = async () => {
    if (!confirm) return;
    const newStatus = confirm.action === "finish" ? "finished" : "cancelled";
    const { error } = await supabase.from("orders").update({ status: newStatus }).eq("id", confirm.id);
    if (error) return toast.error("Erro ao atualizar pedido");
    toast.success(confirm.action === "finish" ? "Pedido concluído" : "Pedido cancelado");
    if (selected?.id === confirm.id) setSelected({ ...selected, status: newStatus });
    // Dispara notificação WhatsApp (silencioso — só se WhatsApp estiver conectado)
    supabase.functions.invoke("whatsapp-notify-order", {
      body: { order_id: confirm.id, status: newStatus },
    }).catch(() => {});
    setConfirm(null);
    load();
  };

  const openWhats = (phone: string | null) => {
    if (!phone) return toast.error("Cliente sem telefone cadastrado");
    const digits = phone.replace(/\D/g, "");
    window.open(`https://wa.me/${digits}`, "_blank");
  };

  const handlePrintOrder = (order: Order) => {
    if (window.electronAPI !== undefined) {
      printOrderElectron(order.id, order.customer_name);
    } else {
      const ordItems = itemsOf(order.id);
      printOrder({
        restaurantName: printSettings.restaurant_name || 'Restaurante',
        order: {
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
        },
        items: ordItems.map((item) => ({
          product_name: item.product_name,
          quantity: item.quantity,
          unit_price: Number(item.unit_price),
          subtotal: Number(item.subtotal),
          category_name: item.category_name || null,
          notes: item.notes || null,
          addons: item.addons ?? undefined,
        })),
        splitByCategory: printSettings.print_split_by_category,
      });
    }
    toast.success("Enviado para impressão");
  };

  return (
    <div className="mx-auto max-w-7xl space-y-6 p-4 md:p-8">
      <header className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
        <div>
          <h1 className="font-display text-2xl font-bold tracking-tight md:text-3xl">Pedidos</h1>
          <p className="text-sm text-muted-foreground">
            Acompanhe e gerencie todos os pedidos recebidos em tempo real.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="cta" onClick={() => setManualOpen(true)}>
            <Plus className="h-4 w-4" /> Novo pedido manual
          </Button>
          <div className="flex items-center gap-2 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-3 py-1.5 text-xs font-semibold text-emerald-700 dark:text-emerald-300">
            <span className="relative flex h-2 w-2">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-500 opacity-60" />
              <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-500" />
            </span>
            Tempo real
          </div>
        </div>
      </header>

      {/* Configurações de impressão */}
      <Card>
        <CardContent className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:gap-6">
          <div className="flex items-center gap-2 text-sm font-semibold">
            <Printer className="h-4 w-4 text-primary" /> Impressão
          </div>
          <label className="flex cursor-pointer items-center gap-2 text-sm">
            <Switch
              checked={printSettings.auto_print}
              onCheckedChange={(v) => updatePrintSetting({ auto_print: v })}
              disabled={!printSettings.menu_id}
            />
            Imprimir novos pedidos automaticamente
          </label>
          {/* Opção oculta - Separar por categoria (cozinha/bebidas)
          <label className="flex cursor-pointer items-center gap-2 text-sm">
            <Switch
              checked={printSettings.print_split_by_category}
              onCheckedChange={(v) => updatePrintSetting({ print_split_by_category: v })}
              disabled={!printSettings.menu_id}
            />
            Separar por categoria (cozinha/bebidas)
          </label>
          */}
          {printSettings.auto_print && (
            <span className="text-[11px] text-muted-foreground">
              Permita pop-ups deste site no navegador.
            </span>
          )}
        </CardContent>
      </Card>

      {/* Resumo */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <SummaryTile label="Total no período" value={counts.total} icon={Package} accent="primary" />
        <SummaryTile label="Pedido criado" value={counts.new} icon={Clock} accent="orange" />
        <SummaryTile label="Concluídos" value={counts.finished} icon={CheckCircle2} accent="emerald" />
        <SummaryTile label="Cancelados" value={counts.cancelled} icon={XCircle} accent="rose" />
      </div>

      {/* Filtros */}
      <Card>
        <CardContent className="flex flex-col gap-3 p-4 md:flex-row md:items-center">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              placeholder="Buscar por nome ou telefone..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-9"
            />
          </div>
          <Select value={period} onValueChange={(v) => setPeriod(v as Period)}>
            <SelectTrigger className="md:w-44"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="today">Hoje</SelectItem>
              <SelectItem value="yesterday">Ontem</SelectItem>
              <SelectItem value="7d">Últimos 7 dias</SelectItem>
              <SelectItem value="30d">Últimos 30 dias</SelectItem>
              <SelectItem value="custom">Personalizado</SelectItem>
            </SelectContent>
          </Select>
          {period === "custom" && (
            <Popover>
              <PopoverTrigger asChild>
                <Button variant="outline" className="md:w-56 justify-start font-normal">
                  <CalendarIcon className="h-4 w-4" />
                  {customRange.from ? (
                    customRange.to ? (
                      `${format(customRange.from, "dd/MM", { locale: ptBR })} - ${format(customRange.to, "dd/MM", { locale: ptBR })}`
                    ) : (
                      format(customRange.from, "dd/MM/yyyy", { locale: ptBR })
                    )
                  ) : (
                    <span className="text-muted-foreground">Escolher datas</span>
                  )}
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-auto p-0" align="end">
                <Calendar
                  mode="range"
                  selected={customRange as any}
                  onSelect={(r: any) => setCustomRange(r || {})}
                  numberOfMonths={1}
                  locale={ptBR}
                  className="p-3 pointer-events-auto"
                />
              </PopoverContent>
            </Popover>
          )}
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="md:w-44"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todos os status</SelectItem>
              <SelectItem value="new">Pedido criado</SelectItem>
              <SelectItem value="finished">Pedido concluído</SelectItem>
              <SelectItem value="cancelled">Pedido cancelado</SelectItem>
            </SelectContent>
          </Select>
        </CardContent>
      </Card>

      {/* Lista */}
      {loading ? (
        <div className="py-16 text-center text-sm text-muted-foreground">Carregando pedidos...</div>
      ) : filtered.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center gap-2 py-16 text-center">
            <Package className="h-10 w-10 text-muted-foreground/60" />
            <div className="font-medium">Nenhum pedido encontrado</div>
            <div className="text-sm text-muted-foreground">Ajuste os filtros ou aguarde novos pedidos.</div>
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {filtered.map((o) => {
            const isOpenTab = !!(o as any).is_open_tab && o.status === "new";
            const meta = getStatusMeta(o as any);
            const isNew = highlightIds.has(o.id);
            const accentBar = isOpenTab
              ? "bg-sky-500"
              : o.status === "finished"
              ? "bg-emerald-500"
              : o.status === "cancelled"
              ? "bg-rose-500"
              : "bg-orange-500";
            return (
              <button
                key={o.id}
                onClick={() => setSelected(o)}
                className={cn(
                  "group relative overflow-hidden rounded-2xl border border-border/70 bg-card text-left shadow-sm transition-all hover:-translate-y-1 hover:border-primary/40 hover:shadow-lg",
                  isNew && "ring-2 ring-primary/50",
                )}
              >
                {/* Barra lateral de status */}
                <span className={cn("absolute left-0 top-0 h-full w-1", accentBar)} />

                {isNew && (
                  <span className="absolute -right-2 -top-2 z-10 inline-flex items-center gap-1 rounded-full bg-primary px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider text-primary-foreground shadow-lg">
                    <Sparkles className="h-3 w-3" /> Novo
                  </span>
                )}

                <div className="flex flex-col gap-3 p-5 pl-6">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-muted text-sm font-bold text-muted-foreground">
                          {o.customer_name.charAt(0).toUpperCase()}
                        </div>
                        <div className="min-w-0">
                          <div className="truncate font-display text-sm font-semibold tracking-tight">
                            {o.customer_name}
                          </div>
                          <div className="flex items-center gap-1 text-[11px] text-muted-foreground">
                            <Clock className="h-3 w-3" />
                            {format(new Date(o.created_at), "dd/MM 'às' HH:mm", { locale: ptBR })}
                          </div>
                        </div>
                      </div>
                    </div>
                    <Badge variant="outline" className={cn("shrink-0 border text-[10px] font-semibold uppercase tracking-wider", meta.pill)}>
                      <span className={cn("mr-1.5 h-1.5 w-1.5 rounded-full", meta.dot)} />
                      {meta.label}
                    </Badge>
                  </div>

                  <div className="flex items-end justify-between border-t border-dashed border-border/70 pt-3">
                    <div className="flex items-center gap-1.5">
                      <Badge
                        variant="outline"
                        className={cn(
                          "border text-[10px] font-bold uppercase tracking-wider",
                          getOrderTypeMeta((o as any).order_type).className,
                        )}
                      >
                        {getOrderTypeMeta((o as any).order_type).label}
                      </Badge>
                      {(o as any).is_scheduled && (
                        <Badge
                          variant="outline"
                          className="border border-indigo-500/30 bg-indigo-500/10 text-[10px] font-bold uppercase tracking-wider text-indigo-700 dark:text-indigo-300"
                        >
                          <AlarmClock className="mr-1 h-3 w-3" /> Agendado
                        </Badge>
                      )}
                      <div className="flex items-center gap-1.5 rounded-full bg-muted/60 px-2.5 py-1 text-[11px] font-medium text-muted-foreground">
                        <Package className="h-3 w-3" />
                        {itemsCount(o.id)}
                      </div>
                    </div>
                    <div className="font-display text-xl font-bold tracking-tight">
                      {formatCurrency(Number(o.total_amount))}
                    </div>
                  </div>
                </div>
              </button>
            );
          })}
        </div>
      )}

      {/* Detalhes */}
      <Dialog open={!!selected} onOpenChange={(o) => !o && setSelected(null)}>
        <DialogContent className="w-[calc(100vw-2rem)] max-w-2xl max-h-[90vh] overflow-x-hidden overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="text-xl">Detalhes do pedido</DialogTitle>
          </DialogHeader>
          <DialogHeader>
            <DialogTitle>Detalhes do pedido</DialogTitle>
          </DialogHeader>
          {selected && (
            <div className="space-y-5">
              <div className="flex flex-wrap items-center gap-2">
                {(() => {
                  const sMeta = getStatusMeta(selected as any);
                  return (
                    <Badge variant="outline" className={cn("border", sMeta.pill)}>
                      <span className={cn("mr-1.5 h-1.5 w-1.5 rounded-full", sMeta.dot)} />
                      {sMeta.label}
                    </Badge>
                  );
                })()}
                <Badge
                  variant="outline"
                  className={cn(
                    "border text-[10px] font-bold uppercase tracking-wider",
                    getOrderTypeMeta((selected as any).order_type).className,
                  )}
                >
                  {getOrderTypeMeta((selected as any).order_type).label}
                </Badge>
                {(selected as any).is_scheduled && (
                  <Badge
                    variant="outline"
                    className="border border-indigo-500/30 bg-indigo-500/10 text-[10px] font-bold uppercase tracking-wider text-indigo-700 dark:text-indigo-300"
                  >
                    <AlarmClock className="mr-1 h-3 w-3" /> Agendado
                  </Badge>
                )}
              </div>

              {selected.status === "new" && (
                <Button
                  variant="cta"
                  className="w-full bg-sky-600 hover:bg-sky-700"
                  onClick={() => {
                    setEditTabOrder(selected);
                    setSelected(null);
                  }}
                >
                  <SettingsIcon className="h-4 w-4" />
                  {(selected as any).is_open_tab ? "Editar comanda" : "Editar pedido"}
                </Button>
              )}

              <Section title="Cliente">
                <Row icon={User} label="Nome" value={selected.customer_name} />
                <Row icon={Phone} label="Telefone" value={selected.customer_phone || "—"} />
              </Section>

              {selected.customer_address && (
                <Section title="Endereço">
                  <div className="flex gap-2 text-sm">
                    <MapPin className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
                    <span className="whitespace-pre-line">{selected.customer_address}</span>
                  </div>
                </Section>
              )}

              <Section title="Itens">
                <div className="overflow-hidden rounded-lg border border-border">
                  {selectedItems.map((i) => {
                    const itemAddons = Array.isArray((i as any).addons) ? ((i as any).addons as any[]) : [];
                    const itemNotes = ((i as any).notes as string | null) || "";
                    return (
                      <div key={i.id} className="flex items-start justify-between gap-3 border-b border-border px-3 py-2.5 text-sm last:border-b-0">
                        <div className="min-w-0 flex-1">
                          <div className="font-medium">{i.product_name}</div>
                          <div className="text-xs text-muted-foreground">
                            {i.quantity}x {formatCurrency(Number(i.unit_price))}
                          </div>
                          {itemAddons.length > 0 && (
                            <ul className="mt-1 space-y-0.5">
                              {itemAddons.map((a, idx) => (
                                <li key={idx} className="text-xs text-muted-foreground">
                                  + {a.option_name}
                                  {Number(a.price) > 0 ? ` (${formatCurrency(Number(a.price))})` : ""}
                                </li>
                              ))}
                            </ul>
                          )}
                          {itemNotes.trim() && (
                            <div className="mt-1 rounded-md bg-amber-500/10 px-2 py-1 text-xs italic text-amber-700 dark:text-amber-300">
                              Obs: {itemNotes.trim()}
                            </div>
                          )}
                        </div>
                        <div className="font-semibold whitespace-nowrap">{formatCurrency(Number(i.subtotal))}</div>
                      </div>
                    );
                  })}
                  <div className="flex items-center justify-between bg-muted/50 px-3 py-2.5 text-sm font-semibold">
                    <span>Total do pedido</span>
                    <span className="text-base">{formatCurrency(Number(selected.total_amount))}</span>
                  </div>
                </div>
                <div className="mt-2 text-xs text-muted-foreground">
                  Realizado em {format(new Date(selected.created_at), "dd/MM/yyyy 'às' HH:mm", { locale: ptBR })}
                </div>
              </Section>

              {selected.notes && (() => {
                // Notas são salvas no formato: "Pagamento: X (troco para R$ Y) · __msg__: <texto longo>"
                // Extraímos cada parte e exibimos de forma limpa, escondendo o __msg__ (já há detalhes completos acima).
                const raw = selected.notes;
                const parts = raw.split(" · ");
                let payment = "";
                const extras: string[] = [];
                for (const p of parts) {
                  const trimmed = p.trim();
                  if (!trimmed) continue;
                  if (trimmed.startsWith("__msg__:")) continue;
                  if (trimmed.toLowerCase().startsWith("pagamento:")) {
                    payment = trimmed.replace(/^pagamento:\s*/i, "").trim();
                  } else {
                    extras.push(trimmed);
                  }
                }
                if (!payment && extras.length === 0) return null;
                return (
                  <Section title="Observações">
                    <div className="flex flex-col gap-2.5">
                      {payment && (
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="text-xs font-medium text-muted-foreground">Pagamento:</span>
                          <span className="inline-flex items-center rounded-full bg-primary/10 px-3 py-1 text-xs font-semibold text-primary">
                            {payment}
                          </span>
                        </div>
                      )}
                      {extras.map((e, i) => (
                        <p key={i} className="text-sm text-foreground">{e}</p>
                      ))}
                    </div>
                  </Section>
                );
              })()}

              <div className="flex flex-col gap-2 border-t border-border pt-4 sm:flex-row sm:flex-wrap">
                <Button variant="outline" className="flex-1 min-w-[180px]" onClick={() => openWhats(selected.customer_phone)}>
                  <MessageCircle className="h-4 w-4" /> Abrir no WhatsApp
                </Button>
                <Button variant="outline" className="flex-1 min-w-[180px]" onClick={() => handlePrintOrder(selected)}>
                  <Printer className="h-4 w-4" /> IMPRIMIR
                </Button>
                {selected.status === "new" && (
                  <>
                    <Button
                      className="flex-1 min-w-[180px] bg-emerald-600 text-white hover:bg-emerald-700"
                      onClick={() => setConfirm({ id: selected.id, action: "finish" })}
                    >
                      <CheckCircle2 className="h-4 w-4" /> Marcar como concluído
                    </Button>
                    <Button
                      variant="outline"
                      className="flex-1 min-w-[180px] border-rose-300 text-rose-700 hover:bg-rose-50 dark:border-rose-900 dark:text-rose-300 dark:hover:bg-rose-950"
                      onClick={() => setConfirm({ id: selected.id, action: "cancel" })}
                    >
                      <XCircle className="h-4 w-4" /> Cancelar pedido
                    </Button>
                  </>
                )}
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!confirm} onOpenChange={(o) => !o && setConfirm(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {confirm?.action === "finish" ? "Concluir pedido?" : "Cancelar pedido?"}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {confirm?.action === "finish"
                ? "O pedido será marcado como concluído e não poderá mais ser alterado."
                : "O pedido será cancelado e não poderá mais ser alterado."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Voltar</AlertDialogCancel>
            <AlertDialogAction
              onClick={performAction}
              className={
                confirm?.action === "finish"
                  ? "bg-emerald-600 text-white hover:bg-emerald-700"
                  : "bg-destructive text-destructive-foreground hover:bg-destructive/90"
              }
            >
              Confirmar
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <ManualOrderDialog
        open={manualOpen}
        onOpenChange={setManualOpen}
        onCreated={() => load()}
      />

      <ManualOrderDialog
        open={!!appendTarget}
        onOpenChange={(o) => !o && setAppendTarget(null)}
        onCreated={() => load()}
        appendToOrder={appendTarget}
      />

      <EditOpenTabDialog
        open={!!editTabOrder}
        onOpenChange={(o) => !o && setEditTabOrder(null)}
        order={editTabOrder}
        items={items}
        onSaved={() => load()}
      />
    </div>
  );
};

const ACCENT_STYLES: Record<string, { bg: string; text: string; ring: string }> = {
  primary: { bg: "bg-primary/10", text: "text-primary", ring: "ring-primary/20" },
  orange: { bg: "bg-orange-500/10", text: "text-orange-600 dark:text-orange-400", ring: "ring-orange-500/20" },
  emerald: { bg: "bg-emerald-500/10", text: "text-emerald-600 dark:text-emerald-400", ring: "ring-emerald-500/20" },
  rose: { bg: "bg-rose-500/10", text: "text-rose-600 dark:text-rose-400", ring: "ring-rose-500/20" },
};

const SummaryTile = ({
  label,
  value,
  icon: Icon,
  accent,
}: {
  label: string;
  value: number;
  icon: any;
  accent: keyof typeof ACCENT_STYLES;
}) => {
  const a = ACCENT_STYLES[accent];
  return (
    <Card className="overflow-hidden border-border/60 transition-all hover:border-border hover:shadow-md">
      <CardContent className="flex items-center gap-3 p-4">
        <div className={cn("flex h-11 w-11 shrink-0 items-center justify-center rounded-xl ring-1", a.bg, a.text, a.ring)}>
          <Icon className="h-5 w-5" />
        </div>
        <div className="min-w-0">
          <div className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">{label}</div>
          <div className="font-display text-2xl font-bold leading-tight tracking-tight">{value}</div>
        </div>
      </CardContent>
    </Card>
  );
};

const Section = ({ title, children }: { title: string; children: React.ReactNode }) => (
  <div>
    <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">{title}</div>
    <div className="space-y-2">{children}</div>
  </div>
);

const Row = ({ icon: Icon, label, value }: { icon: any; label: string; value: string }) => (
  <div className="flex items-center gap-2 text-sm">
    <Icon className="h-4 w-4 text-muted-foreground" />
    <span className="text-muted-foreground">{label}:</span>
    <span className="font-medium">{value}</span>
  </div>
);

export default OrdersPage;
