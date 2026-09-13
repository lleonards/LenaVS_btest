import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import {
  BookOpen,
  FolderOpen,
  HelpCircle,
  LifeBuoy,
  LogOut,
  ArrowUp,
  Gem,
  X,
  AlertTriangle,
  Upload,
  FileText,
  Monitor,
  Download,
  User,
  Pencil,
  CreditCard,
  Trash2,
  Loader2,
} from 'lucide-react';
import './Header.css';
import { startUpgradeCheckout } from '../utils/checkout';
import { openBillingPortal } from '../utils/billingPortal';
import { buildAppUrl } from '../utils/appPath';
import AlertDialog from './AlertDialog';
import SupportModal from './SupportModal';

const ABOUT_LENAVS_PARAGRAPHS = [
  'A LenaVS é uma plataforma desenvolvida para facilitar a criação de vídeos de karaokê de forma rápida, prática e acessível.',
  'A ferramenta foi criada com o objetivo de simplificar um processo que normalmente exige diversos programas de edição. Com a LenaVS, é possível importar músicas, letras, imagens ou vídeos de fundo, sincronizar estrofes, personalizar a aparência do texto e exportar o resultado final em poucos passos.',
  'A plataforma permite que cada estrofe seja editada individualmente, oferecendo recursos como definição de tempos de início e fim, ajustes de posição, tamanho, cores, contorno, estilos de texto e efeitos de transição. Também é possível configurar o comportamento de imagens e vídeos de fundo para criar apresentações mais suaves e profissionais.',
  'A LenaVS continua em constante evolução, recebendo melhorias e novos recursos para tornar a criação de vídeos de karaokê cada vez mais simples e eficiente.',
  'Obrigado por utilizar a LenaVS.',
];

const ABOUT_LENAVS_FEATURES = [
  'Sincronização manual de letras com atalhos de teclado para agilizar a edição.',
  'Alternância entre a música original e o playback durante a edição.',
  'Importação de letras por arquivo ou texto colado diretamente no editor.',
  'Organização automática de letras em estrofes.',
  'Personalização completa da aparência das letras.',
  'Transições para textos, imagens e vídeos.',
  'Exportação em diferentes formatos de vídeo.',
  'Compatibilidade com computadores, tablets e dispositivos móveis.',
];

const GUIDE_MODAL_TEXT = {
  title: 'Guia completo do LenaVS',
  description: 'Fluxo recomendado para criar, salvar, publicar e reaproveitar projetos.',
};

const ABOUT_MODAL_TEXT = {
  title: 'Sobre a LenaVS',
  description: 'Conheça a proposta da plataforma e os principais recursos disponíveis.',
};

const HelpRichCard = ({ title, paragraphs = [], bullets = [] }) => (
  <section className="guide-intro-card guide-intro-card--rich">
    {title ? <h4>{title}</h4> : null}

    {paragraphs.map((paragraph) => (
      <p key={paragraph}>{paragraph}</p>
    ))}

    {bullets.length ? (
      <ul className="guide-bullet-list">
        {bullets.map((bullet) => (
          <li key={bullet}>{bullet}</li>
        ))}
      </ul>
    ) : null}
  </section>
);

const GuideProjectsNote = () => (
  <div className="guide-projects-note">
    <strong>Projetos</strong>
    <p>
      Na aba Projetos ficam seus projetos salvos.
      Você pode acessar, editar, excluir ou escolher se quer deixar um projeto público para outros usuários.
      Também é possível ver projetos de outros usuários e criar uma cópia para editar.
    </p>
  </div>
);

