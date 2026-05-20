const https = require('https');

// Configurações do Supabase
const SUPABASE_URL = 'https://nqzrqxxyjxqzjxqzjxqz.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im5xenJxeHh5anhxeGp4cXp6anh6Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3MDAwMDAwMDAsImV4cCI6MjAxNTU1NTU1NTV9.fake-key-for-development';

// Função para fazer requisições HTTP para Supabase
function supabaseRequest(table, options = {}) {
  return new Promise((resolve, reject) => {
    const { method = 'GET', filters = {}, select = '*' } = options;
    
    // Construir URL
    let url = `${SUPABASE_URL}/rest/v1/${table}?select=${encodeURIComponent(select)}`;
    
    // Adicionar filtros
    Object.entries(filters).forEach(([key, value]) => {
      url += `&${key}=${encodeURIComponent(value)}`;
    });
    
    const urlObj = new URL(url);
    
    const requestOptions = {
      hostname: urlObj.hostname,
      port: 443,
      path: urlObj.pathname + urlObj.search,
      method: method,
      headers: {
        'apikey': SUPABASE_ANON_KEY,
        'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
        'Content-Type': 'application/json'
      }
    };
    
    const req = https.request(requestOptions, (res) => {
      let data = '';
      
      res.on('data', (chunk) => {
        data += chunk;
      });
      
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          if (res.statusCode >= 200 && res.statusCode < 300) {
            resolve(parsed);
          } else {
            reject(new Error(`HTTP ${res.statusCode}: ${parsed.message || data}`));
          }
        } catch (error) {
          reject(error);
        }
      });
    });
    
    req.on('error', reject);
    req.end();
  });
}

// API simplificada para compatibilidade
const supabase = {
  from: (table) => ({
    select: (columns = '*') => ({
      eq: (column, value) => ({
        single: () => supabaseRequest(table, { select: columns, filters: { [column]: `eq.${value}` } })
      }),
      then: (resolve) => supabaseRequest(table, { select: columns }).then(resolve)
    })
  }),
  channel: (name) => ({
    on: (event, config, callback) => ({
      subscribe: (statusCallback) => {
        console.log('⚠️ [SUPABASE] WebSocket não suportado, usando polling...');
        statusCallback('SUBSCRIBED');
        // Retornar objeto de canal simulado
        return {
          unsubscribe: () => console.log('🛑 [SUPABASE] Polling parado')
        };
      }
    })
  }),
  removeChannel: (channel) => {
    if (channel && channel.unsubscribe) {
      channel.unsubscribe();
    }
  }
};

console.log('✅ [SUPABASE] Cliente HTTP inicializado (sem WebSocket)');

module.exports = { supabase, supabaseRequest };
