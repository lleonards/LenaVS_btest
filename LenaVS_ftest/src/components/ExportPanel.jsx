import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ChevronDown, Download, Loader, Lock } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import api from '../services/api';
import { useAuth } from '../contexts/AuthContext';
import { startUpgradeCheckout } from '../utils/checkout';
import ConfirmDialog from './ConfirmDialog';
import './ExportPanel.css';

const wait = (ms) => new Promise((resolve) => window.setTimeout(resolve, ms));

const RESOLUTION_OPTIONS = [
  { value: '360p', label: '360p (SD)', disabled: false },
  { value: '480p', label: '480p (SD+)', disabled: false },
  { value: '720p', label: '720p (HD)', disabled: false },
  { value: '1080p', label: '1080p (Full HD)', disabled: true, tooltip: 'Disponível em breve' },
];

const RENDERING_FEEDBACK_MESSAGES = ['Criando vídeo...', 'Quase lá...'];
const FEEDBACK_SWAP_INTERVAL_MS = 17000;

const getFileNameFromDisposition = (contentDisposition, fallbackName) => {
  const rawHeader = String(contentDisposition || '');
  const utf8Match = rawHeader.match(/filename\*=UTF-8''([^;]+)/i);

  if (utf8Match?.[1]) {
    return decodeURIComponent(utf8Match[1]);
  }

  const asciiMatch = rawHeader.match(/filename="?([^";]+)"?/i);
  if (asciiMatch?.[1]) {
    return asciiMatch[1];
  }

  return fallbackName;
};

const triggerBrowserDownload = (blob, fileName) => {
  const objectUrl = window.URL.createObjectURL(blob);
  const link = document.createElement('a');

  link.href = objectUrl;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  link.remove();

  window.setTimeout(() => {
    window.URL.revokeObjectURL(objectUrl);
  }, 1000);
};

const resolveMediaSourceForExport = (mediaFiles = {}, mediaMetadata = {}, fieldName) => {
  const metadataEntry = mediaMetadata?.[fieldName] || {};

  return (
    metadataEntry.storagePath
    || metadataEntry.publicUrl
    || mediaFiles?.[fieldName]
    || null
  );
};

