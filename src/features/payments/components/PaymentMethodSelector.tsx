import React from 'react';
import { CreditCard, QrCode, Zap, MessageCircle } from 'lucide-react';

interface PaymentMethodSelectorProps {
  paymentMethod: 'pix' | 'credit_card';
  onPaymentMethodChange: (method: 'pix' | 'credit_card') => void;
}

export const PaymentMethodSelector: React.FC<PaymentMethodSelectorProps> = ({
  paymentMethod,
  onPaymentMethodChange
}) => {
  return (
    <div className="grid grid-cols-2 gap-3">
      {/* PIX */}
      <button
        type="button"
        onClick={() => onPaymentMethodChange('pix')}
        className={`relative flex flex-col items-start gap-3 rounded-2xl border p-4 lg:p-5 text-left transition-all duration-200 ${
          paymentMethod === 'pix'
            ? 'border-purple-500 bg-purple-500/10 shadow-lg shadow-purple-500/5'
            : 'border-white/10 hover:border-white/20 bg-white/[0.02] hover:bg-white/[0.04]'
        }`}
      >
        {paymentMethod === 'pix' && (
          <span className="absolute top-3 right-3 w-2 h-2 rounded-full bg-purple-400" />
        )}
        <div className={`w-10 h-10 rounded-xl flex items-center justify-center transition-colors ${
          paymentMethod === 'pix' ? 'bg-purple-500/20' : 'bg-white/5'
        }`}>
          <QrCode className={`h-5 w-5 ${paymentMethod === 'pix' ? 'text-purple-400' : 'text-zinc-400'}`} />
        </div>
        <div>
          <p className={`font-semibold text-sm ${paymentMethod === 'pix' ? 'text-white' : 'text-zinc-300'}`}>
            PIX
          </p>
          <p className="text-[11px] text-zinc-500 flex items-center gap-1 mt-0.5">
            <Zap className="h-2.5 w-2.5 text-yellow-500" />
            Aprovação instantânea
          </p>
        </div>
      </button>

      {/* Cartão de Crédito */}
      <button
        type="button"
        onClick={() => onPaymentMethodChange('credit_card')}
        className={`relative flex flex-col items-start gap-3 rounded-2xl border p-4 lg:p-5 text-left transition-all duration-200 ${
          paymentMethod === 'credit_card'
            ? 'border-orange-500 bg-orange-500/10 shadow-lg shadow-orange-500/5'
            : 'border-white/10 hover:border-white/20 bg-white/[0.02] hover:bg-white/[0.04]'
        }`}
      >
        {paymentMethod === 'credit_card' && (
          <span className="absolute top-3 right-3 w-2 h-2 rounded-full bg-orange-400" />
        )}
        <div className={`w-10 h-10 rounded-xl flex items-center justify-center transition-colors ${
          paymentMethod === 'credit_card' ? 'bg-orange-500/20' : 'bg-white/5'
        }`}>
          <CreditCard className={`h-5 w-5 ${paymentMethod === 'credit_card' ? 'text-orange-400' : 'text-zinc-400'}`} />
        </div>
        <div>
          <p className={`font-semibold text-sm ${paymentMethod === 'credit_card' ? 'text-white' : 'text-zinc-300'}`}>
            Cartão de Crédito
          </p>
          <p className="text-[11px] text-zinc-500 flex items-center gap-1 mt-0.5">
            <MessageCircle className="h-2.5 w-2.5 text-green-500" />
            Via suporte
          </p>
        </div>
      </button>
    </div>
  );
};
