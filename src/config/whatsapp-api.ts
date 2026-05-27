// Configuração da API do WhatsApp Engine (Evolution API - Railway)
export const WHATSAPP_API_BASE_URL = 'https://bot-zap-production-9534.up.railway.app/api/sessions';

// Helper para fazer requisições à API do WhatsApp Engine
export const whatsappApi = {
  // POST /connect/:storeId
  connect: async (storeId: string, phoneNumber: string) => {
    const response = await fetch(`${WHATSAPP_API_BASE_URL}/connect/${storeId}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        phoneNumber: phoneNumber
      }),
    });
    
    if (!response.ok) {
      const error = await response.json();
      if (error.code === 'MISSING_PHONE_NUMBER') {
        throw new Error('Número de telefone obrigatório');
      }
      throw new Error(error.error || `Erro ao conectar: ${response.status} ${response.statusText}`);
    }
    
    const data = await response.json();
    return data;
  },

  // GET /status/:storeId
  getStatus: async (storeId: string) => {
    const response = await fetch(`${WHATSAPP_API_BASE_URL}/status/${storeId}`);
    
    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error || `Erro ao buscar status: ${response.status} ${response.statusText}`);
    }
    
    const data = await response.json();
    return data;
  },

  // POST /disconnect/:storeId
  disconnect: async (storeId: string) => {
    const response = await fetch(`${WHATSAPP_API_BASE_URL}/disconnect/${storeId}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
    });
    
    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error || `Erro ao desconectar: ${response.status} ${response.statusText}`);
    }
    
    const data = await response.json();
    return data;
  },

  // GET /auto-reply/:storeId
  getConfig: async (storeId: string) => {
    const response = await fetch(`${WHATSAPP_API_BASE_URL}/auto-reply/${storeId}`);

    if (!response.ok) {
      throw new Error(`Erro ao buscar configuração: ${response.status} ${response.statusText}`);
    }

    return response.json();
  },

  // POST /auto-reply/:storeId
  saveConfig: async (userId: string, message_text: string, cooldown_hours: number, is_active: boolean) => {
    const response = await fetch(`${WHATSAPP_API_BASE_URL}/auto-reply/${userId}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        message_text,
        cooldown_hours,
        is_active
      }),
    });

    if (!response.ok) {
      throw new Error(`Erro ao salvar configuração: ${response.status} ${response.statusText}`);
    }

    const data = await response.json();

    if (data.success) {
      return data;
    } else {
      throw new Error(data.error || 'Config save failed');
    }
  },
};