const GUIDE_PANELS = [
  {
    id: 'arquivos',
    label: 'Painel Arquivos',
    icon: Upload,
    imageSrc: '/guide/guide_01.png',
    imageAlt: 'Captura do LenaVS com destaque no painel Arquivos.',
    showHighlight: false,
    highlightStyle: {
      left: '1.2%',
      top: '12.1%',
      width: '30.8%',
      height: '73.2%',
    },
    bubbleStyle: {
      right: '2.6%',
      top: '15.5%',
      width: '28%',
    },
    bubbleTone: 'peach',
    bubbleText:
      `Arquivos
Neste painel você adiciona os arquivos usados para criar o vídeo.
Envie a música original e a música instrumental (até 15 minutos cada), 
ou gere a versão instrumental com IA a partir da música original.
Também é possível adicionar uma imagem ou vídeo de fundo opcional para 
personalizar o resultado, além de ajustar o vídeo através do botão "comportamento" quando necessário.
A letra pode ser adicionada por arquivo ou colando o texto, e, se não estiver organizada em estrofes, 
a LenaVS faz essa separação automaticamente para facilitar a edição.`,
  },
  {
    id: 'preview',
    label: 'Preview',
    icon: Monitor,
    imageSrc: '/guide/guide_02.png',
    imageAlt: 'Captura do LenaVS com destaque na área de Preview.',
    showHighlight: false,
    highlightStyle: {
      left: '25.7%',
      top: '8.1%',
      width: '49%',
      height: '60.9%',
    },
    bubbleStyle: {
      left: '2.4%',
      bottom: '8%',
      width: '31%',
    },
    bubbleTone: 'green',
  bubbleText:
  `Preview
Neste painel você acompanha, em tempo real, como o vídeo de karaokê está ficando durante a edição.
É possível reproduzir, pausar e continuar a reprodução do projeto, 
navegar pela linha do tempo e alternar entre a música original e a instrumental usando a tecla T.
Para uma edição mais rápida, utilize a tecla Espaço para reproduzir ou 
pausar o vídeo e Ctrl + ← / → para voltar ou avançar 1 segundo.
Também é possível alterar a cor de fundo do vídeo diretamente pelo painel.
Quando uma estrofe possui os tempos inicial e final definidos no Editor de Letras, 
o Preview retorna automaticamente para o tempo inicial da estrofe ao selecioná-la.`,
  },
  {
    id: 'editor',
    label: 'Editor de Letras',
    icon: FileText,
    imageSrc: '/guide/guide_03.png',
    imageAlt: 'Captura do LenaVS com destaque no Editor de Letras.',
    showHighlight: false,
    highlightStyle: {
      left: '72.1%',
      top: '8.3%',
      width: '25.3%',
      height: '69.8%',
    },
    bubbleStyle: {
      left: '2.4%',
      bottom: '6.8%',
      width: '39%',
    },
    bubbleTone: 'blue',
    bubbleText:
      `Editor de Letras
Neste painel você edita e sincroniza as estrofes da música. 
Cada estrofe fica organizada em um bloco individual, 
onde é possível definir os tempos de início e fim, 
ajustar o tamanho do texto e personalizar sua aparência. 
Você pode aplicar negrito, itálico, sublinhado, alterar cores, contorno e posicionamento da letra. 
No Modo Linha, também é possível personalizar individualmente cada frase ou linha da estrofe. 
Também é possível adicionar transições como Fade, Slide, Zoom In e Zoom Out,
ajustar sua duração e remover blocos de estrofes quando necessário. 
Para agilizar a edição, utilize M para marcar o início da estrofe, 
N para marcar o fim e as teclas ↑ e ↓ para navegar entre as estrofes.`,
  },
  {
    id: 'comportamento',
    label: 'Comportamento',
    icon: LifeBuoy,
    imageSrc: '/guide/guide_04.png',
    imageAlt: 'Captura do LenaVS com destaque no painel Comportamento.',
    showHighlight: false,
    highlightStyle: {
      left: '14.1%',
      top: '15.6%',
      width: '72.5%',
      height: '68.3%',
    },
    bubbleStyle: {
      left: '29%',
      bottom: '4.5%',
      width: '42%',
    },
    bubbleTone: 'peach',
    bubbleText:
      `Comportamento
O botão Comportamento é exibido quando um vídeo ou imagem é adicionado ao projeto. 
Nele, você pode configurar transições para tornar a exibição mais suave. 
Quando o vídeo é maior que o áudio, ele é ajustado automaticamente para a mesma duração da música, 
permitindo configurar apenas as transições de início e fim. 
Se o vídeo for menor que o áudio, ele será repetido automaticamente, 
e você poderá definir transições de início, fim e entre os loops. Para imagens, 
ficam disponíveis apenas as transições de início e fim.`,
  },
  {
    id: 'exportar',
    label: 'Exportar Vídeo',
    icon: Download,
    imageSrc: '/guide/guide_05.png',
    imageAlt: 'Captura do LenaVS com destaque no painel Exportar Vídeo.',
    showHighlight: false,
    highlightStyle: {
      left: '3.4%',
      top: '72.8%',
      width: '93.3%',
      height: '24.2%',
    },
    bubbleStyle: {
      right: '2.4%',
      top: '15.5%',
      width: '25%',
    },
    bubbleTone: 'gold',
    bubbleText:
      `Exportar Vídeo
Neste painel você define as configurações finais do vídeo antes da exportação. 
Para liberar o download, é necessário informar um nome para o projeto. 
Você pode escolher a resolução do vídeo (atualmente até 720p), 
selecionar o formato de saída (MP4, AVI, MOV ou MKV)
e definir qual áudio será utilizado no resultado final, 
entre a música original ou o playback. Após a conclusão da exportação, 
você pode baixar o vídeo gerado ou iniciar um novo projeto pelo botão Novo Projeto.`,
  },
];

