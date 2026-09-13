import React, {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { hasSupabaseConfig, supabase } from '../services/supabase';
import api from '../services/api';

const AuthContext = createContext(null);

const AUTH_BOOT_TIMEOUT_MS = 8000;

/* =========================================================
   Utilitários
========================================================= */
const parseDateOrNull = (value) => {
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
};

const normalizeDisplayName = (value) =>
  String(value || '').trim().replace(/\s+/g, ' ');

const normalizeEmail = (value) => String(value || '').trim().toLowerCase();

/**
 * Traduz erros do Supabase (e do backend, via axios) para mensagens
 * seguras em português. Erros técnicos nunca chegam ao usuário.
 */
const getSafeAuthMessage = (error, context = 'login') => {
  const code = String(error?.code || error?.response?.data?.code || '').toLowerCase();
  const rawMessage = String(
    error?.response?.data?.error ||
    error?.response?.data?.message ||
    error?.message ||
    ''
  );

  if (context === 'login' && (code === 'invalid_login_credentials' || /invalid login credentials|invalid credentials|invalid password|password is incorrect/i.test(rawMessage))) {
    return 'senha incorreta';
  }

  if (code === 'email_not_confirmed' || /email not confirmed|email is not confirmed/i.test(rawMessage)) {
    return 'Confirme seu e-mail antes de entrar.';
  }

  if (code === 'user_already_exists' || /already (registered|exists|in use)|user already registered/i.test(rawMessage)) {
    return 'Este e-mail já está cadastrado. Tente entrar ou use outro e-mail.';
  }

  if (code === 'weak_password' || /password should be at least|weak password/i.test(rawMessage)) {
    return 'A senha precisa ter pelo menos 6 caracteres.';
  }

  if (code === 'invalid_email') {
    return 'Digite um e-mail válido.';
  }

  if (code === 'over_email_send_rate_limit' || /rate limit|too many requests/i.test(rawMessage)) {
    return 'Muitas tentativas. Aguarde alguns minutos e tente novamente.';
  }

  if (code === 'password_required') {
    return 'Digite sua senha.';
  }

  if (rawMessage) {
    return rawMessage;
  }

  return context === 'login'
    ? 'Não foi possível fazer login. Tente novamente.'
    : 'Não foi possível concluir a autenticação. Tente novamente.';
};

/**
 * URL base do site usada no link de confirmação enviado por e-mail.
 * O Supabase entrega a sessão de volta nessa origem, sem query/hash.
 */
const getEmailRedirectUrl = () => {
  if (typeof window === 'undefined') return undefined;
  const url = new URL(window.location.href);
  url.search = '';
  url.hash = '';
  return url.toString();
};

const deriveProfileFromSessionUser = (sessionUser) => {
  const metadata = sessionUser?.user_metadata || {};
  return {
    displayName:
      normalizeDisplayName(metadata.display_name) ||
      normalizeDisplayName(metadata.full_name) ||
      normalizeDisplayName(metadata.name) ||
      '',
    avatarUrl:
      String(metadata.avatar_url || metadata.picture || metadata.photo_url || '').trim() || null,
    email: sessionUser?.email || null,
  };
};

/* =========================================================
   Aviso fixo de confirmação de e-mail (após o cadastro)
========================================================= */
const EmailConfirmationNotice = ({ email, onClose }) => (
  <div
    role="status"
    aria-live="polite"
    style={{
      position: 'fixed',
      top: '20px',
      right: '20px',
      zIndex: 9999,
      width: 'min(360px, calc(100vw - 40px))',
      display: 'flex',
      alignItems: 'flex-start',
      gap: '12px',
      padding: '16px',
      border: '1px solid #e9e3f5',
      borderRadius: '12px',
      backgroundColor: '#ffffff',
      boxShadow: '0 8px 28px rgba(30, 20, 55, 0.12)',
      color: '#2d2640',
      fontFamily:
        'Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
    }}
  >
    <div
      aria-hidden="true"
      style={{
        flexShrink: 0,
        width: '30px',
        height: '30px',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        borderRadius: '50%',
        backgroundColor: '#f3edff',
        color: '#7651c9',
        fontSize: '16px',
        lineHeight: 1,
      }}
    >
      ✓
    </div>
    <div style={{ flex: 1, minWidth: 0 }}>
      <strong
        style={{
          display: 'block',
          marginBottom: '4px',
          fontSize: '14px',
          fontWeight: 700,
          lineHeight: 1.35,
        }}
      >
        Confirme seu e-mail
      </strong>
      <span
        style={{
          display: 'block',
          color: '#6f687e',
          fontSize: '13px',
          lineHeight: 1.5,
          overflowWrap: 'anywhere',
        }}
      >
        Enviamos um link para{' '}
        <strong style={{ color: '#4f4563', fontWeight: 600 }}>
          {email || 'seu e-mail'}
        </strong>
        . Verifique sua caixa de entrada.
      </span>
    </div>
    <button
      type="button"
      onClick={onClose}
      aria-label="Fechar aviso"
      style={{
        flexShrink: 0,
        width: '24px',
        height: '24px',
        margin: '-2px -4px 0 0',
        padding: 0,
        border: 0,
        background: 'transparent',
        color: '#9a93a8',
        cursor: 'pointer',
        fontSize: '20px',
        fontWeight: 400,
        lineHeight: 1,
      }}
    >
      ×
    </button>
  </div>
);

/* =========================================================
   Provider
========================================================= */
export const AuthProvider = ({ children }) => {
  const [session, setSession] = useState(null);
  const [loading, setLoading] = useState(true);
  const [credits, setCredits] = useState(0);
  const [plan, setPlan] = useState('free');
  const [subscriptionStatus, setSubscriptionStatus] = useState('inactive');
  const [unlimitedUntil, setUnlimitedUntil] = useState(null);
  const [cancelScheduledAt, setCancelScheduledAt] = useState(null);
  const [displayName, setDisplayName] = useState('');
  const [avatarUrl, setAvatarUrl] = useState(null);
  const [userEmail, setUserEmail] = useState(null);
  const [emailConfirmationNotice, setEmailConfirmationNotice] = useState(null);

  const sessionRef = useRef(null);

  const resetLocalUserState = () => {
    setCredits(0);
    setPlan('free');
    setSubscriptionStatus('inactive');
    setUnlimitedUntil(null);
    setCancelScheduledAt(null);
    setDisplayName('');
    setAvatarUrl(null);
    setUserEmail(null);
  };

  const applyUserSnapshot = (data, fallbackUser = null) => {
    const fallbackProfile = fallbackUser
      ? deriveProfileFromSessionUser(fallbackUser)
      : { displayName: '', avatarUrl: null, email: null };

    setCredits(data?.credits ?? 0);
    setPlan(data?.plan ?? 'free');
    setSubscriptionStatus(data?.subscription_status ?? 'inactive');
    setUnlimitedUntil(data?.unlimited_access_until ?? null);
    const canceledButStillActive =
      String(data?.subscription_status || '') === 'canceled'
      && Boolean(data?.unlimited_access_until);
    setCancelScheduledAt(
      String(data?.cancel_scheduled_at || '').trim()
      || (canceledButStillActive ? data.unlimited_access_until : null)
      || null
    );
    setDisplayName(
      normalizeDisplayName(data?.display_name) || fallbackProfile.displayName || ''
    );
    setAvatarUrl(
      String(data?.avatar_url || '').trim() || fallbackProfile.avatarUrl || null
    );
    setUserEmail(data?.email || fallbackProfile.email || null);
    return data ?? null;
  };

  /**
   * Busca os dados do usuário logado.
   * 1º) Backend (fonte oficial: service_role, auto-repara perfil).
   * 2º) Fallback direto na tabela users via RLS (backend fora do ar / cold start).
   */
  const fetchUserData = async (userId, fallbackUser = null) => {
    if (!userId || !hasSupabaseConfig) {
      resetLocalUserState();
      return null;
    }

    try {
      const backendResponse = await api.get('/user/me', {
        timeout: AUTH_BOOT_TIMEOUT_MS,
      });
      if (backendResponse?.data) {
        return applyUserSnapshot(backendResponse.data, fallbackUser);
      }
    } catch (backendError) {
      console.warn(
        'Falha ao sincronizar usuário pelo backend. Usando fallback do Supabase:',
        backendError?.response?.data?.error || backendError?.message
      );
    }

    try {
      const { data, error } = await supabase
        .from('users')
        .select('credits, plan, subscription_status, unlimited_access_until')
        .eq('id', userId)
        .maybeSingle();

      if (error) {
        console.warn('Erro ao buscar dados do usuário no Supabase:', error.message);
        resetLocalUserState();
        return null;
      }

      return applyUserSnapshot(data, fallbackUser);
    } catch (error) {
      console.error('Erro inesperado ao buscar dados do usuário:', error);
      resetLocalUserState();
      return null;
    }
  };

  const refreshCredits = async () => {
    const userId = sessionRef.current?.user?.id;
    if (!userId) return null;
    return fetchUserData(userId, sessionRef.current?.user ?? null);
  };

  const updateProfile = async ({
    displayName: nextDisplayName,
    avatarFile = null,
    removeAvatar = false,
  } = {}) => {
    const normalizedDisplayName = normalizeDisplayName(nextDisplayName);
    const formData = new FormData();
    formData.append('name', normalizedDisplayName);
    if (avatarFile) {
      formData.append('avatar', avatarFile);
    }
    if (removeAvatar) {
      formData.append('removeAvatar', 'true');
    }

    const { data } = await api.put('/user/profile', formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
    });

    applyUserSnapshot(data, sessionRef.current?.user ?? null);
    return data;
  };

  /* =========================================================
     Sessão — padrão oficial do Supabase (SIMPLES)
     -----------------------------------------------------
     - getSession(): restaura a sessão salva ao abrir o app.
     - onAuthStateChange(): o Supabase avisa sobre login,
       logout, renovação de token e confirmação de e-mail.
     Nenhuma manipulação manual de token ou localStorage.
  ========================================================= */
  useEffect(() => {
    let isMounted = true;

    if (!hasSupabaseConfig) {
      setSession(null);
      resetLocalUserState();
      setLoading(false);
      return () => {};
    }

    const applySession = async (nextSession, { fetchProfile = true } = {}) => {
      sessionRef.current = nextSession;
      setSession(nextSession);

      if (nextSession?.user) {
        if (fetchProfile) {
          await fetchUserData(nextSession.user.id, nextSession.user);
        }
      } else {
        resetLocalUserState();
      }
    };

    // Diagnóstico: detecta o retorno do link de confirmação de e-mail na URL.
    if (typeof window !== 'undefined' && window.location.hash) {
      const rawHash = String(window.location.hash || '');
      const hashParams = new URLSearchParams(rawHash.replace(/^#\/?/, ''));
      if (
        hashParams.get('access_token')
        || hashParams.get('refresh_token')
        || hashParams.get('token_hash')
        || hashParams.get('error_description')
      ) {
        console.log('[LenaVS Auth] Token de confirmação detectado na URL. O Supabase está processando a sessão...');
      }
    }

    // 1) Restaura a sessão salva (se existir) ao carregar o app.
    supabase.auth
      .getSession()
      .then(({ data }) => applySession(data?.session ?? null))
      .catch((error) => {
        console.error('Erro ao recuperar sessão:', error?.message);
        return applySession(null);
      })
      .finally(() => {
        if (isMounted) {
          setLoading(false);
        }
      });

    // 2) Ouve o Supabase: SIGNED_IN, SIGNED_OUT, TOKEN_REFRESHED,
    //    USER_UPDATED e a volta do link de confirmação de e-mail.
    const { data: listener } = supabase.auth.onAuthStateChange(
      (event, newSession) => {
        if (!isMounted) return;

        console.log(
          '[LenaVS Auth] Evento de sessão:',
          event,
          newSession?.user?.email || ''
        );

        // TOKEN_REFRESHED não precisa recarregar o perfil.
        void applySession(newSession ?? null, {
          fetchProfile: event !== 'TOKEN_REFRESHED',
        });
      }
    );

    // Atualiza créditos/plano quando o usuário volta para a aba.
    const handleVisibility = () => {
      const currentSession = sessionRef.current;
      if (
        document.visibilityState === 'visible' &&
        currentSession?.user?.id
      ) {
        void fetchUserData(currentSession.user.id, currentSession.user);
      }
    };
    document.addEventListener('visibilitychange', handleVisibility);

    return () => {
      isMounted = false;
      document.removeEventListener('visibilitychange', handleVisibility);
      listener?.subscription?.unsubscribe?.();
    };
  }, []);

  /**
   * Cadastro direto no Supabase Auth (cliente público, anon key).
   * O Supabase envia o e-mail de confirmação; nenhuma sessão é criada
   * antes de o usuário clicar no link.
   */
  const signUp = async (
    email,
    password,
    name,
    countryCode = 'BR',
    acceptedLegal = false
  ) => {
    const normalizedEmail = normalizeEmail(email);
    const normalizedName = String(name || '').trim();
    const normalizedCountryCode = String(countryCode || 'BR').trim().toUpperCase();
    const normalizedCountryGroup = normalizedCountryCode === 'BR' ? 'BR' : 'INTL';
    const preferredCurrency = normalizedCountryGroup === 'BR' ? 'BRL' : 'USD';

    const countryLabelMap = {
      BR: 'Brasil',
      US: 'Estados Unidos',
      CA: 'Canadá',
      AU: 'Austrália',
      NZ: 'Nova Zelândia',
      SG: 'Singapura',
      HK: 'Hong Kong',
      OTHER: 'Outros',
    };

    if (!acceptedLegal) {
      throw new Error(
        'Você precisa aceitar os termos de uso e a política de privacidade para criar a conta.'
      );
    }

    const { data, error } = await supabase.auth.signUp({
      email: normalizedEmail,
      password,
      options: {
        data: {
          name: normalizedName,
          full_name: normalizedName,
          display_name: normalizedName,
          country_group: normalizedCountryGroup,
          country: normalizedCountryCode,
          country_code: normalizedCountryCode,
          country_label: countryLabelMap[normalizedCountryCode] || 'Outros',
          preferred_currency: preferredCurrency,
          accepted_legal_terms: true,
          legal_acceptance_at: new Date().toISOString(),
          privacy_policy_version: '2026-06',
        },
        emailRedirectTo: getEmailRedirectUrl(),
      },
    });

    if (error) {
      throw error;
    }

    // E-mail já cadastrado: o Supabase retorna usuário sem identidades.
    if (data?.user && Array.isArray(data.user.identities) && data.user.identities.length === 0) {
      throw new Error(
        'Este e-mail já está cadastrado. Tente entrar ou use outro e-mail.'
      );
    }

    // Projeto com confirmação desativada criaria sessão automática.
    // A confirmação de e-mail é obrigatória, então encerramos a sessão.
    if (data?.session && !data?.user?.email_confirmed_at) {
      try {
        await supabase.auth.signOut();
      } catch (signOutError) {
        console.warn(
          'Falha ao encerrar sessão criada antes da confirmação do e-mail:',
          signOutError?.message
        );
      }
    }

    setEmailConfirmationNotice({ email: normalizedEmail });

    return {
      emailConfirmationRequired: true,
      message:
        'Cadastro realizado. Confirme seu e-mail pelo link enviado para entrar na plataforma.',
    };
  };

  /**
   * Login direto no Supabase Auth (cliente público, anon key).
   * Retorna erro "email_not_confirmed" se o e-mail não foi confirmado.
   */
  const signIn = async (email, password) => {
    const normalizedEmail = normalizeEmail(email);

    const { data, error } = await supabase.auth.signInWithPassword({
      email: normalizedEmail,
      password,
    });

    if (error) {
      throw error;
    }

    const returnedSession = data?.session ?? null;

    setEmailConfirmationNotice(null);

    if (returnedSession) {
      sessionRef.current = returnedSession;
      setSession(returnedSession);
      await fetchUserData(returnedSession.user.id, returnedSession.user);
    }

    return returnedSession;
  };

  const signOut = async () => {
    try {
      await supabase.auth.signOut();
    } catch (error) {
      console.warn('Falha ao encerrar sessão do Supabase:', error?.message);
    }
    sessionRef.current = null;
    setSession(null);
    resetLocalUserState();
  };

  const hasUnlimitedAccess = useMemo(() => {
    const untilDate = parseDateOrNull(unlimitedUntil);
    if (untilDate) {
      return untilDate.getTime() > Date.now();
    }
    return plan === 'pro' && subscriptionStatus === 'active';
  }, [plan, subscriptionStatus, unlimitedUntil]);

  const creditsLabel = hasUnlimitedAccess
    ? 'unlimited'
    : Math.max(0, Number(credits) || 0);

  return (
    <AuthContext.Provider
      value={{
        session,
        user: session?.user ?? null,
        isAuthenticated: Boolean(session),
        loading,
        credits,
        creditsLabel,
        plan,
        subscriptionStatus,
        unlimitedUntil,
        cancelScheduledAt,
        hasUnlimitedAccess,
        displayName,
        avatarUrl,
        userEmail,
        signUp,
        signIn,
        signOut,
        refreshCredits,
        updateProfile,
        getSafeAuthMessage,
      }}
    >
      {children}
      {emailConfirmationNotice && (
        <EmailConfirmationNotice
          email={emailConfirmationNotice.email}
          onClose={() => {
            setEmailConfirmationNotice(null);
          }}
        />
      )}
    </AuthContext.Provider>
  );
};

export const useAuth = () => useContext(AuthContext);
