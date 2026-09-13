import React, { useEffect, useMemo, useState } from 'react';
import { Link, useLocation, useParams } from 'react-router-dom';
import { CheckCircle2, Clock3, CreditCard, Loader2, XCircle } from 'lucide-react';
import api from '../services/api';
import { useAuth } from '../contexts/AuthContext';
import { startUpgradeCheckout } from '../utils/checkout';

const STATUS_META = {
  success: {
    icon: CheckCircle2,
    title: 'Pagamento confirmado',
    description: 'Estamos finalizando a liberação do seu acesso e sincronizando sua conta.',
    color: '#4ade80',
  },
  pending: {
    icon: Clock3,
    title: 'Pagamento em análise',
    description: 'Estamos verificando a confirmação do pagamento. Isso pode levar alguns instantes.',
    color: '#fbbf24',
  },
  failure: {
    icon: XCircle,
    title: 'Pagamento não concluído',
    description: 'Nenhuma cobrança foi confirmada. Você pode tentar novamente quando quiser.',
    color: '#f87171',
  },
};

const wait = (ms) => new Promise((resolve) => window.setTimeout(resolve, ms));

const PaymentStatus = () => {
  const { status = 'pending' } = useParams();
  const location = useLocation();
  const { refreshCredits } = useAuth();
  const [syncing, setSyncing] = useState(status !== 'failure');
  const [details, setDetails] = useState(null);
  const [error, setError] = useState('');
  const [retryingCheckout, setRetryingCheckout] = useState(false);

  const searchParams = useMemo(() => new URLSearchParams(location.search), [location.search]);
  const provider = searchParams.get('provider') || 'stripe';
  const meta = STATUS_META[status] || STATUS_META.pending;
  const Icon = meta.icon;
  const isErrorState = status === 'failure' || Boolean(error);
  const shouldShowRetry = status !== 'success' || Boolean(error);

  useEffect(() => {
    let cancelled = false;

    const stripeSessionId = searchParams.get('session_id') || '';
    const shouldSyncAccess = provider === 'stripe' ? status === 'success' : status !== 'failure';

    const syncAccess = async () => {
      if (!shouldSyncAccess) {
        setSyncing(false);
        return;
      }

      try {
        setSyncing(true);

        const maxAttempts = provider === 'stripe' ? 8 : 20;

        for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
          const response = await api.get('/payment/subscription', {
            params: provider === 'stripe'
              ? { sync_provider: 'stripe', session_id: stripeSessionId || undefined }
              : provider === 'pagarme'
                ? { sync_provider: 'pagarme' }
                : {},
          });
          const data = response.data || {};

          if (cancelled) return;

          setDetails(data);

          if (data.unlimited) {
            await refreshCredits?.();
            setSyncing(false);
            return;
          }

          await wait(1800);
        }

        setError('Seu pagamento voltou normalmente, mas a liberação ainda está terminando. Aguarde alguns segundos e atualize a página.');
      } catch (err) {
        console.error('Erro ao sincronizar pagamento:', err);
        setError(err.response?.data?.error || err.message || 'Não foi possível confirmar o pagamento agora.');
      } finally {
        if (!cancelled) {
          setSyncing(false);
        }
      }
    };

    void syncAccess();

    return () => {
      cancelled = true;
    };
  }, [provider, refreshCredits, searchParams, status]);

  return (
    <div style={{
      minHeight: '100vh',
      background: 'linear-gradient(180deg, #0e0e0e, #050505)',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      padding: '24px',
    }}>
      <div style={{
        width: 'min(640px, 100%)',
        background: '#141414',
        border: `1px solid ${meta.color}33`,
        borderRadius: 24,
        boxShadow: '0 30px 90px rgba(0,0,0,0.45)',
        padding: '30px',
        color: '#fff',
      }}>
        <div style={{
          width: 64,
          height: 64,
          borderRadius: 20,
          background: `${meta.color}22`,
          color: meta.color,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          marginBottom: 18,
        }}>
          {syncing ? <Loader2 size={30} style={{ animation: 'spin 1s linear infinite' }} /> : <Icon size={30} />}
        </div>

        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, alignItems: 'center', marginBottom: 10 }}>
          <h1 style={{ margin: 0, fontSize: '32px' }}>{meta.title}</h1>
          <span style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 8,
            padding: '7px 12px',
            borderRadius: 999,
            background: '#202020',
            color: '#d9d9d9',
            fontSize: '13px',
            fontWeight: 700,
          }}>
            <CreditCard size={16} />
            {provider === 'pagarme' ? 'Pagar.me' : 'Stripe'}
          </span>
        </div>

        <p style={{ margin: 0, color: '#cfcfcf', lineHeight: 1.7 }}>{meta.description}</p>

        {status !== 'failure' ? (
          <div style={{
            marginTop: 22,
            borderRadius: 16,
            background: '#1b1b1b',
            padding: '18px 18px 16px',
            border: '1px solid rgba(255,255,255,0.06)',
          }}>
            <strong style={{ display: 'block', marginBottom: 8, color: '#ffb08d' }}>LenaVS Upgrade</strong>
            <p style={{ margin: 0, color: '#d7d7d7', lineHeight: 1.6 }}>
              Assim que o pagamento for confirmado, sua conta recebe 30 dias de acesso liberado.
            </p>
            {details?.unlimited_access_until ? (
              <p style={{ margin: '10px 0 0', color: '#8fe6a6', fontWeight: 700 }}>
                Acesso ativo até: {new Date(details.unlimited_access_until).toLocaleString('pt-BR')}
              </p>
            ) : null}
            {syncing ? (
              <p style={{ margin: '10px 0 0', color: '#fbbf24' }}>Estamos conferindo a confirmação final do pagamento...</p>
            ) : null}
          </div>
        ) : null}

        {status === 'pending' ? (
          <div style={{
            marginTop: 22,
            borderRadius: 16,
            background: 'rgba(245,158,11,0.1)',
            border: '1px solid rgba(245,158,11,0.2)',
            padding: '16px 18px',
            color: '#f4d17b',
            lineHeight: 1.7,
          }}>
            Se você já concluiu o pagamento, basta aguardar um pouco. Quando ele for confirmado, o acesso será liberado automaticamente.
          </div>
        ) : null}

        {error ? (
          <div style={{
            marginTop: 18,
            borderRadius: 16,
            background: 'rgba(239,68,68,0.12)',
            border: '1px solid rgba(239,68,68,0.22)',
            padding: '14px 16px',
            color: '#ffb3b3',
            lineHeight: 1.6,
          }}>
            {error}
          </div>
        ) : null}

        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginTop: 26, justifyContent: 'flex-end' }}>
          {shouldShowRetry ? (
            <button
              type="button"
              onClick={() => {
                setRetryingCheckout(true);
                setError('');
                void startUpgradeCheckout({
                  onFinish: () => setRetryingCheckout(false),
                  onError: (message) => setError(message),
                }).catch(() => {});
              }}
              style={{
                background: isErrorState ? '#ff8c5a' : '#242424',
                color: isErrorState ? '#111' : '#fff',
                padding: '12px 18px',
                borderRadius: 12,
                fontWeight: 800,
                border: isErrorState ? '1px solid #ff8c5a' : '1px solid transparent',
                opacity: retryingCheckout ? 0.75 : 1,
                cursor: retryingCheckout ? 'wait' : 'pointer',
                transition: 'all 0.15s ease',
              }}
              disabled={retryingCheckout}
            >
              {retryingCheckout ? 'Abrindo checkout...' : 'Tentar novamente'}
            </button>
          ) : null}
          <Link to="/editor" style={{
            background: isErrorState ? '#242424' : '#ff8c5a',
            color: isErrorState ? '#cfcfcf' : '#111',
            padding: '12px 18px',
            borderRadius: 12,
            fontWeight: 800,
            border: isErrorState ? '1px solid rgba(255,255,255,0.12)' : '1px solid transparent',
            textDecoration: 'none',
            transition: 'all 0.15s ease',
          }}>
            Voltar para o editor
          </Link>
        </div>

        <style>{`@keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }`}</style>
      </div>
    </div>
  );
};

export default PaymentStatus;
