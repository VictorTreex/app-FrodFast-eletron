import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Route, Routes } from "react-router-dom";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { FixedAuthProvider } from "@/contexts/FixedAuthContext";
import { ThemeProvider } from "@/contexts/ThemeContext";
import { EditingProvider } from "@/contexts/EditingContext";
import { lazy, Suspense } from "react";
import { RealtimeOrderListener } from "@/components/RealtimeOrderListener";

// Public landing kept eager for instant first paint
import Index from "./pages/Index";

// Dashboard pages bundled together — navigation between them must be instant
import DashboardLayout from "./pages/dashboard/DashboardLayout";
import MenusList from "./pages/dashboard/MenusList";
import MenuEditor from "./pages/dashboard/MenuEditor";
import Settings from "./pages/dashboard/Settings";
import PlanPage from "./pages/dashboard/PlanPage";
import Sales from "./pages/dashboard/Sales";
import Orders from "./pages/dashboard/Orders";
import Inventory from "./pages/dashboard/Inventory";
import WhatsApp from "./pages/dashboard/WhatsApp";
import AddonLibrary from "./pages/dashboard/AddonLibrary";
import Customers from "./pages/dashboard/Customers";
import GlobalOrderNotifier from "./components/GlobalOrderNotifier";

// Only truly separate routes stay lazy
const Auth = lazy(() => import("./pages/Auth"));
const NotFound = lazy(() => import("./pages/NotFound"));
const PublicMenu = lazy(() => import("./pages/PublicMenu"));
const Admin = lazy(() => import("./pages/Admin"));
const Checkout = lazy(() => import("./pages/payment/Checkout"));
const PaymentSuccess = lazy(() => import("./pages/payment/PaymentSuccess"));
const PaymentFailed = lazy(() => import("./pages/payment/PaymentFailed"));

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      gcTime: 5 * 60_000,
      refetchOnWindowFocus: false,
      retry: 1,
    },
  },
});

// Fallback leve para rotas com lazy load — sem spinner bloqueante.
// Mantém o usuário vendo o background imediatamente enquanto o chunk chega.
const RouteFallback = () => <div className="min-h-screen bg-background" />;

const App = () => (
  <QueryClientProvider client={queryClient}>
    <ThemeProvider>
      <TooltipProvider>
        <Toaster />
        <Sonner />
        <BrowserRouter>
          <EditingProvider>
            <FixedAuthProvider>
            <GlobalOrderNotifier />
            <RealtimeOrderListener />
            <Suspense fallback={<RouteFallback />}>
              <Routes>
                <Route path="/" element={<Index />} />
                <Route path="/auth" element={<Auth />} />
                <Route path="/menu/:slug" element={<PublicMenu />} />
                <Route path="/admin" element={<Admin />} />
                <Route path="/checkout" element={<Checkout />} />
                <Route path="/payment/success" element={<PaymentSuccess />} />
                <Route path="/payment/failed" element={<PaymentFailed />} />
                <Route path="/dashboard" element={<DashboardLayout />}>
                  <Route index element={<MenusList />} />
                  <Route path="cardapio/:menuId" element={<MenuEditor />} />
                  <Route path="pedidos" element={<Orders />} />
                  <Route path="estoque" element={<Inventory />} />
                  <Route path="whatsapp" element={<WhatsApp />} />
                  <Route path="vendas" element={<Sales />} />
                  <Route path="adicionais" element={<AddonLibrary />} />
                  <Route path="clientes" element={<Customers />} />
                  <Route path="configuracoes" element={<Settings />} />
                  <Route path="plano" element={<PlanPage />} />
                                  </Route>
                <Route path="*" element={<NotFound />} />
              </Routes>
            </Suspense>
            </FixedAuthProvider>
          </EditingProvider>
        </BrowserRouter>
      </TooltipProvider>
    </ThemeProvider>
  </QueryClientProvider>
);

export default App;