const ExportPanel = ({
  stanzas,
  mediaFiles,
  mediaMetadata,
  mediaAnimation,
  backgroundColor,
  audioType,
  initialResolution = '720p',
  initialVideoFormat = 'mp4',
  projectName,
  onProjectNameChange,
  currentProjectId,
  onProjectSaved,
  onCreateNewProject,
  onNotify,
}) => {
  const [exportAudioType, setExportAudioType] = useState(audioType || 'original');
  const [videoFormat, setVideoFormat] = useState(initialVideoFormat);
  const [resolution, setResolution] = useState(initialResolution);
  const [loading, setLoading] = useState(false);
  const [loadingLabel, setLoadingLabel] = useState(RENDERING_FEEDBACK_MESSAGES[0]);
  const [loadingStage, setLoadingStage] = useState('idle');
  const [isResolutionMenuOpen, setIsResolutionMenuOpen] = useState(false);
  const [resolutionTooltip, setResolutionTooltip] = useState('');
  const [menuPosition, setMenuPosition] = useState({ top: 0, left: 0, width: 0, openUp: false });
  const [showNewProjectDialog, setShowNewProjectDialog] = useState(false);

  const resolutionMenuRef = useRef(null);
  const resolutionTriggerRef = useRef(null);
  const navigate = useNavigate();
  const { credits, hasUnlimitedAccess, subscriptionStatus, refreshCredits } = useAuth();

  useEffect(() => {
    setExportAudioType(audioType || 'original');
  }, [audioType]);

  useEffect(() => {
    const handleOutsideClick = (event) => {
      const menuEl = resolutionMenuRef.current;
      const triggerEl = resolutionTriggerRef.current;
      if (
        menuEl && !menuEl.contains(event.target) &&
        triggerEl && !triggerEl.contains(event.target)
      ) {
        setIsResolutionMenuOpen(false);
        setResolutionTooltip('');
      }
    };

    const handleScrollOrResize = () => {
      setIsResolutionMenuOpen(false);
      setResolutionTooltip('');
    };

    document.addEventListener('mousedown', handleOutsideClick);
    window.addEventListener('scroll', handleScrollOrResize, true);
    window.addEventListener('resize', handleScrollOrResize);
    return () => {
      document.removeEventListener('mousedown', handleOutsideClick);
      window.removeEventListener('scroll', handleScrollOrResize, true);
      window.removeEventListener('resize', handleScrollOrResize);
    };
  }, []);

  useEffect(() => {
    if (!loading) {
      return undefined;
    }

    if (loadingStage === 'downloading') {
      setLoadingLabel('Baixando vídeo');
      return undefined;
    }

    if (loadingStage !== 'rendering') {
      return undefined;
    }

    let currentMessageIndex = 0;
    setLoadingLabel(RENDERING_FEEDBACK_MESSAGES[currentMessageIndex]);

    const intervalId = window.setInterval(() => {
      currentMessageIndex = (currentMessageIndex + 1) % RENDERING_FEEDBACK_MESSAGES.length;
      setLoadingLabel(RENDERING_FEEDBACK_MESSAGES[currentMessageIndex]);
    }, FEEDBACK_SWAP_INTERVAL_MS);

    return () => window.clearInterval(intervalId);
  }, [loading, loadingStage]);

  const selectedResolution = useMemo(
    () => RESOLUTION_OPTIONS.find((option) => option.value === resolution) || RESOLUTION_OPTIONS[2],
    [resolution]
  );

  const effectiveAudioType = useMemo(() => {
    if (exportAudioType === 'instrumental' && !mediaFiles?.musicaInstrumental) {
      return 'original';
    }

    return exportAudioType;
  }, [exportAudioType, mediaFiles]);

  const openCheckout = async () => {
    await startUpgradeCheckout({
      onError: (message) => {
        onNotify?.({
          type: 'error',
          title: 'Erro no checkout',
          message,
        });
      },
    });
  };

  const saveProjectBeforeExport = async () => {
    // Projetos são sempre salvos como privados.
    // A publicação é uma ação manual do usuário via painel de projetos.
    const payload = {
      name: projectName.trim(),
      resolution,
      config: {
        stanzas,
        mediaFiles,
        mediaMetadata,
        mediaAnimation,
        backgroundColor,
        audioType: effectiveAudioType,
        lockedAudioType: null,
        videoFormat,
      },
    };

    const response = currentProjectId
      ? await api.put(`/projects/${currentProjectId}`, payload)
      : await api.post('/projects', payload);

    const savedProject = response.data?.project;
    if (savedProject && onProjectSaved) {
      onProjectSaved(savedProject);
    }

    return savedProject;
  };

  const waitForGeneration = async (response) => {
    if (response.data?.status === 'completed' && response.data?.videoUrl) {
      return response.data;
    }

    const taskId = response.data?.taskId;
    if (!taskId) {
      throw new Error('O backend não retornou o processamento do vídeo.');
    }

    let attempts = 0;
    const maxAttempts = 720;

    while (attempts < maxAttempts) {
      attempts += 1;
      await wait(1500);

      const statusResponse = await api.get(`/video/status/${taskId}`);
      const data = statusResponse.data || {};

      if (data.status === 'completed' && data.videoUrl) {
        return data;
      }

      if (data.status === 'error') {
        throw new Error(data.error || data.message || 'Erro ao gerar vídeo');
      }

    }

    throw new Error('Tempo limite excedido ao gerar o vídeo.');
  };

  const downloadGeneratedVideo = async (videoUrl, fallbackFileName, exactProjectName) => {
    let lastError = null;

    for (let attempt = 1; attempt <= 3; attempt += 1) {
      try {
        setLoadingStage('downloading');
        setLoadingLabel('Baixando vídeo');

        const downloadResponse = await api.get(videoUrl, {
          responseType: 'blob',
        });

        const fileNameFromHeader = getFileNameFromDisposition(
          downloadResponse.headers['content-disposition'],
          fallbackFileName
        );
        const finalFileName = fileNameFromHeader || `${exactProjectName}.${videoFormat}`;

        triggerBrowserDownload(downloadResponse.data, finalFileName);
        return;
      } catch (error) {
        lastError = error;

        if (error.response?.status !== 404 || attempt === 3) {
          throw error;
        }

        await wait(1200);
      }
    }

    throw lastError || new Error('Não foi possível baixar o vídeo gerado.');
  };

  const handleExport = async () => {
    if (loading) return;

    if (!projectName.trim()) {
      onNotify?.({
        type: 'warning',
        title: 'Nome do projeto',
        message: 'Preencha o nome do projeto antes de exportar.',
      });
      return;
    }

    if (!mediaFiles.musicaOriginal && !mediaFiles.musicaInstrumental) {
      onNotify?.({
        type: 'warning',
        title: 'Áudio necessário',
        message: 'Faça upload do áudio antes de exportar.',
      });
      return;
    }

    if (!hasUnlimitedAccess && Number(credits) <= 0) {
      const isExpired = subscriptionStatus === 'canceled' || subscriptionStatus === 'past_due';
      onNotify?.({
        type: 'warning',
        title: isExpired ? 'Prazo de pagamento expirado' : 'Créditos esgotados',
        message: isExpired
          ? 'O prazo do seu plano expirou. Efetue o pagamento para continuar usando a plataforma.'
          : 'Você está sem créditos. Obtenha o plano ilimitado para continuar exportando.',
      });
      await openCheckout();
      return;
    }

    try {
      setLoading(true);
      setLoadingStage('rendering');
      setLoadingLabel(RENDERING_FEEDBACK_MESSAGES[0]);

      await saveProjectBeforeExport();

      const backgroundVideoSource = resolveMediaSourceForExport(mediaFiles, mediaMetadata, 'video');
      const backgroundImageSource = resolveMediaSourceForExport(mediaFiles, mediaMetadata, 'imagem');
      const audioSource = effectiveAudioType === 'original'
        ? resolveMediaSourceForExport(mediaFiles, mediaMetadata, 'musicaOriginal')
        : resolveMediaSourceForExport(mediaFiles, mediaMetadata, 'musicaInstrumental');

      const response = await api.post('/video/generate', {
        projectName,
        audioType: effectiveAudioType,
        audioPath: audioSource,
        backgroundType: backgroundVideoSource
          ? 'video'
          : backgroundImageSource
          ? 'image'
          : 'color',
        backgroundPath: backgroundVideoSource || backgroundImageSource,
        backgroundColor,
        mediaAnimation,
        stanzas,
        videoFormat,
        resolution,
      });

      const generationResult = await waitForGeneration(response);
      const videoUrl = generationResult.videoUrl;
      const exactProjectName = projectName.trim();
      const fallbackFileName = generationResult.downloadFileName || `${exactProjectName}.${videoFormat}`;

      if (!videoUrl) {
        throw new Error('O backend não retornou o link do vídeo gerado.');
      }

      await downloadGeneratedVideo(videoUrl, fallbackFileName, exactProjectName);

      if (refreshCredits) {
        await refreshCredits();
      }

      if (!hasUnlimitedAccess) {
        onNotify?.({
          type: 'success',
          title: 'Crédito usado',
          message: '1 crédito foi consumido neste vídeo.',
          persistent: true,
        });
      }
    } catch (error) {
      if (error.response?.status === 403 && error.response?.data?.code === 'NO_CREDITS') {
        onNotify?.({
          type: 'warning',
          title: 'Créditos esgotados',
          message: 'Sem créditos. Obtenha o plano ilimitado para continuar.',
        });
        await openCheckout();
        return;
      }

      console.error(error);
      onNotify?.({
        type: 'error',
        title: 'Falha na exportação',
        message: error.response?.data?.error || error.message || 'Erro ao exportar vídeo',
      });
    } finally {
      setLoading(false);
      setLoadingStage('idle');
      setLoadingLabel(RENDERING_FEEDBACK_MESSAGES[0]);
    }
  };

  // Abre o modal de confirmação antes de descartar o projeto atual
  const handleCreateNewProject = () => {
    setShowNewProjectDialog(true);
  };

  const handleConfirmNewProject = () => {
    setShowNewProjectDialog(false);
    onCreateNewProject?.();
  };

  const handleCancelNewProject = () => {
    setShowNewProjectDialog(false);
  };

  const renderLoadingLabel = () => {
    if (loadingStage === 'downloading') {
      return (
        <span className="export-btn__loading-text export-btn__loading-text--wave" aria-live="polite">
          {Array.from(loadingLabel).map((character, index) => (
            <span
              key={`${character}-${index}`}
              className="export-btn__loading-char"
              style={{ animationDelay: `${index * 0.08}s` }}
            >
              {character === ' ' ? '\u00A0' : character}
            </span>
          ))}
        </span>
      );
    }

    return (
      <span className="export-btn__loading-text export-btn__loading-text--pulse" aria-live="polite">
        {loadingLabel}
      </span>
    );
  };

  return (
    <>
      <div className="export-panel">
        <h2>Exportar Vídeo</h2>

        <div className="export-form">
          <div className="export-config-row">
            <div className="form-group form-group--name">
              <label>Nome do Projeto</label>
              <input
                type="text"
                value={projectName}
                onChange={(event) => onProjectNameChange(event.target.value)}
                placeholder="Digite o nome do projeto"
                required
              />
            </div>

            <div className="form-group form-group--resolution">
              <label>Resolução</label>
              <div className="resolution-select">
                <button
                  type="button"
                  ref={resolutionTriggerRef}
                  className={`resolution-select__trigger${isResolutionMenuOpen ? ' open' : ''}`}
                  onClick={() => {
                    if (!isResolutionMenuOpen && resolutionTriggerRef.current) {
                      const rect = resolutionTriggerRef.current.getBoundingClientRect();
                      const spaceBelow = window.innerHeight - rect.bottom;
                      // Estimar altura do menu: 4 opções * 36px + padding ≈ 175px
                      const menuEstimatedHeight = 175;
                      const openUp = spaceBelow < menuEstimatedHeight;
                      setMenuPosition({
                        top: openUp ? rect.top : rect.bottom + 6,
                        left: rect.left,
                        width: rect.width,
                        openUp,
                      });
                    }
                    setIsResolutionMenuOpen((prev) => !prev);
                  }}
                >
                  <span>{selectedResolution.label}</span>
                  <ChevronDown size={14} className={`resolution-select__chevron${isResolutionMenuOpen ? ' open' : ''}`} />
                </button>

                {isResolutionMenuOpen && typeof document !== 'undefined'
                  ? createPortal(
                    <div
                      ref={resolutionMenuRef}
                      className={`resolution-select__menu${menuPosition.openUp ? ' resolution-select__menu--up' : ''}`}
                      style={{
                        position: 'fixed',
                        top: menuPosition.openUp ? undefined : menuPosition.top,
                        bottom: menuPosition.openUp ? window.innerHeight - menuPosition.top : undefined,
                        left: menuPosition.left,
                        width: menuPosition.width,
                        zIndex: 9999,
                      }}
                    >
                      {RESOLUTION_OPTIONS.map((option) => {
                        const isSelected = option.value === resolution;

                        return (
                          <div
                            key={option.value}
                            className="resolution-select__option-wrap"
                            onMouseEnter={() => setResolutionTooltip(option.disabled ? option.tooltip || '' : '')}
                            onMouseLeave={() => setResolutionTooltip('')}
                          >
                            <button
                              type="button"
                              className={`resolution-select__option${isSelected ? ' selected' : ''}${option.disabled ? ' disabled' : ''}`}
                              onClick={() => {
                                if (option.disabled) return;
                                setResolution(option.value);
                                setIsResolutionMenuOpen(false);
                                setResolutionTooltip('');
                              }}
                              disabled={option.disabled}
                            >
                              <span>{option.label}</span>
                              {option.disabled ? <Lock size={12} /> : null}
                            </button>
                          </div>
                        );
                      })}

                      {resolutionTooltip ? <div className="resolution-select__tooltip">{resolutionTooltip}</div> : null}
                    </div>,
                    document.body
                  )
                  : null}
              </div>
            </div>

            <div className="form-group form-group--format">
              <label>Formato de vídeo</label>
              <select value={videoFormat} onChange={(event) => setVideoFormat(event.target.value)}>
                <option value="mp4">MP4</option>
                <option value="avi">AVI</option>
                <option value="mov">MOV</option>
                <option value="mkv">MKV</option>
              </select>
            </div>

            <div className="form-group form-group--audio">
              <label>Áudio final</label>
              <div className="audio-type-selector">
                <button
                  type="button"
                  className={effectiveAudioType === 'original' ? 'active' : ''}
                  onClick={() => setExportAudioType('original')}
                  disabled={!mediaFiles.musicaOriginal}
                >
                  Original
                </button>
                <button
                  type="button"
                  className={effectiveAudioType === 'instrumental' ? 'active' : ''}
                  onClick={() => setExportAudioType('instrumental')}
                  disabled={!mediaFiles.musicaInstrumental}
                >
                  Playback
                </button>
              </div>
            </div>
          </div>

          <div className="form-group form-group--btn">
            <div className="export-actions">
              <button className="export-btn" onClick={handleExport} disabled={loading || !projectName.trim()} title={!projectName.trim() ? 'Preencha o nome do projeto para liberar a exportação.' : undefined}>
                {loading ? (
                  <>
                    <Loader size={16} className="spinner" />
                    {renderLoadingLabel()}
                  </>
                ) : (
                  <>
                    <Download size={16} />
                    Exportar vídeo
                  </>
                )}
              </button>

              <button
                type="button"
                className="new-project-btn"
                onClick={handleCreateNewProject}
                disabled={loading}
              >
                Novo projeto
              </button>
            </div>
          </div>
        </div>
      </div>

      <ConfirmDialog
        isOpen={showNewProjectDialog}
        title="Criar novo projeto?"
        message="O projeto atual será descartado do editor. Certifique-se de ter exportado ou salvo o que precisava antes de continuar."
        confirmLabel="Criar novo projeto"
        cancelLabel="Cancelar"
        onConfirm={handleConfirmNewProject}
        onCancel={handleCancelNewProject}
      />
    </>
  );
};

export default ExportPanel;
