import React from 'react';
import { AlertCircle, AlertTriangle, CheckCircle2, Info, X } from 'lucide-react';
import './NoticeCenter.css';

const NOTICE_META = {
  success: {
    icon: CheckCircle2,
    label: 'Sucesso',
  },
  error: {
    icon: AlertCircle,
    label: 'Erro',
  },
  warning: {
    icon: AlertTriangle,
    label: 'Aviso',
  },
  info: {
    icon: Info,
    label: 'Informação',
  },
};

const NoticeCenter = ({ notices = [], onDismiss }) => {
  if (!notices.length) {
    return null;
  }

  return (
    <div className="notice-center" aria-live="polite" aria-atomic="false">
      {notices.map((notice) => {
        const meta = NOTICE_META[notice.type] || NOTICE_META.info;
        const Icon = meta.icon;

        return (
          <div
            key={notice.id}
            className={`notice-card notice-card--${notice.type || 'info'}${notice.persistent ? ' notice-card--persistent' : ''}`}
            role={notice.type === 'error' ? 'alert' : 'status'}
          >
            <div className="notice-card__icon" aria-hidden="true">
              <Icon size={18} />
            </div>

            <div className="notice-card__content">
              <div className="notice-card__header">
                <strong>{notice.title || meta.label}</strong>
                {notice.persistent ? <span className="notice-card__pill">fixo</span> : null}
              </div>
              <p>{notice.message}</p>
            </div>

            <button
              type="button"
              className="notice-card__close"
              onClick={() => onDismiss?.(notice.id)}
              aria-label="Fechar aviso"
              title="Fechar aviso"
            >
              <X size={15} />
            </button>
          </div>
        );
      })}
    </div>
  );
};

export default NoticeCenter;
