import { useState, useEffect, useCallback } from 'react';
import { PaymentResponse, CheckoutPersistence } from '@/services/paymentService';
import { PIX_EXPIRY_MINUTES } from '../constants/payment.constants';
import QRCode from 'qrcode';

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

export const usePersistedPix = (selectedPlan: any, paymentMethod: 'pix' | 'credit_card') => {
  const [payment, setPayment] = useState<PaymentResponse | null>(null);
  const [qrCodeDataUrl, setQrCodeDataUrl] = useState<string>('');
  const [showPix, setShowPix] = useState(false);
  const [paymentStatus, setPaymentStatus] = useState<string>('pending');

  // Restaurar PIX pendente ao montar
  useEffect(() => {
    const savedState = CheckoutPersistence.get();
    
    // Restaurar PIX pendente se existir, for válido E for do mesmo plano
    if (savedState.generatedPix && 
        CheckoutPersistence.validatePixIntegrity(savedState.generatedPix) &&
        savedState.generatedPix.plan_id === selectedPlan?.id) {
      const pixData = savedState.generatedPix as PaymentResponse;
      
      // Verificar se ainda não expirou
      const now = new Date().getTime();
      const expiry = new Date(pixData.expires_at || '').getTime();
      
      if (expiry > now) {
        // PIX ainda válido e do mesmo plano - restaurar
        setPayment(pixData);
        setShowPix(true);
        setPaymentStatus(pixData.status || 'pending');
        
        // Gerar QR Code localmente se tiver pix_code
        if (pixData.pix_code) {
          QRCode.toDataURL(pixData.pix_code, {
            width: 256,
            margin: 2,
            color: {
              dark: '#000000',
              light: '#FFFFFF'
            }
          }).then(setQrCodeDataUrl).catch(console.error);
        }
      } else {
        // PIX expirado - limpar
        CheckoutPersistence.save({ generatedPix: undefined });
      }
    } else {
      // Só limpa se o plano já foi inicializado (evita limpar durante o carregamento inicial)
      if (savedState.generatedPix && selectedPlan != null) {
        CheckoutPersistence.save({ generatedPix: undefined });
      }
    }
    
    // Cleanup automático de PIX expirados
    CheckoutPersistence.cleanupExpiredPix();
  }, [selectedPlan?.id]);

  // Salvar estado do checkout quando o plano for selecionado
  useEffect(() => {
    if (selectedPlan) {
      CheckoutPersistence.save({
        selectedPlan: selectedPlan.id,
        currentStep: 'payment_method'
      });
    }
  }, [selectedPlan]);
  
  // Salvar método de pagamento selecionado
  useEffect(() => {
    if (paymentMethod) {
      CheckoutPersistence.save({
        paymentMethod,
        currentStep: 'payment_form'
      });
    }
  }, [paymentMethod]);

  // Formatar número do cartão
  const handleCardNumberChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const formatted = e.target.value.replace(/\s/g, '').replace(/(.{4})/g, '$1 ').trim();
    return formatted;
  };

  // Validar formulário
  const validateForm = (customerData: CustomerData, cardData: CardData): boolean => {
    if (!selectedPlan) {
      return false;
    }
    
    if (paymentMethod === 'credit_card') {
      if (!customerData.name || customerData.name.length < 3) {
        return false;
      }
      
      if (!customerData.document || customerData.document.length < 11) {
        return false;
      }
      
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!emailRegex.test(customerData.email)) {
        return false;
      }
      
      const cleaned = cardData.number.replace(/\s/g, '');
      if (cleaned.length < 13 || cleaned.length > 19 || !/^\d+$/.test(cleaned)) {
        return false;
      }
      
      if (!cardData.cvv || cardData.cvv.length < 3 || cardData.cvv.length > 4 || !/^\d+$/.test(cardData.cvv)) {
        return false;
      }
      
      const month = parseInt(cardData.month);
      const year = parseInt(cardData.year);
      const currentYear = new Date().getFullYear();
      
      if (!month || month < 1 || month > 12) {
        return false;
      }
      
      if (!year || year < currentYear || year > currentYear + 10) {
        return false;
      }
    }
    
    return true;
  };

  // Salvar PIX gerado
  const savePixPayment = useCallback((paymentResponse: PaymentResponse, planId: string) => {
    setPayment(paymentResponse);
    setShowPix(true);
    setPaymentStatus('pending'); // Status correto após gerar PIX
    
    // Persistir PIX gerado localmente
    CheckoutPersistence.save({
      generatedPix: {
        payment_id: paymentResponse.id,
        pix_code: paymentResponse.pix_code,
        qr_code: paymentResponse.qr_code,
        amount: paymentResponse.amount,
        plan_id: planId,
        status: 'pending',
        expires_at: new Date(Date.now() + PIX_EXPIRY_MINUTES * 60 * 1000).toISOString(),
        created_at: new Date().toISOString()
      },
      currentStep: 'pix_generated'
    });
  }, []);

  // Limpar PIX
  const clearPixPayment = useCallback(() => {
    setPayment(null);
    setQrCodeDataUrl('');
    setShowPix(false);
    setPaymentStatus('pending');
    CheckoutPersistence.save({ generatedPix: undefined });
  }, []);

  // Verificar se pode gerar novo PIX
  const canGeneratePix = useCallback((currentStatus?: string) => {
    const status = currentStatus || paymentStatus || payment?.status;
    return !payment || status === 'expired' || status === 'failed';
  }, [payment, paymentStatus]);

  return {
    payment,
    qrCodeDataUrl,
    showPix,
    paymentStatus,
    setPaymentStatus,
    savePixPayment,
    clearPixPayment,
    canGeneratePix,
    handleCardNumberChange,
    validateForm
  };
};
