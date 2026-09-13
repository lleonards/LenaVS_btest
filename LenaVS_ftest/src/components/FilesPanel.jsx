import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Upload, Type, X, Loader2, Sparkles, Music2 } from 'lucide-react';
import api from '../services/api';
import { useAuth } from '../contexts/AuthContext';
import './FilesPanel.css';
import { createStanzaFromText } from '../utils/stanza';
import {
  DEFAULT_MEDIA_ANIMATION,
  MEDIA_ANIMATION_DURATION_MAX,
  MEDIA_ANIMATION_DURATION_MIN,
  normalizeMediaAnimation,
  clampMediaAnimationDuration,
} from '../utils/mediaAnimation';

const FILE_LABELS = {
  musicaOriginal: 'Música Original',
  musicaInstrumental: 'Música Instrumental',
  video: 'Vídeo / Foto (fundo)',
  letraArquivo: 'Letra (arquivo)',
};

const MEDIA_TRANSITION_OPTIONS = [
  { value: 'fade', label: 'Fade' },
  { value: 'slide', label: 'Slide' },
  { value: 'zoom-in', label: 'Zoom In' },
  { value: 'zoom-out', label: 'Zoom Out' },
];

const MAX_AUDIO_MINUTES = 15;
const MAX_AUDIO_SECONDS = MAX_AUDIO_MINUTES * 60;
const IMAGE_EXTENSIONS = new Set(['.jpg', '.jpeg', '.png', '.gif', '.bmp', '.webp']);
const AUDIO_ACCEPT = [
  'audio/*',
  '.mp3', '.wav', '.ogg', '.oga', '.m4a', '.mp4', '.aac', '.flac', '.wma', '.opus',
  '.weba', '.webm', '.aiff', '.aif', '.amr', '.caf', '.mka', '.alac', '.mid', '.midi',
].join(',');
const BACKGROUND_ACCEPT = [
  'video/*',
  'image/*',
  '.mp4', '.mov', '.avi', '.mkv', '.webm', '.m4v', '.mpeg', '.mpg', '.3gp', '.ts',
  '.mts', '.m2ts', '.mxf', '.flv', '.wmv', '.asf', '.ogv', '.vob', '.rm', '.rmvb',
  '.jpg', '.jpeg', '.png', '.gif', '.bmp', '.webp',
].join(',');
const LYRICS_ACCEPT = [
  '.txt', '.lrc', '.srt', '.md', '.rtf', '.doc', '.docx', '.pdf',
  'text/plain', 'application/pdf',
].join(',');

const readAudioDuration = (file) => new Promise((resolve, reject) => {
  const audio = document.createElement('audio');
  const objectUrl = URL.createObjectURL(file);

  const cleanup = () => {
    URL.revokeObjectURL(objectUrl);
    audio.removeAttribute('src');
    audio.load();
  };

  audio.preload = 'metadata';
  audio.src = objectUrl;

  audio.onloadedmetadata = () => {
    const duration = Number(audio.duration);
    cleanup();
    resolve(Number.isFinite(duration) ? duration : 0);
  };

  audio.onerror = () => {
    cleanup();
    reject(new Error('Não foi possível validar a duração do áudio.'));
  };
});

const getFileExtension = (fileName = '') => {
  const normalized = String(fileName || '').trim().toLowerCase();
  const dotIndex = normalized.lastIndexOf('.');
  return dotIndex >= 0 ? normalized.slice(dotIndex) : '';
};

const fileMatchesExtensionSet = (file, extensionSet) => extensionSet.has(getFileExtension(file?.name));

