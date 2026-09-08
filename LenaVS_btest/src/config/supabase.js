import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';

dotenv.config();

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseServiceKey) {
  console.error('❌ ERRO: Variáveis de ambiente do Supabase não encontradas no Backend!');
  console.error('   Defina SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY no arquivo .env');
}

/* =====================================================
   CLIENTE ADMIN (SERVICE ROLE)
   Usado para validar tokens (auth.getUser) e acessar
   o banco sem restrições de RLS.
===================================================== */

const supabase = createClient(supabaseUrl, supabaseServiceKey, {
  auth: {
    autoRefreshToken: false,
    persistSession: false,
  },
});

export { supabase };

export default supabase;
