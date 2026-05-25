import { useState, useEffect } from 'react';
import { PaymentResponse } from '@/services/paymentService';
import { CheckoutPersistence } from '@/services/paymentService';

export const usePaymentCountdown = (payment: PaymentResponse | null, onExpired?: () => void) => {
  const [timeLeft, setTimeLeft] = useState<string>('');

  useEffect(() => {
    if (!payment?.expires_at) return;

    const interval = setInterval(() => {
      const now = new Date().getTime();
      const expiry = new Date(payment.expires_at).getTime();
      const diff = expiry - now;

      if (diff <= 0) {
        setTimeLeft('');
        CheckoutPersistence.save({ generatedPix: undefined });
        clearInterval(interval);
        onExpired?.();
        return;
      }

      const minutes = Math.floor(diff / (1000 * 60));
      const seconds = Math.floor((diff % (1000 * 60)) / 1000);
      setTimeLeft(`${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`);
    }, 1000);

    return () => clearInterval(interval);
  }, [payment?.expires_at]);

  return timeLeft;
};
