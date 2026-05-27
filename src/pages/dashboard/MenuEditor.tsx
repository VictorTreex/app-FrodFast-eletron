import { useEffect, useState, useRef } from "react";
import { useParams, Link, useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useAccess } from "@/hooks/useAccess";
import { BlockedAccess } from "@/components/BlockedAccess";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { ArrowLeft, Plus, Pencil, Trash2, Image as ImageIcon, Upload, Eye, Check, GripVertical, Package, Tag, Sparkles, Palette, Info, Save, Phone, MapPin, Clock, MessageCircle, Tag as TagIcon, Timer, Wallet, Search, X, FolderOpen, Smartphone, Monitor, Lightbulb, Gift, Percent } from "lucide-react";
import { toast } from "sonner";
import { MENU_THEMES, getMenuTheme } from "@/lib/menuThemes";
import { ThemePreview } from "@/components/menu/ThemePreview";
import { IconPicker } from "@/components/menu/IconPicker";
import { getCategoryIcon, getCategoryIconData } from "@/lib/categoryIcons";
import { CategoryIconView } from "@/components/menu/CategoryIconView";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { BusinessHoursDialog } from "@/components/menu/BusinessHoursDialog";
import { BusinessHours, DEFAULT_HOURS, normalizeBusinessHours, isOpenNow } from "@/lib/businessHours";
import { AddonsManager } from "@/components/menu/AddonsManager";
import { RecipeManager } from "@/components/menu/RecipeManager";
import AddonLibrary from "@/pages/dashboard/AddonLibrary";
import { Switch } from "@/components/ui/switch";
import { Truck, Bike, Store } from "lucide-react";
import { MoneyInput } from "@/components/ui/money-input";
import { useRealtimeRefresh } from "@/hooks/useRealtimeRefresh";
import { generateSlug } from "@/lib/slugGenerator";
import { compressToWebp } from "@/lib/imageOptimizer";

interface Product {
  id: string;
  menu_id: string;
  name: string;
  description: string | null;
  price: number | null;
  image_url: string | null;
  category: string | null;
  category_id: string | null;
  position: number;
  is_available: boolean;
  price_from_enabled: boolean;
  price_from_value: number | null;
}

interface Category {
  id: string;
  menu_id: string;
  name: string;
  icon: string;
  position: number;
}

interface Menu { id: string; name: string; cover_url: string | null; slug: string; is_active: boolean; }
interface MenuSettings {
  id?: string;
  logo_url: string | null;
  display_name: string | null;
  primary_color: string;
  layout_style: string;
  whatsapp_number: string | null;
  address: string | null;
  phone: string | null;
  opening_hours: string | null;
  delivery_time: string | null;
  is_open: boolean;
  business_hours: BusinessHours;
  accept_delivery: boolean;
  accept_pickup: boolean;
  accept_dine_in: boolean;
  delivery_fee: number;
  accept_scheduled: boolean;
  scheduling_min_minutes: number;
  scheduling_max_days: number;
  birthday_promo_enabled: boolean;
  birthday_promo_percent: number;
}

const themeList = Object.values(MENU_THEMES);

// === Telefone BR helpers ===
const onlyDigits = (s: string) => s.replace(/\D/g, "");
const formatPhoneBR = (raw: string) => {
  const d = onlyDigits(raw).slice(0, 11);
  if (d.length === 0) return "";
  if (d.length <= 2) return `(${d}`;
  if (d.length <= 6) return `(${d.slice(0, 2)}) ${d.slice(2)}`;
  if (d.length <= 10) return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`;
  return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`;
};

