import React, { useEffect } from 'react';
import { X, AlertTriangle, CheckCircle, Info } from 'lucide-react';
import './AlertDialog.css';

/**
 * Diálogo de alerta no estilo LenaVS.
 *
 * Props:
 *   isOpen      – boolean: exibe ou oculta o modal
 *   type        – 'error' | 'success' | 'info' (padrão: 'info')
 *   title       – string: título da mensagem
 *   message     – string: corpo da mensagem
 *   confirmLabel – string (opcional): texto do botão de fechar (padrão: "Entendido")
 *   onClose     – função chamada quando o usuário fecha
 */
const AlertDialog = ({
  isOpen,
  type = 'info',
  title,
  message,
  confirmLabel = 'Entendido',
  onClose,
}) => {
  useEffect(() => {
    if (!isOpen) return undefined;

    const handleKey = (event) => {
      if (event.key === 'Escape' || event.key === 'Enter') onClose?.();
    };

    document.addEventListener('keydown', handleKey);
    return () => document.removeEventListener('keydown', handleKey);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const Icon = type === 'success' ? CheckCircle : type === 'error' ? AlertTriangle : Info;

  return (
    <div
      className="alert-dialog-overlay"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose?.();
      }}
      role="alertdialog"
      aria-modal="true"
      aria-labelledby="alert-dialog-title"
    >
      <div className={`alert-dialog alert-dialog--${type}`}>
        <button
          type="button"
          className="alert-dialog__close"
          onClick={onClose}
          aria-label="Fechar"
        >
          <X size={15} />
        </button>

        <div className="alert-dialog__icon" aria-hidden="true">
          <Icon size={22} />
        </div>

        {title && (
          <h3 id="alert-dialog-title" className="alert-dialog__title">
            {title}
          </h3>
        )}

        {message && (
          <p className="alert-dialog__message">{message}</p>
        )}

        <div className="alert-dialog__actions">
          <button
            type="button"
            className={`alert-dialog__btn alert-dialog__btn--${type}`}
            onClick={onClose}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
};

export default AlertDialog;
