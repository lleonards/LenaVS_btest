import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { useNavigate } from 'react-router-dom';
import Header from '../components/Header';
import FilesPanel from '../components/FilesPanel';
import PreviewPanel from '../components/PreviewPanel';
import LyricsEditorPanel from '../components/LyricsEditorPanel';
import MobileFloatingPreviewControls from '../components/MobileFloatingPreviewControls';
import { isTextEntryElement } from '../components/TimecodeInput';
import ExportPanel from '../components/ExportPanel';
import ProjectsPanel from '../components/ProjectsPanel';
import NoticeCenter from '../components/NoticeCenter';
import ConfirmDialog from '../components/ConfirmDialog';
import { formatFixedTimecode, parseFixedTimecode } from '../utils/timecode';
import { getActiveStanzaAtTime, hasDefinedEndTime, hasDefinedStartTime, normalizeStanzas } from '../utils/stanza';
import { DEFAULT_MEDIA_ANIMATION, normalizeMediaAnimation } from '../utils/mediaAnimation';
import api from '../services/api';
import './Editor.css';

const EMPTY_MEDIA_FILES = {
  musicaOriginal: null,
  musicaInstrumental: null,
  video: null,
  imagem: null,
};

const EMPTY_MEDIA_METADATA = {
  musicaOriginal: null,
  musicaInstrumental: null,
  video: null,
  imagem: null,
};

const DESKTOP_RESIZE_BREAKPOINT = 1240;
const TABLET_LAYOUT_BREAKPOINT = 900;
const DEFAULT_DESKTOP_RATIOS = {
  files: 0.24,
  preview: 0.38,
};

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

const getDesktopConstraints = (totalWidth) => {
  const safeWidth = Math.max(totalWidth, DESKTOP_RESIZE_BREAKPOINT);

  return {
    filesMin: clamp(Math.round(safeWidth * 0.2), 280, 360),
    filesMax: clamp(Math.round(safeWidth * 0.32), 360, 500),
    previewMin: clamp(Math.round(safeWidth * 0.32), 480, 600),
    lyricsMin: clamp(Math.round(safeWidth * 0.24), 320, 480),
  };
};

const normalizeDesktopRatios = (totalWidth, incomingRatios = DEFAULT_DESKTOP_RATIOS) => {
  if (!totalWidth) {
    return {
      files: DEFAULT_DESKTOP_RATIOS.files,
      preview: DEFAULT_DESKTOP_RATIOS.preview,
      lyrics: 1 - DEFAULT_DESKTOP_RATIOS.files - DEFAULT_DESKTOP_RATIOS.preview,
    };
  }

  const constraints = getDesktopConstraints(totalWidth);
  const filesMinRatio = constraints.filesMin / totalWidth;
  const filesMaxRatio = constraints.filesMax / totalWidth;
  const previewMinRatio = constraints.previewMin / totalWidth;
  const lyricsMinRatio = constraints.lyricsMin / totalWidth;

  let files = Number.isFinite(incomingRatios?.files) ? incomingRatios.files : DEFAULT_DESKTOP_RATIOS.files;
  let preview = Number.isFinite(incomingRatios?.preview) ? incomingRatios.preview : DEFAULT_DESKTOP_RATIOS.preview;

  files = clamp(files, filesMinRatio, filesMaxRatio);
  preview = Math.max(preview, previewMinRatio);

  let lyrics = 1 - files - preview;

  if (lyrics < lyricsMinRatio) {
    const deficit = lyricsMinRatio - lyrics;
    const previewCanShrink = Math.max(0, preview - previewMinRatio);
    const previewShrink = Math.min(previewCanShrink, deficit);

    preview -= previewShrink;

    const remaining = deficit - previewShrink;
    if (remaining > 0) {
      files = Math.max(filesMinRatio, files - remaining);
    }

    lyrics = 1 - files - preview;
  }

  const previewMaxRatio = Math.max(previewMinRatio, 1 - files - lyricsMinRatio);
  preview = clamp(preview, previewMinRatio, previewMaxRatio);
  lyrics = Math.max(lyricsMinRatio, 1 - files - preview);

  if (files + preview + lyrics !== 1) {
    preview = 1 - files - lyrics;
  }

  return {
    files,
    preview,
    lyrics: 1 - files - preview,
  };
};

