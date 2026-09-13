import React, { useEffect, useState } from 'react';
import { ArrowLeft, Loader2 } from 'lucide-react';
import { Link } from 'react-router-dom';
import { startUpgradeCheckout } from '../utils/checkout';
import './Upgrade.css';

const Upgrade = () => {
  const [isOpening, setIsOpening] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;

    const openCheckout = async () => {
      try {
        await startUpgradeCheckout({
          onStart: () => {
            if (!cancelled) {
              setIsOpening(true);
              setError('');
            }
          },
          onFinish: () => {
            if (!cancelled) {
              setIsOpening(false);
            }
          },
          onError: (message) => {
            if (!cancelled) {
              setError(message);
            }
          },
        });
      } catch {
        // Mensagem já tratada acima.
      }
    };

    void openCheckout();

    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="upgrade-redirect-container">
      <div className="upgrade-redirect-card">
        <Link to="/editor" className="upgrade-redirect-back-link">
          <ArrowLeft size={16} />
          Voltar ao editor
        </Link>

        <div className="upgrade-redirect-icon">
          <Loader2 size={30} className="upgrade-spinner" />
        </div>

        <h1>Abrindo checkout</h1>
        <p>
          Estamos direcionando você para a área de pagamento.
        </p>

        {error ? <div className="upgrade-redirect-error">{error}</div> : null}

        <button
          type="button"
          className="upgrade-redirect-button"
          onClick={() => {
            setIsOpening(true);
            setError('');
            void startUpgradeCheckout({
              onFinish: () => setIsOpening(false),
              onError: (message) => setError(message),
            }).catch(() => {});
          }}
          disabled={isOpening}
        >
          {isOpening ? 'Abrindo checkout...' : 'Tentar novamente'}
        </button>
      </div>
    </div>
  );
};

export default Upgrade;
