import React, { useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { startUpgradeCheckout } from '../utils/checkout';
import AlertDialog from './AlertDialog';

const CreditsBadge = () => {
  const { creditsLabel, hasUnlimitedAccess, subscriptionStatus } = useAuth();
  const [openingCheckout, setOpeningCheckout] = useState(false);
  const [alertDialog, setAlertDialog] = useState({ isOpen: false, message: '' });

  const isPro = hasUnlimitedAccess;
  const isExpired = !isPro && (subscriptionStatus === 'canceled' || subscriptionStatus === 'past_due');

  const handleClick = async () => {
    if (isPro || openingCheckout) return;

    try {
      await startUpgradeCheckout({
        onStart: () => setOpeningCheckout(true),
        onFinish: () => setOpeningCheckout(false),
        onError: (message) => setAlertDialog({ isOpen: true, message }),
      });
    } catch {
      // Erro já tratado no helper.
    }
  };

  return (
    <>
    <div
      onClick={() => {
        void handleClick();
      }}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: '8px',
        padding: '6px 14px',
        borderRadius: '20px',
        background: isPro
          ? 'linear-gradient(90deg, #ff7a00, #ff9900)'
          : isExpired
          ? 'rgba(239, 68, 68, 0.15)'
          : 'rgba(255, 122, 0, 0.15)',
        border: isPro
          ? '1px solid #ff7a00'
          : isExpired
          ? '1px solid #ef4444'
          : '1px solid #ff7a00',
        color: isPro ? '#000' : isExpired ? '#ef4444' : '#ff7a00',
        fontWeight: '600',
        fontSize: '14px',
        cursor: isPro ? 'default' : 'pointer',
        transition: '0.2s ease',
        opacity: openingCheckout ? 0.75 : 1,
      }}
    >
      {isPro ? (
        <>⭐ Plano PRO</>
      ) : isExpired ? (
        <>
          ⚠️ Plano expirado
          <span style={{ fontWeight: '700' }}>{openingCheckout ? ' Abrindo...' : ' Renovar'}</span>
        </>
      ) : (
        <>
          🔥 {creditsLabel} créditos
          <span style={{ fontWeight: '700' }}>{openingCheckout ? ' Abrindo...' : ' Upgrade'}</span>
        </>
      )}
    </div>

    <AlertDialog
      isOpen={alertDialog.isOpen}
      type="error"
      title="Erro no checkout"
      message={alertDialog.message}
      onClose={() => setAlertDialog({ isOpen: false, message: '' })}
    />
    </>
  );
};

export default CreditsBadge;
