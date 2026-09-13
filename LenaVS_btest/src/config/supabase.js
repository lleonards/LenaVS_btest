import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';

dotenv.config();

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const supabaseAnonKey = process.env.SUPABASE_ANON_KEY;

// Fallback inofensivo: mantém o processo vivo (health check responde)
// mesmo sem configuração, evitando crash loop / SIGTERM no deploy.
const FALLBACK_URL = 'https://placeholder.supabase.co';
const FALLBACK_KEY = 'missing-supabase-key';

export const isSupabaseConfigured = Boolean(supabaseUrl && supabaseServiceKey);

if (!isSupabaseConfigured) {
  console.error(
    '❌ ERRO: Variáveis de ambiente do Supabase não encontradas no Backend!' +
    '\n   Configure SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY.' +
    '\n   O servidor vai subir em modo degradado (rotas de autenticação/storage vão falhar), ' +
    'mas o processo permanece vivo para o health check.'
  );
}

/* =====================================================
   🔐 CLIENTE ADMIN (SERVICE ROLE)
===================================================== */

const supabase = createClient(
  supabaseUrl || FALLBACK_URL,
  supabaseServiceKey || FALLBACK_KEY,
  {
    auth: {
      autoRefreshToken: false,
      persistSession: false
    }
  }
);

/* =====================================================
   🔑 CLIENTE PÚBLICO (ANON)
===================================================== */

const supabaseAnon = createClient(
  supabaseUrl || FALLBACK_URL,
  supabaseAnonKey || FALLBACK_KEY
);

/* =====================================================
   EXPORTS (COMPATÍVEL COM TODO O PROJETO)
===================================================== */

// ✅ Named export (para: import { supabase })
export { supabase, supabaseAnon };

// ✅ Default export (para: import supabase from)
export default supabase;

export const supabaseConfig = {
  url: supabaseUrl,
  jwtSecret: process.env.SUPABASE_JWT_SECRET
};
