import React from 'react';
import { Check, Star, Calendar } from 'lucide-react';
import { Plan } from '@/services/paymentService';
import { Badge } from '@/components/ui/badge';

interface CheckoutSummaryProps {
  selectedPlan: Plan;
}

export const CheckoutSummary: React.FC<CheckoutSummaryProps> = ({ selectedPlan }) => {
  const formatPrice = (price: number) =>
    new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(price / 100);

  const durationLabel: Record<string, string> = {
    monthly: 'por mês',
    trimester: 'por 3 meses',
    annual: 'por ano',
  };

  const durationMonths: Record<string, string> = {
    monthly: '1 mês de acesso',
    trimester: '3 meses de acesso',
    annual: '12 meses de acesso',
  };

  return (
    <div className="bg-white/[0.03] border border-white/10 backdrop-blur-xl rounded-3xl overflow-hidden">
      {/* Top gradient stripe */}
      <div className="h-1 bg-gradient-to-r from-purple-500 via-pink-500 to-orange-500" />

      <div className="p-6 lg:p-7 space-y-6">
        {/* Plan label + badge */}
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-[11px] text-zinc-500 uppercase tracking-widest mb-1.5">Resumo do pedido</p>
            <h2 className="text-xl font-bold leading-tight">{selectedPlan.name}</h2>
          </div>
          {selectedPlan.popular && (
            <Badge className="bg-orange-500/20 text-orange-400 border-orange-500/30 shrink-0 text-xs">
              <Star className="h-2.5 w-2.5 mr-1 fill-current" />
              Popular
            </Badge>
          )}
        </div>

        {/* Price block */}
        <div className="bg-white/[0.03] rounded-2xl p-4 flex items-center justify-between gap-4 border border-white/5">
          <div>
            <p className="text-[11px] text-zinc-500 mb-1">Total a pagar</p>
            <div className="flex items-end gap-2">
              <span className="text-3xl font-bold tracking-tight">{formatPrice(selectedPlan.price)}</span>
              <span className="text-zinc-400 text-xs mb-0.5">
                {durationLabel[selectedPlan.duration] ?? 'por mês'}
              </span>
            </div>
          </div>
          <div className="flex items-center gap-1.5 text-xs text-zinc-400 bg-white/5 rounded-xl px-3 py-2 whitespace-nowrap">
            <Calendar className="h-3.5 w-3.5 text-purple-400 shrink-0" />
            {durationMonths[selectedPlan.duration] ?? '1 mês de acesso'}
          </div>
        </div>

        {/* Features */}
        <div className="space-y-2.5">
          <p className="text-[11px] text-zinc-500 uppercase tracking-widest">Incluso no plano</p>
          {selectedPlan.features.map((feature, i) => (
            <div key={i} className="flex items-center gap-3">
              <div className="w-4 h-4 rounded-full bg-green-500/15 flex items-center justify-center shrink-0">
                <Check className="h-2.5 w-2.5 text-green-400" />
              </div>
              <span className="text-sm text-zinc-300">{feature}</span>
            </div>
          ))}
        </div>

        {/* Guarantee note */}
        <div className="border-t border-white/5 pt-4 text-center">
          <p className="text-[11px] text-zinc-600">
            ✅ Ativação imediata após confirmação do pagamento
          </p>
        </div>
      </div>
    </div>
  );
};
