import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Search, Users, Gift, Phone, Calendar, UtensilsCrossed, X,
  Trophy, Star, Save, Loader2, Coins, TrendingUp, Crown,
} from "lucide-react";
import { toast } from "sonner";

/* ─── Types ────────────────────────────────────────────────── */

interface Customer {
  id: string;
  menu_id: string;
  name: string;
  phone: string;
  birth_date: string | null;
  points: number;
  created_at: string;
}

interface Menu {
  id: string;
  name: string;
}

interface MenuSettings {
  menu_id: string;
  points_enabled: boolean;
  points_mode: string;
  points_percent: number;
  points_per_value: number;
}

const DEFAULT_SETTINGS: MenuSettings = {
  menu_id: "",
  points_enabled: false,
  points_mode: "per_value",
  points_percent: 5,
  points_per_value: 10,
};

/* ─── Helpers ───────────────────────────────────────────────── */

const isBirthdayToday = (d: string | null) => {
  if (!d) return false;
  const today = new Date();
  const [, m, day] = d.split("-").map(Number);
  return today.getMonth() + 1 === m && today.getDate() === day;
};

const fmtDate = (iso: string) =>
  new Date(iso).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric" });

const fmtBirthday = (d: string | null) => {
  if (!d) return null;
  const [, m, day] = d.split("-");
  return `${day}/${m}`;
};

const initials = (name: string) =>
  name.trim().split(" ").slice(0, 2).map((w) => w[0]?.toUpperCase() || "").join("");

const COLORS = ["#6C2BD9", "#E53E3E", "#DD6B20", "#2F855A", "#2B6CB0", "#B7791F", "#C53030", "#285E61"];
const avatarColor = (id: string) => COLORS[id.charCodeAt(0) % COLORS.length];

const calcPoints = (total: number, cfg: MenuSettings): number => {
  if (!cfg.points_enabled) return 0;
  if (cfg.points_mode === "percent")
    return Math.floor((total * (cfg.points_percent || 5)) / 100);
  return Math.floor(total / (cfg.points_per_value || 10));
};

/* ─── Main component ────────────────────────────────────────── */

