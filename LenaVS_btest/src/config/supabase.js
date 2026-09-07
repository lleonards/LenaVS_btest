import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';

dotenv.config();

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseServiceKey =
  process.env.SUPABASE_SERVICE_ROLE_KEY
  || process.env.SUPABASE_SECRET_KEY;
const supabaseAnonKey =
  process.env.SUPABASE_ANON_KEY
  || process.env.SUPABASE_PUBLISHABLE_KEY;

const missingVariables = [
  !supabaseUrl && 'SUPABASE_URL',
  !supabaseServiceKey && 'SUPABASE_SERVICE_ROLE_KEY',
  !supabaseAnonKey && 'SUPABASE_ANON_KEY',
].filter(Boolean);

if (missingVariables.length > 0) {
  throw new Error(
    `Configuração do Supabase incompleta no backend. Variáveis ausentes: ${missingVariables.join(', ')}`
  );
}

/* =====================================================
   🔐 CLIENTE ADMIN (SERVICE ROLE)
===================================================== */

const supabase = createClient(supabaseUrl, supabaseServiceKey, {
  auth: {
    autoRefreshToken: false,
    persistSession: false,
    detectSessionInUrl: false,
  },
});

/* =====================================================
   🔑 CLIENTE PÚBLICO (ANON)
===================================================== */

const supabaseAnon = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    autoRefreshToken: false,
    persistSession: false,
    detectSessionInUrl: false,
  },
});

/* =====================================================
   EXPORTS (COMPATÍVEL COM TODO O PROJETO)
===================================================== */

// ✅ Named export (para: import { supabase })
export { supabase, supabaseAnon };

// ✅ Default export (para: import supabase from)
export default supabase;

export const supabaseConfig = {
  url: supabaseUrl,
};
