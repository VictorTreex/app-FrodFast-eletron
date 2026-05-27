import { createClient } from '@supabase/supabase-js';
import type { Database } from './types';

// TRUE SINGLETON - Garante única instância em toda a aplicação
interface SupabaseSingleton {
  client: ReturnType<typeof createClient<Database>>;
  isInitialized: boolean;
}

let supabaseSingleton: SupabaseSingleton | null = null;

export const getSupabaseClient = () => {
  if (supabaseSingleton?.isInitialized) {
    return supabaseSingleton.client;
  }

  // Prevenir múltiplas inicializações simultâneas
  if (supabaseSingleton?.isInitialized === false) {
    throw new Error('Supabase client initialization in progress');
  }

  supabaseSingleton = {
    isInitialized: false,
    client: null as any
  };

  const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
  const SUPABASE_PUBLISHABLE_KEY = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;

  if (!SUPABASE_URL || !SUPABASE_PUBLISHABLE_KEY) {
    throw new Error('Missing Supabase environment variables');
  }

  try {
    supabaseSingleton.client = createClient<Database>(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
      auth: {
        storage: localStorage,
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
      },
      global: {
        headers: {
          'X-Client-Info': 'treexmenu/1.0.0',
        },
      },
      realtime: {
        params: {
          eventsPerSecond: 2, // Reduzido para evitar sobrecarga
        },
      },
      db: {
        schema: 'public',
      },
    });

    supabaseSingleton.isInitialized = true;
    return supabaseSingleton.client;
  } catch (error) {
    supabaseSingleton = null;
    throw error;
  }
};


// Exportar instância única
export const supabase = getSupabaseClient();