const Customers = () => {
  const { user } = useAuth();

  // ── Shared
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [menus, setMenus] = useState<Menu[]>([]);
  const [loading, setLoading] = useState(true);

  // ── Clientes tab
  const [search, setSearch] = useState("");

  // ── Fidelidade tab
  const [selectedMenuId, setSelectedMenuId] = useState("");
  const [cfg, setCfg] = useState<MenuSettings>(DEFAULT_SETTINGS);
  const [loadingCfg, setLoadingCfg] = useState(false);
  const [savingCfg, setSavingCfg] = useState(false);

  /* Load customers + menus */
  useEffect(() => {
    if (!user) return;
    const load = async () => {
      setLoading(true);
      const { data: menuData } = await supabase
        .from("menus")
        .select("id, name")
        .eq("user_id", user.id);
      const allMenus = (menuData || []) as Menu[];
      setMenus(allMenus);
      if (allMenus.length > 0) setSelectedMenuId(allMenus[0].id);
      const ids = allMenus.map((m) => m.id);
      if (ids.length === 0) { setLoading(false); return; }
      const { data: customerData } = await (supabase as any)
        .from("menu_customers")
        .select("*")
        .in("menu_id", ids)
        .order("points", { ascending: false });
      setCustomers((customerData || []) as Customer[]);
      setLoading(false);
    };
    load();
  }, [user]);

  /* Load points config when selectedMenuId changes */
  useEffect(() => {
    if (!selectedMenuId) return;
    setLoadingCfg(true);
    supabase
      .from("menu_settings")
      .select("menu_id,points_enabled,points_mode,points_percent,points_per_value")
      .eq("menu_id", selectedMenuId)
      .maybeSingle()
      .then(({ data }) => {
        if (data) {
          setCfg({ ...DEFAULT_SETTINGS, ...(data as any), menu_id: selectedMenuId });
        } else {
          setCfg({ ...DEFAULT_SETTINGS, menu_id: selectedMenuId });
        }
        setLoadingCfg(false);
      });
  }, [selectedMenuId]);

  const saveConfig = async () => {
    if (!user || !cfg.menu_id) return;
    setSavingCfg(true);
    const { error } = await supabase
      .from("menu_settings")
      .update({
        points_enabled: cfg.points_enabled,
        points_mode: cfg.points_mode,
        points_percent: cfg.points_percent,
        points_per_value: cfg.points_per_value,
      })
      .eq("menu_id", cfg.menu_id);
    if (error) toast.error("Erro ao salvar configurações");
    else toast.success("Configurações de pontos salvas!");
    setSavingCfg(false);
  };

  /* Derived */
  const menuMap = useMemo(
    () => Object.fromEntries(menus.map((m) => [m.id, m.name])),
    [menus],
  );
  const todayBirthdays = useMemo(() => customers.filter((c) => isBirthdayToday(c.birth_date)), [customers]);
  const totalPoints = useMemo(() => customers.reduce((s, c) => s + (c.points || 0), 0), [customers]);
  const topByPoints = useMemo(() => [...customers].sort((a, b) => (b.points || 0) - (a.points || 0)).slice(0, 10), [customers]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return customers;
    return customers.filter(
      (c) =>
        c.name.toLowerCase().includes(q) ||
        c.phone.includes(q) ||
        (menuMap[c.menu_id] || "").toLowerCase().includes(q),
    );
  }, [customers, search, menuMap]);

  const previewPoints = calcPoints(50, cfg);
  const previewPoints100 = calcPoints(100, cfg);

  return (
    <div className="mx-auto max-w-5xl space-y-6 p-4 md:p-8">
      <header className="space-y-1">
        <h1 className="font-display text-2xl font-bold tracking-tight md:text-3xl">Clientes</h1>
        <p className="text-sm text-muted-foreground">
          Clientes cadastrados e programa de fidelidade por pontos.
        </p>
      </header>

      <Tabs defaultValue="clientes" className="space-y-6">
        <TabsList className="w-full sm:w-auto">
          <TabsTrigger value="clientes" className="gap-2 flex-1 sm:flex-none">
            <Users className="h-4 w-4" /> Clientes
          </TabsTrigger>
          <TabsTrigger value="fidelidade" className="gap-2 flex-1 sm:flex-none">
            <Star className="h-4 w-4" /> Fidelidade & Pontos
          </TabsTrigger>
        </TabsList>

        {/* ═══════════════ ABA CLIENTES ═══════════════ */}
        <TabsContent value="clientes" className="space-y-6">
          {/* Stats */}
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            <StatCard icon={<Users className="h-5 w-5" />} label="Total de clientes" value={customers.length} color="blue" />
            <StatCard icon={<Gift className="h-5 w-5" />} label="Aniversariantes hoje" value={todayBirthdays.length} color={todayBirthdays.length > 0 ? "green" : "muted"} />
            <StatCard icon={<Coins className="h-5 w-5" />} label="Pontos distribuídos" value={totalPoints} color="purple" />
            <StatCard icon={<Calendar className="h-5 w-5" />} label="Com data de nasc." value={customers.filter((c) => !!c.birth_date).length} color="orange" />
          </div>

          {/* Birthday highlight */}
          {todayBirthdays.length > 0 && (
            <div className="rounded-2xl border border-amber-400/40 bg-amber-50/60 p-4 dark:bg-amber-950/20">
              <div className="mb-3 flex items-center gap-2">
                <span className="text-xl">🎂</span>
                <span className="text-sm font-bold text-amber-700 dark:text-amber-400">
                  {todayBirthdays.length === 1 ? "1 aniversariante hoje!" : `${todayBirthdays.length} aniversariantes hoje!`}
                </span>
              </div>
              <div className="flex flex-wrap gap-2">
                {todayBirthdays.map((c) => (
                  <div key={c.id} className="flex items-center gap-2 rounded-full border border-amber-400/40 bg-white/60 px-3 py-1.5 dark:bg-amber-950/40">
                    <div className="flex h-6 w-6 items-center justify-center rounded-full text-[10px] font-extrabold text-white" style={{ background: avatarColor(c.id) }}>
                      {initials(c.name)}
                    </div>
                    <span className="text-sm font-semibold text-amber-800 dark:text-amber-300">{c.name}</span>
                    <span className="text-xs text-amber-600 dark:text-amber-400">{c.phone}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Search */}
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Buscar por nome, telefone ou cardápio…" className="h-11 pl-10 pr-9" />
            {search && (
              <button onClick={() => setSearch("")} className="absolute right-2.5 top-1/2 -translate-y-1/2 rounded-md p-0.5 text-muted-foreground hover:text-foreground" aria-label="Limpar busca">
                <X className="h-4 w-4" />
              </button>
            )}
          </div>

          {/* List */}
          {loading ? (
            <div className="space-y-3">{Array.from({ length: 5 }).map((_, i) => <div key={i} className="h-16 animate-pulse rounded-2xl border border-border bg-muted/40" />)}</div>
          ) : filtered.length === 0 ? (
            <EmptyState search={search} />
          ) : (
            <div className="overflow-hidden rounded-2xl border border-border bg-card shadow-sm">
              <div className="grid grid-cols-[1fr_auto_auto_auto] gap-3 border-b border-border bg-muted/30 px-5 py-3 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground sm:grid-cols-[1fr_150px_100px_90px_90px]">
                <span>Cliente</span>
                <span className="hidden sm:block">Cardápio</span>
                <span>Aniversário</span>
                <span className="hidden sm:block text-right">Pontos</span>
                <span className="hidden sm:block">Cadastro</span>
              </div>
              <div className="divide-y divide-border">
                {filtered.map((c, idx) => {
                  const birthday = isBirthdayToday(c.birth_date);
                  const pts = c.points || 0;
                  return (
                    <div key={c.id} className={`grid grid-cols-[1fr_auto_auto_auto] items-center gap-3 px-5 py-3.5 sm:grid-cols-[1fr_150px_100px_90px_90px] ${birthday ? "bg-amber-50/60 dark:bg-amber-950/20" : "hover:bg-muted/20"} transition-colors`}>
                      <div className="flex min-w-0 items-center gap-3">
                        <div className="relative flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-xs font-extrabold text-white shadow-sm" style={{ background: avatarColor(c.id) }}>
                          {initials(c.name)}
                          {idx === 0 && pts > 0 && (
                            <span className="absolute -right-1 -top-1 flex h-4 w-4 items-center justify-center rounded-full bg-amber-400 text-[9px]">👑</span>
                          )}
                        </div>
                        <div className="min-w-0">
                          <div className="flex items-center gap-1.5">
                            <span className="truncate text-sm font-semibold">{c.name}</span>
                            {birthday && <span className="text-base leading-none">🎂</span>}
                          </div>
                          <div className="flex items-center gap-1 text-xs text-muted-foreground">
                            <Phone className="h-3 w-3 shrink-0" />
                            <span className="tabular-nums">{c.phone}</span>
                          </div>
                        </div>
                      </div>
                      <span className="hidden truncate text-xs text-muted-foreground sm:block">{menuMap[c.menu_id] || "—"}</span>
                      <div>
                        {c.birth_date ? (
                          <span className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-bold ${birthday ? "bg-amber-100 text-amber-700 dark:bg-amber-900/50 dark:text-amber-300" : "bg-muted text-muted-foreground"}`}>
                            <Calendar className="h-3 w-3" />
                            {birthday ? `Hoje! ${fmtBirthday(c.birth_date)}` : fmtBirthday(c.birth_date)}
                          </span>
                        ) : <span className="text-xs text-muted-foreground/50">—</span>}
                      </div>
                      <div className="hidden sm:flex items-center justify-end gap-1">
                        {pts > 0 ? (
                          <span className="inline-flex items-center gap-1 rounded-full bg-primary/10 px-2.5 py-1 text-xs font-bold text-primary">
                            <Star className="h-3 w-3" /> {pts}
                          </span>
                        ) : <span className="text-xs text-muted-foreground/50">0</span>}
                      </div>
                      <span className="hidden text-xs tabular-nums text-muted-foreground sm:block">{fmtDate(c.created_at)}</span>
                    </div>
                  );
                })}
              </div>
              <div className="border-t border-border bg-muted/20 px-5 py-2.5 text-xs text-muted-foreground">
                {filtered.length === customers.length ? `${customers.length} cliente${customers.length !== 1 ? "s" : ""}` : `${filtered.length} de ${customers.length} clientes`}
              </div>
            </div>
          )}
        </TabsContent>

        {/* ═══════════════ ABA FIDELIDADE ═══════════════ */}
        <TabsContent value="fidelidade" className="space-y-6">
          <div className="grid gap-6 lg:grid-cols-2">

            {/* ── Configuração de Pontos ── */}
            <div className="overflow-hidden rounded-2xl border border-border bg-card shadow-sm">
              <div className="flex items-center gap-3 border-b border-border bg-gradient-to-r from-primary/5 via-card to-card px-6 py-5">
                <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary/10 text-primary">
                  <Star className="h-5 w-5" />
                </div>
                <div>
                  <h3 className="font-display text-base font-semibold">Programa de Pontos</h3>
                  <p className="text-xs text-muted-foreground">Configure como os clientes acumulam pontos.</p>
                </div>
              </div>
              <div className="space-y-5 p-6">
                {/* Menu selector */}
                {menus.length > 1 && (
                  <div className="space-y-1.5">
                    <Label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Cardápio</Label>
                    <Select value={selectedMenuId} onValueChange={setSelectedMenuId}>
                      <SelectTrigger className="h-10">
                        <SelectValue placeholder="Selecione o cardápio" />
                      </SelectTrigger>
                      <SelectContent>
                        {menus.map((m) => <SelectItem key={m.id} value={m.id}>{m.name}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                )}

                {loadingCfg ? (
                  <div className="flex items-center gap-2 py-4 text-sm text-muted-foreground">
                    <Loader2 className="h-4 w-4 animate-spin" /> Carregando...
                  </div>
                ) : (
                  <>
                    {/* Toggle */}
                    <div className="flex items-center justify-between gap-4">
                      <div>
                        <div className="text-sm font-semibold">Ativar programa de pontos</div>
                        <div className="text-xs text-muted-foreground">Clientes acumulam pontos a cada compra.</div>
                      </div>
                      <Switch
                        checked={cfg.points_enabled}
                        onCheckedChange={(v) => setCfg({ ...cfg, points_enabled: v })}
                      />
                    </div>

                    {cfg.points_enabled && (
                      <>
                        {/* Modo */}
                        <div className="space-y-2">
                          <Label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                            Como os pontos são calculados
                          </Label>
                          <div className="grid grid-cols-2 gap-2">
                            {[
                              { id: "per_value", emoji: "💵", title: "Por valor gasto", desc: "Ex: a cada R$ 10 = 1 ponto" },
                              { id: "percent", emoji: "📊", title: "Por porcentagem", desc: "Ex: 5% da compra = pontos" },
                            ].map((mode) => (
                              <button
                                key={mode.id}
                                type="button"
                                onClick={() => setCfg({ ...cfg, points_mode: mode.id })}
                                className={`flex flex-col gap-1 rounded-xl border-2 p-3 text-left text-xs font-semibold transition ${cfg.points_mode === mode.id ? "border-primary bg-primary/8" : "border-border hover:border-primary/40"}`}
                              >
                                <span className="text-lg">{mode.emoji}</span>
                                <span className="font-bold">{mode.title}</span>
                                <span className="font-normal text-muted-foreground">{mode.desc}</span>
                              </button>
                            ))}
                          </div>
                        </div>

                        {/* Valor */}
                        {cfg.points_mode === "per_value" ? (
                          <div className="space-y-1.5">
                            <Label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                              A cada R$ quanto = 1 ponto
                            </Label>
                            <Input
                              type="number"
                              min={1}
                              value={cfg.points_per_value}
                              onChange={(e) => setCfg({ ...cfg, points_per_value: Math.max(1, Number(e.target.value) || 10) })}
                              className="h-11 text-base font-semibold"
                              placeholder="10"
                            />
                            <p className="text-[11px] text-muted-foreground">
                              A cada R$ {cfg.points_per_value || 10},00 gastos o cliente ganha 1 ponto.
                            </p>
                          </div>
                        ) : (
                          <div className="space-y-1.5">
                            <Label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                              % da compra vira pontos
                            </Label>
                            <Input
                              type="number"
                              min={1}
                              max={100}
                              value={cfg.points_percent}
                              onChange={(e) => setCfg({ ...cfg, points_percent: Math.max(1, Math.min(100, Number(e.target.value) || 5)) })}
                              className="h-11 text-base font-semibold"
                              placeholder="5"
                            />
                            <p className="text-[11px] text-muted-foreground">
                              {cfg.points_percent || 5}% do valor da compra vira pontos.
                            </p>
                          </div>
                        )}

                        {/* Preview */}
                        <div className="rounded-xl border border-primary/20 bg-primary/5 p-4">
                          <div className="mb-2 text-xs font-bold uppercase tracking-wider text-primary">
                            Exemplo de acúmulo
                          </div>
                          <div className="space-y-1 text-sm">
                            <div className="flex items-center justify-between">
                              <span className="text-muted-foreground">Compra de R$ 50,00</span>
                              <span className="font-bold text-primary">
                                {previewPoints} ponto{previewPoints !== 1 ? "s" : ""}
                              </span>
                            </div>
                            <div className="flex items-center justify-between">
                              <span className="text-muted-foreground">Compra de R$ 100,00</span>
                              <span className="font-bold text-primary">
                                {previewPoints100} ponto{previewPoints100 !== 1 ? "s" : ""}
                              </span>
                            </div>
                          </div>
                        </div>
                      </>
                    )}

                    <Button onClick={saveConfig} disabled={savingCfg} className="w-full" variant="cta">
                      {savingCfg ? <><Loader2 className="h-4 w-4 animate-spin" /> Salvando...</> : <><Save className="h-4 w-4" /> Salvar configurações</>}
                    </Button>
                  </>
                )}
              </div>
            </div>

            {/* ── Ranking ── */}
            <div className="overflow-hidden rounded-2xl border border-border bg-card shadow-sm">
              <div className="flex items-center gap-3 border-b border-border bg-gradient-to-r from-amber-500/5 via-card to-card px-6 py-5">
                <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-amber-500/10 text-amber-500">
                  <Trophy className="h-5 w-5" />
                </div>
                <div>
                  <h3 className="font-display text-base font-semibold">Ranking de Pontos</h3>
                  <p className="text-xs text-muted-foreground">Top 10 clientes mais fiéis.</p>
                </div>
              </div>
              <div className="p-5">
                {loading ? (
                  <div className="space-y-3">{Array.from({ length: 5 }).map((_, i) => <div key={i} className="h-12 animate-pulse rounded-xl bg-muted/40" />)}</div>
                ) : topByPoints.filter((c) => (c.points || 0) > 0).length === 0 ? (
                  <div className="flex flex-col items-center justify-center py-10 text-center">
                    <div className="mb-3 text-4xl opacity-40">🏆</div>
                    <p className="text-sm font-semibold text-foreground">Nenhum ponto acumulado ainda</p>
                    <p className="mt-1 text-xs text-muted-foreground">Os pontos aparecem aqui quando os clientes fizerem pedidos.</p>
                  </div>
                ) : (
                  <div className="space-y-2">
                    {topByPoints.filter((c) => (c.points || 0) > 0).map((c, idx) => {
                      const pts = c.points || 0;
                      const maxPts = topByPoints[0]?.points || 1;
                      const pct = Math.max(8, Math.round((pts / maxPts) * 100));
                      const medal = idx === 0 ? "🥇" : idx === 1 ? "🥈" : idx === 2 ? "🥉" : null;
                      return (
                        <div key={c.id} className="flex items-center gap-3 rounded-xl px-3 py-2.5 hover:bg-muted/30 transition-colors">
                          <div className="w-6 text-center text-sm font-bold text-muted-foreground">
                            {medal || <span className="text-xs">{idx + 1}</span>}
                          </div>
                          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-[11px] font-extrabold text-white shadow-sm" style={{ background: avatarColor(c.id) }}>
                            {initials(c.name)}
                          </div>
                          <div className="min-w-0 flex-1">
                            <div className="truncate text-sm font-semibold">{c.name}</div>
                            <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-muted">
                              <div
                                className="h-full rounded-full bg-primary transition-all"
                                style={{ width: `${pct}%` }}
                              />
                            </div>
                          </div>
                          <span className="shrink-0 text-sm font-bold tabular-nums text-primary">
                            {pts} <span className="text-xs font-normal text-muted-foreground">pts</span>
                          </span>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Stats de pontos */}
          {totalPoints > 0 && (
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
              <StatCard icon={<Coins className="h-5 w-5" />} label="Total de pontos" value={totalPoints} color="purple" />
              <StatCard icon={<TrendingUp className="h-5 w-5" />} label="Clientes com pontos" value={customers.filter((c) => (c.points || 0) > 0).length} color="blue" />
              <StatCard icon={<Crown className="h-5 w-5" />} label="Maior saldo" value={topByPoints[0]?.points || 0} color="orange" />
            </div>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
};

/* ─── Sub-components ────────────────────────────────────────── */

const StatCard = ({
  icon, label, value, color,
}: {
  icon: React.ReactNode; label: string; value: number;
  color: "blue" | "green" | "purple" | "orange" | "muted";
}) => {
  const cls = {
    blue: "bg-blue-50 text-blue-600 dark:bg-blue-950/40 dark:text-blue-400",
    green: "bg-emerald-50 text-emerald-600 dark:bg-emerald-950/40 dark:text-emerald-400",
    purple: "bg-purple-50 text-purple-600 dark:bg-purple-950/40 dark:text-purple-400",
    orange: "bg-orange-50 text-orange-600 dark:bg-orange-950/40 dark:text-orange-400",
    muted: "bg-muted text-muted-foreground",
  };
  return (
    <div className="overflow-hidden rounded-2xl border border-border bg-card p-4 shadow-sm">
      <div className={`mb-3 inline-flex h-9 w-9 items-center justify-center rounded-xl ${cls[color]}`}>{icon}</div>
      <div className="text-2xl font-extrabold tabular-nums tracking-tight">{value.toLocaleString("pt-BR")}</div>
      <div className="mt-0.5 text-xs font-medium text-muted-foreground">{label}</div>
    </div>
  );
};

const EmptyState = ({ search }: { search: string }) => (
  <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-border py-16 text-center">
    <div className="flex h-14 w-14 items-center justify-center rounded-full bg-muted">
      <UtensilsCrossed className="h-6 w-6 text-muted-foreground" />
    </div>
    <p className="mt-4 text-sm font-semibold">{search ? "Nenhum cliente encontrado" : "Nenhum cliente cadastrado ainda"}</p>
    <p className="mt-1 max-w-xs text-xs text-muted-foreground">
      {search ? "Tente outros termos de busca." : "Os clientes aparecem aqui ao se cadastrarem no cardápio com data de nascimento."}
    </p>
  </div>
);

export default Customers;
