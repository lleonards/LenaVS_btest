import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';

dotenv.config();

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const supabaseAnonKey = process.env.SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseServiceKey) {
  console.error('❌ ERRO: Variáveis de ambiente do Supabase não encontradas no Backend!');
}

/* =====================================================
   🔐 CLIENTE ADMIN (SERVICE ROLE)
===================================================== */

const supabase = createClient(supabaseUrl, supabaseServiceKey, {
  auth: {
    autoRefreshToken: false,
    persistSession: false
  }
});

/* =====================================================
   🔑 CLIENTE PÚBLICO (ANON)
===================================================== */

const supabaseAnon = createClient(supabaseUrl, supabaseAnonKey);

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
