import React, { useEffect, useState } from 'react';
import { Loader2, LifeBuoy, Send, X, CheckCircle } from 'lucide-react';
import api from '../services/api';
import './SupportModal.css';

/**
 * Modal de suporte interno da LenaVS.
 *
 * Props:
 *   isOpen       – boolean
 *   onClose      – função chamada ao fechar
 *   defaultName  – string: nome pré-preenchido (usuário logado)
 *   defaultEmail – string: e-mail pré-preenchido (usuário logado)
 */
const SupportModal = ({ isOpen, onClose, defaultName = '', defaultEmail = '' }) => {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [message, setMessage] = useState('');
  const [fieldError, setFieldError] = useState('');
  const [sending, setSending] = useState(false);
  const [success, setSuccess] = useState(false);

  /* Sincroniza os campos quando o modal abre */
  useEffect(() => {
    if (isOpen) {
      setName(defaultName);
      setEmail(defaultEmail);
      setMessage('');
      setFieldError('');
      setSuccess(false);
    }
  }, [isOpen, defaultName, defaultEmail]);

  /* Fecha com Escape */
  useEffect(() => {
    if (!isOpen) return undefined;
    const handleKey = (e) => {
      if (e.key === 'Escape' && !sending) onClose?.();
    };
    document.addEventListener('keydown', handleKey);
    return () => document.removeEventListener('keydown', handleKey);
  }, [isOpen, sending, onClose]);

  if (!isOpen) return null;

  const validate = () => {
    const trimmedName = name.trim();
    const trimmedEmail = email.trim();
    const trimmedMsg = message.trim();

    if (!trimmedName) return 'Nome é obrigatório.';
    if (!trimmedEmail) return 'E-mail é obrigatório.';
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmedEmail)) return 'Informe um e-mail válido.';
    if (!trimmedMsg) return 'Mensagem é obrigatória.';
    if (trimmedMsg.length < 10) return 'Mensagem deve ter no mínimo 10 caracteres.';
    return '';
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    const err = validate();
    if (err) {
      setFieldError(err);
      return;
    }
    setFieldError('');
    setSending(true);
    try {
      await api.post('/support/report-error', {
        name: name.trim(),
        email: email.trim(),
        description: message.trim(),
      });
      setSuccess(true);
    } catch (error) {
      setFieldError(
        error.response?.data?.error ||
          'Não foi possível enviar sua mensagem. Tente novamente em alguns instantes.',
      );
    } finally {
      setSending(false);
    }
  };

  const handleOverlayClick = (e) => {
    if (e.target === e.currentTarget && !sending) onClose?.();
  };

  /* ── Tela de sucesso ── */
  if (success) {
    return (
      <div
        className="support-overlay"
        onClick={handleOverlayClick}
        role="dialog"
        aria-modal="true"
        aria-label="Mensagem enviada com sucesso"
      >
        <div className="support-modal support-modal--success" onClick={(e) => e.stopPropagation()}>
          <button
            type="button"
            className="support-modal__close-btn"
            onClick={onClose}
            aria-label="Fechar"
          >
            <X size={15} />
          </button>

          <div className="support-modal__success-icon" aria-hidden="true">
            <CheckCircle size={36} />
          </div>

          <h3 className="support-modal__success-title">Mensagem enviada!</h3>

          <p className="support-modal__success-body">
            Mensagem enviada com sucesso. Nossa equipe responderá em até 24 horas.
          </p>

          <button type="button" className="support-modal__submit-btn" onClick={onClose}>
            Fechar
          </button>
        </div>
      </div>
    );
  }

  /* ── Formulário ── */
  return (
    <div
      className="support-overlay"
      onClick={handleOverlayClick}
      role="dialog"
      aria-modal="true"
      aria-labelledby="support-modal-title"
    >
      <div className="support-modal" onClick={(e) => e.stopPropagation()}>
        {/* Cabeçalho */}
        <div className="support-modal__header">
          <div className="support-modal__header-left">
            <span className="support-modal__header-icon" aria-hidden="true">
              <LifeBuoy size={19} />
            </span>
            <div>
              <h3 id="support-modal-title" className="support-modal__title">
                Suporte LenaVS
              </h3>
              <p className="support-modal__subtitle">
                Envie sua dúvida ou relato. Respondemos em até 24 horas.
              </p>
            </div>
          </div>

          <button
            type="button"
            className="support-modal__close-btn"
            onClick={onClose}
            disabled={sending}
            aria-label="Fechar"
          >
            <X size={15} />
          </button>
        </div>

        {/* Formulário */}
        <form className="support-modal__body" onSubmit={handleSubmit} noValidate>
          <label className="support-modal__field">
            <span className="support-modal__label">
              Nome <span className="support-modal__required" aria-hidden="true">*</span>
            </span>
            <input
              type="text"
              className="support-modal__input"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Seu nome"
              maxLength={120}
              disabled={sending}
              autoComplete="name"
            />
          </label>

          <label className="support-modal__field">
            <span className="support-modal__label">
              E-mail <span className="support-modal__required" aria-hidden="true">*</span>
            </span>
            <input
              type="email"
              className="support-modal__input"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="seu@email.com"
              maxLength={254}
              disabled={sending}
              autoComplete="email"
            />
          </label>

          <label className="support-modal__field">
            <span className="support-modal__label">
              Mensagem <span className="support-modal__required" aria-hidden="true">*</span>
            </span>
            <textarea
              className="support-modal__textarea"
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              placeholder="Descreva sua dúvida ou problema com o máximo de detalhes possível..."
              rows={5}
              maxLength={2000}
              disabled={sending}
            />
            <span className="support-modal__char-count">
              {message.length}/2000
            </span>
          </label>

          {fieldError && (
            <p className="support-modal__error" role="alert">
              {fieldError}
            </p>
          )}

          <p className="support-modal__notice">
            Responderemos sua solicitação pelo e-mail informado em até 24 horas. Se não encontrar nossa resposta, verifique também a pasta Spam ou Lixo Eletrônico.
          </p>

          <div className="support-modal__footer">
            <button
              type="button"
              className="support-modal__cancel-btn"
              onClick={onClose}
              disabled={sending}
            >
              Cancelar
            </button>

            <button
              type="submit"
              className="support-modal__submit-btn"
              disabled={sending}
            >
              {sending ? (
                <>
                  <Loader2 size={15} className="support-modal__spin" />
                  Enviando…
                </>
              ) : (
                <>
                  <Send size={15} />
                  Enviar
                </>
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

export default SupportModal;
