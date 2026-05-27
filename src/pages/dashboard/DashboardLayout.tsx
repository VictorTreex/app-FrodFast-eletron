import { Outlet, NavLink as RRNavLink, Navigate, useNavigate } from "react-router-dom";
import { LayoutGrid, Settings, CreditCard, LogOut, UtensilsCrossed, BarChart3, Package, Boxes, Moon, Sun, MessageSquare, Shield } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { useTheme } from "@/contexts/ThemeContext";
import { Logo } from "@/components/Logo";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { UpdateBanner } from "@/components/UpdateBanner";

const baseItems = [
  { to: "/dashboard", label: "Cardápios", icon: LayoutGrid, end: true },
  { to: "/dashboard/pedidos", label: "Pedidos", icon: Package },
  { to: "/dashboard/estoque", label: "Estoque", icon: Boxes },
  { to: "/dashboard/whatsapp", label: "WhatsApp", icon: MessageSquare },
  { to: "/dashboard/vendas", label: "Vendas", icon: BarChart3 },
  { to: "/dashboard/configuracoes", label: "Configurações", icon: Settings },
  { to: "/dashboard/plano", label: "Plano", icon: CreditCard },
];
const adminPageItem = { to: "/admin", label: "Administração", icon: Shield, end: false };

const DashboardLayout = () => {
  const { user, loading, signOut } = useAuth();
  const { theme, toggleTheme } = useTheme();
  const navigate = useNavigate();
  const [restaurantName, setRestaurantName] = useState<string>("");
  const [isAdmin, setIsAdmin] = useState(false);

  useEffect(() => {
    if (!user) return;
    
    // Carregar nome do restaurante
    supabase.from("profiles").select("restaurant_name").eq("id", user.id).maybeSingle()
      .then(({ data, error }) => {
        if (error) {
          console.error("Erro ao carregar nome do restaurante:", error);
        } else if (data?.restaurant_name) {
          setRestaurantName(data.restaurant_name);
        }
      });
    
    // Verificar se é admin via Edge Function
    supabase.functions.invoke("check-user-role", {
      body: { user_id: user.id, role: "admin" }
    })
    .then(({ data, error }) => {
      if (error) {
        console.error("Erro ao verificar permissões de admin:", error);
        setIsAdmin(false);
      } else {
        setIsAdmin(data?.hasRole || false);
      }
    });
  }, [user]);

  const items = isAdmin ? [...baseItems, adminPageItem] : baseItems;

  // Não bloqueia o render com spinner fullscreen.
  // Se ainda está carregando a sessão, deixa a UI base aparecer; só redireciona quando confirmamos que NÃO há usuário.
  if (!loading && !user) return <Navigate to="/auth" replace />;

  return (
    <div className="flex min-h-screen w-full bg-muted/40">
      <UpdateBanner />
      <aside className="hidden lg:flex fixed inset-y-0 left-0 z-30 w-72 flex-col border-r border-sidebar-border bg-sidebar">
        {/* Brand */}
        <div className="flex h-32 items-center justify-center border-b border-sidebar-border px-4">
          <Logo imgClassName="h-24" />
        </div>

        {/* Restaurant card */}
        <div className="px-4 pt-5">
          <div className="relative overflow-hidden rounded-xl border border-sidebar-border bg-gradient-to-br from-sidebar-accent to-sidebar-accent/40 px-4 py-3.5">
            <div className="absolute -right-6 -top-6 h-20 w-20 rounded-full bg-primary/10 blur-2xl" />
            <div className="relative flex items-center gap-3">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg gradient-brand text-base font-bold uppercase text-primary-foreground shadow-brand">
                {(restaurantName || "—").trim().charAt(0).toUpperCase()}
              </div>
              <div className="min-w-0">
                <div className="text-[11px] font-medium uppercase tracking-wider text-sidebar-foreground/60">
                  Restaurante
                </div>
                <div className="truncate text-sm font-semibold uppercase text-sidebar-foreground">
                  {restaurantName || "—"}
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Nav */}
        <nav className="flex-1 space-y-1 px-3 pt-6">
          <div className="px-3 pb-2 text-[11px] font-semibold uppercase tracking-wider text-sidebar-foreground/50">
            Menu
          </div>
          {items.map((it) => (
            <RRNavLink
              key={it.to}
              to={it.to}
              end={it.end}
              className={({ isActive }) =>
                `group relative flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-all duration-200 ${
                  isActive
                    ? "bg-primary text-primary-foreground shadow-brand"
                    : "text-sidebar-foreground/80 hover:bg-sidebar-accent hover:text-sidebar-foreground"
                }`
              }
            >
              {({ isActive }) => (
                <>
                  <span
                    className={`absolute left-0 top-1/2 h-6 w-1 -translate-y-1/2 rounded-r-full bg-primary-foreground transition-opacity ${
                      isActive ? "opacity-100" : "opacity-0"
                    }`}
                  />
                  <span
                    className={`flex h-8 w-8 items-center justify-center rounded-lg transition-colors ${
                      isActive
                        ? "bg-primary-foreground/15"
                        : "bg-sidebar-accent/50 group-hover:bg-sidebar-accent"
                    }`}
                  >
                    <it.icon className="h-4 w-4" />
                  </span>
                  {it.label}
                </>
              )}
            </RRNavLink>
          ))}
        </nav>

        {/* Footer */}
        <div className="space-y-2 border-t border-sidebar-border p-4">
          <button
            type="button"
            onClick={toggleTheme}
            className="flex w-full items-center justify-between rounded-xl border border-sidebar-border bg-sidebar-accent/40 px-3 py-2.5 text-sm font-medium text-sidebar-foreground transition-colors hover:bg-sidebar-accent"
            aria-label="Alternar tema"
          >
            <span className="flex items-center gap-2.5">
              <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-sidebar-accent">
                {theme === "dark" ? <Moon className="h-3.5 w-3.5" /> : <Sun className="h-3.5 w-3.5" />}
              </span>
              Modo escuro
            </span>
            <Switch
              checked={theme === "dark"}
              onCheckedChange={toggleTheme}
              onClick={(e) => e.stopPropagation()}
              aria-label="Modo escuro"
            />
          </button>

          <button
            type="button"
            onClick={async () => {
              await signOut();
              navigate("/");
            }}
            className="flex w-full items-center gap-2.5 rounded-xl px-3 py-2.5 text-sm font-medium text-sidebar-foreground/80 transition-colors hover:bg-destructive/10 hover:text-destructive"
          >
            <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-sidebar-accent/60">
              <LogOut className="h-3.5 w-3.5" />
            </span>
            Sair
          </button>
        </div>
      </aside>

      {/* Mobile top bar */}
      <div className="lg:hidden fixed top-0 left-0 right-0 z-40 flex h-16 items-center justify-between border-b border-border bg-background px-4">
        <Logo imgClassName="h-14" />
        <div className="flex items-center gap-1">
          <Button variant="ghost" size="sm" onClick={toggleTheme} aria-label="Alternar tema">
            {theme === "dark" ? <Moon className="h-4 w-4" /> : <Sun className="h-4 w-4" />}
          </Button>
          <Button variant="ghost" size="sm" onClick={async () => { await signOut(); navigate("/"); }}>
            <LogOut className="h-4 w-4" />
          </Button>
        </div>
      </div>

      <main className="flex-1 lg:pl-72 pt-16 lg:pt-0">
        {/* Mobile bottom nav */}
        <nav className="fixed bottom-0 left-0 right-0 z-40 flex border-t border-border bg-background lg:hidden">
          {items.map((it) => (
            <RRNavLink
              key={it.to}
              to={it.to}
              end={it.end}
              className={({ isActive }) =>
                `flex flex-1 flex-col items-center gap-1 py-2.5 text-xs font-medium ${
                  isActive ? "text-primary" : "text-muted-foreground"
                }`
              }
            >
              <it.icon className="h-5 w-5" />
              {it.label}
            </RRNavLink>
          ))}
        </nav>

        <div className="pb-20 lg:pb-0">
          <Outlet />
        </div>
      </main>
    </div>
  );
};

export default DashboardLayout;