const getFriendlyApiError = (error, file, fallback) => {
  const responseData = error?.response?.data || {};
  const fileName = file?.name || responseData.fileName || 'arquivo';
  const serverMessage = String(responseData.error || '').trim();

  if (responseData.code === 'FILE_TOO_LARGE' || error?.response?.status === 413) {
    return `O arquivo "${fileName}" é muito grande. Escolha um arquivo menor e tente novamente.`;
  }

  if (responseData.code === 'MEDIA_READ_ERROR') {
    return `Não foi possível ler o arquivo "${fileName}". Ele pode estar corrompido ou em um formato que o servidor não reconhece.`;
  }

  if (responseData.code === 'AUDIO_TOO_LONG') {
    return `O áudio "${fileName}" ultrapassa o limite de ${MAX_AUDIO_MINUTES} minutos.`;
  }

  if (responseData.code === 'UNSUPPORTED_FILE_TYPE' || error?.response?.status === 415) {
    return `O arquivo "${fileName}" não tem um formato aceito para este campo. Confira a extensão e tente novamente.`;
  }

  if (responseData.code === 'LYRICS_TEXT_NOT_FOUND') {
    return `Não foi possível encontrar texto legível no arquivo "${fileName}".`;
  }

  if (responseData.code === 'LYRICS_OCR_FAILED') {
    return `Não foi possível reconhecer o texto do PDF "${fileName}" nem com OCR. Verifique a qualidade da imagem e tente novamente.`;
  }

  if (responseData.code === 'LYRICS_READ_ERROR' || responseData.code === 'UNSUPPORTED_LYRICS_FORMAT') {
    return serverMessage || `Não foi possível ler o arquivo "${fileName}".`;
  }

  if (serverMessage) return serverMessage;
  return fallback;
};

const sanitizeDurationDraft = (value) => {
  const normalized = String(value ?? '').replace(',', '.').replace(/[^\d.]/g, '');
  const [integerPart = '', ...fractionParts] = normalized.split('.');
  const fraction = fractionParts.join('');

  return fractionParts.length > 0
    ? `${integerPart.slice(0, 2)}.${fraction.slice(0, 2)}`
    : integerPart.slice(0, 2);
};

const normalizeDurationValue = (value) => {
  const numeric = Number(value);
  return Number.isFinite(numeric) && numeric > 0 ? Number(numeric.toFixed(3)) : null;
};

const normalizeUploadedMediaMetadataEntry = (value, fallbackKind) => ({
  kind: String(value?.kind || fallbackKind || '').trim().toLowerCase() || fallbackKind || null,
  duration: normalizeDurationValue(value?.duration),
  publicUrl: String(value?.publicUrl || '').trim() || null,
  storagePath: String(value?.storagePath || '').trim() || null,
  bucket: String(value?.bucket || '').trim() || null,
});

const readMediaDurationFromUrl = (url, mediaKind) => new Promise((resolve, reject) => {
  const element = document.createElement(mediaKind === 'video' ? 'video' : 'audio');

  const cleanup = () => {
    element.removeAttribute('src');
    element.load();
  };

  element.preload = 'metadata';
  element.src = url;

  element.onloadedmetadata = () => {
    const duration = normalizeDurationValue(element.duration);
    cleanup();
    resolve(duration);
  };

  element.onerror = () => {
    cleanup();
    reject(new Error('Não foi possível ler a duração da mídia.'));
  };
});