const GuidePanelCard = ({ panel }) => {
  const Icon = panel.icon;

  return (
    <section className="guide-card">
      <div className="guide-card__header">
        <span className="guide-card__badge">
          <Icon size={15} />
          {panel.label}
        </span>
      </div>

      <div className={`guide-text guide-text--${panel.bubbleTone}`}>
        {panel.bubbleText.split('\n').map((paragraph, index) => (
          <p key={`${panel.id}-${paragraph}`} className={index === 0 ? 'guide-text__title' : ''}>
            {paragraph}
          </p>
        ))}
      </div>

      <div className="guide-scene">
        <img className="guide-screenshot" src={panel.imageSrc} alt={panel.imageAlt} />
        {panel.showHighlight !== false && panel.highlightStyle ? (
          <div className="guide-highlight" style={panel.highlightStyle} />
        ) : null}
      </div>
    </section>
  );
};

const getDisplayName = (displayName, userEmail) => {
  const trimmed = String(displayName || '').trim();
  if (trimmed) return trimmed;
  const emailPart = String(userEmail || '').split('@')[0];
  return emailPart ? emailPart : 'Meu perfil';
};

const getInitials = (value) => {
  const words = String(value || '')
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2);

  if (!words.length) return 'LP';
  return words.map((word) => word[0]?.toUpperCase() || '').join('');
};

