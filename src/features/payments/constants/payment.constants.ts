export const PAYMENT_METHODS = {
  PIX: 'pix',
  CREDIT_CARD: 'credit_card'
} as const;

export const PAYMENT_STATUS = {
  PENDING: 'pending',
  GENERATING: 'gerando',
  CONFIRMED: 'confirmado',
  EXPIRED: 'expirado',
  ERROR: 'erro',
  CANCELLED: 'cancelado',
  TIMEOUT: 'timeout',
  CONNECTION_ERROR: 'erro_conexao',
  PROVIDER_OFFLINE: 'provider_offline',
  RATE_LIMIT: 'rate_limit'
} as const;

export const CHECKOUT_STEPS = {
  PLAN_SELECTION: 'plan_selection',
  PAYMENT_METHOD: 'payment_method',
  PAYMENT_FORM: 'payment_form',
  PIX_GENERATED: 'pix_generated'
} as const;

export const PIX_EXPIRY_MINUTES = 20;
export const POLLING_INTERVAL_MS = 5000;
export const POLLING_DELAY_MS = 2000;