const Editor = () => {
  const { user, loading } = useAuth();
  const navigate = useNavigate();

  const [stanzas, setStanzas] = useState([]);
  const [selectedStanzaId, setSelectedStanzaId] = useState(null);
  const [seekRequest, setSeekRequest] = useState(null);
  const [showLyricsEditor, setShowLyricsEditor] = useState(false);
  const [mediaFiles, setMediaFiles] = useState(EMPTY_MEDIA_FILES);
  const [mediaMetadata, setMediaMetadata] = useState(EMPTY_MEDIA_METADATA);
  const [mediaAnimation, setMediaAnimation] = useState(DEFAULT_MEDIA_ANIMATION);
  const [projectName, setProjectName] = useState('');
  const [currentProjectId, setCurrentProjectId] = useState(null);
  const [projectExportDefaults, setProjectExportDefaults] = useState({
    resolution: '720p',
    videoFormat: 'mp4',
  });
  const [currentTime, setCurrentTime] = useState(0);
  const [audioType, setAudioType] = useState('original');
  const [backgroundColor, setBackgroundColor] = useState('#000000');
  const [previewMetrics, setPreviewMetrics] = useState({ width: 1280, height: 720 });
  const [syncStatus, setSyncStatus] = useState(null);
  const [isSyncingLyrics, setIsSyncingLyrics] = useState(false);
  const [notices, setNotices] = useState([]);
  const [showProjectsPanel, setShowProjectsPanel] = useState(false);
  const [confirmDialog, setConfirmDialog] = useState({ isOpen: false, project: null });
  const [projectsTab, setProjectsTab] = useState('history');
  const [selectedStanzaFocusSignal, setSelectedStanzaFocusSignal] = useState(0);
  const [resetVersion, setResetVersion] = useState(0);
  const [myProjects, setMyProjects] = useState([]);
  const [libraryProjects, setLibraryProjects] = useState([]);
  const [loadingMyProjects, setLoadingMyProjects] = useState(false);
  const [loadingLibrary, setLoadingLibrary] = useState(false);
  const [librarySearch, setLibrarySearch] = useState('');
  const [loadingProjectState, setLoadingProjectState] = useState({
    projectId: null,
    action: null,
    message: '',
  });
  const [workspaceWidth, setWorkspaceWidth] = useState(0);
  const [layoutMode, setLayoutMode] = useState('desktop');
  const [panelRatios, setPanelRatios] = useState(DEFAULT_DESKTOP_RATIOS);
  const [exportBelow, setExportBelow] = useState(false);
  const [isResizingPanels, setIsResizingPanels] = useState(false);
  const [isPreviewPlaying, setIsPreviewPlaying] = useState(false);
  const [isLyricsEditorVisibleOnMobile, setIsLyricsEditorVisibleOnMobile] = useState(false);

  // Publish modal
  const [showPublishModal, setShowPublishModal] = useState(false);
  const [publishModalProject, setPublishModalProject] = useState(null);
  const [publishModalName, setPublishModalName] = useState('');
  const [publishModalError, setPublishModalError] = useState('');
  const [publishingProject, setPublishingProject] = useState(false);
  // Incentive modal
  const [showIncentiveModal, setShowIncentiveModal] = useState(false);
  const [incentiveProject, setIncentiveProject] = useState(null);

  const currentTimeRef = useRef(0);
  const editorMainRef = useRef(null);
  const previewPanelRef = useRef(null);
  const previewWrapperRef = useRef(null);
  const editorRightRef = useRef(null);
  const exportWrapperRef = useRef(null);
  const dragStateRef = useRef(null);
  const resizeRafRef = useRef(null);
  const lastShortcutZoneRef = useRef(null);
  const noticeTimersRef = useRef(new Map());

  useEffect(() => {
    if (!loading && !user) {
      navigate('/login');
    }
  }, [user, loading, navigate]);

  const fetchMyProjects = useCallback(async () => {
    if (!user) return;

    try {
      setLoadingMyProjects(true);
      const response = await api.get('/projects');
      setMyProjects(response.data?.projects || []);
    } catch (error) {
      console.error('Erro ao carregar histórico:', error);
    } finally {
      setLoadingMyProjects(false);
    }
  }, [user]);

  const fetchLibraryProjects = useCallback(async () => {
    if (!user) return;

    try {
      setLoadingLibrary(true);
      const response = await api.get('/projects/library');
      setLibraryProjects(response.data?.projects || []);
    } catch (error) {
      console.error('Erro ao carregar biblioteca:', error);
    } finally {
      setLoadingLibrary(false);
    }
  }, [user]);

  useEffect(() => {
    if (!user) return;
    fetchMyProjects();
    fetchLibraryProjects();
  }, [user, fetchMyProjects, fetchLibraryProjects]);

  const handleTimeUpdate = useCallback((time) => {
    currentTimeRef.current = time;
    setCurrentTime(time);
  }, []);

  const dismissNotice = useCallback((noticeId) => {
    const timerId = noticeTimersRef.current.get(noticeId);
    if (timerId) {
      window.clearTimeout(timerId);
      noticeTimersRef.current.delete(noticeId);
    }

    setNotices((prev) => prev.filter((notice) => notice.id !== noticeId));
  }, []);

  const pushNotice = useCallback(({ type = 'info', title = '', message, persistent = false }) => {
    if (!message) return null;

    const noticeId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const nextNotice = { id: noticeId, type, title, message, persistent };

    setNotices((prev) => [nextNotice, ...prev].slice(0, 4));

    if (!persistent && typeof window !== 'undefined') {
      const timeoutMs = type === 'error' ? 7000 : 5000;
      const timerId = window.setTimeout(() => {
        dismissNotice(noticeId);
      }, timeoutMs);
      noticeTimersRef.current.set(noticeId, timerId);
    }

    return noticeId;
  }, [dismissNotice]);

  useEffect(() => () => {
    noticeTimersRef.current.forEach((timerId) => window.clearTimeout(timerId));
    noticeTimersRef.current.clear();
  }, []);

  // Usuário processou/fez upload de nova letra → edição de conteúdo
  const handleLyricsProcessed = useCallback((processedStanzas) => {
    const normalized = normalizeStanzas(processedStanzas, previewMetrics);
    const firstStanza = normalized[0] ?? null;

    setStanzas(normalized);
    setSelectedStanzaId(firstStanza?.id ?? null);
    setShowLyricsEditor(true);
    currentTimeRef.current = 0;
    setCurrentTime(0);
    setIsPreviewPlaying(false);
    setSeekRequest(firstStanza ? {
      stanzaId: firstStanza.id,
      time: 0,
      nonce: Date.now(),
    } : null);
    setSyncStatus(null);
  }, [previewMetrics]);

  // Usuário pediu sincronização automática da letra (Lyrics Aligner) → o backend
  // apenas DESCOBRE os tempos; a estrutura de blocos digitada pelo usuário
  // é sempre preservada (nenhum bloco é criado/excluído/dividido/juntado).
  const handleAutoSyncLyrics = useCallback(async () => {
    const audioUrl = mediaFiles?.musicaOriginal;

    if (!audioUrl || !stanzas.length || isSyncingLyrics) return;

    const payloadStanzas = stanzas
      .map((stanza) => ({
        id: stanza.id,
        text: String(stanza.text || '').trim(),
      }))
      .filter((stanza) => stanza.text.length > 0);

    if (!payloadStanzas.length) {
      pushNotice({
        type: 'warning',
        title: 'Letra vazia',
        message: 'Adicione a letra antes de sincronizar automaticamente.',
      });
      return;
    }

    setIsSyncingLyrics(true);
    setSyncStatus({
      type: 'info',
      message: '🎵 Estamos ouvindo a música para sincronizar sua letra automaticamente... isso pode levar alguns minutos.',
    });

    try {
      const response = await api.post('/media/sync-lyrics', {
        audioUrl,
        stanzas: payloadStanzas,
      });

      const timed = Array.isArray(response.data?.stanzas) ? response.data.stanzas : [];

      if (!timed.length) {
        throw new Error('O servidor não retornou tempos para nenhum bloco.');
      }

      setStanzas((prev) => prev.map((stanza) => {
        const match = timed.find((item) => item.id === stanza.id);
        if (!match || !match.startTime) return stanza;
        return {
          ...stanza,
          startTime: match.startTime,
          endTime: match.endTime || stanza.endTime,
        };
      }));

      setSyncStatus({
        type: 'success',
        message: '✨ Pronto! Sua letra foi sincronizada automaticamente. Revise os tempos se quiser ajustar algo.',
      });
    } catch (error) {
      console.error('Erro ao sincronizar letra:', error);
      const message = error.response?.data?.error || '🎵 Ops! Não foi possível concluir a sincronização automática agora. Tente novamente ou ajuste os tempos manualmente.';
      setSyncStatus({ type: 'error', message });
      pushNotice({ type: 'error', title: 'Falha na sincronização', message });
    } finally {
      setIsSyncingLyrics(false);
    }
  }, [isSyncingLyrics, mediaFiles, pushNotice, stanzas]);

  // Usuário fez upload de arquivo de mídia → edição de conteúdo
  const handleFilesUploaded = useCallback((files) => {
    setMediaFiles((prev) => ({ ...prev, ...files }));
  }, []);

  // Usuário alterou metadados de mídia (ex.: troca de arquivo) → edição de conteúdo
  const handleMediaMetadataChange = useCallback((metadataPatch) => {
    setMediaMetadata((prev) => ({ ...prev, ...(metadataPatch || {}) }));
  }, []);

  // Usuário editou estrofes no editor de letras → edição de conteúdo
  const handleStanzasChange = useCallback((nextStanzas) => {
    const normalized = normalizeStanzas(nextStanzas, previewMetrics);
    setStanzas(normalized);
    setShowLyricsEditor(normalized.length > 0);
  }, [previewMetrics]);

  // Usuário alterou cor/fundo → edição de conteúdo
  const handleBackgroundColorChange = useCallback((color) => {
    setBackgroundColor(color);
  }, []);

  // Usuário alterou animação de mídia → edição de conteúdo
  const handleMediaAnimationChange = useCallback((animation) => {
    setMediaAnimation(animation);
  }, []);

  const secondsToTimecode = (seconds) => formatFixedTimecode(seconds);

  const handleTapSync = useCallback((stanzaId, field) => {
    const current = currentTimeRef.current;
    const flagField = field === 'startTime' ? 'hasManualStart' : 'hasManualEnd';

    setStanzas((prev) =>
      prev.map((stanza) =>
        stanza.id === stanzaId
          ? {
              ...stanza,
              [field]: secondsToTimecode(current),
              [flagField]: true,
            }
          : stanza
      )
    );
  }, []);

  const requestPreviewSeek = useCallback((stanzaId, options = {}) => {
    const { notifyIfMissingStart = false } = options;
    const stanzaIndex = stanzas.findIndex((item) => item.id === stanzaId);
    const stanza = stanzaIndex >= 0 ? stanzas[stanzaIndex] : null;

    if (!stanza) return false;

    if (!hasDefinedStartTime(stanza, { allowFirstBlockAtZero: stanzaIndex === 0 })) {
      if (notifyIfMissingStart) {
        setSyncStatus({
          type: 'warning',
          message: 'Ao selecionar uma estrofe com tempo inicial e final definido, o preview retornará automaticamente para o inicio dessa estrofe.',
        });
      }
      return false;
    }

    if (!hasDefinedEndTime(stanza)) {
      if (notifyIfMissingStart) {
        setSyncStatus({
          type: 'warning',
          message: 'O preview só volta automaticamente quando o fim da estrofe estiver preenchido.',
        });
      }
      return false;
    }

    const start = parseFixedTimecode(stanza.startTime);

    if (start === null) {
      if (notifyIfMissingStart) {
        setSyncStatus({
          type: 'warning',
          message: 'Ao selecionar uma estrofe com tempo inicial e final definido, o preview retornará automaticamente para o inicio dessa estrofe.',
        });
      }
      return false;
    }

    setSeekRequest({
      stanzaId,
      time: start,
      nonce: Date.now(),
    });

    return true;
  }, [stanzas]);

  const handleSelectStanza = useCallback((stanzaId, options = {}) => {
    const { source = 'editor', shouldSeek = source === 'editor', notifyIfMissingStart = source === 'editor' } = options;
    const isSameSelection = stanzaId === selectedStanzaId;

    setSelectedStanzaId(stanzaId);

    if (shouldSeek && !isSameSelection) {
      requestPreviewSeek(stanzaId, { notifyIfMissingStart });
    }
  }, [requestPreviewSeek, selectedStanzaId]);

  const focusSelectedStanzaBlock = useCallback(() => {
    setSelectedStanzaFocusSignal((prev) => prev + 1);
  }, []);

  const navigateBetweenStanzas = useCallback((direction) => {
    if (!stanzas.length) return;

    const activeStanzaId = getActiveStanzaAtTime(stanzas, currentTimeRef.current)?.id ?? null;
    const baseId = selectedStanzaId || activeStanzaId || stanzas[0]?.id || null;
    const currentIndex = stanzas.findIndex((stanza) => stanza.id === baseId);
    const safeIndex = currentIndex >= 0 ? currentIndex : 0;
    const nextIndex = clamp(safeIndex + direction, 0, stanzas.length - 1);
    const nextStanza = stanzas[nextIndex];

    if (!nextStanza) return;

    handleSelectStanza(nextStanza.id, {
      source: 'shortcut',
      shouldSeek: true,
      notifyIfMissingStart: true,
    });
    focusSelectedStanzaBlock();
  }, [focusSelectedStanzaBlock, handleSelectStanza, selectedStanzaId, stanzas]);

  const openBlankProject = useCallback(() => {
    setCurrentProjectId(null);
    setProjectName('');
    setProjectExportDefaults({ resolution: '720p', videoFormat: 'mp4' });
    setStanzas([]);
    setSelectedStanzaId(null);
    setShowLyricsEditor(false);
    setMediaFiles(EMPTY_MEDIA_FILES);
    setMediaMetadata(EMPTY_MEDIA_METADATA);
    setMediaAnimation(DEFAULT_MEDIA_ANIMATION);
    setAudioType('original');
    setAudioType('original');
    setBackgroundColor('#000000');
    setCurrentTime(0);
    setIsPreviewPlaying(false);
    currentTimeRef.current = 0;
    setSeekRequest(null);
    setProjectsTab('history');
    setLibrarySearch('');
    setResetVersion((prev) => prev + 1);
    setLoadingProjectState({ projectId: null, action: null, message: '' });
    setSyncStatus({
      type: 'info',
      message: 'Novo projeto iniciado. Faça upload dos arquivos e personalize o vídeo.',
    });
    setShowProjectsPanel(false);
  }, []);

  const loadProjectIntoEditor = useCallback((project, successMessage) => {
    const config = project?.config || {};
    const normalizedStanzas = normalizeStanzas(config.stanzas || [], previewMetrics);
    const firstStanza = normalizedStanzas[0] || null;
    const projectResolution = ['360p', '480p', '720p', '1080p'].includes(project?.resolution)
      ? project.resolution
      : '720p';
    const projectVideoFormat = ['mp4', 'avi', 'mov', 'mkv'].includes(config.videoFormat)
      ? config.videoFormat
      : 'mp4';

    const resolvedAudioType = ['original', 'instrumental'].includes(config.audioType)
      ? config.audioType
      : 'original';

    setCurrentProjectId(project?.id || null);
    setProjectName(project?.name || '');
    setProjectExportDefaults({
      resolution: projectResolution,
      videoFormat: projectVideoFormat,
    });
    setStanzas(normalizedStanzas);
    setSelectedStanzaId(normalizedStanzas[0]?.id ?? null);
    setShowLyricsEditor(normalizedStanzas.length > 0);
    setMediaFiles({
      ...EMPTY_MEDIA_FILES,
      ...(config.mediaFiles || {}),
    });
    setMediaMetadata({
      ...EMPTY_MEDIA_METADATA,
      ...(config.mediaMetadata || {}),
    });
    setMediaAnimation(normalizeMediaAnimation(config.mediaAnimation || DEFAULT_MEDIA_ANIMATION));
    setAudioType(resolvedAudioType);
    setBackgroundColor(config.backgroundColor || '#000000');
    currentTimeRef.current = 0;
    setCurrentTime(0);
    setSeekRequest(firstStanza ? {
      stanzaId: firstStanza.id,
      time: 0,
      nonce: Date.now(),
    } : null);
    setIsPreviewPlaying(false);
    setResetVersion((prev) => prev + 1);
    setSyncStatus({
      type: 'success',
      message: successMessage || `Projeto "${project?.name || 'sem nome'}" carregado com sucesso.`,
    });
    setShowProjectsPanel(false);
  }, [previewMetrics]);

  const handleSavedProject = useCallback((project) => {
    if (!project) return;

    setCurrentProjectId(project.id);
    setProjectName(project.name || '');
    setMyProjects((prev) => {
      const otherProjects = prev.filter((item) => item.id !== project.id);
      return [project, ...otherProjects];
    });
    setLibraryProjects((prev) => {
      const withoutCurrent = prev.filter((item) => item.id !== project.id);
      return project.is_public ? [project, ...withoutCurrent] : withoutCurrent;
    });
  }, []);

  const withProjectLoading = useCallback(async (projectId, action, message, task) => {
    setLoadingProjectState({ projectId, action, message });

    try {
      return await task();
    } finally {
      setLoadingProjectState({ projectId: null, action: null, message: '' });
    }
  }, []);

  const handleOpenProject = useCallback(async (project) => {
    await withProjectLoading(project.id, 'open', `Abrindo o projeto "${project.name}"...`, async () => {
      loadProjectIntoEditor(project, `Projeto "${project.name}" aberto no editor.`);
    });
  }, [loadProjectIntoEditor, withProjectLoading]);

  const handleTogglePublic = useCallback(async (project) => {
    if (project.is_public) {
      // Despublicar diretamente
      try {
        await withProjectLoading(project.id, 'toggle-public', 'Despublicando projeto...', async () => {
          const response = await api.post(`/projects/${project.id}/unpublish`);
          const updatedProject = response.data?.project;
          if (!updatedProject) return;
          setMyProjects((prev) => prev.map((item) => (item.id === updatedProject.id ? updatedProject : item)));
          setLibraryProjects((prev) => prev.filter((item) => item.id !== updatedProject.id));
          setSyncStatus({ type: 'success', message: `Projeto "${updatedProject.name}" voltou para privado.` });
        });
      } catch (error) {
        console.error('Erro ao despublicar projeto:', error);
        pushNotice({ type: 'error', title: 'Falha ao despublicar', message: error.response?.data?.error || 'Não foi possível despublicar o projeto.' });
      }
    } else {
      // Abrir modal de publicação
      setPublishModalProject(project);
      setPublishModalName(project.public_name || '');
      setPublishModalError('');
      setShowPublishModal(true);
    }
  }, [pushNotice, withProjectLoading]);

  const handlePublishSubmit = useCallback(async () => {
    const trimmedName = publishModalName.trim();
    if (!trimmedName) { setPublishModalError('O nome público é obrigatório.'); return; }
    try {
      setPublishingProject(true);
      setPublishModalError('');
      const response = await api.post(`/projects/${publishModalProject.id}/publish`, { publicName: trimmedName });
      const updatedProject = response.data?.project;
      if (!updatedProject) return;
      setMyProjects((prev) => prev.map((item) => (item.id === updatedProject.id ? updatedProject : item)));
      setLibraryProjects((prev) => { const without = prev.filter((item) => item.id !== updatedProject.id); return [updatedProject, ...without]; });
      setSyncStatus({ type: 'success', message: `Projeto publicado na comunidade como "${trimmedName}".` });
      setShowPublishModal(false);
      setShowIncentiveModal(false);
    } catch (error) {
      console.error('Erro ao publicar projeto:', error);
      setPublishModalError(error.response?.data?.error || 'Não foi possível publicar o projeto.');
    } finally {
      setPublishingProject(false);
    }
  }, [publishModalName, publishModalProject]);

  const handleDeleteProject = useCallback((project) => {
    setConfirmDialog({ isOpen: true, project });
  }, []);

  const handleConfirmDelete = useCallback(async () => {
    const project = confirmDialog.project;
    setConfirmDialog({ isOpen: false, project: null });
    if (!project) return;

    try {
      await withProjectLoading(project.id, 'delete', `Excluindo o projeto "${project.name}"...`, async () => {
        await api.delete(`/projects/${project.id}`);
        setMyProjects((prev) => prev.filter((item) => item.id !== project.id));
        setLibraryProjects((prev) => prev.filter((item) => item.id !== project.id));

        if (currentProjectId === project.id) {
          setCurrentProjectId(null);
        }

        setSyncStatus({
          type: 'success',
          message: `Projeto "${project.name}" excluído com sucesso.`,
        });
      });
    } catch (error) {
      console.error('Erro ao excluir projeto:', error);
      pushNotice({
        type: 'error',
        title: 'Falha ao excluir projeto',
        message: error.response?.data?.error || 'Não foi possível excluir o projeto.',
      });
    }
  }, [confirmDialog.project, currentProjectId, pushNotice, withProjectLoading]);

  const handleForkProject = useCallback(async (project) => {
    try {
      await withProjectLoading(project.id, 'fork', `Carregando a sua cópia de "${project.name}"...`, async () => {
        const response = await api.post(`/projects/${project.id}/fork`, {
          name: `${project.name} (cópia)`,
        });

        const forkedProject = response.data?.project;
        if (!forkedProject) return;

        setMyProjects((prev) => [forkedProject, ...prev.filter((item) => item.id !== forkedProject.id)]);
        loadProjectIntoEditor(
          forkedProject,
          `Uma cópia de "${project.name}" foi gerada para edição.`
        );
      });
    } catch (error) {
      console.error('Erro ao criar cópia do projeto:', error);
      pushNotice({
        type: 'error',
        title: 'Falha ao criar cópia',
        message: error.response?.data?.error || 'Não foi possível criar uma cópia deste projeto.',
      });
    }
  }, [loadProjectIntoEditor, pushNotice, withProjectLoading]);

  useEffect(() => {
    if (!stanzas.length) {
      if (selectedStanzaId !== null) {
        setSelectedStanzaId(null);
      }
      return;
    }

    const selectionStillExists = stanzas.some((stanza) => stanza.id === selectedStanzaId);
    if (!selectionStillExists) {
      setSelectedStanzaId(stanzas[0].id);
    }
  }, [stanzas, selectedStanzaId]);

  useEffect(() => {
    const resolveShortcutZone = (target) => {
      if (!(target instanceof Node)) {
        return null;
      }

      if (previewWrapperRef.current?.contains(target)) {
        return 'preview';
      }

      if (editorRightRef.current?.contains(target)) {
        return 'editor';
      }

      return null;
    };

    const handlePointerDown = (event) => {
      lastShortcutZoneRef.current = resolveShortcutZone(event.target);
    };

    const handleFocusIn = (event) => {
      const nextZone = resolveShortcutZone(event.target);
      if (nextZone) {
        lastShortcutZoneRef.current = nextZone;
      }
    };

    const handleKeyDown = (event) => {
      if (event.defaultPrevented || event.isComposing) return;

      if (document.querySelector('.guide-overlay, .projects-overlay, .editor-loading-overlay')) {
        return;
      }

      const activeElement = document.activeElement;
      const shortcutZone = lastShortcutZoneRef.current;
      const isTextFieldFocused = isTextEntryElement(activeElement);
      const isLyricsEditorTextFocused = Boolean(
        activeElement
        && editorRightRef.current?.contains(activeElement)
        && isTextFieldFocused
      );
      const usingModifier = event.ctrlKey || event.metaKey;
      const normalizedKey = event.key.length === 1 ? event.key.toLowerCase() : event.key;
      const canUsePauseShortcut = layoutMode !== 'desktop' || shortcutZone === 'preview' || shortcutZone === 'editor';

      if (isLyricsEditorTextFocused) {
        if (usingModifier && event.code === 'Space' && canUsePauseShortcut) {
          event.preventDefault();
          previewPanelRef.current?.togglePlay();
        }
        return;
      }

      if (isTextFieldFocused) {
        return;
      }

      if (usingModifier && event.key === 'ArrowRight') {
        event.preventDefault();
        previewPanelRef.current?.seekBy(1);
        return;
      }

      if (usingModifier && event.key === 'ArrowLeft') {
        event.preventDefault();
        previewPanelRef.current?.seekBy(-1);
        return;
      }

      if (event.code === 'Space' && canUsePauseShortcut) {
        event.preventDefault();
        previewPanelRef.current?.togglePlay();
        return;
      }

      if (event.key === 'ArrowUp') {
        event.preventDefault();
        navigateBetweenStanzas(-1);
        return;
      }

      if (event.key === 'ArrowDown') {
        event.preventDefault();
        navigateBetweenStanzas(1);
        return;
      }

      if (normalizedKey === 'm' && selectedStanzaId) {
        event.preventDefault();
        handleTapSync(selectedStanzaId, 'startTime');
        focusSelectedStanzaBlock();
        return;
      }

      if (normalizedKey === 'n' && selectedStanzaId) {
        event.preventDefault();
        handleTapSync(selectedStanzaId, 'endTime');
        focusSelectedStanzaBlock();
        return;
      }

      if (normalizedKey === 't') {
        event.preventDefault();
        previewPanelRef.current?.toggleAudioTrack();
      }
    };

    document.addEventListener('pointerdown', handlePointerDown, true);
    document.addEventListener('focusin', handleFocusIn, true);
    document.addEventListener('keydown', handleKeyDown);

    return () => {
      document.removeEventListener('pointerdown', handlePointerDown, true);
      document.removeEventListener('focusin', handleFocusIn, true);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [focusSelectedStanzaBlock, handleTapSync, layoutMode, navigateBetweenStanzas, selectedStanzaId]);

  useEffect(() => {
    if (!stanzas.length) return;

    setStanzas((prev) => {
      const normalized = normalizeStanzas(prev, previewMetrics);
      const hasChanges = normalized.some((stanza, index) => (
        stanza.fontSize !== prev[index]?.fontSize
        || stanza.transition !== prev[index]?.transition
        || stanza.transitionDuration !== prev[index]?.transitionDuration
        || stanza.outlineWidth !== prev[index]?.outlineWidth
        || stanza.scaleX !== prev[index]?.scaleX
      ));

      return hasChanges ? normalized : prev;
    });
  }, [previewMetrics, stanzas.length]);

  useEffect(() => {
    if (!editorMainRef.current) return undefined;

    const element = editorMainRef.current;

    const measure = () => {
      const nextWidth = Math.floor(element.getBoundingClientRect().width);
      setWorkspaceWidth(nextWidth);

      if (nextWidth >= DESKTOP_RESIZE_BREAKPOINT) {
        setLayoutMode('desktop');
      } else if (nextWidth >= TABLET_LAYOUT_BREAKPOINT) {
        setLayoutMode('tablet');
      } else {
        setLayoutMode('mobile');
      }
    };

    measure();

    const resizeObserver = typeof ResizeObserver !== 'undefined'
      ? new ResizeObserver(() => measure())
      : null;

    resizeObserver?.observe(element);
    window.addEventListener('resize', measure);

    return () => {
      resizeObserver?.disconnect();
      window.removeEventListener('resize', measure);
    };
  }, []);

  const desktopRatios = useMemo(
    () => normalizeDesktopRatios(workspaceWidth, panelRatios),
    [workspaceWidth, panelRatios]
  );

  const desktopColumnWidths = useMemo(() => {
    if (!workspaceWidth) {
      return { files: 320, preview: 520, lyrics: 420 };
    }

    const files = Math.round(desktopRatios.files * workspaceWidth);
    const preview = Math.round(desktopRatios.preview * workspaceWidth);
    const lyrics = Math.max(0, workspaceWidth - files - preview);

    return { files, preview, lyrics };
  }, [desktopRatios.files, desktopRatios.preview, workspaceWidth]);

  const isDesktopLayout = layoutMode === 'desktop';

  const startPanelResize = useCallback((side, event) => {
    if (!isDesktopLayout || !workspaceWidth) return;

    event.preventDefault();
    event.stopPropagation();

    dragStateRef.current = {
      side,
      startX: event.clientX,
      ratios: desktopRatios,
    };

    setIsResizingPanels(true);
  }, [desktopRatios, isDesktopLayout, workspaceWidth]);

  useEffect(() => {
    if (!isResizingPanels) return undefined;

    let nextClientX = null;

    const applyResize = (clientX) => {
      const dragState = dragStateRef.current;
      if (!dragState || !workspaceWidth) return;

      const delta = clientX - dragState.startX;
      const totalWidth = workspaceWidth;

      if (dragState.side === 'left') {
        const nextFiles = ((dragState.ratios.files * totalWidth) + delta) / totalWidth;
        const nextPreview = 1 - nextFiles - dragState.ratios.lyrics;
        const normalized = normalizeDesktopRatios(totalWidth, { files: nextFiles, preview: nextPreview });

        setPanelRatios({ files: normalized.files, preview: normalized.preview });
        return;
      }

      const nextPreview = ((dragState.ratios.preview * totalWidth) + delta) / totalWidth;
      const normalized = normalizeDesktopRatios(totalWidth, { files: dragState.ratios.files, preview: nextPreview });
      setPanelRatios({ files: normalized.files, preview: normalized.preview });
    };

    const scheduleResize = (clientX) => {
      nextClientX = clientX;

      if (resizeRafRef.current !== null) return;

      resizeRafRef.current = window.requestAnimationFrame(() => {
        resizeRafRef.current = null;

        if (nextClientX !== null) {
          applyResize(nextClientX);
        }
      });
    };

    const handlePointerMove = (event) => {
      if (typeof event.clientX !== 'number') return;
      scheduleResize(event.clientX);
    };

    const stopResizing = () => {
      if (resizeRafRef.current !== null) {
        window.cancelAnimationFrame(resizeRafRef.current);
        resizeRafRef.current = null;
      }

      dragStateRef.current = null;
      setIsResizingPanels(false);
    };

    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';

    window.addEventListener('pointermove', handlePointerMove);
    window.addEventListener('pointerup', stopResizing);
    window.addEventListener('pointercancel', stopResizing);

    return () => {
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      if (resizeRafRef.current !== null) {
        window.cancelAnimationFrame(resizeRafRef.current);
        resizeRafRef.current = null;
      }
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerup', stopResizing);
      window.removeEventListener('pointercancel', stopResizing);
    };
  }, [isResizingPanels, workspaceWidth]);

  useEffect(() => {
    if (!isDesktopLayout) {
      setExportBelow(false);
      return undefined;
    }

    const measureExportPlacement = () => {
      if (!previewWrapperRef.current || !exportWrapperRef.current) return;

      const headerHeight = document.querySelector('.header')?.getBoundingClientRect().height || 0;
      const previewRect = previewWrapperRef.current.getBoundingClientRect();
      const exportRect = exportWrapperRef.current.getBoundingClientRect();
      const viewportAllowance = window.innerHeight - headerHeight - 28;
      const requiredHeight = previewRect.height + exportRect.height + 24;

      setExportBelow(requiredHeight > viewportAllowance);
    };

    measureExportPlacement();

    const resizeObserver = typeof ResizeObserver !== 'undefined'
      ? new ResizeObserver(() => measureExportPlacement())
      : null;

    if (previewWrapperRef.current) resizeObserver?.observe(previewWrapperRef.current);
    if (exportWrapperRef.current) resizeObserver?.observe(exportWrapperRef.current);
    if (editorMainRef.current) resizeObserver?.observe(editorMainRef.current);

    window.addEventListener('resize', measureExportPlacement);

    return () => {
      resizeObserver?.disconnect();
      window.removeEventListener('resize', measureExportPlacement);
    };
  }, [desktopColumnWidths.preview, isDesktopLayout]);

  useEffect(() => {
    if (layoutMode !== 'mobile' || !showLyricsEditor) {
      setIsLyricsEditorVisibleOnMobile(false);
      return undefined;
    }

    const editorElement = editorRightRef.current;

    if (!editorElement || typeof IntersectionObserver === 'undefined') {
      setIsLyricsEditorVisibleOnMobile(true);
      return undefined;
    }

    const editorObserver = new IntersectionObserver(
      ([entry]) => {
        // Em mobile o editor pode ficar muito alto; por isso basta qualquer interseção real.
        setIsLyricsEditorVisibleOnMobile(Boolean(entry?.isIntersecting));
      },
      {
        threshold: [0, 0.01, 0.05],
      }
    );

    editorObserver.observe(editorElement);

    return () => {
      editorObserver.disconnect();
    };
  }, [layoutMode, showLyricsEditor]);

  const hasPreviewAudioAvailable = useMemo(() => {
    if (audioType === 'instrumental' && mediaFiles?.musicaInstrumental) {
      return true;
    }

    return Boolean(mediaFiles?.musicaOriginal);
  }, [audioType, mediaFiles]);

  const editorLayoutStyle = useMemo(() => {
    if (!isDesktopLayout) return undefined;

    return {
      '--editor-left-width': `${desktopColumnWidths.files}px`,
      '--editor-preview-width': `${desktopColumnWidths.preview}px`,
      '--editor-right-width': `${desktopColumnWidths.lyrics}px`,
    };
  }, [desktopColumnWidths.files, desktopColumnWidths.lyrics, desktopColumnWidths.preview, isDesktopLayout]);

  if (loading) {
    return (
      <div className="editor-container">
        <p style={{ color: '#fff', padding: 40 }}>Carregando sessão...</p>
      </div>
    );
  }

  const isProjectLoading = Boolean(loadingProjectState.projectId);
  const showMobileFloatingPreviewControls = layoutMode === 'mobile'
    && showLyricsEditor
    && isLyricsEditorVisibleOnMobile
    && !showProjectsPanel
    && !isProjectLoading;

  return (
    <div
      className={`editor-container${layoutMode !== 'desktop' || exportBelow ? ' editor-container--scrollable' : ''}${isResizingPanels ? ' editor-container--resizing' : ''}`}
    >
      <Header onOpenProjects={() => setShowProjectsPanel(true)} />

      <div
        ref={editorMainRef}
        className={`editor-main editor-main--${layoutMode}${exportBelow ? ' editor-main--export-below' : ''}`}
        style={editorLayoutStyle}
      >
        <div className="editor-left">
          <FilesPanel
            key={`files-${resetVersion}`}
            onLyricsProcessed={handleLyricsProcessed}
            onFilesUploaded={handleFilesUploaded}
            onMediaAnimationChange={handleMediaAnimationChange}
            stanzaCount={stanzas.length}
            syncStatus={syncStatus}
            onNotify={pushNotice}
            onSyncLyrics={handleAutoSyncLyrics}
            isSyncingLyrics={isSyncingLyrics}
            mediaFiles={mediaFiles}
            mediaMetadata={mediaMetadata}
            mediaAnimation={mediaAnimation}
            audioType={audioType}
            onMediaMetadataChange={handleMediaMetadataChange}
          />
        </div>

        {isDesktopLayout ? (
          <button
            type="button"
            className="editor-resizer editor-resizer--left"
            aria-label="Redimensionar painel Arquivos"
            onPointerDown={(event) => startPanelResize('left', event)}
          />
        ) : null}

        <div className="preview-wrapper" ref={previewWrapperRef}>
          <PreviewPanel
            ref={previewPanelRef}
            key={`preview-${resetVersion}`}
            stanzas={stanzas}
            selectedStanzaId={selectedStanzaId}
            currentTime={currentTime}
            audioType={audioType}
            backgroundColor={backgroundColor}
            mediaFiles={mediaFiles}
            mediaAnimation={mediaAnimation}
            seekRequest={seekRequest}
            onTimeUpdate={handleTimeUpdate}
            onAudioTypeChange={setAudioType}
            onBackgroundColorChange={handleBackgroundColorChange}
            onPreviewMetricsChange={setPreviewMetrics}
            onPlaybackStateChange={setIsPreviewPlaying}
          />
        </div>

        {isDesktopLayout ? (
          <button
            type="button"
            className="editor-resizer editor-resizer--right"
            aria-label="Redimensionar painel Preview"
            onPointerDown={(event) => startPanelResize('right', event)}
          />
        ) : null}

        <div className="editor-right" ref={editorRightRef}>
          {showLyricsEditor ? (
            <LyricsEditorPanel
              stanzas={stanzas}
              selectedStanzaId={selectedStanzaId}
              currentTime={currentTime}
              onStanzasChange={handleStanzasChange}
              onTapSync={handleTapSync}
              onStanzaSelect={(stanzaId) => handleSelectStanza(stanzaId, { source: 'editor', shouldSeek: true, notifyIfMissingStart: true })}
              previewMetrics={previewMetrics}
              focusSelectedSignal={selectedStanzaFocusSignal}
              isDesktopLayout={isDesktopLayout}
            />
          ) : (
            <div className="placeholder-panel">
              <p>O painel Editor de Letras aparecerá aqui após o upload da letra</p>
            </div>
          )}
        </div>

        <div className="export-wrapper" ref={exportWrapperRef}>
          <ExportPanel
            key={`export-${resetVersion}`}
            stanzas={stanzas}
            mediaFiles={mediaFiles}
            mediaMetadata={mediaMetadata}
            mediaAnimation={mediaAnimation}
            audioType={audioType}
            initialResolution={projectExportDefaults.resolution}
            initialVideoFormat={projectExportDefaults.videoFormat}
            backgroundColor={backgroundColor}
            projectName={projectName}
            onProjectNameChange={setProjectName}
            currentProjectId={currentProjectId}
            onProjectSaved={handleSavedProject}
            onCreateNewProject={openBlankProject}
            onNotify={pushNotice}
          />
        </div>
      </div>

      <MobileFloatingPreviewControls
        visible={showMobileFloatingPreviewControls}
        disabled={!hasPreviewAudioAvailable}
        isPlaying={isPreviewPlaying}
        onTogglePlay={() => previewPanelRef.current?.togglePlay()}
        onSeekBy={(delta) => previewPanelRef.current?.seekBy(delta)}
      />

      <ProjectsPanel
        isOpen={showProjectsPanel}
        activeTab={projectsTab}
        onTabChange={setProjectsTab}
        myProjects={myProjects}
        libraryProjects={libraryProjects}
        librarySearch={librarySearch}
        onLibrarySearchChange={setLibrarySearch}
        loadingMyProjects={loadingMyProjects}
        loadingLibrary={loadingLibrary}
        onRefreshMyProjects={fetchMyProjects}
        onRefreshLibrary={fetchLibraryProjects}
        onOpenProject={handleOpenProject}
        onTogglePublic={handleTogglePublic}
        onDeleteProject={handleDeleteProject}
        onForkProject={handleForkProject}
        onCreateNewProject={openBlankProject}
        onClose={() => setShowProjectsPanel(false)}
        loadingProjectId={loadingProjectState.projectId}
        loadingProjectAction={loadingProjectState.action}
      />

      <NoticeCenter notices={notices} onDismiss={dismissNotice} />

      <ConfirmDialog
        isOpen={confirmDialog.isOpen}
        title="Excluir projeto"
        message={confirmDialog.project ? `Deseja realmente excluir o projeto "${confirmDialog.project.name}"? Essa ação não pode ser desfeita.` : ''}
        confirmLabel="Excluir"
        cancelLabel="Cancelar"
        onConfirm={handleConfirmDelete}
        onCancel={() => setConfirmDialog({ isOpen: false, project: null })}
      />

      {/* Modal de publicação na comunidade */}
      {showPublishModal && publishModalProject ? (
        <div className="publish-modal-overlay" onClick={() => { if (!publishingProject) { setShowPublishModal(false); } }}>
          <div className="publish-modal" onClick={(e) => e.stopPropagation()}>
            <h3>Publicar na Comunidade</h3>
            <p className="publish-modal__desc">Escolha um nome para exibição na Biblioteca LenaVS. Seu projeto poderá ajudar outros usuários da comunidade.</p>
            <div className="publish-modal__field">
              <label htmlFor="publish-name-input">Nome público</label>
              <input
                id="publish-name-input"
                type="text"
                value={publishModalName}
                onChange={(e) => { setPublishModalName(e.target.value); setPublishModalError(''); }}
                placeholder="Digite o nome do projeto"
                maxLength={60}
                disabled={publishingProject}
                autoFocus
              />
              <span className="publish-modal__char-count">{publishModalName.trim().length}/60</span>
              {publishModalError ? <p className="publish-modal__error">{publishModalError}</p> : null}
            </div>
            <p className="publish-modal__hint">O nome original do projeto continuará privado e visível apenas para você.</p>
            <div className="publish-modal__actions">
              <button type="button" className="publish-modal__cancel" onClick={() => setShowPublishModal(false)} disabled={publishingProject}>Cancelar</button>
              <button type="button" className="publish-modal__submit" onClick={handlePublishSubmit} disabled={publishingProject}>
                {publishingProject ? 'Publicando...' : 'Publicar'}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {/* Incentivo de publicação */}
      {showIncentiveModal && incentiveProject ? (
        <div className="incentive-modal-overlay" onClick={() => setShowIncentiveModal(false)}>
          <div className="incentive-modal" onClick={(e) => e.stopPropagation()}>
            <div className="incentive-modal__icon">🎵</div>
            <h4>Ajude a comunidade LenaVS</h4>
            <p>Publique seu projeto e inspire outros criadores.</p>
            <div className="incentive-modal__actions">
              <button
                type="button"
                className="incentive-modal__publish-btn"
                onClick={() => {
                  setShowIncentiveModal(false);
                  setPublishModalProject(incentiveProject);
                  setPublishModalName(incentiveProject.public_name || '');
                  setPublishModalError('');
                  setShowPublishModal(true);
                }}
              >
                Publicar projeto
              </button>
              <button type="button" className="incentive-modal__skip-btn" onClick={() => setShowIncentiveModal(false)}>
                Agora não
              </button>
            </div>
          </div>
        </div>
      ) : null}

            {isProjectLoading && (
        <div className="editor-loading-overlay">
          <div className="editor-loading-card">
            <Loader2 size={24} className="editor-loading-spinner" />
            <strong>Carregando projeto</strong>
            <p>{loadingProjectState.message || 'Aguarde alguns segundos...'}</p>
          </div>
        </div>
      )}
    </div>
  );
};

export default Editor;
