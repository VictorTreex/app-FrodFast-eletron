import { useState, useCallback, useRef } from 'react';
import { paymentService, PaymentResponse, Plan, CheckoutPersistence } from '@/services/paymentService';
import { PIX_EXPIRY_MINUTES } from '../constants/payment.constants';
import { useAuth } from '@/contexts/AuthContext';
import QRCode from 'qrcode';
import { toast } from 'sonner';

interface CustomerData {
  name: string;
  document: string;
  email: string;
  phone: string;
}

interface CardData {
  number: string;
  cvv: string;
  month: string;
  year: string;
  firstName: string;
  lastName: string;
}

export const usePixPayment = (selectedPlan: Plan | null, onSavePixPayment?: (payment: PaymentResponse, planId: string) => void) => {
  const { user } = useAuth();
  const [isGenerating, setIsGenerating] = useState(false);
  const [payment, setPayment] = useState<PaymentResponse | null>(null);
  const [qrCodeDataUrl, setQrCodeDataUrl] = useState<string>('');
  const abortControllerRef = useRef<AbortController | null>(null);

  const generateQRCode = useCallback(async (pixCode: string) => {
    if (!pixCode) return '';
    
    try {
      const qrDataUrl = await QRCode.toDataURL(pixCode, {
        width: 256,
        margin: 2,
        color: {
          dark: '#000000',
          light: '#FFFFFF'
        }
      });
      setQrCodeDataUrl(qrDataUrl);
      return qrDataUrl;
    } catch (error) {
      console.error('Erro ao gerar QR Code local:', error);
      return '';
    }
  }, []);

  // Gerar pagamento (PIX ou Cartão)
  const generatePixPayment = useCallback(async (
    paymentMethod: 'pix' | 'credit_card' = 'pix',
    customerData: CustomerData,
    cardData: CardData
  ) => {
    if (!selectedPlan || !user || isGenerating) return;
    
    setIsGenerating(true);
    
    try {
      let paymentResponse;
      
      if (paymentMethod === 'pix') {
        const idempotencyKey = `pix_${user.id}_${selectedPlan.id}_${Date.now()}`;
        paymentResponse = await paymentService.createPixPayment(
          selectedPlan.id,
          `Plano ${selectedPlan.name} - ${user.email}`,
          user.email || '',
          {
            user_id: user.id,
            plan_id: selectedPlan.id,
            plan_name: selectedPlan.name
          },
          idempotencyKey
        );
      } else {
        // Pagamento com cartão de crédito
        const idempotencyKey = `card_${user.id}_${selectedPlan.id}_${Date.now()}`;
        paymentResponse = await paymentService.createCreditCardPayment(
          selectedPlan.id,
          `Plano ${selectedPlan.name} - ${user.email}`,
          {
            name: customerData.name,
            document: customerData.document,
            email: customerData.email,
            phone: customerData.phone
          },
          {
            number: cardData.number,
            cvv: cardData.cvv,
            month: cardData.month,
            year: cardData.year,
            firstName: cardData.firstName || customerData.name?.split(' ')[0],
            lastName: cardData.lastName || customerData.name?.split(' ').slice(1).join(' ')
          },
          1,
          {
            user_id: user.id,
            plan_id: selectedPlan.id,
            plan_name: selectedPlan.name
          },
          idempotencyKey
        );
      }
      
      setPayment(paymentResponse);
      
      // Mudar status para pending imediatamente quando pagamento é gerado com sucesso
      if (paymentResponse.pix_code || paymentResponse.qr_code || paymentResponse.status === 'paid') {
        await generateQRCode(paymentResponse.pix_code || '');
        
        // Usar função de callback para salvar PIX gerado
        if (onSavePixPayment) {
          onSavePixPayment(paymentResponse, selectedPlan.id);
        } else {
          // Fallback: persistir diretamente no localStorage
          CheckoutPersistence.save({
            generatedPix: {
              payment_id: paymentResponse.id,
              pix_code: paymentResponse.pix_code,
              qr_code: paymentResponse.qr_code,
              amount: paymentResponse.amount,
              plan_id: selectedPlan.id,
              status: paymentResponse.status === 'paid' ? 'paid' : 'pending',
              expires_at: new Date(Date.now() + PIX_EXPIRY_MINUTES * 60 * 1000).toISOString(),
              created_at: new Date().toISOString()
            },
            currentStep: 'payment_generated'
          });
        }
        
        const message = paymentMethod === 'pix' 
          ? 'PIX gerado! Pague para ativar seu plano.'
          : 'Pagamento processado! Aguardando confirmação.';
        toast.success(message);
      }
    } catch (error: any) {
      console.error('Erro ao processar pagamento:', error);
      
      if (error.message?.includes('timeout')) {
        toast.error('Tempo esgotado. Tente novamente.');
      } else if (error.message?.includes('network') || error.message?.includes('fetch')) {
        toast.error('Falha na conexão. Verifique sua internet.');
      } else if (error.message?.includes('provider')) {
        toast.error('Serviço de pagamento indisponível. Tente em alguns minutos.');
      } else if (error.message?.includes('rate limit')) {
        toast.error('Muitas tentativas. Aguarde alguns minutos.');
      } else {
        toast.error('Erro ao processar pagamento. Tente novamente.');
      }
    } finally {
      setIsGenerating(false);
    }
  }, [selectedPlan, user, isGenerating, generateQRCode]);

  const clearPixPayment = useCallback(() => {
    setPayment(null);
    setQrCodeDataUrl('');
    CheckoutPersistence.save({ generatedPix: undefined });
  }, []);

  // Verificar se pode gerar novo PIX
  const canGeneratePix = useCallback((currentStatus?: string) => {
    const status = currentStatus || payment?.status;
    return !payment || status === 'expired' || status === 'failed';
  }, [payment]);

  // Cleanup no unmount
  const cleanup = useCallback(() => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }
  }, []);

  return {
    isGenerating,
    payment,
    qrCodeDataUrl,
    generatePixPayment,
    clearPixPayment,
    canGeneratePix,
    cleanup
  };
};
