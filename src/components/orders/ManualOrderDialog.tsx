/* ============================================================
   Diálogo "+ Novo pedido manual" (balcão)
   - Seleciona cardápio, produtos, adicionais, quantidade, obs.
   - Insere em orders + order_items (com snapshot de category_name)
   - Não envia WhatsApp, não cobra. Marca is_manual = true.
============================================================ */

import { useEffect, useMemo, useState } from "react";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Search, Plus, Minus, Trash2, ShoppingBag, Bike, Store, Truck, User, Utensils } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { useAuth } from "@/contexts/AuthContext";
import {
  AddonGroup, CartItem, CartItemAddon, makeCartKey, itemSubtotal, itemUnitTotal, cartSubtotal,
} from "@/lib/cart";
import { printOrder } from "@/utils/electronPrint";

interface Props {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  onCreated?: () => void;
  /** Quando definido, em vez de criar um pedido novo, adiciona itens a esta comanda existente. */
  appendToOrder?: { id: string; menu_id: string; total_amount: number; label?: string } | null;
}

interface MenuLite { id: string; name: string; }
interface ProductLite {
  id: string; name: string; price: number; image_url: string | null;
  category_id: string | null; description: string | null;
}
interface CategoryLite { id: string; name: string; }

type ManualType = "delivery" | "pickup" | "dine_in";

const TYPE_LABEL: Record<ManualType, string> = {
  delivery: "Entrega",
  pickup: "Retirada",
  dine_in: "Mesa",
};

