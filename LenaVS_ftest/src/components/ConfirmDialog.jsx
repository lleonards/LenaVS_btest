import React, { useEffect } from 'react';
import { AlertTriangle, X } from 'lucide-react';
import './ConfirmDialog.css';

/**
 * Modal de confirmação no estilo LenaVS.
 *
 * Props:
 *   isOpen       – boolean: exibe ou oculta o modal
 *   title        – string: título da pergunta
 *   message      – string: corpo da mensagem
 *   confirmLabel – string (opcional): texto do botão de confirmar  (padrão: "Confirmar")
 *   cancelLabel  – string (opcional): texto do botão de cancelar   (padrão: "Cancelar")
 *   onConfirm    – função chamada quando o usuário confirma
 *   onCancel     – função chamada quando o usuário cancela / fecha
 */
const ConfirmDialog = ({
  isOpen,
  title = 'Confirmação',
  message,
  confirmLabel = 'Confirmar',
  cancelLabel = 'Cancelar',
  onConfirm,
  onCancel,
}) => {
  // Fecha com Escape
  useEffect(() => {
    if (!isOpen) return undefined;

    const handleKey = (event) => {
      if (event.key === 'Escape') onCancel?.();
    };

    document.addEventListener('keydown', handleKey);
    return () => document.removeEventListener('keydown', handleKey);
  }, [isOpen, onCancel]);

  if (!isOpen) return null;

  return (
    <div
      className="confirm-dialog-overlay"
      onClick={(e) => {
        if (e.target === e.currentTarget) onCancel?.();
      }}
      role="dialog"
      aria-modal="true"
      aria-labelledby="confirm-dialog-title"
    >
      <div className="confirm-dialog">
        <button
          type="button"
          className="confirm-dialog__close"
          onClick={onCancel}
          aria-label="Fechar"
        >
          <X size={15} />
        </button>

        <div className="confirm-dialog__icon" aria-hidden="true">
          <AlertTriangle size={22} />
        </div>

        <h3 id="confirm-dialog-title" className="confirm-dialog__title">
          {title}
        </h3>

        {message && (
          <p className="confirm-dialog__message">{message}</p>
        )}

        <div className="confirm-dialog__actions">
          <button
            type="button"
            className="confirm-dialog__btn confirm-dialog__btn--cancel"
            onClick={onCancel}
          >
            {cancelLabel}
          </button>
          <button
            type="button"
            className="confirm-dialog__btn confirm-dialog__btn--confirm"
            onClick={onConfirm}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
};

export default ConfirmDialog;