const MenuEditor = () => {
  const { menuId } = useParams();
  const { user } = useAuth();
  const access = useAccess();
  const navigate = useNavigate();
  const [menu, setMenu] = useState<Menu | null>(null);
  const [products, setProducts] = useState<Product[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [settings, setSettings] = useState<MenuSettings>({
    logo_url: null, display_name: null, primary_color: "#6C2BD9", layout_style: "modern", whatsapp_number: null,
    address: null, phone: null, opening_hours: null, delivery_time: null, is_open: true,
    business_hours: DEFAULT_HOURS, accept_delivery: false, accept_pickup: false, accept_dine_in: false,
    delivery_fee: 0, accept_scheduled: false, scheduling_min_minutes: 30, scheduling_max_days: 7,
    birthday_promo_enabled: false, birthday_promo_percent: 10,
  });

  // Helper para obter URL segura do cardápio
  const getMenuUrl = (menu: Menu): string => {
    // NUNCA usar ID como subdomínio
    if (!menu.slug) {
      console.error("❌ [MenuEditor] Cardápio sem slug:", menu);
      return "#"; // Retorna safe fallback
    }
    
    // Verificar se o slug parece com ID (previne bugs)
    if (menu.slug.match(/^[a-f0-9]{8,}$/i)) {
      console.error("❌ [MenuEditor] Slug parece ID, usando fallback:", menu.slug);
      return "#";
    }
    
    return `https://${menu.slug}.treexonline.online`;
  };

  const [loading, setLoading] = useState(true);
  const coverInputRef = useRef<HTMLInputElement>(null);
  const logoInputRef = useRef<HTMLInputElement>(null);

  // Aba ativa persistida — evita reset ao salvar / re-render
  const TAB_STORAGE_KEY = `menu-editor-tab:${menuId || "default"}`;
  const [activeTab, setActiveTab] = useState<string>(() => {
    if (typeof window === "undefined") return "produtos";
    return localStorage.getItem(TAB_STORAGE_KEY) || "produtos";
  });
  useEffect(() => {
    if (typeof window !== "undefined") {
      localStorage.setItem(TAB_STORAGE_KEY, activeTab);
    }
  }, [activeTab, TAB_STORAGE_KEY]);

  // dirty state para salvar manual em Visual e Info
  const [visualDirty, setVisualDirty] = useState(false);
  const [infoDirty, setInfoDirty] = useState(false);
  const [savingVisual, setSavingVisual] = useState(false);
  const [savingInfo, setSavingInfo] = useState(false);
  const [menuNameDirty, setMenuNameDirty] = useState(false);

  // product dialog
  const [productOpen, setProductOpen] = useState(false);
  const [editingProduct, setEditingProduct] = useState<Partial<Product> | null>(null);
  const productImageInput = useRef<HTMLInputElement>(null);
  const [savingProduct, setSavingProduct] = useState(false);

  // category dialog
  const [categoryOpen, setCategoryOpen] = useState(false);
  const [editingCategory, setEditingCategory] = useState<Partial<Category> | null>(null);
  const [savingCategory, setSavingCategory] = useState(false);

  // Search filter for products
  const [productSearch, setProductSearch] = useState("");

  const load = async () => {
    if (!user || !menuId) return;
    setLoading(true);
    const [{ data: m }, { data: ps }, { data: s }, { data: cs }] = await Promise.all([
      supabase.from("menus").select("*").eq("id", menuId).maybeSingle(),
      supabase.from("products").select("*").eq("menu_id", menuId).order("position"),
      supabase.from("menu_settings").select("*").eq("menu_id", menuId).maybeSingle(),
      supabase.from("categories").select("*").eq("menu_id", menuId).order("position"),
    ]);
    setMenu(m as any);
    setProducts((ps || []) as any);
    setCategories((cs || []) as any);
    if (s) setSettings({ ...(s as any), business_hours: normalizeBusinessHours((s as any).business_hours) });
    setLoading(false);
  };

  useEffect(() => { load(); }, [user, menuId]);

  // Realtime: sincroniza o editor com mudanças vindas de outras abas/dispositivos.
  // Importante: só recarrega quando NADA estiver com edição pendente (dirty),
  // nem com diálogos abertos — assim não perdemos o que o usuário está digitando.
  useRealtimeRefresh({
    channelKey: `menu-editor-rt-${menuId ?? "none"}`,
    enabled: !!user && !!menuId,
    tables: [
      { table: "products", filter: menuId ? `menu_id=eq.${menuId}` : undefined },
      { table: "categories", filter: menuId ? `menu_id=eq.${menuId}` : undefined },
      { table: "menus", filter: menuId ? `id=eq.${menuId}` : undefined },
      { table: "menu_settings", filter: menuId ? `menu_id=eq.${menuId}` : undefined },
    ],
    onChange: () => {
      const editingSomething =
        visualDirty || infoDirty || menuNameDirty ||
        productOpen || categoryOpen ||
        savingVisual || savingInfo || savingProduct || savingCategory;
      if (editingSomething) return;
      
      load();
    },
  });

  const uploadImage = async (file: File, folder: string): Promise<string | null> => {
    if (!user) return null;
    // Converte automaticamente para WebP (mantém qualidade alta) para reduzir o peso.
    // Em caso de falha, usa o arquivo original (nunca quebra o upload).
    const optimized = await compressToWebp(file);
    const ext = (optimized.name.split(".").pop() || "webp").toLowerCase();
    const path = `${user.id}/${folder}/${Date.now()}.${ext}`;
    const { error } = await supabase.storage
      .from("menu-images")
      .upload(path, optimized, { upsert: false, contentType: optimized.type });
    if (error) { toast.error(error.message); return null; }
    const { data } = supabase.storage.from("menu-images").getPublicUrl(path);
    return data.publicUrl;
  };

  const updateMenu = async (patch: Partial<Menu>) => {
    if (!menuId) return;
    const { error } = await supabase.from("menus").update(patch).eq("id", menuId);
    if (error) toast.error(error.message);
    else { setMenu((p) => p ? { ...p, ...patch } : p); toast.success("Salvo"); }
  };

  const handleCoverUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]; if (!file) return;
    const url = await uploadImage(file, `menus/${menuId}/cover`);
    if (url) await updateMenu({ cover_url: url });
  };

  const handleLogoUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]; if (!file) return;
    const url = await uploadImage(file, `menus/${menuId}/logo`);
    if (url) {
      const next = { ...settings, logo_url: url };
      setSettings(next);
      await saveSettings(next);
    }
  };

  const saveSettings = async (next?: MenuSettings) => {
    if (!user || !menuId) return;
    const src = next || settings;
    const { id: _omit, business_hours, ...rest } = src;
    const payload: any = {
      menu_id: menuId,
      user_id: user.id,
      ...rest,
      business_hours: business_hours as any,
    };
    const { error } = await supabase
      .from("menu_settings")
      .upsert(payload, { onConflict: "menu_id" });
    if (error) toast.error(error.message);
    else toast.success("Configurações salvas");
  };

  const handleSaveVisual = async () => {
    setSavingVisual(true);
    await saveSettings();
    if (menuNameDirty) await updateMenu({ name: menu?.name || "" });
    setVisualDirty(false);
    setMenuNameDirty(false);
    setSavingVisual(false);
  };

  const handleSaveInfo = async () => {
    setSavingInfo(true);
    await saveSettings();
    setInfoDirty(false);
    setSavingInfo(false);
  };

  const openNewProduct = () => {
    setEditingProduct({
      name: "", description: "", price: null, category: "", category_id: null,
      image_url: null, position: products.length, price_from_enabled: false, price_from_value: null,
    });
    setProductOpen(true);
  };
  const openEditProduct = (p: Product) => { setEditingProduct(p); setProductOpen(true); };

  const saveProduct = async () => {
    if (!editingProduct || !user || !menuId) return;
    if (!editingProduct.name?.trim()) { toast.error("Nome é obrigatório"); return; }
    setSavingProduct(true);
    // Mantém o texto sincronizado com o nome da categoria escolhida (legacy)
    const catName = editingProduct.category_id
      ? categories.find((c) => c.id === editingProduct.category_id)?.name || null
      : (editingProduct.category || null);
    const payload = {
      menu_id: menuId,
      user_id: user.id,
      name: editingProduct.name!.trim(),
      description: editingProduct.description || null,
      price: Number(editingProduct.price) || 0,
      category: catName,
      category_id: editingProduct.category_id || null,
      image_url: editingProduct.image_url || null,
      position: editingProduct.position ?? products.length,
      is_available: editingProduct.is_available ?? true,
      // Adicionar campos de preço a partir de
      price_from_enabled: editingProduct.price_from_enabled || false,
      price_from_value: editingProduct.price_from_enabled ? (editingProduct.price_from_value || 0) : null,
    };
    
    const { error } = editingProduct.id
      ? await supabase.from("products").update(payload).eq("id", editingProduct.id)
      : await supabase.from("products").insert(payload);
      
    if (error) {
      toast.error(error.message);
    } else {
      toast.success("Produto salvo"); 
      setProductOpen(false); 
      setEditingProduct(null); 
      load();
    }
    setSavingProduct(false);
  };

  const deleteProduct = async (id: string) => {
    if (!confirm("Excluir este produto?")) return;
    const { error } = await supabase.from("products").delete().eq("id", id);
    if (error) toast.error(error.message); else { toast.success("Excluído"); load(); }
  };

  const handleProductImage = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]; if (!file) return;
    const url = await uploadImage(file, `products`);
    if (url) setEditingProduct((p) => p ? { ...p, image_url: url } : p);
  };

  /* ========== Categorias ========== */
  const openNewCategory = () => {
    setEditingCategory({ name: "", icon: "utensils", position: categories.length });
    setCategoryOpen(true);
  };
  const openEditCategory = (c: Category) => { setEditingCategory(c); setCategoryOpen(true); };

  const saveCategory = async () => {
    if (!editingCategory || !user || !menuId) return;
    const name = (editingCategory.name || "").trim();
    if (!name) { toast.error("Nome é obrigatório"); return; }
    setSavingCategory(true);
    const payload = {
      menu_id: menuId,
      user_id: user.id,
      name,
      icon: editingCategory.icon || "utensils",
      position: editingCategory.position ?? categories.length,
    };
    const { error } = editingCategory.id
      ? await supabase.from("categories").update(payload).eq("id", editingCategory.id)
      : await supabase.from("categories").insert(payload);
    if (error) toast.error(error.message);
    else { toast.success("Categoria salva"); setCategoryOpen(false); setEditingCategory(null); load(); }
    setSavingCategory(false);
  };

  const deleteCategory = async (id: string) => {
    if (!confirm("Excluir esta categoria? Os produtos vinculados ficarão sem categoria.")) return;
    const { error } = await supabase.from("categories").delete().eq("id", id);
    if (error) toast.error(error.message); else { toast.success("Excluída"); load(); }
  };


  if (!access.loading && !access.hasAccess) {
    return <BlockedAccess />;
  }

  if (loading) {
    return (
      <div className="flex min-h-[50vh] items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent" />
      </div>
    );
  }
  if (!menu) return <div className="container-app py-8">Cardápio não encontrado.</div>;

  return (
    <div className="container-app py-6 space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="icon" onClick={() => navigate("/dashboard")}>
            <ArrowLeft />
          </Button>
          <div>
            <h1 className="font-display text-2xl font-bold tracking-tight">{menu.name}</h1>
            <p className="text-sm text-muted-foreground">Editor de cardápio</p>
          </div>
        </div>
        <Button asChild variant="outline">
          <a href={getMenuUrl(menu)} target="_blank" rel="noreferrer"><Eye /> Visualizar</a>
        </Button>
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-6">
        <div className="overflow-x-auto -mx-4 px-4 sm:mx-0 sm:px-0">
          <TabsList className="inline-flex h-auto items-center gap-1 rounded-2xl border border-border bg-card p-1.5 shadow-sm">
            <TabsTrigger
              value="produtos"
              className="gap-2 rounded-xl px-4 py-2.5 text-sm font-medium data-[state=active]:bg-primary data-[state=active]:text-primary-foreground data-[state=active]:shadow-md"
            >
              <Package className="h-4 w-4" /> Produtos
            </TabsTrigger>
            <TabsTrigger
              value="categorias"
              className="gap-2 rounded-xl px-4 py-2.5 text-sm font-medium data-[state=active]:bg-primary data-[state=active]:text-primary-foreground data-[state=active]:shadow-md"
            >
              <Tag className="h-4 w-4" /> Categorias
            </TabsTrigger>
            <TabsTrigger
              value="adicionais"
              className="gap-2 rounded-xl px-4 py-2.5 text-sm font-medium data-[state=active]:bg-primary data-[state=active]:text-primary-foreground data-[state=active]:shadow-md"
            >
              <Sparkles className="h-4 w-4" /> Adicionais
            </TabsTrigger>
            <TabsTrigger
              value="visual"
              className="gap-2 rounded-xl px-4 py-2.5 text-sm font-medium data-[state=active]:bg-primary data-[state=active]:text-primary-foreground data-[state=active]:shadow-md"
            >
              <Palette className="h-4 w-4" /> Visual
            </TabsTrigger>
            <TabsTrigger
              value="info"
              className="gap-2 rounded-xl px-4 py-2.5 text-sm font-medium data-[state=active]:bg-primary data-[state=active]:text-primary-foreground data-[state=active]:shadow-md"
            >
              <Info className="h-4 w-4" /> Informações
            </TabsTrigger>
          </TabsList>
        </div>

        {/* ADICIONAIS */}
        <TabsContent value="adicionais" className="space-y-4">
          <AddonLibrary embedded />
        </TabsContent>

        {/* PRODUTOS */}
        <TabsContent value="produtos" className="space-y-5">
          <section className="overflow-hidden rounded-2xl border border-border bg-card shadow-sm">
            <header className="flex flex-wrap items-center justify-between gap-3 border-b border-border bg-gradient-to-r from-primary/5 via-card to-card px-6 py-4">
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary/10 text-primary">
                  <Package className="h-5 w-5" />
                </div>
                <div>
                  <h3 className="font-display text-lg font-semibold tracking-tight">
                    Produtos <span className="text-muted-foreground">({products.length})</span>
                  </h3>
                  <p className="text-xs text-muted-foreground">
                    Itens que aparecem no seu cardápio público.
                  </p>
                </div>
              </div>
              <Button variant="cta" onClick={openNewProduct}>
                <Plus className="h-4 w-4" /> Novo produto
              </Button>
            </header>

            <div className="space-y-5 p-6">
              {products.length === 0 ? (
                <div className="flex flex-col items-center justify-center rounded-2xl border-2 border-dashed border-border bg-muted/20 p-12 text-center">
                  <div className="mb-3 flex h-14 w-14 items-center justify-center rounded-2xl bg-primary/10 text-primary">
                    <Package className="h-7 w-7" />
                  </div>
                  <p className="font-display text-base font-semibold">Nenhum produto cadastrado</p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    Comece criando seu primeiro item de cardápio.
                  </p>
                  <Button variant="cta" className="mt-5" onClick={openNewProduct}>
                    <Plus className="h-4 w-4" /> Adicionar primeiro produto
                  </Button>
                </div>
              ) : (
                (() => {
                  // Search bar
                  const q = productSearch.trim().toLowerCase();
                  const filtered = q
                    ? products.filter(
                        (p) =>
                          p.name.toLowerCase().includes(q) ||
                          (p.description || "").toLowerCase().includes(q) ||
                          (p.category || "").toLowerCase().includes(q),
                      )
                    : products;

                  // Group by category preserving categories order
                  const groupsMap = new Map<string, { id: string | null; name: string; icon: string; items: Product[] }>();
                  // seed in category order
                  categories.forEach((c) =>
                    groupsMap.set(c.id, { id: c.id, name: c.name, icon: c.icon, items: [] }),
                  );
                  const uncategorized: Product[] = [];
                  filtered.forEach((p) => {
                    if (p.category_id && groupsMap.has(p.category_id)) {
                      groupsMap.get(p.category_id)!.items.push(p);
                    } else if (p.category) {
                      // legacy text category — group by name
                      const key = `legacy:${p.category}`;
                      if (!groupsMap.has(key))
                        groupsMap.set(key, { id: null, name: p.category, icon: "utensils", items: [] });
                      groupsMap.get(key)!.items.push(p);
                    } else {
                      uncategorized.push(p);
                    }
                  });
                  const groups = Array.from(groupsMap.values()).filter((g) => g.items.length > 0);
                  if (uncategorized.length)
                    groups.push({ id: null, name: "Sem categoria", icon: "utensils", items: uncategorized });

                  return (
                    <>
                      {/* Search bar */}
                      <div className="relative">
                        <Search className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                        <Input
                          value={productSearch}
                          onChange={(e) => setProductSearch(e.target.value)}
                          placeholder="Buscar produtos por nome, descrição ou categoria..."
                          className="h-12 rounded-xl border-border bg-muted/30 pl-11 pr-11 text-sm shadow-sm transition-all focus-visible:border-primary focus-visible:bg-card focus-visible:ring-2 focus-visible:ring-primary/20"
                        />
                        {productSearch && (
                          <button
                            type="button"
                            onClick={() => setProductSearch("")}
                            className="absolute right-3 top-1/2 flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                            aria-label="Limpar busca"
                          >
                            <X className="h-4 w-4" />
                          </button>
                        )}
                      </div>

                      {filtered.length === 0 ? (
                        <div className="flex flex-col items-center justify-center rounded-2xl border-2 border-dashed border-border bg-muted/20 p-10 text-center">
                          <div className="mb-3 flex h-12 w-12 items-center justify-center rounded-xl bg-muted text-muted-foreground">
                            <Search className="h-5 w-5" />
                          </div>
                          <p className="text-sm font-semibold">Nenhum produto encontrado</p>
                          <p className="mt-1 text-xs text-muted-foreground">
                            Tente outro termo de busca.
                          </p>
                        </div>
                      ) : (
                        <div className="space-y-6">
                          {groups.map((g) => {
                            const data = getCategoryIconData(g.icon);
                            const Icon = data.Icon;
                            return (
                              <section key={g.id || g.name} className="space-y-3">
                                <div className="flex items-center gap-2.5 border-b border-border/60 pb-2">
                                  {data.image ? (
                                    <CategoryIconView iconKey={g.icon} size={32} />
                                  ) : (
                                    <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary/10 text-primary">
                                      <Icon className="h-4 w-4" />
                                    </div>
                                  )}
                                  <h4 className="font-display text-sm font-semibold uppercase tracking-wider">
                                    {g.name}
                                  </h4>
                                  <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] font-medium text-muted-foreground">
                                    {g.items.length}
                                  </span>
                                </div>
                                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                                  {g.items.map((p) => (
                                    <div
                                      key={p.id}
                                      className="group flex gap-3 rounded-xl border border-border bg-card p-3 transition-all hover:border-primary/40 hover:shadow-md"
                                    >
                                      <div className="h-20 w-20 shrink-0 overflow-hidden rounded-lg bg-muted">
                                        {p.image_url ? (
                                          <img
                                            src={p.image_url}
                                            alt={p.name}
                                            className="h-full w-full object-cover transition-transform group-hover:scale-105"
                                            loading="lazy"
                                            decoding="async"
                                          />
                                        ) : (
                                          <div className="flex h-full items-center justify-center text-muted-foreground">
                                            <ImageIcon className="h-5 w-5" />
                                          </div>
                                        )}
                                      </div>
                                      <div className="min-w-0 flex-1">
                                        <div className="flex items-start justify-between gap-2">
                                          <div className="min-w-0">
                                            <div className="truncate font-display text-sm font-semibold tracking-tight">
                                              {p.name}
                                            </div>
                                            {p.description && (
                                              <p className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">
                                                {p.description}
                                              </p>
                                            )}
                                          </div>
                                          <div className="shrink-0 text-sm font-bold text-primary">
                                            {p.price_from_enabled && p.price_from_value
                                              ? `A partir de R$ ${Number(p.price_from_value).toFixed(2)}`
                                              : `R$ ${Number(p.price).toFixed(2)}`}
                                          </div>
                                        </div>
                                        <div className="mt-2 flex gap-1">
                                          <Button
                                            size="sm"
                                            variant="ghost"
                                            onClick={() => openEditProduct(p)}
                                            className="h-8 px-2"
                                          >
                                            <Pencil className="h-3.5 w-3.5" /> Editar
                                          </Button>
                                          <Button
                                            size="sm"
                                            variant="ghost"
                                            onClick={() => deleteProduct(p.id)}
                                            className="h-8 px-2 text-destructive hover:bg-destructive/10 hover:text-destructive"
                                          >
                                            <Trash2 className="h-3.5 w-3.5" />
                                          </Button>
                                        </div>
                                      </div>
                                    </div>
                                  ))}
                                </div>
                              </section>
                            );
                          })}
                        </div>
                      )}
                    </>
                  );
                })()
              )}
            </div>
          </section>
        </TabsContent>

        {/* CATEGORIAS */}
        <TabsContent value="categorias" className="space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-lg font-semibold">Categorias ({categories.length})</h2>
              <p className="text-sm text-muted-foreground">
                Cada categoria recebe um ícone que aparece no cardápio público.
              </p>
            </div>
            <Button variant="cta" onClick={openNewCategory}><Plus /> Nova categoria</Button>
          </div>

          {categories.length === 0 ? (
            <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-border bg-card p-12 text-center">
              <p className="text-muted-foreground">Nenhuma categoria criada ainda.</p>
              <Button variant="cta" className="mt-4" onClick={openNewCategory}>
                <Plus /> Criar primeira categoria
              </Button>
            </div>
          ) : (
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {categories.map((c) => {
                const data = getCategoryIconData(c.icon);
                const Icon = data.Icon;
                const count = products.filter((p) => p.category_id === c.id).length;
                return (
                  <div
                    key={c.id}
                    className="flex items-center gap-3 rounded-xl border border-border bg-card p-3"
                  >
                    {data.image ? (
                      <CategoryIconView iconKey={c.icon} size={48} className="shrink-0" />
                    ) : (
                      <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                        <Icon className="h-6 w-6" />
                      </div>
                    )}
                    <div className="min-w-0 flex-1">
                      <div className="truncate font-semibold uppercase tracking-wide">
                        {c.name}
                      </div>
                      <div className="text-xs text-muted-foreground">
                        {count} {count === 1 ? "produto" : "produtos"}
                      </div>
                    </div>
                    <Button size="sm" variant="ghost" onClick={() => openEditCategory(c)}>
                      <Pencil className="h-3.5 w-3.5" />
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="text-destructive"
                      onClick={() => deleteCategory(c.id)}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                );
              })}
            </div>
          )}
        </TabsContent>

        {/* VISUAL */}
        <TabsContent value="visual" className="space-y-6">
          <div className="rounded-xl border border-border bg-card p-6">
            <h3 className="font-semibold">Identidade do cardápio</h3>
            <p className="mt-1 text-sm text-muted-foreground">Nome exibido no topo do cardápio público.</p>
            <div className="mt-4">
              <Label>Nome de exibição</Label>
              <Input
                value={settings.display_name || ""}
                onChange={(e) => { setSettings({ ...settings, display_name: e.target.value }); setVisualDirty(true); }}
                placeholder="Burger House"
              />
            </div>
          </div>

          <div className="rounded-xl border border-border bg-card p-4 sm:p-6">
            <h3 className="font-semibold">Estilo do cardápio</h3>
            <p className="mt-1 text-sm text-muted-foreground">
              Cada estilo já vem com cores, formato e layout prontos. Toque em um para aplicar.
            </p>
            <div className="mt-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {themeList.map((t) => {
                const selected = settings.layout_style === t.id;
                return (
                  <button
                    key={t.id}
                    type="button"
                    onClick={() => {
                      setSettings({ ...settings, layout_style: t.id, primary_color: t.accent });
                      setVisualDirty(true);
                    }}
                    className={`group relative text-left rounded-xl border-2 p-3 transition-all ${
                      selected
                        ? "border-primary shadow-md"
                        : "border-border hover:border-primary/40"
                    }`}
                  >
                    {selected && (
                      <span className="absolute right-3 top-3 z-10 flex h-6 w-6 items-center justify-center rounded-full bg-primary text-primary-foreground shadow">
                        <Check className="h-3.5 w-3.5" />
                      </span>
                    )}
                    <div className="aspect-[4/3] w-full overflow-hidden rounded-lg">
                      <ThemePreview theme={t} />
                    </div>
                    <div className="mt-3 flex items-center gap-2">
                      <span
                        className="h-4 w-4 shrink-0 rounded-full border border-border"
                        style={{ backgroundColor: t.accent }}
                      />
                      <div className="min-w-0">
                        <div className="truncate text-sm font-semibold">{t.name}</div>
                        <p className="truncate text-xs text-muted-foreground">{t.tagline}</p>
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>

          <div className="rounded-2xl border border-border bg-card p-6">
            <div className="flex items-start gap-3">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
                <ImageIcon className="h-5 w-5" />
              </div>
              <div className="min-w-0 flex-1">
                <h3 className="font-display text-lg font-semibold tracking-tight">Imagem de capa</h3>
                <p className="mt-0.5 text-sm text-muted-foreground">
                  Banner exibido no topo do cardápio público.
                </p>
              </div>
            </div>

            {/* Preview + upload */}
            <div className="mt-5 flex flex-wrap items-center gap-4">
              <div className="aspect-[16/9] w-56 shrink-0 overflow-hidden rounded-xl border border-border bg-muted shadow-sm">
                {menu.cover_url ? (
                  <img src={menu.cover_url} alt="Capa" className="h-full w-full object-cover" loading="lazy" decoding="async" />
                ) : (
                  <div className="flex h-full items-center justify-center text-muted-foreground">
                    <ImageIcon className="h-6 w-6" />
                  </div>
                )}
              </div>
              <input type="file" accept="image/*" ref={coverInputRef} onChange={handleCoverUpload} className="hidden" />
              <div className="flex flex-col gap-2">
                <Button variant="cta" size="sm" onClick={() => coverInputRef.current?.click()}>
                  <Upload className="h-4 w-4" /> {menu.cover_url ? "Trocar capa" : "Enviar capa"}
                </Button>
                <span className="text-[11px] text-muted-foreground">PNG ou JPG • até 5MB</span>
              </div>
            </div>

            {/* Recommended sizes — beautiful hint card */}
            <div className="relative mt-5 overflow-hidden rounded-2xl border border-primary/20 bg-gradient-to-br from-primary/5 via-card to-card p-5">
              <div className="pointer-events-none absolute -right-8 -top-8 h-32 w-32 rounded-full bg-primary/10 blur-2xl" />
              <div className="relative">
                <div className="flex items-center gap-2">
                  <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-primary/15 text-primary">
                    <Lightbulb className="h-3.5 w-3.5" />
                  </span>
                  <h4 className="font-display text-sm font-semibold tracking-tight">
                    Dicas para uma capa profissional
                  </h4>
                </div>

                <div className="mt-4 grid gap-3 sm:grid-cols-2">
                  <div className="rounded-xl border border-border bg-card/60 p-3.5 backdrop-blur-sm">
                    <div className="flex items-center gap-2 text-foreground">
                      <Monitor className="h-4 w-4 text-primary" />
                      <span className="text-xs font-semibold uppercase tracking-wider">Desktop</span>
                    </div>
                    <p className="mt-2 text-base font-bold tracking-tight">1920 × 720 px</p>
                    <p className="mt-0.5 text-[11px] text-muted-foreground">Proporção 16:6 — banner amplo</p>
                  </div>
                  <div className="rounded-xl border border-border bg-card/60 p-3.5 backdrop-blur-sm">
                    <div className="flex items-center gap-2 text-foreground">
                      <Smartphone className="h-4 w-4 text-primary" />
                      <span className="text-xs font-semibold uppercase tracking-wider">Mobile</span>
                    </div>
                    <p className="mt-2 text-base font-bold tracking-tight">1080 × 720 px</p>
                    <p className="mt-0.5 text-[11px] text-muted-foreground">Proporção 3:2 — recorte central</p>
                  </div>
                </div>

                <div className="mt-4 flex items-start gap-2.5 rounded-xl border border-amber-500/30 bg-amber-500/10 p-3">
                  <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-md bg-amber-500/20 text-amber-700 dark:text-amber-300">
                    <Sparkles className="h-3 w-3" />
                  </span>
                  <p className="text-xs leading-relaxed text-foreground/90">
                    <span className="font-semibold">Recomendado:</span> use uma imagem com o
                    <span className="font-semibold"> nome do estabelecimento</span> em destaque. Isso dá personalidade e fortalece sua marca no cardápio digital.
                  </p>
                </div>

                <div className="mt-3 grid gap-2 text-[11px] text-muted-foreground sm:grid-cols-3">
                  <div className="flex items-center gap-1.5">
                    <Check className="h-3 w-3 text-primary" /> Foco no centro da imagem
                  </div>
                  <div className="flex items-center gap-1.5">
                    <Check className="h-3 w-3 text-primary" /> Boa iluminação e nitidez
                  </div>
                  <div className="flex items-center gap-1.5">
                    <Check className="h-3 w-3 text-primary" /> Evite textos pequenos
                  </div>
                </div>
              </div>
            </div>

            {/* Product image hint */}
            <div className="mt-4 flex items-start gap-3 rounded-xl border border-border bg-muted/30 p-4">
              <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-primary/15 text-primary">
                <Package className="h-3.5 w-3.5" />
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-xs font-semibold uppercase tracking-wider text-foreground">
                  Imagens dos produtos
                </p>
                <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                  Use fotos quadradas em alta resolução —{" "}
                  <span className="font-semibold text-foreground">1080 × 1080 px</span> (proporção 1:1).
                  Aparecem em destaque ao abrir o produto e na hora de adicionar ao carrinho — mantenha qualidade e enquadramento.
                </p>
              </div>
            </div>
          </div>

          {/* Sticky Save Bar — Visual */}
          {visualDirty && (
            <div className="sticky bottom-4 z-10 flex items-center justify-between gap-3 rounded-2xl border border-primary/30 bg-card/95 p-3 pl-5 shadow-lg backdrop-blur">
              <span className="text-sm font-medium text-foreground">
                Você tem alterações não salvas no visual
              </span>
              <Button variant="cta" onClick={handleSaveVisual} disabled={savingVisual}>
                <Save className="h-4 w-4" /> {savingVisual ? "Salvando..." : "Salvar alterações"}
              </Button>
            </div>
          )}
        </TabsContent>

        {/* INFO */}
        <TabsContent value="info" className="space-y-5">
          {/* Identificação */}
          <section className="overflow-hidden rounded-2xl border border-border bg-card shadow-sm">
            <header className="flex items-center gap-3 border-b border-border bg-gradient-to-r from-primary/5 via-card to-card px-6 py-4">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary/10 text-primary">
                <TagIcon className="h-5 w-5" />
              </div>
              <div>
                <h3 className="font-display text-lg font-semibold tracking-tight">Identificação</h3>
                <p className="text-xs text-muted-foreground">Como seu cardápio aparece para os clientes.</p>
              </div>
            </header>
            <div className="grid gap-5 p-6 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  Nome do cardápio
                </Label>
                <Input
                  value={menu.name}
                  onChange={(e) => {
                    setMenu({ ...menu, name: e.target.value.toUpperCase() });
                    setInfoDirty(true);
                    setMenuNameDirty(true);
                  }}
                  placeholder="MEU RESTAURANTE"
                  className="h-11 text-base font-semibold uppercase tracking-wide"
                  style={{ textTransform: "uppercase" }}
                />
                <p className="text-[11px] text-muted-foreground">Sempre exibido em maiúsculas.</p>
              </div>
              <div className="space-y-1.5">
                <Label className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  <MessageCircle className="h-3.5 w-3.5 text-emerald-500" />
                  WhatsApp para pedidos
                </Label>
                <Input
                  value={formatPhoneBR(settings.whatsapp_number || "")}
                  onChange={(e) => {
                    const raw = onlyDigits(e.target.value).slice(0, 11);
                    setSettings({ ...settings, whatsapp_number: raw });
                    setInfoDirty(true);
                  }}
                  placeholder="(11) 99999-9999"
                  inputMode="numeric"
                  className="h-11 text-base font-medium tracking-wide"
                />
                <p className="text-[11px] text-muted-foreground">Inclua o DDD. Os pedidos chegam neste número.</p>
              </div>
            </div>
          </section>

          {/* Informações da loja */}
          <section className="overflow-hidden rounded-2xl border border-border bg-card shadow-sm">
            <header className="flex flex-wrap items-center justify-between gap-3 border-b border-border bg-gradient-to-r from-primary/5 via-card to-card px-6 py-4">
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary/10 text-primary">
                  <Info className="h-5 w-5" />
                </div>
                <div>
                  <h3 className="font-display text-lg font-semibold tracking-tight">Informações da loja</h3>
                  <p className="text-xs text-muted-foreground">
                    Aparecem no botão de informações dentro do cardápio público.
                  </p>
                </div>
              </div>
              <label className="group flex shrink-0 cursor-pointer items-center gap-2.5 rounded-full border border-border bg-background px-4 py-2 shadow-sm transition-all hover:border-primary/40">
                <span className="relative flex h-2.5 w-2.5">
                  {settings.is_open && (
                    <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-500 opacity-60" />
                  )}
                  <span
                    className={`relative inline-flex h-2.5 w-2.5 rounded-full ${
                      settings.is_open ? "bg-emerald-500" : "bg-red-500"
                    }`}
                  />
                </span>
                <span className="text-xs font-semibold tracking-wide">
                  {settings.is_open ? "Aberto agora" : "Fechado"}
                </span>
                <Switch
                  checked={settings.is_open}
                  onCheckedChange={(v) => { setSettings({ ...settings, is_open: v }); setInfoDirty(true); }}
                />
              </label>
            </header>

            <div className="space-y-5 p-6">
              {/* Horário de atendimento estruturado */}
              <div className="rounded-xl border border-border/70 bg-muted/30 p-4">
                <div className="mb-3 flex items-center gap-2">
                  <Clock className="h-4 w-4 text-primary" />
                  <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                    Horário de atendimento
                  </span>
                </div>
                <BusinessHoursDialog
                  value={settings.business_hours}
                  onSave={async (bh) => {
                    const next = { ...settings, business_hours: bh, is_open: isOpenNow(bh) };
                    setSettings(next);
                    await saveSettings(next);
                  }}
                />
              </div>

              <div className="grid gap-5 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                    <Timer className="h-3.5 w-3.5" />
                    Tempo estimado de entrega
                  </Label>
                  <Input
                    value={settings.delivery_time || ""}
                    onChange={(e) => { setSettings({ ...settings, delivery_time: e.target.value }); setInfoDirty(true); }}
                    placeholder="30-45 min"
                    className="h-11 text-base"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                    <Phone className="h-3.5 w-3.5" />
                    Telefone (exibição)
                  </Label>
                  <Input
                    value={formatPhoneBR(settings.phone || "")}
                    onChange={(e) => {
                      const raw = onlyDigits(e.target.value).slice(0, 11);
                      setSettings({ ...settings, phone: raw });
                      setInfoDirty(true);
                    }}
                    placeholder="(11) 99999-9999"
                    inputMode="numeric"
                    className="h-11 text-base font-medium tracking-wide"
                  />
                </div>
                <div className="space-y-1.5 sm:col-span-2">
                  <Label className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                    <MapPin className="h-3.5 w-3.5" />
                    Endereço
                  </Label>
                  <Input
                    value={settings.address || ""}
                    onChange={(e) => { setSettings({ ...settings, address: e.target.value }); setInfoDirty(true); }}
                    placeholder="Rua Exemplo, 123 - Bairro"
                    className="h-11 text-base"
                  />
                </div>
              </div>
            </div>
          </section>

          {/* Pedidos & entrega */}
          <section className="overflow-hidden rounded-2xl border border-border bg-card shadow-sm">
            <header className="flex items-center gap-3 border-b border-border bg-gradient-to-r from-primary/5 via-card to-card px-6 py-4">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary/10 text-primary">
                <Bike className="h-5 w-5" />
              </div>
              <div>
                <h3 className="font-display text-lg font-semibold tracking-tight">Pedidos & entrega</h3>
                <p className="text-xs text-muted-foreground">
                  Escolha as formas de pedido aceitas e a taxa de entrega.
                </p>
              </div>
            </header>

            <div className="space-y-5 p-6">
              <div className="grid gap-3 sm:grid-cols-3">
                <OrderTypeToggle
                  icon={<Bike className="h-5 w-5" />}
                  title="Entrega"
                  description="Pedidos com endereço completo"
                  checked={settings.accept_delivery}
                  onChange={(v) => { setSettings({ ...settings, accept_delivery: v }); setInfoDirty(true); }}
                />
                <OrderTypeToggle
                  icon={<Store className="h-5 w-5" />}
                  title="Retirada"
                  description="Cliente busca no balcão"
                  checked={settings.accept_pickup}
                  onChange={(v) => { setSettings({ ...settings, accept_pickup: v }); setInfoDirty(true); }}
                />
                <OrderTypeToggle
                  icon={<Truck className="h-5 w-5" />}
                  title="Comer no local"
                  description="Pedidos consumidos no salão"
                  checked={settings.accept_dine_in}
                  onChange={(v) => { setSettings({ ...settings, accept_dine_in: v }); setInfoDirty(true); }}
                />
              </div>

              <div className="max-w-xs space-y-1.5">
                <Label className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  <Wallet className="h-3.5 w-3.5" />
                  Taxa de entrega (R$)
                </Label>
                <MoneyInput
                  value={settings.delivery_fee ?? null}
                  onValueChange={(v) => { setSettings({ ...settings, delivery_fee: v ?? 0 }); setInfoDirty(true); }}
                  disabled={!settings.accept_delivery}
                  className="h-11 text-base font-semibold"
                  placeholder="0,00"
                />
                <p className="text-[11px] text-muted-foreground">Use 0 se a entrega for gratuita.</p>
              </div>
            </div>

            {/* Agendamento de pedidos */}
            <div className="mt-6 rounded-2xl border border-border bg-muted/10 p-5">
              <div className="mb-4 flex items-start justify-between gap-4">
                <div className="flex items-start gap-3">
                  <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary/10 text-primary">
                    <Clock className="h-5 w-5" />
                  </span>
                  <div>
                    <h4 className="font-display text-base font-semibold tracking-tight">
                      Agendamento de pedidos
                    </h4>
                    <p className="text-xs text-muted-foreground">
                      Permita que clientes escolham um dia e horário futuros para receber/retirar.
                    </p>
                  </div>
                </div>
                <Switch
                  checked={settings.accept_scheduled}
                  onCheckedChange={(v) => { setSettings({ ...settings, accept_scheduled: v }); setInfoDirty(true); }}
                />
              </div>

              {settings.accept_scheduled && (
                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="space-y-1.5">
                    <Label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                      Antecedência mínima (minutos)
                    </Label>
                    <Input
                      type="number"
                      min={5}
                      max={1440}
                      value={settings.scheduling_min_minutes}
                      onChange={(e) => {
                        const n = Math.max(5, Math.min(1440, Number(e.target.value) || 30));
                        setSettings({ ...settings, scheduling_min_minutes: n });
                        setInfoDirty(true);
                      }}
                      className="h-11 text-base font-semibold"
                    />
                    <p className="text-[11px] text-muted-foreground">
                      Tempo mínimo entre o pedido e o horário agendado.
                    </p>
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                      Janela máxima (dias)
                    </Label>
                    <Input
                      type="number"
                      min={1}
                      max={60}
                      value={settings.scheduling_max_days}
                      onChange={(e) => {
                        const n = Math.max(1, Math.min(60, Number(e.target.value) || 7));
                        setSettings({ ...settings, scheduling_max_days: n });
                        setInfoDirty(true);
                      }}
                      className="h-11 text-base font-semibold"
                    />
                    <p className="text-[11px] text-muted-foreground">
                      Até quantos dias à frente o cliente pode agendar.
                    </p>
                  </div>
                </div>
              )}
            </div>
          </section>

          {/* ===== Promoção de Aniversário ===== */}
          <section className="overflow-hidden rounded-2xl border border-border bg-card shadow-sm">
            <header className="flex items-center gap-4 border-b border-border bg-gradient-to-r from-primary/5 via-card to-card px-6 py-5">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary/10 text-primary">
                <Gift className="h-5 w-5" />
              </div>
              <div>
                <h3 className="font-display text-lg font-semibold tracking-tight">Promoção de Aniversário</h3>
                <p className="text-xs text-muted-foreground">
                  Desconto automático para clientes que se cadastrarem e abrirem o cardápio no dia do aniversário.
                </p>
              </div>
            </header>

            <div className="space-y-5 p-6">
              <div className="flex items-start justify-between gap-4">
                <div className="flex items-start gap-3">
                  <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary/10 text-primary">
                    <Gift className="h-5 w-5" />
                  </span>
                  <div>
                    <h4 className="font-display text-base font-semibold tracking-tight">
                      Ativar promoção de aniversário
                    </h4>
                    <p className="text-xs text-muted-foreground">
                      O cliente informa a data de nascimento no primeiro pedido. No aniversário, vê desconto automático.
                    </p>
                  </div>
                </div>
                <Switch
                  checked={settings.birthday_promo_enabled}
                  onCheckedChange={(v) => { setSettings({ ...settings, birthday_promo_enabled: v }); setInfoDirty(true); }}
                />
              </div>

              {settings.birthday_promo_enabled && (
                <div className="max-w-xs space-y-1.5">
                  <Label className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                    <Percent className="h-3.5 w-3.5" />
                    Desconto (%)
                  </Label>
                  <Input
                    type="number"
                    min={1}
                    max={100}
                    value={settings.birthday_promo_percent}
                    onChange={(e) => {
                      const n = Math.max(1, Math.min(100, Number(e.target.value) || 10));
                      setSettings({ ...settings, birthday_promo_percent: n });
                      setInfoDirty(true);
                    }}
                    className="h-11 text-base font-semibold"
                    placeholder="10"
                  />
                  <p className="text-[11px] text-muted-foreground">
                    Desconto aplicado automaticamente no total do pedido do aniversariante.
                  </p>
                </div>
              )}
            </div>
          </section>

          {/* Sticky Save Bar — Info */}
          {infoDirty && (
            <div className="sticky bottom-4 z-10 flex items-center justify-between gap-3 rounded-2xl border border-primary/30 bg-card/95 p-3 pl-5 shadow-lg backdrop-blur">
              <span className="text-sm font-medium text-foreground">
                Você tem alterações não salvas
              </span>
              <Button variant="cta" onClick={handleSaveInfo} disabled={savingInfo}>
                <Save className="h-4 w-4" /> {savingInfo ? "Salvando..." : "Salvar alterações"}
              </Button>
            </div>
          )}
        </TabsContent>
      </Tabs>

      {/* PRODUCT DIALOG */}
      <Dialog open={productOpen} onOpenChange={setProductOpen}>
        <DialogContent className="flex flex-col gap-0 p-0 overflow-hidden max-h-[92vh] max-w-2xl max-sm:w-full max-sm:max-w-none max-sm:left-0 max-sm:right-0 max-sm:bottom-0 max-sm:top-auto max-sm:translate-x-0 max-sm:translate-y-0 max-sm:rounded-b-none max-sm:rounded-t-3xl max-sm:max-h-[92dvh]">
          {editingProduct && (
            <>
              {/* Drag handle — mobile only */}
              <div className="flex justify-center pt-3 pb-0 sm:hidden shrink-0">
                <div className="h-1 w-10 rounded-full bg-border" />
              </div>

              {/* Sticky header */}
              <div className="shrink-0 relative overflow-hidden border-b border-border bg-gradient-to-br from-primary/10 via-card to-card px-5 py-4 sm:px-6 sm:py-5">
                <DialogHeader>
                  <DialogTitle className="flex items-center gap-2.5 text-lg sm:text-xl font-display font-bold tracking-tight">
                    <span className="flex h-8 w-8 sm:h-9 sm:w-9 items-center justify-center rounded-xl bg-primary text-primary-foreground shadow-md">
                      <Package className="h-4 w-4 sm:h-5 sm:w-5" />
                    </span>
                    {editingProduct?.id ? "Editar produto" : "Novo produto"}
                  </DialogTitle>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {editingProduct?.id
                      ? "Atualize as informações deste item do cardápio."
                      : "Cadastre um novo item para aparecer no seu cardápio."}
                  </p>
                </DialogHeader>
              </div>

              {/* Scrollable content */}
              <div className="flex-1 overflow-y-auto overscroll-contain space-y-5 p-5 sm:space-y-6 sm:p-6">

                {/* Foto + nome */}
                <section className="rounded-2xl border border-border bg-muted/20 p-4 sm:p-5">
                  <div className="flex items-center gap-4">
                    <button
                      type="button"
                      onClick={() => productImageInput.current?.click()}
                      className="relative shrink-0 group"
                      aria-label="Enviar foto"
                    >
                      <div className="h-20 w-20 sm:h-24 sm:w-24 overflow-hidden rounded-xl border-2 border-border bg-card shadow-sm flex items-center justify-center transition-opacity group-active:opacity-70">
                        {editingProduct.image_url ? (
                          <img src={editingProduct.image_url} alt="" className="h-full w-full object-cover" loading="lazy" decoding="async" />
                        ) : (
                          <ImageIcon className="h-6 w-6 sm:h-7 sm:w-7 text-muted-foreground" />
                        )}
                      </div>
                      <span className="absolute -bottom-2 -right-2 flex h-8 w-8 sm:h-9 sm:w-9 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-md transition-transform group-hover:scale-105">
                        <Upload className="h-3.5 w-3.5 sm:h-4 sm:w-4" />
                      </span>
                    </button>
                    <input type="file" accept="image/*" ref={productImageInput} onChange={handleProductImage} className="hidden" />
                    <div className="flex-1 min-w-0 space-y-1.5">
                      <Label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                        Nome do produto
                      </Label>
                      <Input
                        value={editingProduct.name || ""}
                        onChange={(e) => setEditingProduct({ ...editingProduct, name: e.target.value })}
                        placeholder="Ex: X-Bacon Especial"
                        className="h-11 text-base font-semibold"
                      />
                      <p className="text-[11px] text-muted-foreground">A foto deixa o produto mais atraente para o cliente.</p>
                    </div>
                  </div>
                </section>

                {/* Descrição */}
                <div className="space-y-1.5">
                  <Label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                    Descrição
                  </Label>
                  <Textarea
                    value={editingProduct.description || ""}
                    onChange={(e) => setEditingProduct({ ...editingProduct, description: e.target.value })}
                    rows={3}
                    placeholder="Ex: Pão brioche, hambúrguer 180g, queijo cheddar, bacon crocante e molho da casa."
                    className="resize-none text-sm leading-relaxed"
                  />
                </div>

                {/* Preço + Categoria */}
                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="space-y-1.5">
                    <Label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                      Preço
                      {editingProduct.price_from_enabled && (
                        <span className="ml-2 text-xs text-muted-foreground font-normal">
                          (inativo - usando "a partir de")
                        </span>
                      )}
                    </Label>
                    <MoneyInput
                      value={editingProduct.price}
                      onValueChange={(v) => setEditingProduct({ ...editingProduct, price: v })}
                      className="h-11 text-base font-semibold"
                      placeholder="0,00"
                      disabled={editingProduct.price_from_enabled || false}
                    />
                    {editingProduct.price_from_enabled && (
                      <p className="text-xs text-muted-foreground mt-1">
                        Quando "Preço a partir de" está ativo, o preço principal não é utilizado
                      </p>
                    )}
                  </div>
                  <div className="space-y-1.5">
                    <Label className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                      <Tag className="h-3.5 w-3.5" />
                      Categoria
                    </Label>
                    <Select
                      value={editingProduct.category_id || "none"}
                      onValueChange={(v) =>
                        setEditingProduct({ ...editingProduct, category_id: v === "none" ? null : v })
                      }
                    >
                      <SelectTrigger className="h-11">
                        <SelectValue placeholder="Sem categoria" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="none">Sem categoria</SelectItem>
                        {categories.map((c) => (
                          <SelectItem key={c.id} value={c.id}>
                            <span className="inline-flex items-center gap-2">
                              <CategoryIconView iconKey={c.icon} size={18} />
                              {c.name}
                            </span>
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    {categories.length === 0 && (
                      <p className="text-[11px] text-muted-foreground">
                        Crie categorias na aba "Categorias".
                      </p>
                    )}
                  </div>
                </div>

                {/* Preço a partir de */}
                <div className="rounded-2xl border border-border bg-muted/20 p-4 sm:p-5">
                  <div className="mb-4 flex items-center gap-2.5">
                    <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary/10 text-primary">
                      <Wallet className="h-4 w-4" />
                    </span>
                    <div>
                      <h4 className="font-display text-sm font-semibold tracking-tight">Preço a partir de</h4>
                      <p className="text-[11px] text-muted-foreground">Ideal para bebidas com diferentes tamanhos/adicionais.</p>
                    </div>
                  </div>
                  <div className="space-y-4">
                    <div className="flex items-center justify-between">
                      <Label className="text-sm font-medium">Mostrar "a partir de"</Label>
                      <Switch
                        checked={editingProduct.price_from_enabled || false}
                        onCheckedChange={(checked) =>
                          setEditingProduct({ ...editingProduct, price_from_enabled: checked })
                        }
                      />
                    </div>
                    {editingProduct.price_from_enabled && (
                      <div className="space-y-1.5">
                        <Label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                          Valor mínimo
                        </Label>
                        <MoneyInput
                          value={editingProduct.price_from_value}
                          onValueChange={(v) => setEditingProduct({ ...editingProduct, price_from_value: v })}
                          className="h-11 text-base font-semibold"
                          placeholder="0,00"
                        />
                        <p className="text-[11px] text-muted-foreground">
                          Será exibido "A partir de R$ X,XX" no cardápio
                        </p>
                      </div>
                    )}
                  </div>
                </div>

                {/* Adicionais — só após o produto existir */}
                {editingProduct.id && user && (
                  <div className="rounded-2xl border border-border bg-muted/20 p-4 sm:p-5">
                    <div className="mb-4 flex items-center gap-2.5">
                      <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary/10 text-primary">
                        <Sparkles className="h-4 w-4" />
                      </span>
                      <div>
                        <h4 className="font-display text-sm font-semibold tracking-tight">Adicionais deste produto</h4>
                        <p className="text-[11px] text-muted-foreground">Vincule da biblioteca ou crie grupos exclusivos.</p>
                      </div>
                    </div>
                    <AddonsManager productId={editingProduct.id} userId={user.id} />
                  </div>
                )}

                {/* Receita / estoque — só após o produto existir */}
                {editingProduct.id && user && (
                  <div className="rounded-2xl border border-border bg-muted/20 p-4 sm:p-5">
                    <div className="mb-4 flex items-center gap-2.5">
                      <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary/10 text-primary">
                        <Package className="h-4 w-4" />
                      </span>
                      <div>
                        <h4 className="font-display text-sm font-semibold tracking-tight">Receita (estoque)</h4>
                        <p className="text-[11px] text-muted-foreground">Insumos consumidos por venda — baixa automática.</p>
                      </div>
                    </div>
                    <RecipeManager productId={editingProduct.id} />
                  </div>
                )}

                {!editingProduct.id && (
                  <p className="rounded-xl border border-dashed border-border bg-muted/30 p-4 text-center text-xs text-muted-foreground">
                    💡 Salve o produto primeiro para configurar adicionais.
                  </p>
                )}
              </div>

              {/* Sticky save footer */}
              <div className="shrink-0 border-t border-border bg-card/95 backdrop-blur-sm px-5 py-4 sm:px-6">
                <Button
                  variant="cta"
                  size="lg"
                  className="w-full"
                  onClick={saveProduct}
                  disabled={savingProduct}
                >
                  <Save className="h-4 w-4" />
                  {savingProduct ? "Salvando..." : "Salvar produto"}
                </Button>
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>

      {/* CATEGORY DIALOG */}
      <Dialog open={categoryOpen} onOpenChange={setCategoryOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{editingCategory?.id ? "Editar categoria" : "Nova categoria"}</DialogTitle>
          </DialogHeader>
          {editingCategory && (
            <div className="space-y-4">
              <div>
                <Label>Ícone e nome</Label>
                <div className="mt-1.5 flex items-center gap-2">
                  <IconPicker
                    value={editingCategory.icon || "utensils"}
                    onChange={(key) => setEditingCategory({ ...editingCategory, icon: key })}
                  />
                  <Input
                    value={editingCategory.name || ""}
                    onChange={(e) =>
                      setEditingCategory({ ...editingCategory, name: e.target.value })
                    }
                    placeholder="Lanches"
                    className="flex-1"
                  />
                </div>
                <p className="mt-1.5 text-xs text-muted-foreground">
                  O nome aparece em maiúsculas no cardápio com o ícone acima.
                </p>
              </div>

              {/* Preview */}
              <div className="rounded-xl border border-border bg-muted/30 p-5">
                <div className="flex flex-col items-center gap-2">
                  {(() => {
                    const data = getCategoryIconData(editingCategory.icon);
                    if (data.image) {
                      return <CategoryIconView iconKey={editingCategory.icon} size={64} />;
                    }
                    const Icon = data.Icon;
                    return (
                      <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-primary text-primary-foreground shadow-md">
                        <Icon className="h-7 w-7" />
                      </div>
                    );
                  })()}
                  <div className="text-sm font-bold uppercase tracking-[0.15em] text-foreground">
                    {(editingCategory.name || "").trim() || "Nome da categoria"}
                  </div>
                </div>
              </div>

              <Button variant="cta" className="w-full" onClick={saveCategory} disabled={savingCategory}>
                {savingCategory ? "Salvando..." : "Salvar categoria"}
              </Button>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
};

function OrderTypeToggle({
  icon,
  title,
  description,
  checked,
  onChange,
}: {
  icon: React.ReactNode;
  title: string;
  description: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <div
      className={`flex items-start gap-3 rounded-xl border-2 p-4 transition-all ${
        checked ? "border-primary bg-primary/5" : "border-border bg-card"
      }`}
    >
      <div
        className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-lg ${
          checked ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground"
        }`}
      >
        {icon}
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center justify-between gap-2">
          <span className="text-sm font-semibold">{title}</span>
          <Switch checked={checked} onCheckedChange={onChange} />
        </div>
        <p className="mt-1 text-xs text-muted-foreground">{description}</p>
      </div>
    </div>
  );
}

export default MenuEditor;
