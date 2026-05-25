import React, { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { MessageCircle, Check, QrCode } from 'lucide-react';
import { Button } from '@/components/ui/button';
// Hooks especializados
import { usePixPayment } from '@/features/payments/hooks/usePixPayment';
import { usePaymentPolling } from '@/features/payments/hooks/usePaymentPolling';
import { usePaymentCountdown } from '@/features/payments/hooks/usePaymentCountdown';
import { usePersistedPix } from '@/features/payments/hooks/usePersistedPix';
import { useCheckoutState } from '@/features/payments/hooks/useCheckoutState';
import { useCheckoutForm } from '@/features/payments/hooks/useCheckoutForm';
import { useCheckoutValidation } from '@/features/payments/hooks/useCheckoutValidation';
import { usePaymentProcessor } from '@/features/payments/hooks/usePaymentProcessor';

// Componentes reutilizáveis
import { PaymentMethodSelector } from '@/features/payments/components/PaymentMethodSelector';
import { CheckoutSummary } from '@/features/payments/components/CheckoutSummary';
import { CheckoutLayout } from '@/features/payments/components/CheckoutLayout';
import { PaymentSecurityInfo } from '@/features/payments/components/PaymentSecurityInfo';
import { SupportButton } from '@/features/payments/components/SupportButton';
import { PlanSelectionView } from '@/features/payments/components/PlanSelectionView';
import { PaymentActionButton } from '@/features/payments/components/PaymentActionButton';
import { PixPaymentDisplay } from '@/features/payments/components/PixPaymentDisplay';

// Serviços e tipos
import { useAuth } from '@/contexts/AuthContext';
import { SUPPORT_WHATSAPP } from '@/features/payments/constants/checkout.constants';
import { CHECKOUT_MESSAGES } from '@/features/payments/constants/checkout.constants';

const Checkout: React.FC = () => {
  const navigate = useNavigate();
  const { user } = useAuth();

  // Estado do checkout
  const {
    selectedPlan,
    paymentMethod,
    loading,
    globalLoading,
    setPaymentMethod,
    setGlobalLoading,
    initializePlan
  } = useCheckoutState();

  // Dados do formulário (usados em PIX também para manter compatibilidade com handlePayment)
  const { customerData, cardData } = useCheckoutForm();

  // Validação
  const { validateForm } = useCheckoutValidation();

  // Hooks de pagamento
  const {
    payment: persistedPayment,
    qrCodeDataUrl: persistedQrCode,
    showPix,
    paymentStatus,
    setPaymentStatus,
    savePixPayment,
    clearPixPayment: clearPersistedPix
  } = usePersistedPix(selectedPlan, paymentMethod);

  const {
    isGenerating,
    payment,
    qrCodeDataUrl,
    generatePixPayment,
    clearPixPayment,
    canGeneratePix
  } = usePixPayment(selectedPlan, savePixPayment);

  const timeLeft = usePaymentCountdown(persistedPayment, () => {
    setPaymentStatus('expirado');
    clearPersistedPix();
  });

  // Processamento de pagamento
  const { handlePayment } = usePaymentProcessor(
    generatePixPayment,
    setPaymentStatus,
    setGlobalLoading
  );

  // Usar pagamento persistido se existir, senão usar o gerado
  const currentPayment = persistedPayment || payment;
  const currentQrCode = persistedQrCode || qrCodeDataUrl;

  // Polling de status
  usePaymentPolling({
    payment: currentPayment,
    paymentStatus,
    onStatusChange: setPaymentStatus,
    onConfirmed: () => {
      setTimeout(() => navigate('/payment/success'), 2000);
    },
    onExpired: () => {
      clearPersistedPix();
    },
    onFailed: () => {
      clearPersistedPix();
    }
  });

  // Inicializar plano da URL
  useEffect(() => {
    initializePlan();
  }, [initializePlan]);

  // Função principal de pagamento
  const handlePaymentSubmit = () => {
    if (!validateForm(selectedPlan, paymentMethod, customerData, cardData)) return;
    handlePayment(selectedPlan, paymentMethod, customerData, cardData);
  };

  const handleGenerateNewPix = () => {
    handlePayment(selectedPlan, paymentMethod, customerData, cardData);
  };

  const openCreditCardWhatsApp = () => {
    const msg = encodeURIComponent(
      `Olá! Quero assinar o ${selectedPlan?.name ?? 'plano'} com cartão de crédito. Pode gerar o link de pagamento para mim?`
    );
    window.open(`https://wa.me/${SUPPORT_WHATSAPP.PHONE}?text=${msg}`, '_blank', 'noopener,noreferrer');
  };

  // Se não há plano selecionado, mostrar view de seleção
  if (!selectedPlan) {
    return <PlanSelectionView onBack={() => navigate('/dashboard/plano')} />;
  }

  const loadingMessage = isGenerating
    ? CHECKOUT_MESSAGES.GENERATING_PIX
    : CHECKOUT_MESSAGES.PROCESSING_PAYMENT;

  return (
    <CheckoutLayout
      globalLoading={globalLoading}
      loadingMessage={loadingMessage}
      onBack={() => navigate('/dashboard/plano')}
      title="Finalizar Assinatura"
      subtitle={`Ative o ${selectedPlan.name} e comece a usar agora mesmo`}
    >
      <div className="grid lg:grid-cols-[1fr_380px] gap-6 lg:gap-8">

        {/* ── Coluna esquerda: pagamento ── */}
        <div className="space-y-4">

          {/* Seletor de método */}
          <div className="bg-white/[0.03] border border-white/10 backdrop-blur-xl rounded-3xl p-5 lg:p-6">
            <p className="text-[11px] text-zinc-500 uppercase tracking-widest mb-4">
              Forma de pagamento
            </p>
            <PaymentMethodSelector
              paymentMethod={paymentMethod}
              onPaymentMethodChange={setPaymentMethod}
            />
          </div>

          {/* ── PIX ── */}
          {paymentMethod === 'pix' && (
            <>
              <div className="bg-white/[0.03] border border-white/10 backdrop-blur-xl rounded-3xl p-5 lg:p-6">
                <div className="flex items-start gap-4">
                  <div className="w-10 h-10 rounded-xl bg-purple-500/15 flex items-center justify-center shrink-0">
                    <QrCode className="h-5 w-5 text-purple-400" />
                  </div>
                  <div>
                    <p className="font-semibold mb-1">Pagamento via PIX</p>
                    <p className="text-sm text-zinc-400 leading-relaxed">
                      Gere o QR Code abaixo, escaneie com seu banco e a ativação é imediata — sem espera.
                    </p>
                  </div>
                </div>
              </div>

              <PaymentActionButton
                loading={loading}
                isGenerating={isGenerating}
                canGenerate={canGeneratePix(paymentStatus)}
                paymentMethod={paymentMethod}
                onClick={handlePaymentSubmit}
              />

              <PaymentSecurityInfo />
            </>
          )}

          {/* ── CARTÃO DE CRÉDITO — redireciona para WhatsApp ── */}
          {paymentMethod === 'credit_card' && (
            <div className="bg-gradient-to-br from-green-500/5 via-emerald-500/3 to-transparent border border-green-500/20 backdrop-blur-xl rounded-3xl p-6 lg:p-8 space-y-6">

              {/* Ícone + título */}
              <div className="flex flex-col items-center text-center gap-4 pt-2">
                <div className="w-16 h-16 rounded-2xl bg-green-500/10 border border-green-500/20 flex items-center justify-center">
                  <MessageCircle className="h-8 w-8 text-green-400" />
                </div>
                <div>
                  <h3 className="text-xl font-bold mb-2">Pagamento por Cartão de Crédito</h3>
                  <p className="text-zinc-400 text-sm leading-relaxed max-w-xs mx-auto">
                    Para pagar com cartão, fale com nosso suporte pelo WhatsApp.
                    Nossa equipe vai gerar um{' '}
                    <span className="text-white font-semibold">link de pagamento seguro e personalizado</span>{' '}
                    para você em poucos minutos.
                  </p>
                </div>
              </div>

              {/* Passos */}
              <div className="bg-white/[0.03] border border-white/5 rounded-2xl p-4 space-y-3">
                <p className="text-[11px] text-zinc-500 uppercase tracking-widest">Como funciona</p>
                {[
                  'Clique no botão e abra o WhatsApp do suporte',
                  'Informe que quer pagar com cartão de crédito',
                  'Receba o link seguro e finalize o pagamento',
                ].map((step, i) => (
                  <div key={i} className="flex items-center gap-3">
                    <span className="w-6 h-6 rounded-full bg-green-500/15 text-green-400 text-xs flex items-center justify-center font-bold shrink-0">
                      {i + 1}
                    </span>
                    <span className="text-sm text-zinc-300">{step}</span>
                  </div>
                ))}
              </div>

              {/* Botão WhatsApp */}
              <Button
                size="lg"
                onClick={openCreditCardWhatsApp}
                className="w-full h-14 rounded-2xl text-base font-semibold bg-green-500 hover:bg-green-600 text-white transition-all shadow-lg shadow-green-500/20"
              >
                <MessageCircle className="h-5 w-5 mr-2.5" />
                Falar com suporte no WhatsApp
              </Button>

              <p className="text-[11px] text-zinc-600 text-center">
                📞 (18) 99191-3165 · Atendimento rápido e personalizado
              </p>
            </div>
          )}

          <SupportButton />
        </div>

        {/* ── Coluna direita: resumo + PIX ── */}
        <div className="space-y-4 lg:sticky lg:top-6 lg:self-start">
          <CheckoutSummary selectedPlan={selectedPlan} />

          {showPix && currentPayment && (
            <PixPaymentDisplay
              payment={currentPayment}
              qrCodeDataUrl={currentQrCode}
              paymentStatus={paymentStatus}
              timeLeft={timeLeft}
              onGenerateNewPix={handleGenerateNewPix}
              isGenerating={isGenerating}
            />
          )}
        </div>
      </div>
    </CheckoutLayout>
  );
};

export default Checkout;
