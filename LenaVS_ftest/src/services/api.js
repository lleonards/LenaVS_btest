import axios from 'axios';
import { supabase } from './supabase';

/* =========================================================
   CLIENTE DA API — SIMPLES
   -----------------------------------------------------
   - A URL do backend vem só do VITE_API_URL (arquivo .env).
     Em desenvolvimento, sem VITE_API_URL, usa localhost:10000.
   - O token do Supabase é lido da sessão oficial
     (supabase.auth.getSession) e enviado no header
     Authorization: Bearer <token>.
   - Se o backend responder que a sessão é inválida, a sessão
     local do Supabase é encerrada e o AuthGuard manda para o
     login. Nada de limpeza manual de localStorage.
   ========================================================= */

const normalizeBase = (value) => String(value || '').trim().replace(/\/+$/, '');

const DEFAULT_PRODUCTION_API_URL = 'https://lenavs-backend-1-gv24.onrender.com';

const API_BASE_URL = normalizeBase(import.meta.env.VITE_API_URL)
  || (import.meta.env.DEV ? 'http://localhost:10000' : DEFAULT_PRODUCTION_API_URL);

export const getApiBaseUrl = () => API_BASE_URL;

const api = axios.create({
  baseURL: `${API_BASE_URL}/api`,
  withCredentials: false,
  timeout: 900000,
});

// Anexa o access_token do Supabase em toda requisição.
api.interceptors.request.use(
  async (config) => {
    try {
      const { data } = await supabase.auth.getSession();
      const token = data?.session?.access_token;

      if (token) {
        config.headers = {
          ...config.headers,
          Authorization: `Bearer ${token}`,
        };
      }

      return config;
    } catch (error) {
      console.error('Erro ao preparar requisição da API:', error);
      return config;
    }
  },
  (error) => Promise.reject(error)
);

api.interceptors.response.use(
  (response) => response,
  async (error) => {
    const status = error.response?.status;
    const message = String(error.response?.data?.error || '').toLowerCase();
    const backendCode = String(error.response?.data?.code || '').toLowerCase();

    // Erros de cota/quota do Supabase: o problema NÃO é a sessão,
    // então o usuário permanece logado.
    const isQuota = (
      status === 402
      || backendCode === 'storage_quota_exceeded'
      || /exceed storage|storage quota|restricted due to|spend cap|plan upgrade/i.test(message)
    );

    if (isQuota) {
      return Promise.reject(error);
    }

    // Sessão realmente inválida: backend respondeu 401 (sem token)
    // ou 403 com mensagem explícita de token inválido/expirado.
    // Não desloga em 403 de "créditos esgotados" ou "acesso negado".
    const sessionInvalid = status === 401
      || (status === 403 && (
        message.includes('sessão inválida')
        || message.includes('sessao invalida')
        || message.includes('token inválido')
        || message.includes('token invalido')
        || message.includes('expirada')
      ));

    if (sessionInvalid) {
      try {
        await supabase.auth.signOut();
      } catch (signOutError) {
        console.warn('Falha ao encerrar sessão Supabase:', signOutError?.message);
      }
      // O AuthContext é notificado pelo onAuthStateChange e o
      // AuthGuard redireciona para /login automaticamente.
    }

    return Promise.reject(error);
  }
);

export default api;
