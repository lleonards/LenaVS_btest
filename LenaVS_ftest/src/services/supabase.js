import { createClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey =
  import.meta.env.VITE_SUPABASE_ANON_KEY
  || import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;

export const hasSupabaseConfig = Boolean(supabaseUrl && supabaseAnonKey);

let client;

if (!hasSupabaseConfig) {
  console.error(
    '❌ Configurações do Supabase não encontradas. Defina VITE_SUPABASE_URL e VITE_SUPABASE_ANON_KEY no arquivo .env do frontend.'
  );
  // Cliente "placeholder" para o app não travar na inicialização.
  // Nenhum login/cadastro funcionará até as variáveis serem configuradas.
  client = createClient('https://placeholder.supabase.co', 'placeholder-anon-key');
} else {
  console.log(
    '[LenaVS Supabase] Configuração detectada. URL:',
    String(supabaseUrl).replace(/^https?:\/\//, '')
  );
  // Cliente padrão do Supabase: a sessão fica salva e renovada
  // automaticamente, e links de confirmação de e-mail são detectados na URL.
  client = createClient(supabaseUrl, supabaseAnonKey, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true,
    },
  });
}

export const supabase = client;