export function ManualOrderDialog({ open, onOpenChange, onCreated, appendToOrder }: Props) {
  const { user } = useAuth();
  const [menus, setMenus] = useState<MenuLite[]>([]);
  const [menuId, setMenuId] = useState<string>("");
  const [products, setProducts] = useState<ProductLite[]>([]);
  const [categories, setCategories] = useState<CategoryLite[]>([]);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState("");

  const [cart, setCart] = useState<CartItem[]>([]);
  const [productPicker, setProductPicker] = useState<ProductLite | null>(null);

  const [customerName, setCustomerName] = useState("");
  const [customerPhone, setCustomerPhone] = useState("");
  const [orderType, setOrderType] = useState<ManualType>("delivery");
  const [tableNumber, setTableNumber] = useState("");
  const [notes, setNotes] = useState("");
  
  // Endereço para delivery
  const [addressStreet, setAddressStreet] = useState("");
  const [addressNumber, setAddressNumber] = useState("");
  const [addressNeighborhood, setAddressNeighborhood] = useState("");
  const [addressComplement, setAddressComplement] = useState("");
  const [addressZip, setAddressZip] = useState("");
  const [submitting, setSubmitting] = useState(false);

  // restaurantName + auto print do menu selecionado
  const [autoPrint, setAutoPrint] = useState(false);
  const [splitByCategory, setSplitByCategory] = useState(false);
  const [restaurantName, setRestaurantName] = useState("Pedido manual");
  const [deliveryFee, setDeliveryFee] = useState(0);

  // Carrega cardápios do usuário
  useEffect(() => {
    if (!open || !user) return;
    (async () => {
      // Modo "adicionar à comanda": força o menu do pedido existente
      if (appendToOrder) {
        setMenuId(appendToOrder.menu_id);
        setMenus([]);
        return;
      }
      const { data } = await supabase
        .from("menus")
        .select("id,name")
        .eq("user_id", user.id)
        .order("created_at", { ascending: false });
      const list = (data || []) as MenuLite[];
      setMenus(list);
      if (list.length && !menuId) setMenuId(list[0].id);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, user, appendToOrder]);

  // Carrega produtos+categorias+settings do menu selecionado
  useEffect(() => {
    if (!menuId) return;
    setLoading(true);
    (async () => {
      const [{ data: ps }, { data: cs }, { data: ms }] = await Promise.all([
        supabase
          .from("products")
          .select("id,name,price,image_url,category_id,description")
          .eq("menu_id", menuId)
          .eq("is_available", true)
          .order("position"),
        supabase.from("categories").select("id,name").eq("menu_id", menuId).order("position"),
        supabase
          .from("menu_settings")
          .select("display_name,auto_print,print_split_by_category,delivery_fee")
          .eq("menu_id", menuId)
          .maybeSingle(),
      ]);
      setProducts((ps || []) as any);
      setCategories((cs || []) as any);
      setAutoPrint(!!(ms as any)?.auto_print);
      setSplitByCategory(!!(ms as any)?.print_split_by_category);
      setDeliveryFee(Number((ms as any)?.delivery_fee || 0));
      const menu = menus.find((m) => m.id === menuId);
      setRestaurantName((ms as any)?.display_name || menu?.name || "Pedido manual");
      setLoading(false);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [menuId]);

  // Reset ao fechar
  useEffect(() => {
    if (!open) {
      setCart([]);
      setSearch("");
      setCustomerName("");
      setCustomerPhone("");
      setOrderType("delivery");
      setTableNumber("");
      setNotes("");
      setProductPicker(null);
    }
  }, [open]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return products;
    return products.filter(
      (p) =>
        p.name.toLowerCase().includes(q) ||
        (p.description || "").toLowerCase().includes(q),
    );
  }, [products, search]);

  const grouped = useMemo(() => {
    const out: Array<{ id: string; name: string; items: ProductLite[] }> = [];
    categories.forEach((c) => {
      const items = filtered.filter((p) => p.category_id === c.id);
      if (items.length) out.push({ id: c.id, name: c.name, items });
    });
    const orphans = filtered.filter(
      (p) => !p.category_id || !categories.find((c) => c.id === p.category_id),
    );
    if (orphans.length) out.push({ id: "__other__", name: "Outros", items: orphans });
    return out;
  }, [filtered, categories]);

  const subtotal = useMemo(() => cartSubtotal(cart), [cart]);
  const totalItems = cart.reduce((a, b) => a + b.quantity, 0);
  const finalDeliveryFee = orderType === "delivery" ? deliveryFee : 0;
  const totalAmount = subtotal + finalDeliveryFee;

  const addProduct = (p: ProductLite, addons: CartItemAddon[], qty: number, itemNotes: string) => {
    setCart((prev) => {
      const key = makeCartKey(p.id, addons, itemNotes);
      const existing = prev.find((it) => it.key === key);
      if (existing) {
        return prev.map((it) =>
          it.key === key ? { ...it, quantity: it.quantity + qty } : it,
        );
      }
      return [
        ...prev,
        {
          key,
          product_id: p.id,
          product_name: p.name,
          unit_price: Number(p.price) || 0,
          image_url: p.image_url,
          quantity: qty,
          addons,
          notes: itemNotes,
        },
      ];
    });
  };

  const inc = (k: string) =>
    setCart((c) => c.map((it) => (it.key === k ? { ...it, quantity: it.quantity + 1 } : it)));
  const dec = (k: string) =>
    setCart((c) =>
      c
        .map((it) => (it.key === k ? { ...it, quantity: it.quantity - 1 } : it))
        .filter((it) => it.quantity > 0),
    );
  const remove = (k: string) => setCart((c) => c.filter((it) => it.key !== k));

  const handleQuickAdd = async (p: ProductLite) => {
    // Verifica se há grupos de adicionais; se sim, abre picker, senão adiciona direto
    const { data: groups } = await supabase
      .from("product_addon_groups")
      .select("id")
      .eq("product_id", p.id)
      .limit(1);
    if ((groups || []).length > 0) {
      setProductPicker(p);
    } else {
      addProduct(p, [], 1, "");
      toast.success(`${p.name} adicionado`);
    }
  };

  const finalize = async () => {
    if (!user || !menuId) return;
    if (!cart.length) {
      toast.error("Adicione pelo menos um item");
      return;
    }
    setSubmitting(true);
    try {
      const totalAmount = subtotal;

      // Snapshot de category_name por produto (compartilhado entre os dois fluxos)
      const catById = new Map(categories.map((c) => [c.id, c.name]));
      const buildItems = (orderId: string) =>
        cart.map((it) => {
          const product = products.find((p) => p.id === it.product_id);
          const catName = product?.category_id ? catById.get(product.category_id) || null : null;
          return {
            order_id: orderId,
            product_id: it.product_id,
            product_name:
              it.product_name +
              (it.addons.length ? ` (${it.addons.map((a) => a.option_name).join(", ")})` : ""),
            quantity: it.quantity,
            unit_price: itemUnitTotal(it),
            subtotal: itemSubtotal(it),
            category_name: catName,
            notes: it.notes?.trim() ? it.notes.trim() : null,
            addons: it.addons as any,
          };
        });

      // ========= MODO: ADICIONAR ITENS A COMANDA EXISTENTE =========
      if (appendToOrder) {
        const items = buildItems(appendToOrder.id);
        const { error: iErr } = await supabase.from("order_items").insert(items);
        if (iErr) throw iErr;
        const newTotal = Number(appendToOrder.total_amount || 0) + totalAmount;
        await supabase
          .from("orders")
          .update({ total_amount: newTotal })
          .eq("id", appendToOrder.id);

        // Baixa de estoque para os itens recém-adicionados (o trigger só roda
        // automaticamente para os itens do pedido inicial). Buscamos as receitas
        // dos produtos envolvidos e geramos os movimentos de saída.
        const productIds = Array.from(
          new Set(cart.map((it) => it.product_id).filter(Boolean) as string[]),
        );
        if (productIds.length) {
          const { data: recipes } = await supabase
            .from("product_recipes")
            .select("product_id, inventory_item_id, quantity_per_unit")
            .in("product_id", productIds);
          const movements: any[] = [];
          for (const it of cart) {
            const productRecipes = (recipes || []).filter(
              (r: any) => r.product_id === it.product_id,
            );
            for (const r of productRecipes) {
              movements.push({
                user_id: user.id,
                item_id: r.inventory_item_id,
                movement_type: "out",
                quantity: Number(r.quantity_per_unit) * it.quantity,
                reason: "Baixa automática por item adicionado à comanda",
                order_id: appendToOrder.id,
              });
            }
          }
          if (movements.length) {
            await supabase.from("inventory_movements").insert(movements);
          }
        }

        toast.success("Itens adicionados à comanda");
        onCreated?.();
        onOpenChange(false);
        setSubmitting(false);
        return;
      }

      // ========= MODO: NOVO PEDIDO =========
      const isTable = orderType === "dine_in";
      const tableTrim = tableNumber.trim();
      const nameTrim = customerName.trim();
      if (!nameTrim) {
        toast.error("Informe o nome do cliente");
        setSubmitting(false);
        return;
      }
      const finalCustomerName = nameTrim;
      
      // Construir endereço para delivery
      const customerAddress = orderType === "delivery" 
        ? `${addressStreet.trim()}, ${addressNumber.trim()} — ${addressNeighborhood.trim()}${addressComplement.trim() ? ` (${addressComplement.trim()})` : ""}${addressZip.trim() ? ` · CEP ${addressZip.trim()}` : ""}`
        : null;

      const { data: order, error: orderErr } = await supabase
        .from("orders")
        .insert({
          menu_id: menuId,
          user_id: user.id,
          customer_name: finalCustomerName,
          customer_phone: customerPhone.trim() || null,
          customer_address: customerAddress,
          total_amount: totalAmount,
          status: "new",
          source: "manual",
          notes: notes.trim() || null,
          order_type: orderType,
          is_manual: true,
          table_number: isTable ? tableTrim : null,
          is_open_tab: isTable,
        } as any)
        .select("id, created_at")
        .single();
      if (orderErr || !order) throw orderErr || new Error("Falha ao criar pedido");

      const items = buildItems(order.id);
      if (items.length) {
        const { error: iErr } = await supabase.from("order_items").insert(items);
        if (iErr) throw iErr;
      }

      toast.success(isTable ? "Comanda aberta!" : "Pedido manual criado!");

      if (autoPrint) {
        printOrder(order.id, finalCustomerName);
      }

      onCreated?.();
      onOpenChange(false);
    } catch (e: any) {
      toast.error(e?.message || "Erro ao criar pedido");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <>
      <Sheet open={open} onOpenChange={onOpenChange}>
        <SheetContent side="right" className="flex w-full max-w-xl flex-col overflow-hidden p-0 sm:max-w-2xl">
          <SheetHeader className="border-b border-border bg-gradient-to-r from-primary/5 to-card px-5 py-4">
            <SheetTitle className="flex items-center gap-2 text-lg font-display">
              <ShoppingBag className="h-5 w-5 text-primary" />
              {appendToOrder ? `Adicionar à comanda — ${appendToOrder.label || ""}` : "Novo pedido manual"}
            </SheetTitle>
            <p className="text-xs text-muted-foreground">
              {appendToOrder
                ? "Os itens serão somados ao pedido aberto."
                : "Pedido criado direto pelo balcão. Não envia WhatsApp."}
            </p>
          </SheetHeader>

          <div className="grid flex-1 grid-cols-1 overflow-hidden md:grid-cols-[1fr,320px]">
            {/* Coluna esquerda: produtos */}
            <div className="flex flex-col overflow-hidden border-r border-border">
              <div className="space-y-2 border-b border-border bg-muted/20 p-4">
                {menus.length > 1 && (
                  <Select value={menuId} onValueChange={setMenuId}>
                    <SelectTrigger><SelectValue placeholder="Selecione o cardápio" /></SelectTrigger>
                    <SelectContent>
                      {menus.map((m) => (
                        <SelectItem key={m.id} value={m.id}>{m.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    placeholder="Buscar produto..."
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    className="pl-9"
                  />
                </div>
              </div>

              <div className="flex-1 overflow-y-auto p-4">
                {loading ? (
                  <div className="flex justify-center py-8">
                    <div className="h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent" />
                  </div>
                ) : grouped.length === 0 ? (
                  <div className="py-8 text-center text-sm text-muted-foreground">
                    Nenhum produto disponível neste cardápio.
                  </div>
                ) : (
                  <div className="space-y-5">
                    {grouped.map((g) => (
                      <div key={g.id}>
                        <div className="mb-2 text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
                          {g.name}
                        </div>
                        <div className="space-y-2">
                          {g.items.map((p) => (
                            <button
                              key={p.id}
                              type="button"
                              onClick={() => handleQuickAdd(p)}
                              className="flex w-full items-center gap-3 rounded-xl border border-border bg-card p-2.5 text-left transition hover:-translate-y-0.5 hover:border-primary/40 hover:shadow"
                            >
                              <div className="h-12 w-12 shrink-0 overflow-hidden rounded-lg bg-muted">
                                {p.image_url ? (
                                  <img src={p.image_url} alt={p.name} className="h-full w-full object-cover" loading="lazy" />
                                ) : null}
                              </div>
                              <div className="min-w-0 flex-1">
                                <div className="truncate text-sm font-semibold">{p.name}</div>
                                <div className="text-xs text-muted-foreground">R$ {Number(p.price).toFixed(2)}</div>
                              </div>
                              <Plus className="h-4 w-4 text-primary" />
                            </button>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>

            {/* Coluna direita: carrinho + finalização */}
            <div className="flex flex-col overflow-hidden bg-muted/20">
              <div className="flex-1 overflow-y-auto p-4">
                <div className="mb-3 text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
                  Itens do pedido ({totalItems})
                </div>
                {cart.length === 0 ? (
                  <div className="rounded-lg border border-dashed border-border bg-card/50 p-6 text-center text-xs text-muted-foreground">
                    Clique nos produtos à esquerda para adicionar.
                  </div>
                ) : (
                  <div className="space-y-2">
                    {cart.map((it) => (
                      <div key={it.key} className="rounded-lg border border-border bg-card p-2.5 text-sm">
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0 flex-1">
                            <div className="truncate font-semibold">{it.product_name}</div>
                            {it.addons.length > 0 && (
                              <div className="truncate text-[11px] text-muted-foreground">
                                {it.addons.map((a) => a.option_name).join(", ")}
                              </div>
                            )}
                            {it.notes && (
                              <div className="text-[11px] italic text-muted-foreground">Obs: {it.notes}</div>
                            )}
                          </div>
                          <button onClick={() => remove(it.key)} className="text-muted-foreground hover:text-destructive">
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        </div>
                        <div className="mt-2 flex items-center justify-between">
                          <div className="flex items-center gap-1 rounded-full bg-muted p-0.5">
                            <button onClick={() => dec(it.key)} className="flex h-6 w-6 items-center justify-center rounded-full bg-background">
                              <Minus className="h-3 w-3" />
                            </button>
                            <span className="w-6 text-center text-xs font-bold">{it.quantity}</span>
                            <button onClick={() => inc(it.key)} className="flex h-6 w-6 items-center justify-center rounded-full bg-primary text-primary-foreground">
                              <Plus className="h-3 w-3" />
                            </button>
                          </div>
                          <div className="text-sm font-bold">R$ {itemSubtotal(it).toFixed(2)}</div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <div className="space-y-3 border-t border-border bg-card p-4">
                {!appendToOrder && (
                  <>
                    <div className="grid grid-cols-3 gap-1.5">
                      {(["delivery", "pickup", "dine_in"] as ManualType[]).map((t) => {
                        const Icon = t === "delivery" ? Bike : t === "pickup" ? Store : Utensils;
                        const sel = orderType === t;
                        return (
                          <button
                            key={t}
                            type="button"
                            onClick={() => setOrderType(t)}
                            className={`flex flex-col items-center gap-1 rounded-lg border-2 px-2 py-2 text-[11px] font-semibold transition ${
                              sel ? "border-primary bg-primary/10 text-primary" : "border-border bg-background text-muted-foreground"
                            }`}
                          >
                            <Icon className="h-4 w-4" /> {TYPE_LABEL[t]}
                          </button>
                        );
                      })}
                    </div>

                    {orderType === "dine_in" && (
                      <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-2.5">
                        <Label className="text-[10px] font-semibold uppercase tracking-wider text-amber-700 dark:text-amber-300">
                          <Utensils className="mr-1 inline h-3 w-3" /> Número da mesa (opcional)
                        </Label>
                        <Input
                          value={tableNumber}
                          onChange={(e) => setTableNumber(e.target.value)}
                          placeholder="Ex: 5"
                          maxLength={20}
                          className="mt-1 h-9"
                        />
                        <p className="mt-1.5 text-[10px] text-muted-foreground">
                          Comanda fica aberta — você pode adicionar mais itens depois.
                        </p>
                      </div>
                    )}

                    {orderType === "delivery" && (
                      <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 p-2.5">
                        <Label className="text-[10px] font-semibold uppercase tracking-wider text-emerald-700 dark:text-emerald-300">
                          <Bike className="mr-1 inline h-3 w-3" /> Endereço de entrega <span className="text-rose-500">*</span>
                        </Label>
                        <div className="mt-2 space-y-2">
                          <div className="grid grid-cols-3 gap-2">
                            <Input
                              value={addressStreet}
                              onChange={(e) => setAddressStreet(e.target.value)}
                              placeholder="Rua"
                              className="col-span-2 h-9"
                            />
                            <Input
                              value={addressNumber}
                              onChange={(e) => {
                                const value = e.target.value.replace(/\D/g, '');
                                setAddressNumber(value);
                              }}
                              placeholder="Número"
                              className="h-9"
                            />
                          </div>
                          <Input
                            value={addressNeighborhood}
                            onChange={(e) => setAddressNeighborhood(e.target.value)}
                            placeholder="Bairro"
                            className="h-9"
                          />
                          <Input
                            value={addressComplement}
                            onChange={(e) => setAddressComplement(e.target.value)}
                            placeholder="Complemento (opcional)"
                            className="h-9"
                          />
                          <Input
                            value={addressZip}
                            onChange={(e) => {
                              let value = e.target.value.replace(/\D/g, '').slice(0, 8);
                              if (value.length > 5) {
                                value = value.replace(/(\d{5})(\d{3})/, '$1-$2');
                              }
                              setAddressZip(value);
                            }}
                            placeholder="CEP"
                            className="h-9"
                          />
                        </div>
                      </div>
                    )}

                    <div>
                      <Label className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                        <User className="mr-1 inline h-3 w-3" /> Cliente <span className="text-rose-500">*</span>
                      </Label>
                      <Input
                        value={customerName}
                        onChange={(e) => {
                          const value = e.target.value.replace(/[^a-zA-ZÀ-ú\s]/g, '');
                          setCustomerName(value);
                        }}
                        placeholder="Nome do cliente"
                        className="mt-1 h-9"
                        required
                      />
                    </div>

                    <Textarea
                      value={notes}
                      onChange={(e) => setNotes(e.target.value)}
                      rows={2}
                      placeholder="Observações (opcional)"
                      className="resize-none text-sm"
                    />
                  </>
                )}

                {orderType === "delivery" && finalDeliveryFee > 0 && (
                  <div className="flex items-center justify-between text-xs text-muted-foreground">
                    <span>Taxa de entrega:</span>
                    <span>R$ {finalDeliveryFee.toFixed(2)}</span>
                  </div>
                )}
                <div className="flex items-center justify-between border-t border-dashed border-border pt-2 text-sm">
                  <span className="font-semibold">{appendToOrder ? "A adicionar" : "Total"}</span>
                  <span className="text-lg font-bold text-primary">R$ {totalAmount.toFixed(2)}</span>
                </div>

                <Button
                  variant="cta"
                  className="w-full"
                  disabled={!cart.length || submitting}
                  onClick={finalize}
                >
                  {submitting
                    ? "Salvando..."
                    : appendToOrder
                    ? "Adicionar à comanda"
                    : orderType === "dine_in"
                    ? "Abrir comanda"
                    : "Finalizar pedido"}
                </Button>
              </div>
            </div>
          </div>
        </SheetContent>
      </Sheet>

      {/* Picker de adicionais quando produto tem grupos */}
      {productPicker && (
        <ProductAddonsPicker
          product={productPicker}
          onClose={() => setProductPicker(null)}
          onConfirm={(addons, qty, itemNotes) => {
            addProduct(productPicker, addons, qty, itemNotes);
            toast.success(`${productPicker.name} adicionado`);
            setProductPicker(null);
          }}
        />
      )}
    </>
  );
}

/* --- Picker de adicionais simplificado --- */
function ProductAddonsPicker({
  product,
  onClose,
  onConfirm,
}: {
  product: ProductLite;
  onClose: () => void;
  onConfirm: (addons: CartItemAddon[], qty: number, notes: string) => void;
}) {
  const [groups, setGroups] = useState<AddonGroup[] | null>(null);
  const [selected, setSelected] = useState<Record<string, Record<string, number>>>({});
  const [qty, setQty] = useState(1);
  const [notes, setNotes] = useState("");

  useEffect(() => {
    (async () => {
      const { data: gs } = await supabase
        .from("product_addon_groups")
        .select("*")
        .eq("product_id", product.id)
        .order("position");
      const productGroupIds = (gs || []).filter((g: any) => !g.library_group_id).map((g: any) => g.id);
      const libraryGroupIds = (gs || []).filter((g: any) => !!g.library_group_id).map((g: any) => g.library_group_id);
      const [{ data: po }, { data: lo }] = await Promise.all([
        productGroupIds.length
          ? supabase.from("product_addons").select("*").in("group_id", productGroupIds).eq("is_available", true).order("position")
          : Promise.resolve({ data: [] as any[] }),
        libraryGroupIds.length
          ? supabase.from("addon_library_options").select("*").in("library_group_id", libraryGroupIds).eq("is_available", true).order("position")
          : Promise.resolve({ data: [] as any[] }),
      ]);
      const built: AddonGroup[] = (gs || []).map((g: any) => {
        const opts = g.library_group_id
          ? (lo || []).filter((o: any) => o.library_group_id === g.library_group_id)
          : (po || []).filter((o: any) => o.group_id === g.id);
        return {
          id: g.id, name: g.name, selection_type: g.selection_type,
          is_required: g.is_required, max_selections: g.max_selections,
          options: opts.map((o: any) => ({
            id: o.id, name: o.name, price: Number(o.price) || 0,
            default_quantity: Number(o.default_quantity) || 1,
          })),
        };
      });
      setGroups(built);
    })();
  }, [product.id]);

  const updateQuantity = (g: AddonGroup, optId: string, delta: number) => {
    setSelected((cur) => {
      const groupSel = { ...(cur[g.id] || {}) };
      const currentQty = groupSel[optId] || 0;
      const newQty = Math.max(0, currentQty + delta);
      
      if (g.selection_type === "single") {
        // Para seleção única, sempre define como 1 ou 0
        return { ...cur, [g.id]: newQty > 0 ? { [optId]: 1 } : {} };
      }
      
      if (newQty === 0) {
        delete groupSel[optId];
      } else {
        // Verificar se não excede o máximo de seleções (considerando diferentes itens)
        const max = g.max_selections;
        const total = Object.keys(groupSel).length;
        if (max && total >= max && !groupSel[optId]) return cur;
        groupSel[optId] = newQty;
      }
      return { ...cur, [g.id]: groupSel };
    });
  };

  const toggle = (g: AddonGroup, optId: string) => {
    const currentQty = selected[g.id]?.[optId] || 0;
    if (currentQty > 0) {
      updateQuantity(g, optId, -currentQty); // Remove tudo
    } else {
      updateQuantity(g, optId, 1); // Adiciona 1
    }
  };

  const addonsOut: CartItemAddon[] = useMemo(() => {
    if (!groups) return [];
    const out: CartItemAddon[] = [];
    for (const g of groups) {
      const sel = selected[g.id] || {};
      for (const o of g.options) {
        if (sel[o.id]) {
          out.push({
            group_id: g.id, group_name: g.name, option_id: o.id,
            option_name: o.name, price: o.price, quantity: sel[o.id],
          });
        }
      }
    }
    return out;
  }, [groups, selected]);

  const missing = useMemo(() => {
    if (!groups) return false;
    return groups.some((g) => g.is_required && Object.keys(selected[g.id] || {}).length === 0);
  }, [groups, selected]);

  const totalPrice = (Number(product.price) + addonsOut.reduce((a, b) => a + b.price * b.quantity, 0)) * qty;

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[88vh] max-w-md overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{product.name}</DialogTitle>
        </DialogHeader>
        {!groups ? (
          <div className="flex justify-center py-8">
            <div className="h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent" />
          </div>
        ) : (
          <div className="space-y-4">
            {groups.map((g) => (
              <div key={g.id} className="rounded-lg border border-border p-3">
                <div className="mb-2 flex items-center justify-between">
                  <div className="font-semibold text-sm">
                    {g.name}
                    {g.is_required && <span className="ml-1 text-xs text-rose-500">*obrigatório</span>}
                  </div>
                  <span className="text-[11px] text-muted-foreground">
                    {g.selection_type === "single" ? "Escolha 1" : `Até ${g.max_selections || g.options.length}`}
                  </span>
                </div>
                <div className="space-y-1">
                  {g.options.map((o) => {
                    const qty = selected[g.id]?.[o.id] || 0;
                    const sel = qty > 0;
                    return (
                      <div
                        key={o.id}
                        className={`flex w-full items-center justify-between rounded-md border-2 px-2.5 py-1.5 text-sm transition ${
                          sel ? "border-primary bg-primary/10" : "border-border bg-background"
                        }`}
                      >
                        <button
                          type="button"
                          onClick={() => toggle(g, o.id)}
                          className="flex-1 text-left"
                        >
                          <span>{o.name}</span>
                          <span className="text-xs text-muted-foreground ml-2">
                            {o.price > 0 ? `+ R$ ${o.price.toFixed(2)}` : "Grátis"}
                          </span>
                        </button>
                        {sel && (
                          <div className="flex items-center gap-1 ml-2">
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                updateQuantity(g, o.id, -1);
                              }}
                              className="h-5 w-5 rounded-full border border-border bg-background hover:bg-muted flex items-center justify-center text-xs"
                            >
                              -
                            </button>
                            <span className="text-xs font-semibold min-w-[16px] text-center">{qty}</span>
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                updateQuantity(g, o.id, 1);
                              }}
                              className="h-5 w-5 rounded-full border border-border bg-background hover:bg-muted flex items-center justify-center text-xs"
                            >
                              +
                            </button>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}
            <Textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={2}
              placeholder="Observação para este item (opcional)"
              className="resize-none text-sm"
            />
            <div className="flex items-center gap-3">
              <div className="flex items-center gap-1 rounded-full bg-muted p-1">
                <button onClick={() => setQty((q) => Math.max(1, q - 1))} className="flex h-7 w-7 items-center justify-center rounded-full bg-background">
                  <Minus className="h-3 w-3" />
                </button>
                <span className="w-6 text-center text-sm font-bold">{qty}</span>
                <button onClick={() => setQty((q) => q + 1)} className="flex h-7 w-7 items-center justify-center rounded-full bg-primary text-primary-foreground">
                  <Plus className="h-3 w-3" />
                </button>
              </div>
              <Button
                variant="cta"
                className="flex-1"
                disabled={missing}
                onClick={() => onConfirm(addonsOut, qty, notes)}
              >
                Adicionar — R$ {totalPrice.toFixed(2)}
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