const FilesPanel = ({
  onLyricsProcessed,
  onFilesUploaded,
  onMediaAnimationChange,
  onMediaMetadataChange,
  onSyncLyrics,
  isSyncingLyrics = false,
  stanzaCount = 0,
  syncStatus = null,
  mediaFiles = {},
  mediaMetadata = {},
  mediaAnimation = DEFAULT_MEDIA_ANIMATION,
  audioType = 'original',
  onNotify,
}) => {
  const { isAuthenticated, loading: authLoading } = useAuth();

  const panelRef = useRef(null);
  const animationDialogRef = useRef(null);
  const [uploadingType, setUploadingType] = useState(null);
  const [isCreatingInstrumental, setIsCreatingInstrumental] = useState(false);
  const [lyricsText, setLyricsText] = useState('');
  const [showLyricsModal, setShowLyricsModal] = useState(false);
  const [showAnimationsPanel, setShowAnimationsPanel] = useState(false);
  const [durationDrafts, setDurationDrafts] = useState({});

  const normalizedMediaAnimation = useMemo(
    () => normalizeMediaAnimation(mediaAnimation),
    [mediaAnimation]
  );

  const [uploaded, setUploaded] = useState({
    musicaOriginal: false,
    musicaInstrumental: false,
    video: false,
    letraArquivo: false,
    letraManual: false,
  });

  const isUploading = uploadingType !== null;
  const anyBusy = isUploading || isCreatingInstrumental || isSyncingLyrics;

  // Instrumental pode ser criado quando há música original mas ainda não há instrumental
  const canCreateInstrumental = Boolean(mediaFiles?.musicaOriginal) && !isCreatingInstrumental;
  const hasBackgroundMedia = Boolean(mediaFiles?.video || mediaFiles?.imagem);

  // Sincronização automática exige música original + letra (blocos) carregadas
  const canAutoSyncLyrics = Boolean(mediaFiles?.musicaOriginal) && stanzaCount > 0 && !isSyncingLyrics;

  const handleAutoSyncLyrics = () => {
    if (!canAutoSyncLyrics) return;
    onSyncLyrics?.();
  };

  const effectiveAudioField = useMemo(() => {
    if (audioType === 'instrumental' && mediaFiles?.musicaInstrumental) {
      return 'musicaInstrumental';
    }

    if (mediaFiles?.musicaOriginal) {
      return 'musicaOriginal';
    }

    if (mediaFiles?.musicaInstrumental) {
      return 'musicaInstrumental';
    }

    return null;
  }, [audioType, mediaFiles]);

  const currentAudioDuration = useMemo(() => {
    if (!effectiveAudioField) return null;
    return normalizeDurationValue(mediaMetadata?.[effectiveAudioField]?.duration);
  }, [effectiveAudioField, mediaMetadata]);

  const currentVideoDuration = useMemo(
    () => normalizeDurationValue(mediaMetadata?.video?.duration),
    [mediaMetadata]
  );

  const shouldShowLoopTransition = Boolean(
    mediaFiles?.video
    && currentVideoDuration
    && currentAudioDuration
    && currentVideoDuration < currentAudioDuration
  );

  useEffect(() => {
    setDurationDrafts({
      introDuration: String(normalizedMediaAnimation.introDuration),
      outroDuration: String(normalizedMediaAnimation.outroDuration),
      loopTransitionDuration: String(normalizedMediaAnimation.loopTransitionDuration),
    });
  }, [normalizedMediaAnimation]);

  useEffect(() => {
    if (!showAnimationsPanel || typeof document === 'undefined') return undefined;

    const handlePointerDown = (event) => {
      const target = event.target;

      if (panelRef.current?.contains(target) || animationDialogRef.current?.contains(target)) {
        return;
      }

      setShowAnimationsPanel(false);
    };

    const handleKeyDown = (event) => {
      if (event.key === 'Escape') {
        setShowAnimationsPanel(false);
      }
    };

    const previousBodyOverflow = document.body.style.overflow;
    const previousHtmlOverflow = document.documentElement.style.overflow;

    document.body.style.overflow = 'hidden';
    document.documentElement.style.overflow = 'hidden';
    document.addEventListener('mousedown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);

    return () => {
      document.body.style.overflow = previousBodyOverflow;
      document.documentElement.style.overflow = previousHtmlOverflow;
      document.removeEventListener('mousedown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [showAnimationsPanel]);

  useEffect(() => {
    if (!hasBackgroundMedia) {
      setShowAnimationsPanel(false);
    }
  }, [hasBackgroundMedia]);

  useEffect(() => {
    const probeJobs = [];

    if (mediaFiles?.musicaOriginal && !normalizeDurationValue(mediaMetadata?.musicaOriginal?.duration)) {
      probeJobs.push({ field: 'musicaOriginal', url: mediaFiles.musicaOriginal, kind: 'audio' });
    }

    if (mediaFiles?.musicaInstrumental && !normalizeDurationValue(mediaMetadata?.musicaInstrumental?.duration)) {
      probeJobs.push({ field: 'musicaInstrumental', url: mediaFiles.musicaInstrumental, kind: 'audio' });
    }

    if (mediaFiles?.video && !normalizeDurationValue(mediaMetadata?.video?.duration)) {
      probeJobs.push({ field: 'video', url: mediaFiles.video, kind: 'video' });
    }

    if (!probeJobs.length || typeof onMediaMetadataChange !== 'function') {
      return undefined;
    }

    let cancelled = false;

    Promise.allSettled(
      probeJobs.map(async ({ field, url, kind }) => ({
        field,
        kind,
        duration: await readMediaDurationFromUrl(url, kind),
      }))
    ).then((results) => {
      if (cancelled) return;

      const metadataPatch = {};

      results.forEach((result) => {
        if (result.status !== 'fulfilled') return;
        const { field, kind, duration } = result.value;
        metadataPatch[field] = {
          ...(mediaMetadata?.[field] || {}),
          ...normalizeUploadedMediaMetadataEntry(
            {
              ...(mediaMetadata?.[field] || {}),
              kind,
              duration,
            },
            kind
          ),
        };
      });

      if (Object.keys(metadataPatch).length > 0) {
        onMediaMetadataChange(metadataPatch);
      }
    });

    return () => {
      cancelled = true;
    };
  }, [mediaFiles, mediaMetadata, onMediaMetadataChange]);

  const validateAudioLengthIfNeeded = async (file, type) => {
    if (!file || !['musicaOriginal', 'musicaInstrumental'].includes(type)) {
      return;
    }

    let durationInSeconds = null;

    try {
      durationInSeconds = await readAudioDuration(file);
    } catch (error) {
      console.warn('Falha ao ler metadados do áudio no navegador. Validação seguirá no backend.', error);
      return;
    }

    if (durationInSeconds > MAX_AUDIO_SECONDS) {
      throw new Error(`O áudio excede ${MAX_AUDIO_MINUTES} minutos. Envie um arquivo com até ${MAX_AUDIO_MINUTES} minutos.`);
    }
  };

  const handleFileUpload = async (e, type) => {
    const file = e.target.files[0];
    if (!file) return;

    if (authLoading || !isAuthenticated) {
      onNotify?.({
        type: 'warning',
        title: 'Login necessário',
        message: 'Você precisa estar logado para enviar arquivos.',
      });
      return;
    }

    const formData = new FormData();
    const isImageMime = String(file.type || '').startsWith('image/');
    const isKnownImageExtension = fileMatchesExtensionSet(file, IMAGE_EXTENSIONS);
    const isBackgroundImage = type === 'video' && (isImageMime || isKnownImageExtension);
    const backendField = isBackgroundImage ? 'imagem' : type;

    try {
      await validateAudioLengthIfNeeded(file, type);
      formData.append(backendField, file);
      setUploadingType(type);

      const response = await api.post('/video/upload', formData);
      const returnedMetadata = response.data?.metadata?.[backendField] || null;
      const publicUrl = returnedMetadata?.publicUrl || response.data?.files?.[backendField] || null;

      if (type === 'video') {
        onFilesUploaded({
          video: isBackgroundImage ? null : publicUrl,
          imagem: isBackgroundImage ? publicUrl : null,
        });

        onMediaMetadataChange?.({
          video: isBackgroundImage ? null : normalizeUploadedMediaMetadataEntry(returnedMetadata, 'video'),
          imagem: isBackgroundImage ? normalizeUploadedMediaMetadataEntry(returnedMetadata, 'image') : null,
        });
      } else {
        onFilesUploaded({ [type]: publicUrl });
        onMediaMetadataChange?.({
          [type]: normalizeUploadedMediaMetadataEntry(returnedMetadata, 'audio'),
        });
      }

      setUploaded((prev) => ({ ...prev, [type]: true }));
      if (type === 'video') {
        setShowAnimationsPanel(true);
      }
    } catch (error) {
      console.error('Erro no upload:', error.response || error);
      onNotify?.({
        type: 'error',
        title: `Erro ao enviar ${FILE_LABELS[type] || 'arquivo'}`,
        message: getFriendlyApiError(error, file, `Não foi possível enviar o arquivo "${file.name}".`),
      });
    } finally {
      setUploadingType(null);
      e.target.value = '';
    }
  };

  const mapTextsToStanzas = (stanzaTexts = []) => {
    return stanzaTexts.map((text) => createStanzaFromText(text));
  };

  const handleLyricsUpload = async (e) => {
    const file = e.target.files[0];
    if (!file) return;

    if (authLoading || !isAuthenticated) {
      onNotify?.({
        type: 'warning',
        title: 'Login necessário',
        message: 'Você precisa estar logado para enviar letras.',
      });
      return;
    }

    const formData = new FormData();
    formData.append('letra', file);

    try {
      setUploadingType('letraArquivo');
      const response = await api.post('/lyrics/upload', formData);
      const stanzasData = mapTextsToStanzas(response.data.stanzas);

      onLyricsProcessed(stanzasData);
      setUploaded((prev) => ({ ...prev, letraArquivo: true }));
    } catch (error) {
      console.error('Erro ao processar letra:', error.response || error);
      onNotify?.({
        type: 'error',
        title: `Erro ao ler ${file.name}`,
        message: getFriendlyApiError(error, file, `Não foi possível ler o arquivo "${file.name}".`),
      });
    } finally {
      setUploadingType(null);
      e.target.value = '';
    }
  };

  const handleManualLyrics = async () => {
    if (!lyricsText.trim()) return;

    if (authLoading || !isAuthenticated) {
      onNotify?.({
        type: 'warning',
        title: 'Login necessário',
        message: 'Você precisa estar logado para enviar letras.',
      });
      return;
    }

    try {
      setUploadingType('letraManual');
      const response = await api.post('/lyrics/manual', { text: lyricsText });
      const stanzasData = mapTextsToStanzas(response.data.stanzas);

      onLyricsProcessed(stanzasData);
      setLyricsText('');
      setUploaded((prev) => ({ ...prev, letraManual: true }));
      setShowLyricsModal(false);
    } catch (error) {
      console.error('Erro ao processar letra manual:', error.response || error);
      onNotify?.({
        type: 'error',
        title: 'Falha ao processar letra',
        message: error.response?.data?.error || 'Erro ao processar letra',
      });
    } finally {
      setUploadingType(null);
    }
  };

  const handleCreateInstrumental = async () => {
    if (!canCreateInstrumental || anyBusy || !isAuthenticated) return;

    try {
      setIsCreatingInstrumental(true);

      onNotify?.({
        type: 'info',
        title: 'Criando instrumental…',
        message: 'Separando voz e instrumental com IA. Esta ação pode levar alguns instantes',
      });

      const response = await api.post('/media/instrumental', {
        audioUrl: mediaFiles.musicaOriginal,
      });

      const { instrumentalUrl, duration } = response.data || {};

      if (!instrumentalUrl) {
        throw new Error('O servidor não retornou a URL do instrumental.');
      }

      // Atualiza o arquivo instrumental no editor
      onFilesUploaded?.({ musicaInstrumental: instrumentalUrl });

      // Atualiza os metadados com a duração detectada pelo backend
      if (duration != null) {
        onMediaMetadataChange?.({
          musicaInstrumental: normalizeUploadedMediaMetadataEntry({
            ...(mediaMetadata?.musicaInstrumental || {}),
            kind: 'audio',
            duration,
            publicUrl: instrumentalUrl,
          }, 'audio'),
        });
      }

      setUploaded((prev) => ({ ...prev, musicaInstrumental: true }));

      onNotify?.({
        type: 'success',
        title: 'Instrumental criado!',
        message: 'A versão sem voz foi gerada com sucesso e já foi adicionada ao projeto.',
      });
    } catch (error) {
      console.error('[FilesPanel] Erro ao criar instrumental:', error);
      onNotify?.({
        type: 'error',
        title: 'Falha ao criar instrumental',
        message: error.response?.data?.error || error.message || 'Erro ao processar a música.',
      });
    } finally {
      setIsCreatingInstrumental(false);
    }
  };

  const applyMediaAnimationPatch = (patch) => {
    const nextValue = normalizeMediaAnimation({
      ...normalizedMediaAnimation,
      ...patch,
    });

    onMediaAnimationChange?.(nextValue);
  };

  const handleDurationDraftChange = (field, value) => {
    setDurationDrafts((prev) => ({
      ...prev,
      [field]: sanitizeDurationDraft(value),
    }));
  };

  const commitDurationDraft = (field, fallbackValue) => {
    const rawValue = durationDrafts[field] ?? String(fallbackValue ?? '');
    const nextValue = clampMediaAnimationDuration(rawValue, fallbackValue);

    setDurationDrafts((prev) => ({
      ...prev,
      [field]: String(nextValue),
    }));
    applyMediaAnimationPatch({ [field]: nextValue });
  };

  const renderBadge = (type) => {
    const isThisUploading = uploadingType === type;

    if (isThisUploading) {
      return (
        <span className="upload-loading-badge">
          <Loader2 size={12} className="spin-icon" /> Enviando...
        </span>
      );
    }

    if (uploaded[type]) {
      return <span className="upload-check">✓</span>;
    }

    if (type === 'video') {
      return <span className="upload-optional">opcional</span>;
    }

    return <span className="upload-required">obrigatório</span>;
  };

  const getUploadButtonClassName = (type, isManualAction = false) => {
    const isBusyByOtherUpload = isUploading && uploadingType !== type;

    return `upload-btn${uploaded[type] ? ' uploaded' : ''}${uploadingType === type ? ' uploading' : ''}${isBusyByOtherUpload ? ' upload-disabled' : ''}${isManualAction ? ' upload-manual' : ''}`;
  };

  const getUploadBlockedTitle = (type) => (
    isUploading && uploadingType !== type
      ? 'Aguarde o envio atual terminar.'
      : undefined
  );

  const currentUploadLabel = FILE_LABELS[uploadingType] || 'arquivo';

  const renderAnimationControl = (title, transitionField, durationField, options = {}) => {
    const safeDuration = normalizedMediaAnimation[durationField];
    const draftValue = durationDrafts[durationField] ?? String(safeDuration);

    return (
      <div className="files-animation-card">
        <div className="files-animation-card__head">
          <span className="files-animation-card__title">{title}</span>
          <span className="files-animation-card__badge">{safeDuration.toFixed(1)}s</span>
        </div>

        <div className="files-animation-grid">
          <div className="files-animation-field">
            <span className="files-animation-label">Efeito</span>
            <select
              className="files-animation-select"
              value={normalizedMediaAnimation[transitionField]}
              onChange={(event) => applyMediaAnimationPatch({ [transitionField]: event.target.value })}
            >
              {MEDIA_TRANSITION_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>{option.label}</option>
              ))}
            </select>
          </div>

          <div className="files-animation-field files-animation-field--duration">
            <span className="files-animation-label">Duração</span>
            <div className="files-animation-duration-wrap">
              <input
                className="files-animation-input"
                type="text"
                inputMode="decimal"
                enterKeyHint="done"
                value={draftValue}
                onChange={(event) => handleDurationDraftChange(durationField, event.target.value)}
                onBlur={() => commitDurationDraft(durationField, safeDuration)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') {
                    event.preventDefault();
                    commitDurationDraft(durationField, safeDuration);
                  }
                }}
                aria-label={`Duração de ${title.toLowerCase()}`}
              />
              <span className="files-animation-unit">s</span>
            </div>
          </div>
        </div>

        <div className="files-animation-slider-row">
          <span className="files-animation-slider-edge">rápido</span>
          <input
            className="files-animation-slider"
            type="range"
            min={MEDIA_ANIMATION_DURATION_MIN}
            max={MEDIA_ANIMATION_DURATION_MAX}
            step="0.1"
            value={safeDuration}
            onChange={(event) => {
              const nextValue = clampMediaAnimationDuration(event.target.value, safeDuration);
              setDurationDrafts((prev) => ({
                ...prev,
                [durationField]: String(nextValue),
              }));
              applyMediaAnimationPatch({ [durationField]: nextValue });
            }}
          />
          <span className="files-animation-slider-edge">suave</span>
        </div>

        {options.helper ? <p className="files-animation-helper">{options.helper}</p> : null}
      </div>
    );
  };

  const animationPanel = showAnimationsPanel && typeof document !== 'undefined'
    ? createPortal(
      <div
        className="files-animation-viewport"
        role="presentation"
        onMouseDown={(event) => {
          if (event.target === event.currentTarget) {
            setShowAnimationsPanel(false);
          }
        }}
      >
        <div
          ref={animationDialogRef}
          className="files-animation-popover files-animation-popover--floating"
          role="dialog"
          aria-modal="true"
          aria-label="Painel de comportamento"
          onMouseDown={(event) => event.stopPropagation()}
        >
          <div className="files-animation-popover__header">
            <div>
              <span className="files-animation-popover__eyebrow">Comportamento</span>
              <strong>Exibição de Comportamento</strong>
              <p>Ajuste entrada, saída e loop sem corte visual</p>
            </div>

            <button
              type="button"
              className="files-animation-close"
              onClick={() => setShowAnimationsPanel(false)}
              title="Fechar painel de comportamento"
            >
              <X size={15} />
            </button>
          </div>

          <div className={`files-animation-popover__body${shouldShowLoopTransition ? ' files-animation-popover__body--three' : ''}`}>
            {renderAnimationControl('Introdução', 'introTransition', 'introDuration')}
            {renderAnimationControl('Final', 'outroTransition', 'outroDuration')}
            {shouldShowLoopTransition
              ? renderAnimationControl('Loop do vídeo', 'loopTransition', 'loopTransitionDuration', {
                helper: 'ajuste para suavizar repetição de video.',
              })
              : null}
          </div>
        </div>
      </div>,
      document.body
    )
    : null;

  return (
    <div className="files-panel" ref={panelRef}>
      <div className="files-panel-header">
        <h2>Arquivos</h2>
      </div>

      {isUploading ? (
        <div className="upload-feedback-stack" aria-live="polite" aria-atomic="true">
          <div className="upload-progress-bar" role="status">
            <div className="upload-progress-fill" />
            <span>Enviando {currentUploadLabel}…</span>
          </div>
        </div>
      ) : null}

      <div className="upload-section">
        <label className={getUploadButtonClassName('musicaOriginal')} title={getUploadBlockedTitle('musicaOriginal')}>
          <Upload size={15} />
          <div className="upload-btn-copy">
            <span>Música Original</span>
            <small>Música de no máximo 15 min</small>
          </div>
          {renderBadge('musicaOriginal')}
          <input
            type="file"
            accept={AUDIO_ACCEPT}
            onChange={(e) => handleFileUpload(e, 'musicaOriginal')}
            disabled={anyBusy}
          />
        </label>

        <label className={getUploadButtonClassName('musicaInstrumental')} title={getUploadBlockedTitle('musicaInstrumental')}>
          <Upload size={15} />
          <div className="upload-btn-copy">
            <span>Música Instrumental</span>
            <small>Música de no máximo 15 min</small>
          </div>
          {renderBadge('musicaInstrumental')}
          <input
            type="file"
            accept={AUDIO_ACCEPT}
            onChange={(e) => handleFileUpload(e, 'musicaInstrumental')}
            disabled={anyBusy}
          />
        </label>

        <div className="upload-divider">opcional (vídeo/foto de fundo)</div>

        <label className={getUploadButtonClassName('video')} title={getUploadBlockedTitle('video')}>
          <Upload size={15} />
          <div className="upload-btn-copy">
            <span>Vídeo / Foto (fundo)</span>
          </div>
          {renderBadge('video')}
          <input
            type="file"
            accept={BACKGROUND_ACCEPT}
            onChange={(e) => handleFileUpload(e, 'video')}
            disabled={anyBusy}
          />
        </label>

        <div className="upload-divider">letra</div>

        <label className={getUploadButtonClassName('letraArquivo')} title={getUploadBlockedTitle('letraArquivo')}>
          <Upload size={15} />
          <span>Letra (arquivo)</span>
          {renderBadge('letraArquivo')}
          <input
            type="file"
            accept={LYRICS_ACCEPT}
            onChange={handleLyricsUpload}
            disabled={anyBusy}
          />
        </label>

        <button
          type="button"
          className={getUploadButtonClassName('letraManual', true)}
          onClick={() => setShowLyricsModal(true)}
          disabled={anyBusy}
          title={getUploadBlockedTitle('letraManual')}
        >
          <Type size={15} />
          <span>Colar Letra</span>
          {renderBadge('letraManual')}
        </button>
      </div>

      {/* ── Criar Instrumental com IA ──────────────────────────────────── */}
      <div className="auto-sync-section">
        <div className="auto-sync-wrapper">
          <button
            type="button"
            className={`auto-sync-btn ${canCreateInstrumental ? 'unlocked' : 'locked'}`}
            onClick={handleCreateInstrumental}
            disabled={!canCreateInstrumental || anyBusy}
            title={
              !mediaFiles?.musicaOriginal
                ? 'Faça o upload da música original primeiro'
                : 'Remover vocais da música original e gerar instrumental com IA'
            }
          >
            {isCreatingInstrumental ? (
              <span className="auto-sync-btn-content">
                <span className="auto-sync-btn-main">
                  <Loader2 size={15} className="spin-icon" />
                  <span>Criando Instrumental…</span>
                </span>
                <span className="auto-sync-btn-note">Isso pode levar alguns minutos</span>
              </span>
            ) : (
              <span className="auto-sync-btn-content">
                <span className="auto-sync-btn-main">
                  <Music2 size={15} />
                  <span>Criar Instrumental com IA</span>
                </span>
                <span className="auto-sync-btn-note">Isso pode levar alguns minutos</span>
              </span>
            )}
          </button>
        </div>

   <p className="auto-sync-hint">
  {isCreatingInstrumental
    ? 'Separando voz e instrumental com IA... isso pode levar alguns minutos.'
    : !mediaFiles?.musicaOriginal
      ? 'Faça upload da música original para habilitar.'
      : 'Gera a versão sem voz com IA.'}
</p>
      </div>

      {/* ── Sincronizar automaticamente (Lyrics Aligner) ─────────────── */}
      <div className="auto-sync-section">
        <div className="auto-sync-wrapper">
          <button
            type="button"
            className={`auto-sync-btn ${canAutoSyncLyrics ? 'unlocked' : 'locked'}`}
            onClick={handleAutoSyncLyrics}
            disabled={!canAutoSyncLyrics}
            title={
              !mediaFiles?.musicaOriginal
                ? 'Faça o upload da música original primeiro'
                : stanzaCount === 0
                  ? 'Adicione a letra primeiro'
                  : 'Descobrir o tempo de cada bloco a partir da música e da letra'
            }
          >
            {isSyncingLyrics ? (
              <span className="auto-sync-btn-content">
                <span className="auto-sync-btn-main">
                  <Loader2 size={15} className="spin-icon" />
                  <span>Sincronizando…</span>
                </span>
                <span className="auto-sync-btn-note">Alinhando as palavras com a música</span>
              </span>
            ) : (
              <span className="auto-sync-btn-content">
                <span className="auto-sync-btn-main">
                  <Sparkles size={15} />
                  <span>Sincronizar automaticamente</span>
                </span>
                <span className="auto-sync-btn-note">IA descobre o tempo de cada palavra cantada</span>
              </span>
            )}
          </button>
        </div>

        <p className="auto-sync-hint">
          {isSyncingLyrics
            ? '🎵 Estamos ouvindo a música para sincronizar sua letra automaticamente... isso pode levar alguns minutos.'
            : !mediaFiles?.musicaOriginal
              ? 'Faça upload da música original para habilitar.'
              : stanzaCount === 0
                ? 'Adicione a letra para habilitar.'
                : 'Depois da sincronização você ainda pode ajustar os tempos manualmente.'}
        </p>
      </div>

      {hasBackgroundMedia ? (
        <div className={`files-animation-wrapper${showAnimationsPanel ? ' is-open' : ''}`}>
          <button
            type="button"
            className={`files-animation-trigger${showAnimationsPanel ? ' open' : ''}`}
            onClick={() => setShowAnimationsPanel((prev) => !prev)}
          >
            <Sparkles size={15} />
            <span>Comportamento</span>
          </button>
        </div>
      ) : null}

      {animationPanel}

      {syncStatus && syncStatus.type !== 'info' ? (
        <div className={`sync-status sync-status--${syncStatus.type} files-panel-status`}>
          {syncStatus.message}
        </div>
      ) : null}

      {showLyricsModal && (
        <div className="lyrics-modal-overlay" onMouseDown={() => !anyBusy && setShowLyricsModal(false)}>
          <div className="lyrics-modal" onMouseDown={(e) => e.stopPropagation()}>
            <div className="lyrics-modal-header">
              <h3>Colar letra</h3>
              <button
                type="button"
                className="lyrics-modal-close"
                onClick={() => !anyBusy && setShowLyricsModal(false)}
                title="Fechar"
              >
                <X size={16} />
              </button>
            </div>

            <textarea
              value={lyricsText}
              onChange={(e) => setLyricsText(e.target.value)}
              placeholder={'Cole a letra aqui...\n\nDica: use linhas em branco para separar estrofes.'}
              rows={10}
              disabled={anyBusy}
            />

            <div className="lyrics-modal-actions">
              <button
                type="button"
                className="lyrics-modal-primary"
                onClick={handleManualLyrics}
                disabled={anyBusy || !lyricsText.trim()}
              >
                {uploadingType === 'letraManual' ? (
                  <>
                    <Loader2 size={14} className="spin-icon" /> Processando...
                  </>
                ) : (
                  'Processar letra'
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default FilesPanel;