const Header = ({ onOpenProjects = () => {} }) => {
  const {
    signOut,
    hasUnlimitedAccess,
    credits,
    creditsLabel,
    subscriptionStatus,
    cancelScheduledAt,
    displayName,
    avatarUrl,
    userEmail,
    updateProfile,
  } = useAuth();

  const [showHelpMenu, setShowHelpMenu] = useState(false);
  const [activeHelpModal, setActiveHelpModal] = useState(null);
  const [rotatingMessageIndex, setRotatingMessageIndex] = useState(0);
  const [openingCheckout, setOpeningCheckout] = useState(false);
  const [showProfileMenu, setShowProfileMenu] = useState(false);
  const [showProfileModal, setShowProfileModal] = useState(false);
  const [editingName, setEditingName] = useState('');
  const [selectedAvatarFile, setSelectedAvatarFile] = useState(null);
  const [avatarPreviewUrl, setAvatarPreviewUrl] = useState('');
  const [removeAvatar, setRemoveAvatar] = useState(false);
  const [savingProfile, setSavingProfile] = useState(false);
  const [openingBillingPortal, setOpeningBillingPortal] = useState(false);
  const [alertDialog, setAlertDialog] = useState({ isOpen: false, type: 'error', title: '', message: '' });
  const [showSupportModal, setShowSupportModal] = useState(false);

  const showAlert = (type, title, message) => {
    setAlertDialog({ isOpen: true, type, title, message });
  };

  const helpMenuRef = useRef(null);
  const profileMenuRef = useRef(null);
  const fileInputRef = useRef(null);

  const resolvedDisplayName = useMemo(
    () => getDisplayName(displayName, userEmail),
    [displayName, userEmail]
  );

  const resolvedAvatarUrl = avatarPreviewUrl || (removeAvatar ? '' : avatarUrl || '');

  useEffect(() => {
    const handleClickOutside = (event) => {
      if (helpMenuRef.current && !helpMenuRef.current.contains(event.target)) {
        setShowHelpMenu(false);
      }

      if (profileMenuRef.current && !profileMenuRef.current.contains(event.target)) {
        setShowProfileMenu(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  useEffect(() => {
    setEditingName(resolvedDisplayName);
    setSelectedAvatarFile(null);
    setAvatarPreviewUrl('');
    setRemoveAvatar(false);
  }, [resolvedDisplayName, avatarUrl]);

  useEffect(() => () => {
    if (avatarPreviewUrl.startsWith('blob:')) {
      URL.revokeObjectURL(avatarPreviewUrl);
    }
  }, [avatarPreviewUrl]);

  // Rotação de mensagens no topo: 15s para "Novo na LenaVS", 10s para "Ajude outros usuários"
  useEffect(() => {
    const DURATIONS = [15000, 10000]; // ms para cada mensagem (índice 0 e 1)
    let timeoutId;

    const schedule = (currentIndex) => {
      timeoutId = window.setTimeout(() => {
        const nextIndex = (currentIndex + 1) % 2;
        setRotatingMessageIndex(nextIndex);
        schedule(nextIndex);
      }, DURATIONS[currentIndex]);
    };

    schedule(0); // começa no índice 0, aguarda 15s antes de trocar
    return () => window.clearTimeout(timeoutId);
  }, []);

  const handleUpgrade = async () => {
    if (openingCheckout) return;

    try {
      await startUpgradeCheckout({
        onStart: () => setOpeningCheckout(true),
        onFinish: () => setOpeningCheckout(false),
        onError: (message) => showAlert('error', 'Erro no checkout', message),
      });
    } catch {
      // Erro já tratado no helper.
    }
  };

  const handleLogout = async () => {
    await signOut();
    window.location.href = `${window.location.origin}${window.location.pathname}#/login`;
  };

  const openGuideModal = () => {
    setActiveHelpModal('guide');
    setShowHelpMenu(false);
  };

  const openAboutModal = () => {
    setActiveHelpModal('about');
    setShowHelpMenu(false);
  };

  const openSupportModal = () => {
    setShowHelpMenu(false);
    setActiveHelpModal(null);
    setShowSupportModal(true);
  };

  const openProfileModal = () => {
    setEditingName(resolvedDisplayName);
    setSelectedAvatarFile(null);
    setAvatarPreviewUrl('');
    setRemoveAvatar(false);
    setShowProfileMenu(false);
    setShowProfileModal(true);
  };

  const openPrivacyPolicy = () => {
    setShowProfileMenu(false);
    window.open(buildAppUrl('/privacy-policy'), '_blank', 'noopener,noreferrer');
  };

  const handleAvatarFileChange = (event) => {
    const nextFile = event.target.files?.[0] || null;

    if (!nextFile) return;

    if (avatarPreviewUrl.startsWith('blob:')) {
      URL.revokeObjectURL(avatarPreviewUrl);
    }

    setSelectedAvatarFile(nextFile);
    setAvatarPreviewUrl(URL.createObjectURL(nextFile));
    setRemoveAvatar(false);
  };

  const handleRemoveAvatar = () => {
    if (avatarPreviewUrl.startsWith('blob:')) {
      URL.revokeObjectURL(avatarPreviewUrl);
    }

    setSelectedAvatarFile(null);
    setAvatarPreviewUrl('');
    setRemoveAvatar(true);

    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  const handleSaveProfile = async (event) => {
    event.preventDefault();

    if (savingProfile) return;

    try {
      setSavingProfile(true);
      await updateProfile({
        displayName: editingName,
        avatarFile: selectedAvatarFile,
        removeAvatar,
      });
      setShowProfileModal(false);
    } catch (error) {
      const message =
        error.response?.data?.error ||
        error.message ||
        'Não foi possível atualizar o perfil.';
      showAlert('error', 'Erro ao salvar perfil', message);
    } finally {
      setSavingProfile(false);
    }
  };

  const handleOpenBillingPortal = async () => {
    if (openingBillingPortal) return;

    try {
      await openBillingPortal({
        onStart: () => setOpeningBillingPortal(true),
        onFinish: () => setOpeningBillingPortal(false),
        onError: (message) => showAlert('error', 'Erro no portal de cobrança', message),
      });
    } catch {
      // Erro já tratado no helper.
    }
  };

  // Cancelamento agendado: assinatura Pro cancelada, mas período pago ainda vigente.
  // Neste estado hasUnlimitedAccess = true (unlimited_access_until > now).
  const isCancelScheduled = Boolean(hasUnlimitedAccess && subscriptionStatus === 'canceled' && cancelScheduledAt);

  const formatCancelDate = (isoDate) => {
    if (!isoDate) return '';
    const d = new Date(isoDate);
    return d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' });
  };

  const isSubscriptionExpired = !hasUnlimitedAccess && (subscriptionStatus === 'canceled' || subscriptionStatus === 'past_due');
  const showFreeLimitNotice = !hasUnlimitedAccess && Number(credits) <= 0;

  return (
    <>
      <header className="header">
        <div className="header-logo">
          <img src="/logo_oficial.png" alt="LenaVS Logo" className="logo-img" />
        </div>

        <div className="header-center-slot" aria-live="polite">
          {isCancelScheduled ? (
            /* Assinatura cancelada, mas período pago ainda vigente.
               O acesso Pro continua até cancelScheduledAt. */
            <div className="header-free-limit-notice" style={{ borderColor: '#f59e0b', color: '#f59e0b', cursor: 'default' }}>
              <AlertTriangle size={15} />
              <span>
                Plano cancelado. Premium ativo até {formatCancelDate(cancelScheduledAt)}.
              </span>
            </div>
          ) : isSubscriptionExpired ? (
            <button type="button" className="header-free-limit-notice" onClick={() => void handleUpgrade()}
              style={{ borderColor: '#ef4444', color: '#ef4444' }}>
              <AlertTriangle size={15} />
              <span>
                {openingCheckout
                  ? 'Abrindo checkout...'
                  : subscriptionStatus === 'past_due'
                  ? 'Pagamento pendente. Regularize para continuar usando o LenaVS'
                  : 'Prazo expirado. Efetue o pagamento para continuar usando o LenaVS'}
              </span>
            </button>
          ) : showFreeLimitNotice ? (
            <button type="button" className="header-free-limit-notice" onClick={() => void handleUpgrade()}>
              <AlertTriangle size={15} />
              <span>{openingCheckout ? 'Abrindo checkout...' : 'Limite gratuito atingido. Ative o LenaVS Unlimited'}</span>
            </button>
          ) : rotatingMessageIndex === 0 ? (
            <div className="header-inline-help-notice">
              <span className="header-inline-help-text">Novo na LenaVS? Confira</span>

              <button
                type="button"
                className="header-inline-help-link"
                onClick={openGuideModal}
              >
                a Ajuda e o Guia
              </button>
            </div>
          ) : (
            <div className="header-inline-help-notice">
              <span className="header-inline-help-text">
                Ajude outros usuários publicando seus projetos na Biblioteca da Comunidade.
              </span>
            </div>
          )}
        </div>

        <div className="header-nav">
          {hasUnlimitedAccess ? (
            <div className="pro-badge-v2">
              <Gem size={14} />
              <span className="pro-text">UNLIMITED</span>
              <span className="pro-status">Acesso ativo</span>
            </div>
          ) : (
            <button
              type="button"
              className="upgrade-btn-lenavs"
              onClick={() => void handleUpgrade()}
              disabled={openingCheckout}
              style={isSubscriptionExpired ? { borderColor: '#ef4444' } : undefined}
            >
              <div className="credits-section">
                <span className="credits-val" style={isSubscriptionExpired ? { color: '#ef4444' } : undefined}>
                  {isSubscriptionExpired ? '⚠' : creditsLabel}
                </span>
                <span className="credits-label">
                  {isSubscriptionExpired ? 'Expirado' : 'Créditos'}
                </span>
              </div>

              <div className="upgrade-label" style={isSubscriptionExpired ? { background: '#ef4444' } : undefined}>
                <ArrowUp size={14} />
                {openingCheckout ? 'ABRINDO' : isSubscriptionExpired ? 'RENOVAR' : 'UPGRADE'}
              </div>
            </button>
          )}

          <div className={`header-help-wrap${showHelpMenu ? ' header-help-wrap--open' : ''}`} ref={helpMenuRef}>
            <button
              type="button"
              className="header-btn"
              onClick={() => setShowHelpMenu((prev) => !prev)}
            >
              <HelpCircle size={20} />
              Ajuda
            </button>

            {showHelpMenu ? (
              <div className="header-dropdown">
                <button
                  type="button"
                  className="header-dropdown__item"
                  onClick={openGuideModal}
                >
                  <BookOpen size={16} />
                  Guia completo
                </button>

                <button
                  type="button"
                  className="header-dropdown__item"
                  onClick={openAboutModal}
                >
                  <HelpCircle size={16} />
                  Sobre a LenaVS
                </button>

                <button
                  type="button"
                  className="header-dropdown__item"
                  onClick={openSupportModal}
                >
                  <LifeBuoy size={16} />
                  Suporte
                </button>
              </div>
            ) : null}
          </div>

          <button type="button" className="header-btn" onClick={onOpenProjects}>
            <FolderOpen size={20} />
            Projetos
          </button>

          <div className={`header-profile-wrap${showProfileMenu ? ' header-profile-wrap--open' : ''}`} ref={profileMenuRef}>
            <button
              type="button"
              className="header-profile-button"
              onClick={() => setShowProfileMenu((prev) => !prev)}
              title={resolvedDisplayName}
              aria-label={`Perfil de ${resolvedDisplayName}`}
            >
              <span className="header-profile-avatar" aria-hidden="true">
                {resolvedAvatarUrl ? (
                  <img src={resolvedAvatarUrl} alt={resolvedDisplayName} className="header-profile-avatar__image" />
                ) : (
                  <span className="header-profile-avatar__initials">{getInitials(resolvedDisplayName)}</span>
                )}
              </span>
            </button>

            {showProfileMenu ? (
              <div className="header-dropdown header-dropdown--profile">
                <div className="header-profile-summary">
                  <span className="header-profile-summary__avatar" aria-hidden="true">
                    {resolvedAvatarUrl ? (
                      <img src={resolvedAvatarUrl} alt={resolvedDisplayName} className="header-profile-summary__image" />
                    ) : (
                      <span className="header-profile-summary__initials">{getInitials(resolvedDisplayName)}</span>
                    )}
                  </span>

                  <div className="header-profile-summary__text">
                    <strong>{resolvedDisplayName}</strong>
                    <span>{userEmail || 'Conta LenaVS'}</span>
                  </div>
                </div>

                <button
                  type="button"
                  className="header-dropdown__item"
                  onClick={openProfileModal}
                >
                  <Pencil size={16} />
                  Editar perfil
                </button>

                <button
                  type="button"
                  className="header-dropdown__item"
                  onClick={openPrivacyPolicy}
                >
                  <FileText size={16} />
                  Política de Privacidade
                </button>

                <button
                  type="button"
                  className="header-dropdown__item"
                  onClick={() => {
                    setShowProfileMenu(false);
                    void handleOpenBillingPortal();
                  }}
                >
                  <CreditCard size={16} />
                  {openingBillingPortal ? 'Abrindo Stripe...' : 'Gerenciar assinatura'}
                </button>

                <button
                  type="button"
                  className="header-dropdown__item header-dropdown__item--danger"
                  onClick={() => {
                    setShowProfileMenu(false);
                    void handleLogout();
                  }}
                >
                  <LogOut size={16} />
                  Sair da conta
                </button>
              </div>
            ) : null}
          </div>
        </div>
      </header>

      {activeHelpModal ? (
        <div className="guide-overlay" onClick={() => setActiveHelpModal(null)}>
          <div
            className={`guide-modal${activeHelpModal === 'about' ? ' guide-modal--narrow' : ''}`}
            onClick={(event) => event.stopPropagation()}
          >
            <div className="guide-modal__header">
              <div>
                <h3>{activeHelpModal === 'about' ? ABOUT_MODAL_TEXT.title : GUIDE_MODAL_TEXT.title}</h3>
                <p>{activeHelpModal === 'about' ? ABOUT_MODAL_TEXT.description : GUIDE_MODAL_TEXT.description}</p>
              </div>

              <button type="button" className="guide-close-btn" onClick={() => setActiveHelpModal(null)}>
                <X size={18} />
              </button>
            </div>

            <div className="guide-modal__body">
              {activeHelpModal === 'about' ? (
                <>
                  <HelpRichCard
                    paragraphs={ABOUT_LENAVS_PARAGRAPHS.slice(0, 3)}
                    bullets={ABOUT_LENAVS_FEATURES}
                  />
                  <HelpRichCard
                    title="Evolução contínua"
                    paragraphs={ABOUT_LENAVS_PARAGRAPHS.slice(3)}
                  />
                </>
              ) : (
                <>
                  <div className="guide-gallery">
                    {GUIDE_PANELS.map((panel) => (
                      <GuidePanelCard key={panel.id} panel={panel} />
                    ))}
                  </div>

                  <GuideProjectsNote />
                </>
              )}
            </div>
          </div>
        </div>
      ) : null}

      {showProfileModal ? (
        <div className="guide-overlay" onClick={() => !savingProfile && setShowProfileModal(false)}>
          <div className="profile-modal" onClick={(event) => event.stopPropagation()}>
            <div className="guide-modal__header profile-modal__header">
              <div>
                <h3>Editar perfil</h3>
                <p>Atualize seu nome e sua foto de perfil.</p>
              </div>

              <button
                type="button"
                className="guide-close-btn"
                onClick={() => !savingProfile && setShowProfileModal(false)}
                disabled={savingProfile}
              >
                <X size={18} />
              </button>
            </div>

            <form className="profile-modal__body" onSubmit={handleSaveProfile}>
              <div className="profile-modal__avatar-row">
                <div className="profile-modal__avatar-preview" aria-hidden="true">
                  {resolvedAvatarUrl ? (
                    <img src={resolvedAvatarUrl} alt={resolvedDisplayName} className="profile-modal__avatar-image" />
                  ) : (
                    <span className="profile-modal__avatar-initials">{getInitials(editingName || resolvedDisplayName)}</span>
                  )}
                </div>

                <div className="profile-modal__avatar-actions">
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept="image/*"
                    className="profile-modal__file-input"
                    onChange={handleAvatarFileChange}
                  />

                  <div className="profile-modal__avatar-action-row">
                    <button
                      type="button"
                      className="profile-modal__secondary-btn"
                      onClick={() => fileInputRef.current?.click()}
                    >
                      <Upload size={16} />
                      Escolher foto
                    </button>
                  </div>

                  {(avatarUrl || avatarPreviewUrl) ? (
                    <button
                      type="button"
                      className="profile-modal__danger-btn"
                      onClick={handleRemoveAvatar}
                    >
                      <Trash2 size={16} />
                      Remover foto
                    </button>
                  ) : null}
                </div>
              </div>

              <label className="profile-modal__field">
                <span>Nome</span>
                <input
                  type="text"
                  value={editingName}
                  onChange={(event) => setEditingName(event.target.value)}
                  placeholder="Seu nome"
                  maxLength={80}
                  disabled={savingProfile}
                />
              </label>

              <div className="profile-modal__footer">
                <button
                  type="button"
                  className="profile-modal__ghost-btn"
                  onClick={() => setShowProfileModal(false)}
                  disabled={savingProfile}
                >
                  Cancelar
                </button>

                <button type="submit" className="profile-modal__primary-btn" disabled={savingProfile}>
                  {savingProfile ? (
                    <>
                      <Loader2 size={16} className="spin" />
                      Salvando...
                    </>
                  ) : (
                    <>
                      <User size={16} />
                      Salvar perfil
                    </>
                  )}
                </button>
              </div>
            </form>
          </div>
        </div>
      ) : null}

      <AlertDialog
        isOpen={alertDialog.isOpen}
        type={alertDialog.type}
        title={alertDialog.title}
        message={alertDialog.message}
        onClose={() => setAlertDialog((prev) => ({ ...prev, isOpen: false }))}
      />

      <SupportModal
        isOpen={showSupportModal}
        onClose={() => setShowSupportModal(false)}
        defaultName={resolvedDisplayName !== 'Meu perfil' ? resolvedDisplayName : ''}
        defaultEmail={userEmail || ''}
      />
    </>
  );
};

export default Header;
