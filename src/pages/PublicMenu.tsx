import { useEffect, useMemo, useRef, useState } from "react";
import { useParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import {
  Plus, Minus, ShoppingBag, ShoppingBasket, UtensilsCrossed,
  Search, Info, Clock, MapPin, Phone, X, Calendar, Bike, Store, Truck,
  CreditCard, Banknote, ChevronLeft, Pencil, Trash2, Check, Sparkles,
  AlertCircle, Gift, ChevronDown,
} from "lucide-react";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { getMenuTheme, MenuTheme } from "@/lib/menuThemes";
import { getCategoryIcon, getCategoryIconData } from "@/lib/categoryIcons";
import { CategoryIconView } from "@/components/menu/CategoryIconView";
import {
  BusinessHours, DAY_LABELS, DAY_ORDER, isOpenNow, normalizeBusinessHours,
} from "@/lib/businessHours";
import {
  AddonGroup, CartItem, CartItemAddon,
  CheckoutData, EMPTY_CHECKOUT, OrderType, PaymentMethod, ORDER_TYPE_LABEL, PAYMENT_LABEL,
  buildWhatsAppMessage, cartItemCount, cartSubtotal, itemSubtotal, itemUnitTotal, makeCartKey,
} from "@/lib/cart";
import {
  carregarCarrinho, salvarCarrinho, limparCarrinho, limparCarrinhoExpirado,
  carregarDadosCliente, salvarDadosCliente,
} from "@/lib/cartStorage";
import { toast } from "sonner";
import { SchedulingPicker } from "@/components/menu/SchedulingPicker";
import { PublicMenuSkeleton } from "@/components/PublicMenuSkeleton";

interface Product {
  id: string; name: string; description: string | null; price: number; image_url: string | null;
  category: string | null; category_id: string | null; position: number; is_available: boolean;
  price_from_enabled: boolean; price_from_value: number | null;
}
interface Category {
  id: string; name: string; icon: string; position: number;
}
interface Menu { id: string; name: string; cover_url: string | null; slug: string; }
interface Settings {
  logo_url: string | null; display_name: string | null; primary_color: string;
  layout_style: string; whatsapp_number: string | null;
  address: string | null; phone: string | null; opening_hours: string | null;
  delivery_time: string | null; is_open: boolean;
  business_hours: BusinessHours;
  accept_delivery: boolean;
  accept_pickup: boolean;
  accept_dine_in: boolean;
  delivery_fee: number;
  accept_scheduled?: boolean;
  scheduling_min_minutes?: number;
  scheduling_max_days?: number;
  birthday_promo_enabled?: boolean;
  birthday_promo_percent?: number;
}

const UNCATEGORIZED = "__uncategorized__";

const PublicMenu = () => {
  const { slug } = useParams();
  const [menu, setMenu] = useState<Menu | null>(null);
  const [products, setProducts] = useState<Product[]>([]);
  const [categoriesData, setCategoriesData] = useState<Category[]>([]);
  const [settings, setSettings] = useState<Settings | null>(null);

  // Atualizar título da aba dinamicamente com nome do cardápio
  useEffect(() => {
    if (menu?.name) {
      document.title = menu.name;
    } else {
      document.title = "FrodFast — Cardápio digital profissional para restaurantes";
    }
    
    // Cleanup: restaurar título original ao sair do cardápio
    return () => {
      document.title = "FrodFast — Cardápio digital profissional para restaurantes";
    };
  }, [menu?.name]);
  const [loading, setLoading] = useState(true);
  const [cart, setCart] = useState<CartItem[]>([]);
  const [cartHydrated, setCartHydrated] = useState(false);
  const [search, setSearch] = useState("");
  const [searchOpen, setSearchOpen] = useState(false);
  const [activeCategory, setActiveCategory] = useState<string>("");
  const [manualFilter, setManualFilter] = useState<string | null>(null);
  const userClickingRef = useRef<number>(0);
  const [flashProductId, setFlashProductId] = useState<string | null>(null);
  const sectionRefs = useRef<Record<string, HTMLDivElement | null>>({});

  useEffect(() => {
    const previousViewport = document.querySelector<HTMLMetaElement>('meta[name="viewport"]')?.content;
    const viewport = document.querySelector<HTMLMetaElement>('meta[name="viewport"]');
    viewport?.setAttribute("content", "width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no");

    const blockContextMenu = (event: MouseEvent) => event.preventDefault();
    const blockSourceShortcuts = (event: KeyboardEvent) => {
      const key = event.key.toLowerCase();
      if ((event.ctrlKey || event.metaKey) && ["u", "s", "p", "+", "-", "=", "0"].includes(key)) {
        event.preventDefault();
      }
    };
    const blockZoomWheel = (event: WheelEvent) => {
      if (event.ctrlKey || event.metaKey) event.preventDefault();
    };

    document.addEventListener("contextmenu", blockContextMenu);
    document.addEventListener("keydown", blockSourceShortcuts);
    document.addEventListener("wheel", blockZoomWheel, { passive: false });

    return () => {
      if (viewport && previousViewport) viewport.setAttribute("content", previousViewport);
      document.removeEventListener("contextmenu", blockContextMenu);
      document.removeEventListener("keydown", blockSourceShortcuts);
      document.removeEventListener("wheel", blockZoomWheel);
    };
  }, []);

  // Promoção de aniversário
  const [birthdayDiscount, setBirthdayDiscount] = useState(0);

  useEffect(() => {
    if (!slug || !settings?.birthday_promo_enabled || !settings.birthday_promo_percent) return;
    const customerId = localStorage.getItem(`customer_id_${slug}`);
    if (!customerId) return;
    (supabase as any)
      .from("menu_customers")
      .select("birth_date")
      .eq("id", customerId)
      .maybeSingle()
      .then(({ data }: any) => {
        if (!data?.birth_date) return;
        const today = new Date();
        const [, m, d] = (data.birth_date as string).split("-").map(Number);
        if (today.getMonth() + 1 === m && today.getDate() === d) {
          setBirthdayDiscount(settings.birthday_promo_percent ?? 10);
        }
      });
  }, [slug, settings?.birthday_promo_enabled, settings?.birthday_promo_percent]);

  // sheets / dialogs
  const [productSheet, setProductSheet] = useState<{ product: Product; editingKey?: string } | null>(null);
  const [cartOpen, setCartOpen] = useState(false);
  const [checkoutOpen, setCheckoutOpen] = useState(false);

  // adicionais por produto (cache: product_id -> AddonGroup[])
  const [addonsCache, setAddonsCache] = useState<Record<string, AddonGroup[]>>({});

  // Carrega/recarrega tudo do cardápio. Aceita um modo "silencioso"
  // para refresh em segundo plano (não pisca a tela com o spinner).
  const loadMenuData = async (opts?: { silent?: boolean }) => {
    if (!slug) {
      console.log("🔍 [PublicMenu] Slug não encontrado");
      return;
    }
    if (!opts?.silent) setLoading(true);
    
    console.log("🔍 [PublicMenu] Buscando cardápio com slug:", slug);
    
    const { data: m, error: menuError } = await supabase
      .from("menus")
      .select("*")
      .eq("slug", slug)
      .eq("is_active", true)
      .maybeSingle();
    
    console.log("🔍 [PublicMenu] Resultado da busca:", { data: m, error: menuError });
    
    if (!m || menuError) {
      console.log("❌ [PublicMenu] Cardápio não encontrado ou erro:", menuError);
      if (!opts?.silent) setLoading(false);
      return;
    }
    
    console.log("✅ [PublicMenu] Cardápio encontrado:", m.name, "ID:", m.id);
    setMenu(m as any);
    
    const [{ data: ps, error: productsError }, { data: s, error: settingsError }, { data: cs, error: categoriesError }] = await Promise.all([
      supabase.from("products").select("*").eq("menu_id", m.id).eq("is_available", true).order("position"),
      supabase.from("menu_settings").select("*").eq("menu_id", m.id).maybeSingle(),
      supabase.from("categories").select("*").eq("menu_id", m.id).order("position"),
    ]);
    
    console.log("🔍 [PublicMenu] Dados carregados:", {
      products: ps?.length || 0,
      productsError,
      settings: s ? "found" : "not found",
      settingsError,
      categories: cs?.length || 0,
      categoriesError
    });
    
    setProducts((ps || []) as any);
    setSettings(s ? { ...(s as any), business_hours: normalizeBusinessHours((s as any).business_hours) } : null);
    setCategoriesData((cs || []) as any);
    if (!opts?.silent) setLoading(false);
  };

  useEffect(() => {
    if (!slug) return;
    // Limpa qualquer carrinho expirado ao entrar
    limparCarrinhoExpirado(slug);
    // Hidrata carrinho persistido (24h)
    setCart(carregarCarrinho(slug));
    setCartHydrated(true);
    loadMenuData();
  }, [slug]);

  // Mantém o cardápio público sincronizado em tempo real: produtos
  // esgotando, mudança de preço, status do restaurante etc. — sem
  // precisar recarregar a página. Limpa o cache de adicionais para
  // refletir alterações ao reabrir um produto.
  const menuIdForRealtime = menu?.id;
  useEffect(() => {
    if (!menuIdForRealtime) return;
    let timer: number | undefined;
    const trigger = () => {
      if (timer) window.clearTimeout(timer);
      timer = window.setTimeout(() => {
        setAddonsCache({});
        loadMenuData({ silent: true });
      }, 400);
    };
    const ch = supabase
      .channel(`public-menu-rt-${menuIdForRealtime}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "products", filter: `menu_id=eq.${menuIdForRealtime}` }, trigger)
      .on("postgres_changes", { event: "*", schema: "public", table: "categories", filter: `menu_id=eq.${menuIdForRealtime}` }, trigger)
      .on("postgres_changes", { event: "*", schema: "public", table: "menu_settings", filter: `menu_id=eq.${menuIdForRealtime}` }, trigger)
      .on("postgres_changes", { event: "*", schema: "public", table: "menus", filter: `id=eq.${menuIdForRealtime}` }, trigger)
      .subscribe();

    const onVisible = () => { if (document.visibilityState === "visible") trigger(); };
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", trigger);
    window.addEventListener("online", trigger);

    return () => {
      if (timer) window.clearTimeout(timer);
      supabase.removeChannel(ch);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", trigger);
      window.removeEventListener("online", trigger);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [menuIdForRealtime]);

  // Persiste carrinho a cada mudança (após hidratação inicial)
  useEffect(() => {
    if (!slug || !cartHydrated) return;
    salvarCarrinho(slug, cart);
  }, [cart, slug, cartHydrated]);

  // Busca adicionais do produto sob demanda
  const loadAddons = async (productId: string): Promise<AddonGroup[]> => {
    if (addonsCache[productId]) return addonsCache[productId];
    const { data: groups } = await supabase
      .from("product_addon_groups")
      .select("*")
      .eq("product_id", productId)
      .order("position");
    const productGroupIds = (groups || []).filter((g: any) => !g.library_group_id).map((g: any) => g.id);
    const libraryGroupIds = (groups || []).filter((g: any) => !!g.library_group_id).map((g: any) => g.library_group_id);

    const [{ data: productOpts }, { data: libraryOpts }] = await Promise.all([
      productGroupIds.length
        ? supabase.from("product_addons").select("*").in("group_id", productGroupIds).eq("is_available", true).order("position")
        : Promise.resolve({ data: [] as any[] }),
      libraryGroupIds.length
        ? supabase.from("addon_library_options").select("*").in("library_group_id", libraryGroupIds).eq("is_available", true).order("position")
        : Promise.resolve({ data: [] as any[] }),
    ]);

    const built: AddonGroup[] = (groups || []).map((g: any) => {
      const opts = g.library_group_id
        ? (libraryOpts || []).filter((o: any) => o.library_group_id === g.library_group_id)
        : (productOpts || []).filter((o: any) => o.group_id === g.id);
      return {
        id: g.id,
        name: g.name,
        selection_type: g.selection_type,
        is_required: g.is_required,
        max_selections: g.max_selections,
        options: opts.map((o: any) => ({
          id: o.id,
          name: o.name,
          price: Number(o.price) || 0,
          default_quantity: Number(o.default_quantity) || 1,
        })),
      };
    });
    setAddonsCache((prev) => ({ ...prev, [productId]: built }));
    return built;
  };

  /* ===== Cart ops ===== */
  const addItemToCart = (
    product: Product,
    addons: CartItemAddon[],
    notes: string,
    quantity: number,
    replaceKey?: string,
  ) => {
    setCart((prev) => {
      let next = [...prev];
      if (replaceKey) {
        next = next.filter((it) => it.key !== replaceKey);
      }
      const key = makeCartKey(product.id, addons, notes);
      const existing = next.find((it) => it.key === key);
      if (existing) {
        return next.map((it) =>
          it.key === key ? { ...it, quantity: it.quantity + quantity } : it,
        );
      }
      return [
        ...next,
        {
          key,
          product_id: product.id,
          product_name: product.name,
          unit_price: Number(product.price) || 0,
          image_url: product.image_url,
          quantity,
          addons,
          notes,
        },
      ];
    });
    // Feedback visual rápido no card do produto
    setFlashProductId(product.id);
    window.setTimeout(() => setFlashProductId((cur) => (cur === product.id ? null : cur)), 600);
  };

  const incQty = (key: string) =>
    setCart((c) => c.map((it) => (it.key === key ? { ...it, quantity: it.quantity + 1 } : it)));
  const decQty = (key: string) =>
    setCart((c) =>
      c
        .map((it) => (it.key === key ? { ...it, quantity: it.quantity - 1 } : it))
        .filter((it) => it.quantity > 0),
    );
  const removeItem = (key: string) => setCart((c) => c.filter((it) => it.key !== key));

  const subtotal = useMemo(() => cartSubtotal(cart), [cart]);
  const totalItems = useMemo(() => cartItemCount(cart), [cart]);

  // produtos filtrados por busca
  const filteredProducts = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return products;
    return products.filter((p) =>
      p.name.toLowerCase().includes(q) ||
      (p.description || "").toLowerCase().includes(q)
    );
  }, [products, search]);

  // grupos: categorias cadastradas + "Outros" para órfãos
  const groups = useMemo(() => {
    const out: Array<{ id: string; name: string; icon: string; items: Product[] }> = [];
    categoriesData.forEach((c) => {
      const items = filteredProducts.filter((p) => p.category_id === c.id);
      if (items.length > 0) out.push({ id: c.id, name: c.name, icon: c.icon, items });
    });
    const orphans = filteredProducts.filter(
      (p) => !p.category_id || !categoriesData.find((c) => c.id === p.category_id),
    );
    if (orphans.length > 0) {
      out.push({ id: UNCATEGORIZED, name: "Outros", icon: "utensils", items: orphans });
    }
    return out;
  }, [categoriesData, filteredProducts]);

  // Quando os grupos carregarem, define a primeira categoria como ativa
  useEffect(() => {
    if (groups.length > 0 && !groups.find((g) => g.id === activeCategory)) {
      setActiveCategory(groups[0].id);
    }
  }, [groups, activeCategory]);

  // IntersectionObserver: atualiza a categoria ativa conforme o usuário rola
  useEffect(() => {
    // Só observa quando estamos mostrando todas as categorias (sem filtro manual).
    // Quando há filtro manual, a categoria ativa fica travada na escolhida.
    if (groups.length === 0 || manualFilter) return;
    const observer = new IntersectionObserver(
      (entries) => {
        // Ignora atualizações enquanto um clique acabou de disparar scroll programático
        if (Date.now() < userClickingRef.current) return;
        // Pega a seção mais visível no topo
        const visible = entries
          .filter((e) => e.isIntersecting)
          .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
        if (visible.length > 0) {
          const id = (visible[0].target as HTMLElement).dataset.categoryId;
          if (id) setActiveCategory(id);
        }
      },
      { rootMargin: "-180px 0px -60% 0px", threshold: 0 },
    );
    groups.forEach((g) => {
      const el = sectionRefs.current[g.id];
      if (el) observer.observe(el);
    });
    return () => observer.disconnect();
  }, [groups, manualFilter]);

  const scrollToCategory = (catId: string) => {
    setActiveCategory(catId);
    setManualFilter(catId); // ao clicar, filtra apenas essa categoria
    // Bloqueia o observer por ~800ms (duração aproximada do smooth scroll)
    userClickingRef.current = Date.now() + 800;
    // Aguarda o próximo frame para garantir que o DOM já renderizou só a seção filtrada
    requestAnimationFrame(() => {
      const el = sectionRefs.current[catId];
      if (el) {
        const top = el.getBoundingClientRect().top + window.scrollY - 160;
        window.scrollTo({ top, behavior: "smooth" });
      } else {
        window.scrollTo({ top: 0, behavior: "smooth" });
      }
    });
  };

  // O filtro manual permanece ativo até o usuário escolher outra categoria
  // ou limpar a busca — não é liberado ao rolar a tela.

  // Lista renderizada: tudo, ou apenas a categoria selecionada manualmente
  const visibleGroups = useMemo(
    () => (manualFilter ? groups.filter((g) => g.id === manualFilter) : groups),
    [groups, manualFilter],
  );

  if (loading) {
    return <PublicMenuSkeleton />;
  }
  if (!menu) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center bg-background p-6 text-center">
        <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-muted">
          <UtensilsCrossed className="h-8 w-8 text-muted-foreground" />
        </div>
        <h1 className="mt-5 text-2xl font-bold">Estabelecimento indisponível</h1>
        <p className="mt-2 max-w-md text-muted-foreground">
          Este cardápio não está disponível no momento. Se você é o dono do restaurante,
          adquira um plano para reativar seu cardápio.
        </p>
      </div>
    );
  }

  const theme = getMenuTheme(settings?.layout_style);
  const restaurantName = settings?.display_name || menu.name;
  const scheduledOpen = settings?.business_hours ? isOpenNow(settings.business_hours) : true;
  const manualOpen = settings?.is_open ?? true;
  const isOpen = manualOpen && scheduledOpen;
  const todayKey = DAY_ORDER[(new Date().getDay() + 6) % 7];

  // Quantidade total de um produto no carrinho (somando variações)
  const productQty = (productId: string) =>
    cart.filter((it) => it.product_id === productId).reduce((a, b) => a + b.quantity, 0);

  return (
    <div
      className="min-h-screen pb-32"
      style={{ background: theme.bg, color: theme.text, fontFamily: theme.fontFamily }}
    >
      {/* ===== COVER / HEADER ===== */}
      {menu.cover_url ? (
        <div className="relative w-full">
          {/* Mobile: only TOP corners rounded with a small top gap showing site bg.
              Image is full-width (flush with side edges); bottom is straight. */}
          <div className="relative w-full pt-3 sm:pt-0">
            <img
              src={menu.cover_url}
              alt={restaurantName}
              className="h-44 w-full object-cover rounded-t-3xl sm:h-56 sm:rounded-none md:h-72"
              loading="eager"
              decoding="async"
              fetchPriority="high"
            />
            <Dialog>
              <DialogTrigger asChild>
                <Button
                  aria-label="Informações da loja"
                  className="absolute right-5 top-5 flex h-10 w-10 items-center justify-center rounded-full bg-black/45 text-white backdrop-blur-sm transition hover:bg-black/60 sm:right-4 sm:top-4 p-0"
                  variant="ghost"
                >
                  <Info className="h-5 w-5" />
                </Button>
              </DialogTrigger>
              <DialogContent
                className="max-h-[92vh] max-w-md overflow-hidden border-0 p-0 sm:max-w-lg animate-in fade-in-0 zoom-in-95 duration-200"
                style={{ background: theme.surface, color: theme.text }}
              >
                <StoreInfoBody restaurantName={restaurantName} isOpen={isOpen} settings={settings} todayKey={todayKey} theme={theme} />
              </DialogContent>
            </Dialog>
          </div>
        </div>
      ) : (
        <header className="w-full" style={{ background: theme.accent, color: theme.accentText }}>
          <div className="container-app flex items-center justify-end py-3">
            <Dialog>
              <DialogTrigger asChild>
                <Button 
                  aria-label="Informações da loja" 
                  className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-white/15 transition hover:bg-white/25 p-0"
                  variant="ghost"
                >
                  <Info className="h-5 w-5" />
                </Button>
              </DialogTrigger>
              <DialogContent
                className="max-h-[92vh] max-w-md overflow-hidden border-0 p-0 sm:max-w-lg animate-in fade-in-0 zoom-in-95 duration-200"
                style={{ background: theme.surface, color: theme.text }}
              >
                <StoreInfoBody restaurantName={restaurantName} isOpen={isOpen} settings={settings} todayKey={todayKey} theme={theme} />
              </DialogContent>
            </Dialog>
          </div>
        </header>
      )}

      {/* ===== FAIXA DE STATUS (MARQUEE) ===== */}
      <StatusMarquee isOpen={isOpen} deliveryTime={settings?.delivery_time || null} />

      {/* ===== BANNER DE ANIVERSÁRIO ===== */}
      {birthdayDiscount > 0 && (
        <BirthdayBanner theme={theme} discount={birthdayDiscount} />
      )}

      {/* ===== BARRA DE BUSCA ===== */}
      <div className="container-app pt-4">
        <div className="relative">
          <Search
            className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2"
            style={{ color: theme.muted }}
          />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Buscar no cardápio…"
            className="h-11 w-full rounded-full pl-10 pr-10 text-sm outline-none transition focus:ring-2"
            style={{
              background: theme.surface,
              color: theme.text,
              border: `1px solid ${theme.border}`,
              ['--tw-ring-color' as any]: `${theme.accent}55`,
            }}
          />
          {search && (
            <button
              onClick={() => setSearch("")}
              aria-label="Limpar busca"
              className="absolute right-2 top-1/2 flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded-full transition hover:bg-black/5"
              style={{ color: theme.muted }}
            >
              <X className="h-4 w-4" />
            </button>
          )}
        </div>
      </div>

      {/* Barra sticky com chips de categoria */}
      <div className="sticky top-0 z-30 mt-4 shadow-sm backdrop-blur" style={{ background: `${theme.bg}EE`, borderBottom: `1px solid ${theme.border}` }}>
        {search && (
          <div className="container-app pt-2">
            <div
              className="flex items-center justify-between gap-2 rounded-full px-3 py-1.5 text-xs"
              style={{ background: theme.surface, color: theme.text, border: `1px solid ${theme.border}` }}
            >
              <span className="truncate">
                Buscando por <strong>"{search}"</strong>
              </span>
              <button
                onClick={() => setSearch("")}
                aria-label="Limpar busca"
                className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full"
                style={{ color: theme.muted }}
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>
        )}

        {groups.length > 0 && (
          <div className="container-app">
            <div className="flex gap-3 overflow-x-auto py-4 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
              {groups.map((g) => (
                <CategoryChip key={g.id} active={activeCategory === g.id} theme={theme} iconKey={g.icon} label={g.name} onClick={() => scrollToCategory(g.id)} />
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Dialog de busca (abre via lupa no header) */}
      <Dialog open={searchOpen} onOpenChange={setSearchOpen}>
        <DialogContent className="max-w-md gap-0 p-0">
          <DialogHeader className="border-b border-border px-5 py-4">
            <DialogTitle className="text-base">Buscar no cardápio</DialogTitle>
          </DialogHeader>
          <div className="p-4">
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <input
                autoFocus
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Digite o nome do produto…"
                className="h-11 w-full rounded-full border border-border bg-background pl-10 pr-10 text-sm outline-none focus:ring-2 focus:ring-primary/30"
              />
              {search && (
                <button
                  onClick={() => setSearch("")}
                  aria-label="Limpar"
                  className="absolute right-2 top-1/2 flex h-6 w-6 -translate-y-1/2 items-center justify-center rounded-full text-muted-foreground"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              )}
            </div>
            <div className="mt-3 flex items-center justify-end gap-2">
              <button
                onClick={() => { setSearch(""); setSearchOpen(false); }}
                className="rounded-full px-4 py-2 text-xs font-semibold text-muted-foreground hover:text-foreground"
              >
                Cancelar
              </button>
              <button
                onClick={() => setSearchOpen(false)}
                className="rounded-full bg-primary px-4 py-2 text-xs font-bold text-primary-foreground"
              >
                Aplicar
              </button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* ===== LISTA ===== */}
      <main className="container-app mt-6 space-y-10">
        {filteredProducts.length === 0 ? (
          <div className="rounded-xl border border-dashed p-12 text-center" style={{ borderColor: theme.border, color: theme.muted }}>
            {search ? "Nenhum produto encontrado para esta busca." : "Nenhum produto disponível no momento."}
          </div>
        ) : (
          visibleGroups.map((g) => {
            const catData = getCategoryIconData(g.icon);
            const CatIcon = catData.Icon;
            const hasCustom = !!catData.image;
            return (
              <section key={g.id} data-category-id={g.id} ref={(el: HTMLDivElement | null) => { sectionRefs.current[g.id] = el; }} className="scroll-mt-36">
                {/* Título separador da categoria */}
                <div className="mb-4 flex items-center gap-3">
                  {hasCustom ? (
                    <CategoryIconView iconKey={g.icon} size={36} className="shrink-0" />
                  ) : (
                    <div
                      className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl shadow-md"
                      style={{ background: theme.accent, color: theme.accentText }}
                    >
                      <CatIcon className="h-4.5 w-4.5" />
                    </div>
                  )}
                  <h2
                    className="text-sm font-extrabold uppercase tracking-wider"
                    style={{ color: theme.text }}
                  >
                    {g.name}
                  </h2>
                  <div
                    className="h-px flex-1"
                    style={{ background: `linear-gradient(to right, ${theme.accent}66, transparent)` }}
                  />
                </div>
                <div className="space-y-3 md:space-y-0 md:grid md:grid-cols-2 md:gap-5 lg:grid-cols-3 lg:gap-6 xl:grid-cols-4">
                  {g.items.map((p) => (
                    <ProductCard
                      key={p.id}
                      product={p}
                      theme={theme}
                      qty={productQty(p.id)}
                      flash={flashProductId === p.id}
                      birthdayDiscount={birthdayDiscount}
                      onClick={() => setProductSheet({ product: p })}
                    />
                  ))}
                </div>
              </section>
            );
          })
        )}
      </main>

      {/* ===== CARRINHO FAB (sempre visível) ===== */}
      {!checkoutOpen && (
        <button
          onClick={() => setCartOpen(true)}
          aria-label="Abrir carrinho"
          className="fixed bottom-5 left-1/2 z-40 flex h-16 w-16 -translate-x-1/2 items-center justify-center rounded-full shadow-2xl transition-transform hover:scale-105 active:scale-95 sm:bottom-6"
          style={{
            backgroundColor: theme.accent,
            color: theme.accentText,
            boxShadow: `0 12px 28px -8px ${theme.accent}AA, 0 4px 10px -4px rgba(0,0,0,0.25)`,
          }}
        >
          <ShoppingBasket className="h-7 w-7" strokeWidth={2.2} />
          {totalItems > 0 && (
            <>
              <span
                className="absolute -right-1 -top-1 flex h-6 min-w-6 items-center justify-center rounded-full px-1.5 text-[11px] font-extrabold ring-2 animate-scale-in"
                style={{
                  background: theme.bg,
                  color: theme.accent,
                  boxShadow: `0 2px 6px rgba(0,0,0,0.2)`,
                  ['--tw-ring-color' as any]: theme.accent,
                }}
              >
                {totalItems}
              </span>
              <span
                className="absolute -bottom-7 left-1/2 -translate-x-1/2 whitespace-nowrap rounded-full px-2.5 py-0.5 text-[11px] font-bold shadow-md"
                style={{ background: theme.accent, color: theme.accentText }}
              >
                R$ {subtotal.toFixed(2)}
              </span>
            </>
          )}
        </button>
      )}

      {/* ===== Sheet do carrinho ===== */}
      <Sheet open={cartOpen} onOpenChange={setCartOpen}>
        <SheetContent
          side="bottom"
          className="max-h-[92vh] overflow-y-auto rounded-t-2xl border-0 p-0 [&>button.absolute]:hidden"
          style={{ background: theme.surface, color: theme.text }}
        >
          <div className="sticky top-0 z-10 px-5 py-4" style={{ background: theme.surface, borderBottom: `1px solid ${theme.border}` }}>
            <SheetHeader>
              <SheetTitle style={{ color: theme.text }}>Seu pedido</SheetTitle>
            </SheetHeader>
          </div>

          {cart.length === 0 ? (
            <div className="px-5 py-10 text-center" style={{ color: theme.muted }}>
              Seu carrinho está vazio.
            </div>
          ) : (
            <div className="space-y-3 px-5 py-4">
              {cart.map((it) => (
                <CartLine
                  key={it.key}
                  item={it}
                  theme={theme}
                  onInc={() => incQty(it.key)}
                  onDec={() => decQty(it.key)}
                  onRemove={() => removeItem(it.key)}
                  onEdit={() => {
                    const p = products.find((x) => x.id === it.product_id);
                    if (p) {
                      setCartOpen(false);
                      setProductSheet({ product: p, editingKey: it.key });
                    }
                  }}
                />
              ))}
            </div>
          )}

          {cart.length > 0 && (
            <div className="sticky bottom-0 space-y-3 px-5 py-4" style={{ background: theme.surface, borderTop: `1px solid ${theme.border}` }}>
              <div className="flex items-center justify-between">
                <span className="text-sm" style={{ color: theme.muted }}>Subtotal</span>
                <span className="text-base font-bold">R$ {subtotal.toFixed(2)}</span>
              </div>
              {birthdayDiscount > 0 && (
                <div className="flex items-center justify-between">
                  <span className="flex items-center gap-1.5 text-sm font-semibold" style={{ color: "hsl(142 71% 38%)" }}>
                    🎂 Desconto aniversário ({birthdayDiscount}%)
                  </span>
                  <span className="text-sm font-bold" style={{ color: "hsl(142 71% 38%)" }}>
                    - R$ {(subtotal * birthdayDiscount / 100).toFixed(2)}
                  </span>
                </div>
              )}
              <button
                className="flex w-full items-center justify-center gap-2 rounded-full py-3.5 text-sm font-bold shadow-md transition active:scale-[0.98]"
                style={{ background: theme.accent, color: theme.accentText }}
                onClick={() => {
                  setCartOpen(false);
                  setCheckoutOpen(true);
                }}
              >
                Finalizar Pedido
              </button>
            </div>
          )}
        </SheetContent>
      </Sheet>

      {/* ===== Sheet do produto (com adicionais) ===== */}
      <Sheet open={!!productSheet} onOpenChange={(o) => !o && setProductSheet(null)}>
        <SheetContent
          side="bottom"
          className="max-h-[92vh] overflow-y-auto rounded-t-2xl border-0 p-0 [&_[data-radix-dialog-close]]:hidden"
          style={{ background: theme.surface, color: theme.text }}
        >
          {productSheet && (
            <ProductSheetBody
              key={productSheet.product.id + (productSheet.editingKey || "")}
              product={productSheet.product}
              theme={theme}
              loadAddons={loadAddons}
              existingItem={
                productSheet.editingKey
                  ? cart.find((it) => it.key === productSheet.editingKey)
                  : undefined
              }
              onClose={() => setProductSheet(null)}
              onConfirm={(addons, notes, qty) => {
                addItemToCart(productSheet.product, addons, notes, qty, productSheet.editingKey);
                setProductSheet(null);
              }}
            />
          )}
        </SheetContent>
      </Sheet>

      {/* ===== Sheet do checkout ===== */}
      <Sheet open={checkoutOpen} onOpenChange={setCheckoutOpen}>
        <SheetContent
          side="bottom"
          className="max-h-[95vh] overflow-y-auto rounded-t-2xl border-0 p-0"
          style={{ background: theme.surface, color: theme.text }}
        >
          {settings && menu && (
            <CheckoutFlow
              theme={theme}
              cart={cart}
              subtotal={subtotal}
              settings={settings}
              restaurantName={restaurantName}
              menuId={(menu as any).id}
              menuSlug={slug || ""}
              ownerUserId={(menu as any).user_id}
              birthdayDiscount={birthdayDiscount}
              onCancel={() => setCheckoutOpen(false)}
              onSent={() => {
                setCheckoutOpen(false);
                setCart([]);
                if (slug) limparCarrinho(slug);
              }}
            />
          )}
        </SheetContent>
      </Sheet>
    </div>
  );
};

/* ============= Componentes ============= */

/* ===== Banner de Aniversário ===== */
const BirthdayBanner = ({ theme, discount }: { theme: MenuTheme; discount: number }) => (
  <div className="container-app pt-4">
    <div
      className="relative overflow-hidden rounded-2xl px-5 py-4 animate-in fade-in-0 slide-in-from-top-3 duration-500"
      style={{
        background: `linear-gradient(135deg, ${theme.accent}22 0%, ${theme.accent}10 100%)`,
        border: `1.5px solid ${theme.accent}55`,
      }}
    >
      {/* Brilho decorativo */}
      <div
        className="pointer-events-none absolute -right-8 -top-8 h-32 w-32 rounded-full blur-3xl opacity-30"
        style={{ background: theme.accent }}
      />
      <div className="relative flex items-center gap-4">
        <div
          className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl shadow-md text-2xl"
          style={{ background: theme.accent }}
        >
          🎂
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
            <span className="text-base font-extrabold leading-tight" style={{ color: theme.text }}>
              Parabéns! Seu presente já está ativo
            </span>
            <span
              className="rounded-full px-2 py-0.5 text-[11px] font-extrabold uppercase tracking-wider"
              style={{ background: theme.accent, color: theme.accentText }}
            >
              {discount}% OFF
            </span>
          </div>
          <p className="mt-0.5 text-xs font-medium" style={{ color: theme.muted }}>
            Com preços promocionais automáticos em todo o pedido 🎉
          </p>
        </div>
      </div>
    </div>
  </div>
);

const StatusMarquee = ({ isOpen, deliveryTime }: { isOpen: boolean; deliveryTime: string | null }) => {
  const text = isOpen
    ? `Estabelecimento aberto${deliveryTime ? `  •  Tempo de entrega: ${deliveryTime}` : ""}`
    : "Este estabelecimento está fechado no momento";
  const items = Array.from({ length: 6 });
  return (
    <div
      className="w-full overflow-hidden py-2"
      style={{
        background: isOpen ? "hsl(142 71% 38%)" : "hsl(0 75% 50%)",
        color: "white",
      }}
      role="status"
      aria-live="polite"
    >
      <div className="flex w-max animate-marquee items-center whitespace-nowrap">
        {items.map((_, i) => (
          <span key={i} className="mx-6 inline-flex items-center gap-2 text-xs font-bold uppercase tracking-wider sm:text-sm">
            {isOpen && <Clock className="h-3.5 w-3.5" />}
            {text}
            <span className="opacity-60">•</span>
          </span>
        ))}
      </div>
    </div>
  );
};

const StoreInfoBody = ({
  restaurantName, isOpen, settings, todayKey, theme,
}: {
  restaurantName: string; isOpen: boolean; settings: Settings | null; todayKey: string; theme: MenuTheme;
}) => {
  const hours = settings?.business_hours;
  const todayLabel = DAY_LABELS[todayKey as keyof typeof DAY_LABELS]?.long || "";
  const todayHours = hours?.[todayKey as keyof BusinessHours];
  const statusColor = isOpen ? "hsl(142 71% 45%)" : "hsl(0 75% 55%)";

  const contactNumber = settings?.phone || settings?.whatsapp_number || "";
  const mapsUrl = settings?.address
    ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(settings.address)}`
    : null;

  return (
    <div className="flex max-h-[92vh] flex-col" style={{ background: theme.surface, color: theme.text }}>
      {/* Header */}
      <div
        className="relative px-6 pb-5 pt-7"
        style={{
          background: `linear-gradient(180deg, ${theme.bg} 0%, ${theme.surface} 100%)`,
          borderBottom: `1px solid ${theme.border}`,
        }}
      >
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0 flex-1">
            <h2 className="text-xl font-extrabold leading-tight tracking-tight" style={{ color: theme.text }}>
              {restaurantName}
            </h2>
            <div className="mt-2.5 inline-flex items-center gap-2 rounded-full px-3 py-1"
              style={{ background: `${statusColor}1F`, color: statusColor }}
            >
              <span className="relative flex h-2 w-2">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full opacity-60" style={{ background: statusColor }} />
                <span className="relative inline-flex h-2 w-2 rounded-full" style={{ background: statusColor }} />
              </span>
              <span className="text-[11px] font-bold uppercase tracking-wider">
                {isOpen ? "Aberto agora" : "Fechado"}
              </span>
            </div>
            {todayHours && (
              <p className="mt-2 text-xs" style={{ color: theme.muted }}>
                {todayHours.enabled
                  ? `Hoje (${todayLabel}) das ${todayHours.open} às ${todayHours.close}`
                  : `Hoje (${todayLabel}) sem atendimento`}
              </p>
            )}
          </div>
        </div>
      </div>

      {/* Body scroll */}
      <div className="flex-1 overflow-y-auto px-6 py-6">
        <div className="space-y-7">
          {/* Endereço */}
          {settings?.address && (
            <section>
              <SectionLabel theme={theme} icon={<MapPin className="h-3.5 w-3.5" />} label="Endereço" />
              <p className="mt-2 text-sm font-semibold leading-relaxed" style={{ color: theme.text }}>
                {settings.address}
              </p>
              {mapsUrl && (
                <a
                  href={mapsUrl}
                  target="_blank"
                  rel="noreferrer noopener"
                  className="mt-2 inline-flex items-center gap-1.5 text-xs font-bold underline-offset-4 hover:underline"
                  style={{ color: theme.accent }}
                >
                  Ver no mapa
                  <ChevronLeft className="h-3 w-3 rotate-180" />
                </a>
              )}
              <Divider theme={theme} />
            </section>
          )}

          {/* Tempo de entrega */}
          {settings?.delivery_time && (
            <section>
              <SectionLabel theme={theme} icon={<Clock className="h-3.5 w-3.5" />} label="Tempo de entrega" />
              <p className="mt-2 text-sm font-semibold" style={{ color: theme.text }}>
                Em média {settings.delivery_time}
              </p>
              <Divider theme={theme} />
            </section>
          )}

          {/* Contato */}
          {contactNumber && (
            <section>
              <SectionLabel theme={theme} icon={<Phone className="h-3.5 w-3.5" />} label="Contato" />
              <a
                href={`tel:${contactNumber.replace(/\D/g, "")}`}
                className="mt-2 inline-flex text-sm font-semibold transition hover:opacity-80"
                style={{ color: theme.text }}
              >
                {contactNumber}
              </a>
              <Divider theme={theme} />
            </section>
          )}

          {/* Horários da semana */}
          {hours && (
            <section>
              <SectionLabel theme={theme} icon={<Calendar className="h-3.5 w-3.5" />} label="Horários da semana" />
              <div className="mt-3 space-y-1">
                {DAY_ORDER.map((k) => {
                  const d = hours[k];
                  const isToday = k === todayKey;
                  const dayDot = d.enabled ? "hsl(142 71% 45%)" : "hsl(0 0% 50%)";
                  return (
                    <div
                      key={k}
                      className="flex items-center justify-between gap-3 rounded-lg px-3 py-2.5 text-sm transition"
                      style={
                        isToday
                          ? { background: `${theme.accent}14`, border: `1px solid ${theme.accent}33` }
                          : { background: "transparent", border: "1px solid transparent" }
                      }
                    >
                      <div className="flex items-center gap-2.5">
                        <span className="h-2 w-2 rounded-full" style={{ background: dayDot }} />
                        <span
                          className={isToday ? "font-bold" : "font-medium"}
                          style={{ color: isToday ? theme.text : theme.text, opacity: isToday ? 1 : 0.85 }}
                        >
                          {DAY_LABELS[k].long}
                        </span>
                        {isToday && (
                          <span
                            className="rounded-full px-2 py-0.5 text-[10px] font-extrabold uppercase tracking-wider"
                            style={{ background: theme.accent, color: theme.accentText }}
                          >
                            Hoje
                          </span>
                        )}
                      </div>
                      <span
                        className="font-medium tabular-nums"
                        style={{ color: d.enabled ? theme.text : theme.muted, opacity: d.enabled ? 0.95 : 0.7 }}
                      >
                        {d.enabled ? `${d.open} — ${d.close}` : "Fechado"}
                      </span>
                    </div>
                  );
                })}
              </div>
            </section>
          )}
        </div>
      </div>
    </div>
  );
};

const SectionLabel = ({ theme, icon, label }: { theme: MenuTheme; icon: React.ReactNode; label: string }) => (
  <div className="flex items-center gap-2" style={{ color: theme.muted }}>
    <span
      className="flex h-6 w-6 items-center justify-center rounded-md"
      style={{ background: `${theme.accent}1F`, color: theme.accent }}
    >
      {icon}
    </span>
    <span className="text-[10px] font-bold uppercase tracking-[0.14em]">{label}</span>
  </div>
);

const Divider = ({ theme }: { theme: MenuTheme }) => (
  <div className="mt-6 h-px w-full" style={{ background: theme.border, opacity: 0.5 }} />
);


const ProductCard = ({
  product, theme, qty, flash, birthdayDiscount, onClick,
}: {
  product: Product; theme: MenuTheme; qty: number; flash?: boolean; birthdayDiscount?: number; onClick: () => void;
}) => {
  const discount = birthdayDiscount ?? 0;
  const originalPrice = Number(product.price);
  const discountedPrice = discount > 0 ? originalPrice * (1 - discount / 100) : originalPrice;

  return (
    <button
      onClick={onClick}
      className={`group flex w-full items-stretch gap-3 overflow-hidden rounded-2xl border p-3 text-left shadow-sm transition-all duration-200 hover:-translate-y-0.5 hover:shadow-lg active:scale-[0.99] sm:gap-4 sm:p-4 ${flash ? "ring-2 ring-offset-2 animate-scale-in" : ""}`}
      style={{
        background: theme.surface,
        borderColor: discount > 0 ? `${theme.accent}55` : theme.border,
        ...(flash ? { boxShadow: `0 10px 24px -10px ${theme.accent}66` } : {}),
      }}
    >
      <div className="flex min-w-0 flex-1 flex-col">
        <h3 className="text-sm font-semibold leading-tight sm:text-base md:text-sm lg:text-base" style={{ color: theme.text }}>{product.name}</h3>
        {product.description && (
          <p className="mt-1 line-clamp-2 text-xs sm:text-sm md:text-xs lg:text-sm" style={{ color: theme.muted }}>{product.description}</p>
        )}
        <div className="mt-auto flex flex-wrap items-center justify-between gap-2 pt-3">
          {discount > 0 && !product.price_from_enabled ? (
            <div className="flex flex-col gap-0">
              <span className="text-[11px] font-medium line-through" style={{ color: theme.muted }}>
                R$ {originalPrice.toFixed(2)}
              </span>
              <span className="text-sm font-bold sm:text-base md:text-sm lg:text-base" style={{ color: theme.accent }}>
                R$ {discountedPrice.toFixed(2)}
              </span>
            </div>
          ) : (
            <span className="text-sm font-bold sm:text-base md:text-sm lg:text-base" style={{ color: theme.accent }}>
              {product.price_from_enabled && product.price_from_value
                ? `A partir de R$ ${Number(product.price_from_value).toFixed(2)}`
                : `R$ ${originalPrice.toFixed(2)}`}
            </span>
          )}
          <span
            className="inline-flex items-center gap-1 rounded-full px-3 py-1.5 text-xs font-bold shadow-sm transition group-hover:shadow-md group-active:scale-95 sm:px-3.5 sm:text-sm md:px-2.5 md:text-[11px] lg:px-3.5 lg:text-sm"
            style={{
              background: qty > 0 ? `${theme.accent}20` : theme.accent,
              color: qty > 0 ? theme.accent : theme.accentText,
            }}
          >
            {qty > 0 ? `${qty} no carrinho` : <><Plus className="h-3.5 w-3.5" /> Adicionar</>}
          </span>
        </div>
      </div>
      {product.image_url ? (
        <div className="aspect-square h-24 w-24 shrink-0 overflow-hidden rounded-xl sm:h-28 sm:w-28 md:h-20 md:w-20 lg:h-24 lg:w-24 xl:h-28 xl:w-28">
          <img
            src={product.image_url}
            alt={product.name}
            className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-105"
            loading="lazy"
            decoding="async"
          />
        </div>
      ) : (
        <div
          className="flex aspect-square h-24 w-24 shrink-0 items-center justify-center rounded-xl sm:h-28 sm:w-28 md:h-20 md:w-20 lg:h-24 lg:w-24 xl:h-28 xl:w-28"
          style={{ background: `${theme.accent}10` }}
        >
          <UtensilsCrossed className="h-7 w-7" style={{ color: theme.muted }} />
        </div>
      )}
    </button>
  );
};

const CategoryChip = ({
  active, theme, iconKey, label, onClick,
}: {
  active: boolean; theme: MenuTheme; iconKey: string; label: string; onClick: () => void;
}) => {
  const catData = getCategoryIconData(iconKey);
  const Icon = catData.Icon;
  const hasCustom = !!catData.image;
  return (
    <button
      onClick={onClick}
      className={`group flex w-24 shrink-0 flex-col items-center gap-2 rounded-2xl p-3 text-center transition-all duration-200 hover:-translate-y-0.5 active:scale-95 sm:w-28 ${active ? "scale-[1.02]" : ""}`}
      style={{
        background: theme.surface,
        border: `1px solid ${active ? theme.accent : theme.border}`,
        boxShadow: active
          ? `0 8px 20px -8px ${theme.accent}80, 0 0 0 2px ${theme.accent}`
          : `0 2px 6px -2px rgba(0,0,0,0.15)`,
      }}
    >
      {hasCustom ? (
        <div className="flex h-12 w-12 items-center justify-center transition-transform group-hover:scale-105 sm:h-14 sm:w-14">
          <CategoryIconView iconKey={iconKey} size={56} />
        </div>
      ) : (
        <div
          className="flex h-12 w-12 items-center justify-center rounded-xl shadow-md transition-transform group-hover:scale-105 sm:h-14 sm:w-14"
          style={{ background: theme.accent, color: theme.accentText }}
        >
          <Icon className="h-6 w-6 sm:h-7 sm:w-7" />
        </div>
      )}
      <span
        className="line-clamp-2 text-[11px] font-bold uppercase tracking-wider sm:text-xs"
        style={{ color: theme.text }}
      >
        {label}
      </span>
    </button>
  );
};

/* ===== Linha do carrinho ===== */
const CartLine = ({
  item, theme, onInc, onDec, onRemove, onEdit,
}: {
  item: CartItem; theme: MenuTheme;
  onInc: () => void; onDec: () => void; onRemove: () => void; onEdit: () => void;
}) => {
  const hasVariation = item.addons.length > 0 || item.notes.trim().length > 0;
  return (
    <div className="rounded-xl border p-3" style={{ borderColor: theme.border, background: theme.bg }}>
      <div className="flex items-start gap-3">
        {item.image_url ? (
          <img src={item.image_url} alt={item.product_name} className="h-14 w-14 shrink-0 rounded-lg object-cover" loading="lazy" decoding="async" />
        ) : (
          <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-lg" style={{ background: `${theme.accent}15` }}>
            <UtensilsCrossed className="h-5 w-5" style={{ color: theme.muted }} />
          </div>
        )}
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm font-semibold">{item.product_name}</div>
              <div className="text-xs font-bold" style={{ color: theme.accent }}>
                R$ {itemSubtotal(item).toFixed(2)}
              </div>
            </div>
            <button onClick={onRemove} className="shrink-0 rounded-md p-1" style={{ color: theme.muted }} aria-label="Remover">
              <Trash2 className="h-4 w-4" />
            </button>
          </div>

          {item.addons.length > 0 && (
            <ul className="mt-1 space-y-0.5 text-xs" style={{ color: theme.muted }}>
              {item.addons.map((a) => {
                const q = Math.max(1, a.quantity || 1);
                const total = Number(a.price) * q;
                return (
                  <li key={a.option_id}>
                    + {q > 1 ? `${q}x ` : ""}{a.option_name}
                    {a.price > 0 && <span> (R$ {total.toFixed(2)})</span>}
                  </li>
                );
              })}
            </ul>
          )}
          {item.notes.trim() && (
            <p className="mt-1 line-clamp-2 text-xs italic" style={{ color: theme.muted }}>
              Obs: {item.notes.trim()}
            </p>
          )}

          <div className="mt-2 flex items-center gap-2">
            <div className="flex items-center gap-1.5">
              <button onClick={onDec} className="flex h-8 w-8 items-center justify-center rounded-md border" style={{ borderColor: theme.border, color: theme.text }} aria-label="Diminuir">
                <Minus className="h-3.5 w-3.5" />
              </button>
              <span className="w-5 text-center text-sm font-semibold">{item.quantity}</span>
              <button onClick={onInc} className="flex h-8 w-8 items-center justify-center rounded-md" style={{ background: theme.accent, color: theme.accentText }} aria-label="Aumentar">
                <Plus className="h-3.5 w-3.5" />
              </button>
            </div>
            {hasVariation && (
              <button onClick={onEdit} className="ml-auto inline-flex items-center gap-1 text-xs font-semibold" style={{ color: theme.accent }}>
                <Pencil className="h-3 w-3" /> Editar
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

/* ===== Sheet do produto ===== */
function ProductSheetBody({
  product, theme, loadAddons, existingItem, onClose, onConfirm,
}: {
  product: Product;
  theme: MenuTheme;
  loadAddons: (id: string) => Promise<AddonGroup[]>;
  existingItem?: CartItem;
  onClose: () => void;
  onConfirm: (addons: CartItemAddon[], notes: string, qty: number) => void;
}) {
  const [addonGroups, setAddonGroups] = useState<AddonGroup[]>([]);
  const [loaded, setLoaded] = useState(false);
  // Mapa: groupId -> Map(optionId -> quantidade)
  const [selected, setSelected] = useState<Record<string, Map<string, number>>>({});
  const [notes, setNotes] = useState(existingItem?.notes || "");
  const [qty, setQty] = useState(existingItem?.quantity || 1);
  // Grupos colapsáveis: categorias com >5 adicionais ficam fechadas até o toque
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set());
  const toggleGroupExpand = (groupId: string) =>
    setExpandedGroups((prev) => {
      const next = new Set(prev);
      next.has(groupId) ? next.delete(groupId) : next.add(groupId);
      return next;
    });

  useEffect(() => {
    let cancelled = false;
    loadAddons(product.id).then((g) => {
      if (cancelled) return;
      setAddonGroups(g);
      const init: Record<string, Map<string, number>> = {};
      g.forEach((group) => {
        const map = new Map<string, number>();
        if (existingItem) {
          existingItem.addons
            .filter((a) => a.group_id === group.id)
            .forEach((a) => map.set(a.option_id, Math.max(1, a.quantity || 1)));
        }
        init[group.id] = map;
      });
      setSelected(init);
      setLoaded(true);
    });
    return () => { cancelled = true; };
  }, [product.id]);

  const toggleOption = (group: AddonGroup, optionId: string, defaultQty = 1) => {
    setSelected((prev) => {
      const next = { ...prev };
      const cur = new Map(next[group.id] || []);
      if (group.selection_type === "single") {
        cur.clear();
        cur.set(optionId, Math.max(1, defaultQty));
      } else {
        if (cur.has(optionId)) {
          cur.delete(optionId);
        } else {
          if (group.max_selections && cur.size >= group.max_selections) return prev;
          cur.set(optionId, Math.max(1, defaultQty));
        }
      }
      next[group.id] = cur;
      return next;
    });
  };

  const setOptionQty = (groupId: string, optionId: string, delta: number) => {
    setSelected((prev) => {
      const next = { ...prev };
      const cur = new Map(next[groupId] || []);
      const currentQty = cur.get(optionId);
      if (currentQty === undefined) return prev;
      const newQty = currentQty + delta;
      if (newQty <= 0) {
        cur.delete(optionId);
      } else {
        cur.set(optionId, newQty);
      }
      next[groupId] = cur;
      return next;
    });
  };

  const selectedAddons: CartItemAddon[] = useMemo(() => {
    const out: CartItemAddon[] = [];
    addonGroups.forEach((g) => {
      const map = selected[g.id];
      if (!map) return;
      g.options.forEach((o) => {
        const q = map.get(o.id);
        if (q && q > 0) {
          out.push({
            group_id: g.id,
            group_name: g.name,
            option_id: o.id,
            option_name: o.name,
            price: o.price,
            quantity: q,
          });
        }
      });
    });
    return out;
  }, [addonGroups, selected]);

  const unitPrice =
    Number(product.price) +
    selectedAddons.reduce((a, b) => a + Number(b.price) * Math.max(1, b.quantity || 1), 0);
  const totalPrice = unitPrice * qty;

  const missingRequired = addonGroups.find(
    (g) => g.is_required && (selected[g.id]?.size ?? 0) === 0,
  );

  // Regra: produtos com "a partir de" devem escolher pelo menos 1 adicional
  const hasPriceFrom = product.price_from_enabled && product.price_from_value;
  const hasSelectedAnyAddon = selectedAddons.length > 0;
  const missingAddonForPriceFrom = hasPriceFrom && !hasSelectedAnyAddon;

  const confirm = () => {
    if (missingRequired || missingAddonForPriceFrom) return;
    onConfirm(selectedAddons, notes, qty);
  };

  return (
    <div className="flex flex-col">
      {/* Header com imagem */}
      <div className="relative">
        {product.image_url ? (
          <img src={product.image_url} alt={product.name} className="h-44 w-full object-cover sm:h-56" loading="lazy" decoding="async" />
        ) : (
          <div className="flex h-44 w-full items-center justify-center sm:h-56" style={{ background: `${theme.accent}15` }}>
            <UtensilsCrossed className="h-10 w-10" style={{ color: theme.muted }} />
          </div>
        )}
        <button
          onClick={onClose}
          aria-label="Fechar"
          className="absolute right-3 top-3 flex h-9 w-9 items-center justify-center rounded-full bg-black/50 text-white backdrop-blur-sm"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      <div className="px-5 py-4">
        <h2 className="text-lg font-bold leading-tight" style={{ color: theme.text }}>{product.name}</h2>
        {product.description && (
          <p className="mt-1 text-sm" style={{ color: theme.muted }}>{product.description}</p>
        )}
        <div className="mt-2 text-base font-bold" style={{ color: theme.accent }}>
          {product.price_from_enabled && product.price_from_value
            ? `A partir de R$ ${Number(product.price_from_value).toFixed(2)}`
            : `R$ ${Number(product.price).toFixed(2)}`}
        </div>
      </div>

      {!loaded ? (
        <div className="px-5 py-4 text-sm" style={{ color: theme.muted }}>Carregando opções…</div>
      ) : (
        <div className="space-y-5 px-5 pb-4">
          {addonGroups.map((g) => {
            const sel = selected[g.id] || new Map<string, number>();
            const isCollapsible = g.options.length > 5;
            const isExpanded = expandedGroups.has(g.id);
            const showOptions = !isCollapsible || isExpanded;
            return (
              <div key={g.id}>
                <div
                  className="mb-2 flex items-center justify-between"
                  style={isCollapsible ? { cursor: "pointer" } : undefined}
                  onClick={isCollapsible ? () => toggleGroupExpand(g.id) : undefined}
                >
                  <div>
                    <div className="text-sm font-bold" style={{ color: theme.text }}>{g.name}</div>
                    {showOptions ? (
                      <div className="text-[11px]" style={{ color: theme.muted }}>
                        {g.selection_type === "single"
                          ? "Escolha 1"
                          : g.max_selections
                          ? `Escolha até ${g.max_selections}`
                          : "Selecione quantos quiser"}
                        {g.is_required && " · obrigatório"}
                      </div>
                    ) : (
                      <div className="text-[11px] font-semibold" style={{ color: theme.accent }}>
                        Clique para escolher
                      </div>
                    )}
                  </div>
                  <div className="flex items-center gap-2">
                    {g.is_required && sel.size === 0 && (
                      <span className="rounded-full bg-destructive/15 px-2 py-0.5 text-[10px] font-bold uppercase text-destructive">
                        Obrigatório
                      </span>
                    )}
                    {isCollapsible && (
                      <ChevronDown
                        className="h-4 w-4 transition-transform duration-200"
                        style={{
                          color: theme.muted,
                          transform: isExpanded ? "rotate(180deg)" : "rotate(0deg)",
                        }}
                      />
                    )}
                  </div>
                </div>
                {showOptions && (
                  <div className="space-y-2">
                    {g.options.map((o) => {
                      const optQty = sel.get(o.id) || 0;
                      const checked = optQty > 0;
                      const showQuantityControls = checked && g.selection_type === "multiple";
                      return (
                        <div
                          key={o.id}
                          className="flex items-center justify-between gap-3 rounded-lg border p-3 transition"
                          style={{
                            borderColor: checked ? theme.accent : theme.border,
                            background: checked ? `${theme.accent}10` : theme.bg,
                          }}
                        >
                          <label className="flex flex-1 cursor-pointer items-center gap-3">
                            <input
                              type={g.selection_type === "single" ? "radio" : "checkbox"}
                              name={`g-${g.id}`}
                              checked={checked}
                              onChange={() => toggleOption(g, o.id, o.default_quantity || 1)}
                              className="accent-current"
                              style={{ accentColor: theme.accent }}
                            />
                            <span className="text-sm">{o.name}</span>
                            {o.price > 0 && (
                              <span className="text-xs font-semibold" style={{ color: theme.accent }}>
                                +R$ {o.price.toFixed(2)}
                              </span>
                            )}
                          </label>
                          {showQuantityControls && (
                            <div
                              className="flex items-center gap-1.5 rounded-full p-0.5"
                              style={{ background: `${theme.accent}1F` }}
                            >
                              <button
                                type="button"
                                onClick={() => setOptionQty(g.id, o.id, -1)}
                                className="flex h-7 w-7 items-center justify-center rounded-full"
                                style={{ background: theme.surface, color: theme.text, border: `1px solid ${theme.border}` }}
                                aria-label="Diminuir"
                              >
                                <Minus className="h-3 w-3" />
                              </button>
                              <span className="w-5 text-center text-xs font-bold tabular-nums" style={{ color: theme.text }}>
                                {optQty}
                              </span>
                              <button
                                type="button"
                                onClick={() => setOptionQty(g.id, o.id, +1)}
                                className="flex h-7 w-7 items-center justify-center rounded-full"
                                style={{ background: theme.accent, color: theme.accentText }}
                                aria-label="Aumentar"
                              >
                                <Plus className="h-3 w-3" />
                              </button>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}

          <div>
            <div className="mb-1 text-sm font-bold" style={{ color: theme.text }}>Observações</div>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Ex: sem cebola, ponto da carne…"
              rows={3}
              className="w-full rounded-lg p-3 text-sm outline-none"
              style={{ background: theme.bg, border: `1px solid ${theme.border}`, color: theme.text }}
            />
          </div>
        </div>
      )}

      {/* Footer */}
      <div className="sticky bottom-0 flex items-center gap-3 px-5 py-4" style={{ background: theme.surface, borderTop: `1px solid ${theme.border}` }}>
        <div className="flex items-center gap-1.5 rounded-full p-1" style={{ background: `${theme.accent}15` }}>
          <button
            onClick={() => setQty((q) => Math.max(1, q - 1))}
            className="flex h-8 w-8 items-center justify-center rounded-full"
            style={{ background: theme.surface, color: theme.text, border: `1px solid ${theme.border}` }}
            aria-label="Diminuir"
          >
            <Minus className="h-3.5 w-3.5" />
          </button>
          <span className="w-6 text-center text-sm font-bold">{qty}</span>
          <button
            onClick={() => setQty((q) => q + 1)}
            className="flex h-8 w-8 items-center justify-center rounded-full"
            style={{ background: theme.accent, color: theme.accentText }}
            aria-label="Aumentar"
          >
            <Plus className="h-3.5 w-3.5" />
          </button>
        </div>
        <button
          onClick={confirm}
          disabled={!!missingRequired || missingAddonForPriceFrom}
          className="flex flex-1 items-center justify-between gap-2 rounded-full px-4 py-3 text-sm font-bold transition active:scale-[0.98] disabled:opacity-50"
          style={{ background: theme.accent, color: theme.accentText }}
        >
          <span>{existingItem ? "Atualizar" : "Adicionar"}</span>
          <span>R$ {totalPrice.toFixed(2)}</span>
        </button>
      </div>
    </div>
  );
}

/* ===== Checkout ===== */
function CheckoutFlow({
  theme, cart, subtotal, settings, restaurantName, menuId, menuSlug, ownerUserId, birthdayDiscount, onCancel, onSent,
}: {
  theme: MenuTheme;
  cart: CartItem[];
  subtotal: number;
  settings: Settings;
  restaurantName: string;
  menuId: string;
  menuSlug: string;
  ownerUserId: string;
  birthdayDiscount: number;
  onCancel: () => void;
  onSent: () => void;
}) {
  const availableTypes: OrderType[] = [];
  if (settings.accept_delivery) availableTypes.push("delivery");
  if (settings.accept_pickup) availableTypes.push("pickup");
  if (settings.accept_dine_in) availableTypes.push("dine_in");

  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [submitting, setSubmitting] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  const [orderError, setOrderError] = useState<string | null>(null);
  const [data, setData] = useState<CheckoutData>(() => {
    const saved = carregarDadosCliente();
    return {
      ...EMPTY_CHECKOUT,
      orderType: availableTypes[0] || "delivery",
      customerName: saved?.customerName || "",
      customerPhone: saved?.customerPhone || "",
      address: saved?.address || EMPTY_CHECKOUT.address,
    };
  });

  // Persiste dados do cliente (nome, telefone, endereço) — nunca o troco.
  useEffect(() => {
    salvarDadosCliente({
      customerName: data.customerName,
      customerPhone: data.customerPhone,
      address: data.address,
    });
  }, [data.customerName, data.customerPhone, data.address]);

  const [birthDate, setBirthDate] = useState("");

  const deliveryFee = data.orderType === "delivery" ? Number(settings.delivery_fee || 0) : 0;
  const discountAmount = birthdayDiscount > 0 ? Math.round(subtotal * birthdayDiscount) / 100 : 0;
  const total = subtotal - discountAmount + deliveryFee;

  const next = () => setStep((s) => (s === 3 ? 3 : ((s + 1) as any)));
  const prev = () => (step === 1 ? onCancel() : setStep((s) => ((s - 1) as any)));

  const canStep1 =
    !!data.orderType &&
    availableTypes.includes(data.orderType) &&
    (!settings.accept_scheduled || !data.scheduledFor || data.scheduledFor.getTime() > Date.now());
  const canStep2 =
    !!data.payment &&
    (data.payment !== "cash" || !data.needsChange || (!!data.changeFor && Number(data.changeFor) > 0));
  const canStep3 =
    data.customerName.trim().length > 1 &&
    data.customerPhone.replace(/\D/g, "").length >= 10 &&
    (data.orderType !== "delivery" ||
      (data.address.street.trim() &&
        data.address.number.trim() &&
        data.address.neighborhood.trim()));

  const canContinue = step === 1 ? canStep1 : step === 2 ? canStep2 : canStep3;

  const friendlyOrderError = (error: any) => {
    const raw = String(error?.message || error?.details || error || "");
    const normalized = raw.toLowerCase();

    if (normalized.includes("row-level security") || normalized.includes("policy")) {
      return "Não conseguimos registrar o pedido agora. Atualize a página e tente novamente.";
    }
    if (normalized.includes("not available") || normalized.includes("não está mais disponível") || normalized.includes("carrinho")) {
      return raw.replace(/^error:\s*/i, "");
    }
    if (normalized.includes("network") || normalized.includes("failed to fetch")) {
      return "Sua conexão falhou por alguns segundos. Confira a internet e tente enviar novamente.";
    }
    return "Não foi possível enviar seu pedido agora. Revise os dados e tente novamente.";
  };

  const sendOrder = async () => {
    if (submitting) return;
    setSubmitting(true);
    setOrderError(null);

    // Mensagem estruturada (uso interno / impressão / log)
    const message = buildWhatsAppMessage({
      restaurantName, items: cart, checkout: data, subtotal, deliveryFee, total,
    });

    try {
      if (!menuId || !ownerUserId) {
        throw new Error("Restaurante não identificado. Recarregue a página e tente novamente.");
      }
      const addressTxt =
        data.orderType === "delivery"
          ? `${data.address.street}, ${data.address.number} — ${data.address.neighborhood}${data.address.complement ? ` (${data.address.complement})` : ""}${data.address.zip ? ` · CEP ${data.address.zip}` : ""}`
          : null;

      // Observação geral do pedido removida da UI — apenas tipo/pagamento/mensagem
      // estruturada continuam sendo anexados como histórico interno.
      const notesTxt = [
        `Pagamento: ${PAYMENT_LABEL[data.payment]}`,
        birthdayDiscount > 0 ? `Desconto aniversário: ${birthdayDiscount}% (-R$ ${discountAmount.toFixed(2)})` : null,
        `__msg__: ${message}`,
      ].filter(Boolean).join(" · ");

      const items = cart.map((it) => ({
        product_id: it.product_id,
        product_name: it.product_name, // LIMPO - sem concatenação de addons
        quantity: it.quantity,
        unit_price: itemUnitTotal(it),
        subtotal: itemSubtotal(it),
        notes: it.notes?.trim() ? it.notes.trim() : null,
        addons: it.addons.map((addon) => ({
          group_id: addon.group_id,
          group_name: addon.group_name,
          option_id: addon.option_id,
          option_name: addon.option_name,
          price: addon.price,
          quantity: addon.quantity
        })), // Estrutura preservada - sem cast inseguro
      }));

      const { data: orderId, error: orderErr } = await (supabase as any).rpc("create_public_menu_order", {
        _menu_id: menuId,
        _user_id: ownerUserId,
        _customer_name: data.customerName.trim(),
        _customer_phone: data.customerPhone.trim(),
        _customer_address: addressTxt,
        _total_amount: total,
        _notes: notesTxt,
        _order_type: data.orderType,
        _is_scheduled: !!data.scheduledFor,
        _scheduled_for: data.scheduledFor ? data.scheduledFor.toISOString() : null,
        _items: items,
      });

      if (orderErr || !orderId) {
        console.error("[PublicMenu] create_public_menu_order failed:", orderErr);
        throw orderErr || new Error("Falha ao registrar o pedido");
      }

      // Dispara mensagem WhatsApp de confirmação (silencioso — só envia se dono tiver configurado)
      supabase.functions.invoke("whatsapp-notify-order", {
        body: { order_id: orderId, status: "new" },
      }).catch(() => {});

      // Cadastra/atualiza cliente para detecção futura de aniversário
      if (birthDate && menuSlug) {
        (supabase as any)
          .from("menu_customers")
          .upsert(
            {
              menu_id: menuId,
              name: data.customerName.trim(),
              phone: data.customerPhone.trim(),
              birth_date: birthDate,
              updated_at: new Date().toISOString(),
            },
            { onConflict: "menu_id,phone" },
          )
          .select("id")
          .maybeSingle()
          .then(({ data: customer }: any) => {
            if (customer?.id) {
              localStorage.setItem(`customer_id_${menuSlug}`, customer.id);
            }
          })
          .catch(() => {});
      }

      // Sucesso → segue para tela de confirmação
      setSubmitting(false);
      setConfirmed(true);
    } catch (e: any) {
      console.error("[PublicMenu] sendOrder error:", e);
      const message = friendlyOrderError(e);
      setOrderError(message);
      toast.error(message);
      setSubmitting(false);
    }
  };

  // Tela de confirmação após pedido enviado
  if (confirmed) {
    return (
      <OrderConfirmation
        theme={theme}
        deliveryTime={settings.delivery_time}
        onClose={onSent}
      />
    );
  }


  return (
    <div className="flex flex-col">
      {/* Header */}
      <div className="sticky top-0 z-10 flex items-center gap-3 px-5 py-4" style={{ background: theme.surface, borderBottom: `1px solid ${theme.border}` }}>
        <button onClick={prev} aria-label="Voltar" className="flex h-9 w-9 items-center justify-center rounded-full" style={{ color: theme.text }}>
          <ChevronLeft className="h-5 w-5" />
        </button>
        <div className="flex-1">
          <div className="text-xs font-semibold uppercase tracking-wide" style={{ color: theme.muted }}>
            Etapa {step} de 3
          </div>
          <div className="text-base font-bold" style={{ color: theme.text }}>
            {step === 1 && "Tipo de pedido"}
            {step === 2 && "Forma de pagamento"}
            {step === 3 && "Dados para finalizar"}
          </div>
        </div>
      </div>

      <div className="space-y-5 px-5 py-5">
        {step === 1 && (
          <>
            {availableTypes.length === 0 ? (
              <div className="rounded-xl border border-dashed p-8 text-center text-sm" style={{ borderColor: theme.border, color: theme.muted }}>
                O restaurante não configurou nenhum tipo de pedido.
              </div>
            ) : (
              <div className="space-y-2.5">
                {availableTypes.includes("delivery") && (
                  <OrderTypeOption
                    theme={theme}
                    icon={<Bike className="h-5 w-5" />}
                    title="Entrega"
                    description={settings.delivery_fee > 0 ? `Taxa R$ ${Number(settings.delivery_fee).toFixed(2)}` : "Entrega gratuita"}
                    selected={data.orderType === "delivery"}
                    onClick={() => setData({ ...data, orderType: "delivery" })}
                  />
                )}
                {availableTypes.includes("pickup") && (
                  <OrderTypeOption
                    theme={theme}
                    icon={<Store className="h-5 w-5" />}
                    title="Retirada"
                    description="Buscar no balcão"
                    selected={data.orderType === "pickup"}
                    onClick={() => setData({ ...data, orderType: "pickup" })}
                  />
                )}
                {availableTypes.includes("dine_in") && (
                  <OrderTypeOption
                    theme={theme}
                    icon={<Truck className="h-5 w-5" />}
                    title="Comer no local"
                    description="Consumo no salão"
                    selected={data.orderType === "dine_in"}
                    onClick={() => setData({ ...data, orderType: "dine_in" })}
                  />
                )}
              </div>
            )}

            {/* Agendamento (opcional, só aparece se o restaurante permitir) */}
            {settings.accept_scheduled && availableTypes.length > 0 && (
              <div
                className="rounded-2xl border p-4"
                style={{ borderColor: theme.border, background: theme.surface }}
              >
                <div className="mb-3 flex items-center gap-2">
                  <Calendar className="h-4 w-4" style={{ color: theme.accent }} />
                  <span className="text-sm font-bold" style={{ color: theme.text }}>
                    Quando?
                  </span>
                </div>
                <div className="mb-3 grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => setData({ ...data, scheduledFor: null })}
                    className="rounded-xl border-2 px-3 py-2 text-sm font-semibold transition"
                    style={{
                      borderColor: !data.scheduledFor ? theme.accent : theme.border,
                      background: !data.scheduledFor ? `${theme.accent}15` : theme.bg,
                      color: theme.text,
                    }}
                  >
                    Assim que possível
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      // Marca como "modo agendar" usando uma data placeholder no futuro
                      // (o picker substitui com a escolha real)
                      if (!data.scheduledFor) {
                        const placeholder = new Date(
                          Date.now() + (settings.scheduling_min_minutes ?? 30) * 60_000,
                        );
                        setData({ ...data, scheduledFor: placeholder });
                      }
                    }}
                    className="rounded-xl border-2 px-3 py-2 text-sm font-semibold transition"
                    style={{
                      borderColor: data.scheduledFor ? theme.accent : theme.border,
                      background: data.scheduledFor ? `${theme.accent}15` : theme.bg,
                      color: theme.text,
                    }}
                  >
                    Agendar
                  </button>
                </div>
                {data.scheduledFor && (
                  <SchedulingPicker
                    businessHours={settings.business_hours}
                    minMinutes={settings.scheduling_min_minutes ?? 30}
                    maxDays={settings.scheduling_max_days ?? 7}
                    value={data.scheduledFor}
                    onChange={(d) => setData({ ...data, scheduledFor: d })}
                    accentColor={theme.accent}
                    textColor={theme.text}
                    surfaceColor={theme.surface}
                    borderColor={theme.border}
                    mutedColor={theme.muted}
                    bgColor={theme.bg}
                  />
                )}
              </div>
            )}
          </>
        )}

        {step === 2 && (
          <div className="space-y-3">
            <PaymentOption
              theme={theme}
              icon={<Banknote className="h-5 w-5" />}
              title="Dinheiro"
              selected={data.payment === "cash"}
              onClick={() => setData({ ...data, payment: "cash" })}
            />
            <PaymentOption
              theme={theme}
              icon={<CreditCard className="h-5 w-5" />}
              title="Cartão de Crédito"
              selected={data.payment === "credit"}
              onClick={() => setData({ ...data, payment: "credit", needsChange: false, changeFor: "" })}
            />
            <PaymentOption
              theme={theme}
              icon={<CreditCard className="h-5 w-5" />}
              title="Cartão de Débito"
              selected={data.payment === "debit"}
              onClick={() => setData({ ...data, payment: "debit", needsChange: false, changeFor: "" })}
            />

            {data.payment === "cash" && (
              <div className="rounded-xl border p-4" style={{ borderColor: theme.border, background: theme.bg }}>
                <div className="text-sm font-semibold" style={{ color: theme.text }}>Precisa de troco?</div>
                <div className="mt-2 grid grid-cols-2 gap-2">
                  <button
                    onClick={() => setData({ ...data, needsChange: false, changeFor: "" })}
                    className="rounded-lg py-2 text-sm font-semibold"
                    style={{
                      background: !data.needsChange ? theme.accent : theme.surface,
                      color: !data.needsChange ? theme.accentText : theme.text,
                      border: `1px solid ${theme.border}`,
                    }}
                  >Não preciso</button>
                  <button
                    onClick={() => setData({ ...data, needsChange: true })}
                    className="rounded-lg py-2 text-sm font-semibold"
                    style={{
                      background: data.needsChange ? theme.accent : theme.surface,
                      color: data.needsChange ? theme.accentText : theme.text,
                      border: `1px solid ${theme.border}`,
                    }}
                  >Sim, troco para</button>
                </div>
                {data.needsChange && (
                  <div className="mt-3">
                    <label className="text-xs font-semibold" style={{ color: theme.muted }}>Troco para quanto? (R$)</label>
                    <input
                      type="number"
                      min={total}
                      step="0.01"
                      value={data.changeFor}
                      onChange={(e) => setData({ ...data, changeFor: e.target.value })}
                      className="mt-1 h-11 w-full rounded-lg px-3 text-sm outline-none"
                      style={{ background: theme.surface, color: theme.text, border: `1px solid ${theme.border}` }}
                      placeholder={total.toFixed(2)}
                    />
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {step === 3 && (
          <div className="space-y-4">
            {orderError && (
              <div
                className="flex items-start gap-3 rounded-xl border p-3 text-sm"
                style={{ background: `${theme.accent}12`, borderColor: theme.border, color: theme.text }}
                role="alert"
              >
                <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" style={{ color: theme.accent }} />
                <div>
                  <div className="font-bold">Não deu para enviar o pedido</div>
                  <p className="mt-0.5 leading-relaxed" style={{ color: theme.muted }}>{orderError}</p>
                </div>
              </div>
            )}
            <Field theme={theme} label="Nome">
              <input
                value={data.customerName}
                onChange={(e) => setData({ ...data, customerName: e.target.value })}
                className="h-11 w-full rounded-lg px-3 text-sm outline-none"
                style={{ background: theme.bg, color: theme.text, border: `1px solid ${theme.border}` }}
                placeholder="Como podemos te chamar?"
              />
            </Field>
            <Field theme={theme} label="Telefone">
              <input
                value={data.customerPhone}
                onChange={(e) => setData({ ...data, customerPhone: e.target.value })}
                inputMode="tel"
                className="h-11 w-full rounded-lg px-3 text-sm outline-none"
                style={{ background: theme.bg, color: theme.text, border: `1px solid ${theme.border}` }}
                placeholder="(11) 99999-9999"
              />
            </Field>

            {settings.birthday_promo_enabled && (
              <div
                className="rounded-xl border p-4"
                style={{ background: `${theme.accent}0C`, borderColor: `${theme.accent}40` }}
              >
                <div className="mb-3 flex items-center gap-2">
                  <Gift className="h-4 w-4" style={{ color: theme.accent }} />
                  <span className="text-sm font-bold" style={{ color: theme.text }}>
                    Ganhe desconto no seu aniversário 🎂
                  </span>
                </div>
                <label className="mb-1 block text-xs font-semibold uppercase tracking-wide" style={{ color: theme.muted }}>
                  Data de nascimento (opcional)
                </label>
                <input
                  type="date"
                  value={birthDate}
                  onChange={(e) => setBirthDate(e.target.value)}
                  max={new Date().toISOString().split("T")[0]}
                  className="h-11 w-full rounded-lg px-3 text-sm outline-none"
                  style={{ background: theme.bg, color: theme.text, border: `1px solid ${theme.border}` }}
                />
                <p className="mt-1.5 text-[11px]" style={{ color: theme.muted }}>
                  No seu aniversário você verá {settings.birthday_promo_percent ?? 10}% de desconto automático no cardápio.
                </p>
              </div>
            )}

            {data.orderType === "delivery" && (
              <>
                <div className="grid grid-cols-3 gap-2">
                  <div className="col-span-2">
                    <Field theme={theme} label="Rua">
                      <input
                        value={data.address.street}
                        onChange={(e) => setData({ ...data, address: { ...data.address, street: e.target.value } })}
                        className="h-11 w-full rounded-lg px-3 text-sm outline-none"
                        style={{ background: theme.bg, color: theme.text, border: `1px solid ${theme.border}` }}
                      />
                    </Field>
                  </div>
                  <Field theme={theme} label="Número">
                    <input
                      value={data.address.number}
                      onChange={(e) => setData({ ...data, address: { ...data.address, number: e.target.value } })}
                      className="h-11 w-full rounded-lg px-3 text-sm outline-none"
                      style={{ background: theme.bg, color: theme.text, border: `1px solid ${theme.border}` }}
                    />
                  </Field>
                </div>
                <Field theme={theme} label="Bairro">
                  <input
                    value={data.address.neighborhood}
                    onChange={(e) => setData({ ...data, address: { ...data.address, neighborhood: e.target.value } })}
                    className="h-11 w-full rounded-lg px-3 text-sm outline-none"
                    style={{ background: theme.bg, color: theme.text, border: `1px solid ${theme.border}` }}
                  />
                </Field>
                <div className="grid grid-cols-2 gap-2">
                  <Field theme={theme} label="CEP (opcional)">
                    <input
                      value={data.address.zip}
                      onChange={(e) => setData({ ...data, address: { ...data.address, zip: e.target.value } })}
                      className="h-11 w-full rounded-lg px-3 text-sm outline-none"
                      style={{ background: theme.bg, color: theme.text, border: `1px solid ${theme.border}` }}
                    />
                  </Field>
                  <Field theme={theme} label="Complemento (opcional)">
                    <input
                      value={data.address.complement}
                      onChange={(e) => setData({ ...data, address: { ...data.address, complement: e.target.value } })}
                      className="h-11 w-full rounded-lg px-3 text-sm outline-none"
                      style={{ background: theme.bg, color: theme.text, border: `1px solid ${theme.border}` }}
                      placeholder="Apto, bloco…"
                    />
                  </Field>
                </div>
              </>
            )}

          </div>
        )}
        {/* (Observações gerais removidas — observações agora ficam por produto.) */}


        {/* Resumo sempre visível */}
        <div className="rounded-xl border p-4 text-sm" style={{ borderColor: theme.border, background: theme.bg }}>
          <div className="flex items-center justify-between">
            <span style={{ color: theme.muted }}>Subtotal ({cartItemCount(cart)} itens)</span>
            <span className="font-semibold">R$ {subtotal.toFixed(2)}</span>
          </div>
          {birthdayDiscount > 0 && (
            <div className="mt-1 flex items-center justify-between">
              <span className="flex items-center gap-1" style={{ color: "hsl(142 71% 38%)" }}>
                🎂 Desconto aniversário ({birthdayDiscount}%)
              </span>
              <span className="font-semibold" style={{ color: "hsl(142 71% 38%)" }}>
                - R$ {discountAmount.toFixed(2)}
              </span>
            </div>
          )}
          {data.orderType === "delivery" && (
            <div className="mt-1 flex items-center justify-between">
              <span style={{ color: theme.muted }}>Taxa de entrega</span>
              <span className="font-semibold">{deliveryFee > 0 ? `R$ ${deliveryFee.toFixed(2)}` : "Grátis"}</span>
            </div>
          )}
          <div className="mt-2 flex items-center justify-between border-t pt-2" style={{ borderColor: theme.border }}>
            <span className="font-bold">Total</span>
            <span className="text-base font-bold" style={{ color: theme.accent }}>R$ {total.toFixed(2)}</span>
          </div>
        </div>
      </div>

      <div className="sticky bottom-0 px-5 py-4" style={{ background: theme.surface, borderTop: `1px solid ${theme.border}` }}>
        {step < 3 ? (
          <button
            onClick={next}
            disabled={!canContinue}
            className="w-full rounded-full py-3.5 text-sm font-bold transition active:scale-[0.98] disabled:opacity-50"
            style={{ background: theme.accent, color: theme.accentText }}
          >
            Continuar
          </button>
        ) : (
          <button
            onClick={sendOrder}
            disabled={!canContinue || submitting}
            className="flex w-full items-center justify-center gap-2 rounded-full py-3.5 text-sm font-bold transition active:scale-[0.98] disabled:opacity-50"
            style={{ background: theme.accent, color: theme.accentText }}
          >
            {submitting ? (
              <>
                <span className="h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent" />
                Enviando...
              </>
            ) : (
              "Pedir agora"
            )}
          </button>
        )}
      </div>
    </div>
  );
}

const OrderTypeOption = ({
  theme, icon, title, description, selected, onClick,
}: {
  theme: MenuTheme; icon: React.ReactNode; title: string; description: string;
  selected: boolean; onClick: () => void;
}) => (
  <button
    onClick={onClick}
    className="flex w-full items-center gap-3 rounded-xl border-2 p-4 text-left transition"
    style={{
      borderColor: selected ? theme.accent : theme.border,
      background: selected ? `${theme.accent}10` : theme.bg,
    }}
  >
    <div
      className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg"
      style={{
        background: selected ? theme.accent : theme.surface,
        color: selected ? theme.accentText : theme.text,
      }}
    >
      {icon}
    </div>
    <div className="min-w-0 flex-1">
      <div className="font-semibold" style={{ color: theme.text }}>{title}</div>
      <div className="text-xs" style={{ color: theme.muted }}>{description}</div>
    </div>
  </button>
);

const PaymentOption = ({
  theme, icon, title, selected, onClick,
}: {
  theme: MenuTheme; icon: React.ReactNode; title: string;
  selected: boolean; onClick: () => void;
}) => (
  <button
    onClick={onClick}
    className="flex w-full items-center gap-3 rounded-xl border-2 p-4 text-left transition"
    style={{
      borderColor: selected ? theme.accent : theme.border,
      background: selected ? `${theme.accent}10` : theme.bg,
    }}
  >
    <div
      className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg"
      style={{
        background: selected ? theme.accent : theme.surface,
        color: selected ? theme.accentText : theme.text,
      }}
    >
      {icon}
    </div>
    <span className="font-semibold" style={{ color: theme.text }}>{title}</span>
  </button>
);

const Field = ({
  theme, label, children,
}: { theme: MenuTheme; label: string; children: React.ReactNode }) => (
  <div>
    <label className="mb-1 block text-xs font-semibold uppercase tracking-wide" style={{ color: theme.muted }}>
      {label}
    </label>
    {children}
  </div>
);


/* ===== Tela de confirmação do pedido ===== */
function OrderConfirmation({
  theme, deliveryTime, onClose,
}: {
  theme: MenuTheme;
  deliveryTime: string | null;
  onClose: () => void;
}) {
  return (
    <div
      className="flex min-h-[80vh] flex-col items-center justify-center px-6 py-10 text-center animate-fade-in"
      style={{ background: theme.surface, color: theme.text }}
    >
      {/* Ícone com partículas */}
      <div className="relative mb-6 animate-scale-in">
        <div
          className="absolute inset-0 rounded-full blur-2xl opacity-40"
          style={{ background: theme.accent }}
        />
        <div
          className="relative flex h-24 w-24 items-center justify-center rounded-full shadow-xl"
          style={{ background: theme.accent, color: theme.accentText }}
        >
          <Check className="h-12 w-12 animate-[scale-in_0.4s_ease-out_0.2s_both]" strokeWidth={3} />
        </div>
        {/* Partículas sutis */}
        <Sparkles
          className="absolute -right-3 -top-2 h-5 w-5 animate-[fade-in_0.6s_ease-out_0.3s_both]"
          style={{ color: theme.accent }}
        />
        <Sparkles
          className="absolute -left-4 top-2 h-4 w-4 animate-[fade-in_0.7s_ease-out_0.5s_both]"
          style={{ color: theme.accent, opacity: 0.7 }}
        />
        <Sparkles
          className="absolute -bottom-1 right-1 h-3 w-3 animate-[fade-in_0.8s_ease-out_0.7s_both]"
          style={{ color: theme.accent, opacity: 0.5 }}
        />
      </div>

      <h2
        className="mb-3 text-2xl font-extrabold tracking-tight sm:text-3xl"
        style={{ color: theme.text, fontFamily: theme.fontFamily }}
      >
        Pedido confirmado!
      </h2>

      <p className="mb-2 max-w-sm text-sm leading-relaxed sm:text-base" style={{ color: theme.text }}>
        Seu pedido foi recebido e já está sendo preparado pelo estabelecimento.
      </p>

      {deliveryTime && (
        <div
          className="mb-4 inline-flex items-center gap-2 rounded-full px-4 py-2 text-sm font-semibold"
          style={{
            background: `${theme.accent}1A`,
            color: theme.accent,
            border: `1px solid ${theme.accent}40`,
          }}
        >
          <Clock className="h-4 w-4" />
          Tempo estimado: {deliveryTime}
        </div>
      )}

      <p className="mb-8 max-w-sm text-sm" style={{ color: theme.muted }}>
        Você será atendido em breve. Agradecemos pela preferência.
      </p>

      <button
        onClick={onClose}
        className="w-full max-w-xs rounded-full py-3.5 text-sm font-bold shadow-lg transition active:scale-[0.98]"
        style={{ background: theme.accent, color: theme.accentText }}
      >
        Voltar ao cardápio
      </button>
    </div>
  );
}

export default PublicMenu;

