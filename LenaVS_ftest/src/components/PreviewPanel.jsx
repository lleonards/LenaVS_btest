import React, {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { Play, Pause, Music } from 'lucide-react';
import './PreviewPanel.css';
import { formatFixedTimecode } from '../utils/timecode';
import {
  clampTransitionDuration,
  getActiveStanzaAtTime,
  getPreviewFontFamily,
  getResolvedStanzaTimeline,
  normalizeOutlineWidth,
  normalizeStanzaTransition,
  normalizeStanzaWidthScale,
  resolveStanzaLineEntries,
} from '../utils/stanza';
import {
  DEFAULT_MEDIA_ANIMATION,
  getMediaAnimationStyle,
  normalizeMediaAnimation,
} from '../utils/mediaAnimation';

const LOGICAL_PREVIEW_SIZE = {
  width: 1280,
  height: 720,
};

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

const buildOutlineShadow = (outlineColor = '#000000', outlineWidth = 2) => {
  const safeWidth = clamp(normalizeOutlineWidth(outlineWidth), 1, 10);
  const shadowPoints = [];

  for (let x = -safeWidth; x <= safeWidth; x += 1) {
    for (let y = -safeWidth; y <= safeWidth; y += 1) {
      if (x === 0 && y === 0) continue;
      if (Math.sqrt((x * x) + (y * y)) <= safeWidth + 0.2) {
        shadowPoints.push(`${x}px ${y}px 0 ${outlineColor}`);
      }
    }
  }

  shadowPoints.push('0 0 14px rgba(0, 0, 0, 0.35)');
  return shadowPoints.join(', ');
};

const getTransitionBaseScales = (transition, stanza) => {
  const baseScaleX = normalizeStanzaWidthScale(stanza?.scaleX ?? 1);
  const rawScaleY = Number(stanza?.scaleY);
  const baseScaleY = Number.isFinite(rawScaleY) ? clamp(rawScaleY, 0.35, 4) : 1;

  switch (transition) {
    case 'zoom-in':
      return {
        hiddenScaleX: Math.max(0.35, Number((baseScaleX * 0.82).toFixed(2))),
        hiddenScaleY: Math.max(0.35, Number((baseScaleY * 0.82).toFixed(2))),
        visibleScaleX: baseScaleX,
        visibleScaleY: baseScaleY,
      };
    case 'zoom-out':
      return {
        hiddenScaleX: Math.min(4, Number((baseScaleX * 1.18).toFixed(2))),
        hiddenScaleY: Math.min(4, Number((baseScaleY * 1.18).toFixed(2))),
        visibleScaleX: baseScaleX,
        visibleScaleY: baseScaleY,
      };
    default:
      return {
        hiddenScaleX: baseScaleX,
        hiddenScaleY: baseScaleY,
        visibleScaleX: baseScaleX,
        visibleScaleY: baseScaleY,
      };
  }
};

const buildTransform = (transition, phase, stanza) => {
  const { hiddenScaleX, hiddenScaleY, visibleScaleX, visibleScaleY } = getTransitionBaseScales(transition, stanza);
  const isHiddenPhase = phase === 'enter' || phase === 'exit';
  const translateY = transition === 'slide' && isHiddenPhase ? 30 : 0;
  const scaleX = isHiddenPhase ? hiddenScaleX : visibleScaleX;
  const scaleY = isHiddenPhase ? hiddenScaleY : visibleScaleY;

  return `translateY(${translateY}px) scale(${scaleX}, ${scaleY})`;
};

const PreviewPanel = forwardRef(({
  stanzas = [],
  selectedStanzaId = null,
  currentTime = 0,
  audioType = 'original',
  backgroundColor = '#000000',
  mediaFiles = {},
  mediaAnimation = DEFAULT_MEDIA_ANIMATION,
  seekRequest = null,
  onTimeUpdate = () => {},
  onAudioTypeChange = () => {},
  onBackgroundColorChange = () => {},
  onPreviewMetricsChange = () => {},
  onPlaybackStateChange = () => {},
}, ref) => {
  const audioRef = useRef(null);
  const backgroundVideoRef = useRef(null);
  const panelRef = useRef(null);
  const stageRef = useRef(null);
  const rafRef = useRef(null);
  const pendingSeekTimeRef = useRef(null);
  const prevAnimatedStanzaKeyRef = useRef(null);

  const [isPlaying, setIsPlaying] = useState(false);
  const [duration, setDuration] = useState(0);
  const [previewBoxSize, setPreviewBoxSize] = useState({ width: 1280, height: 720 });
  const [transitionPhase, setTransitionPhase] = useState('visible');
  const [backgroundVideoDuration, setBackgroundVideoDuration] = useState(0);

  const normalizedMediaAnimation = useMemo(
    () => normalizeMediaAnimation(mediaAnimation),
    [mediaAnimation]
  );

  const backgroundMedia = useMemo(() => {
    if (mediaFiles?.video) {
      return { type: 'video', src: mediaFiles.video };
    }

    if (mediaFiles?.imagem) {
      return { type: 'image', src: mediaFiles.imagem };
    }

    return { type: 'color', src: null };
  }, [mediaFiles]);

  const startRaf = useCallback(() => {
    const tick = () => {
      if (audioRef.current && !audioRef.current.paused) {
        onTimeUpdate(audioRef.current.currentTime);
      }
      rafRef.current = requestAnimationFrame(tick);
    };

    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    rafRef.current = requestAnimationFrame(tick);
  }, [onTimeUpdate]);

  const stopRaf = useCallback(() => {
    if (rafRef.current) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
  }, []);

  useEffect(() => () => stopRaf(), [stopRaf]);

  useEffect(() => {
    onPlaybackStateChange(isPlaying);
  }, [isPlaying, onPlaybackStateChange]);

  const cleanUrl = (url) => (url ? url : null);

  const effectivePreviewAudioType = useMemo(() => {
    if (audioType === 'instrumental' && mediaFiles?.musicaInstrumental) {
      return 'instrumental';
    }

    if (mediaFiles?.musicaOriginal) {
      return 'original';
    }

    return mediaFiles?.musicaInstrumental ? 'instrumental' : 'original';
  }, [audioType, mediaFiles]);

  const audioSrc = useMemo(() => {
    const src = effectivePreviewAudioType === 'instrumental' ? mediaFiles?.musicaInstrumental : mediaFiles?.musicaOriginal;
    return cleanUrl(src);
  }, [effectivePreviewAudioType, mediaFiles]);

  const resolvedPreviewDuration = useMemo(() => {
    if (Number.isFinite(duration) && duration > 0) {
      return duration;
    }

    const audioDuration = audioRef.current?.duration;
    if (Number.isFinite(audioDuration) && audioDuration > 0) {
      return audioDuration;
    }

    return 0;
  }, [duration]);

  const mediaAnimationStyle = useMemo(() => {
    return getMediaAnimationStyle({
      currentTime,
      totalDuration: resolvedPreviewDuration,
      mediaDuration: backgroundMedia.type === 'video' ? backgroundVideoDuration : 0,
      config: normalizedMediaAnimation,
      isVideo: backgroundMedia.type === 'video',
    });
  }, [backgroundMedia.type, backgroundVideoDuration, currentTime, normalizedMediaAnimation, resolvedPreviewDuration]);

  const syncBackgroundVideoTime = useCallback((time) => {
    if (backgroundMedia.type !== 'video' || !backgroundVideoRef.current) {
      return;
    }

    const videoElement = backgroundVideoRef.current;
    const safeDuration = Number(backgroundVideoDuration || videoElement.duration || 0);
    if (!Number.isFinite(safeDuration) || safeDuration <= 0) {
      return;
    }

    const baseTime = Math.max(0, Number(time) || 0);
    const targetTime = resolvedPreviewDuration > 0
      ? (baseTime % safeDuration)
      : Math.min(baseTime, safeDuration);

    if (Math.abs((videoElement.currentTime || 0) - targetTime) > 0.12) {
      try {
        videoElement.currentTime = targetTime;
      } catch (error) {
        console.warn('Não foi possível sincronizar o vídeo do preview:', error);
      }
    }
  }, [backgroundMedia.type, backgroundVideoDuration, resolvedPreviewDuration]);

  useEffect(() => {
    onPreviewMetricsChange(LOGICAL_PREVIEW_SIZE);
  }, [onPreviewMetricsChange]);

  useEffect(() => {
    if (!audioRef.current || !audioSrc) return;

    const audio = audioRef.current;
    const previousTime = audio.currentTime;
    const wasPlaying = !audio.paused;

    audio.pause();
    audio.src = audioSrc;
    audio.load();

    audio.onloadedmetadata = () => {
      const seekTo = pendingSeekTimeRef.current ?? previousTime;
      audio.currentTime = Math.max(0, seekTo);
      onTimeUpdate(audio.currentTime);
      syncBackgroundVideoTime(audio.currentTime);

      if (wasPlaying) {
        audio.play().catch(() => {});
        startRaf();
      }
    };
  }, [audioSrc, onTimeUpdate, startRaf, syncBackgroundVideoTime]);

  useEffect(() => {
    if (!stageRef.current) return;

    const container = stageRef.current;

    const calcAndSet = () => {
      const rect = container.getBoundingClientRect();
      const maxWidth = rect.width;
      const maxHeight = rect.height;
      const isMobile = window.matchMedia && window.matchMedia('(max-width: 768px)').matches;

      if (!maxWidth) return;

      let width = maxWidth;
      let height = (width * 9) / 16;

      if (!isMobile && maxHeight && height > maxHeight) {
        height = maxHeight;
        width = (height * 16) / 9;
      }

      setPreviewBoxSize({
        width: Math.max(320, Math.floor(width)),
        height: Math.max(180, Math.floor(height)),
      });
    };

    calcAndSet();

    let resizeObserver;
    if (typeof ResizeObserver !== 'undefined') {
      resizeObserver = new ResizeObserver(calcAndSet);
      resizeObserver.observe(container);
    }

    window.addEventListener('resize', calcAndSet);

    return () => {
      resizeObserver?.disconnect();
      window.removeEventListener('resize', calcAndSet);
    };
  }, []);

  useEffect(() => {
    if (backgroundMedia.type !== 'video') {
      setBackgroundVideoDuration(0);
      return;
    }

    syncBackgroundVideoTime(currentTime);
  }, [backgroundMedia.type, backgroundMedia.src, currentTime, syncBackgroundVideoTime]);

  useEffect(() => {
    const videoElement = backgroundVideoRef.current;
    if (!videoElement || backgroundMedia.type !== 'video') {
      return undefined;
    }

    const syncPlaybackState = async () => {
      syncBackgroundVideoTime(audioRef.current?.currentTime ?? currentTime);

      if (isPlaying) {
        try {
          await videoElement.play();
        } catch (error) {
          console.warn('O vídeo de fundo não pôde iniciar automaticamente:', error);
        }
      } else {
        videoElement.pause();
      }
    };

    void syncPlaybackState();
  }, [backgroundMedia.type, currentTime, isPlaying, syncBackgroundVideoTime]);

  const previewScale = useMemo(() => {
    const widthScale = previewBoxSize.width / LOGICAL_PREVIEW_SIZE.width;
    const heightScale = previewBoxSize.height / LOGICAL_PREVIEW_SIZE.height;
    return Math.min(widthScale, heightScale) || 1;
  }, [previewBoxSize.height, previewBoxSize.width]);

  const currentStanza = useMemo(() => getActiveStanzaAtTime(stanzas, currentTime), [stanzas, currentTime]);

  const resolvedTimeline = useMemo(() => getResolvedStanzaTimeline(stanzas), [stanzas]);

  const currentTimelineEntry = useMemo(() => {
    if (!currentStanza) return null;

    return resolvedTimeline.find((entry) => entry?.stanza?.id === currentStanza.id) || null;
  }, [currentStanza, resolvedTimeline]);

  const lastVisibleTimelineEntry = useMemo(() => {
    for (let index = resolvedTimeline.length - 1; index >= 0; index -= 1) {
      const entry = resolvedTimeline[index];
      if (entry?.isVisible) {
        return entry;
      }
    }

    return null;
  }, [resolvedTimeline]);

  // Mapa memoizado: stanzaId → próxima entrada visível no timeline.
  // Evita buscas lineares dentro de getTextContainerStyle (chamada por frame durante playback).
  const nextVisibleEntryByStanzaId = useMemo(() => {
    const map = new Map();

    for (let index = 0; index < resolvedTimeline.length; index += 1) {
      const entry = resolvedTimeline[index];
      if (!entry?.stanza?.id) continue;

      // Procurar a próxima entrada visível a partir de index + 1
      let nextEntry = null;
      for (let nextIndex = index + 1; nextIndex < resolvedTimeline.length; nextIndex += 1) {
        if (resolvedTimeline[nextIndex]?.isVisible) {
          nextEntry = resolvedTimeline[nextIndex];
          break;
        }
      }

      map.set(entry.stanza.id, nextEntry);
    }

    return map;
  }, [resolvedTimeline]);

  // Mapa memoizado: stanzaId → própria entrada no timeline.
  // Usado para acessar displayEnd local da estrofe sem depender de currentTimelineEntry.
  const timelineEntryByStanzaId = useMemo(() => {
    const map = new Map();
    resolvedTimeline.forEach((entry) => {
      if (entry?.stanza?.id) {
        map.set(entry.stanza.id, entry);
      }
    });
    return map;
  }, [resolvedTimeline]);

  const selectedStanza = useMemo(
    () => stanzas.find((stanza) => stanza.id === selectedStanzaId) || null,
    [stanzas, selectedStanzaId]
  );

  const stanzaForPreview = useMemo(() => {
    if (isPlaying) {
      return currentStanza;
    }

    return selectedStanza || currentStanza;
  }, [currentStanza, isPlaying, selectedStanza]);

  const animatedStanzaKey = useMemo(() => {
    if (!currentStanza) return null;

    return [
      currentStanza.id,
      normalizeStanzaTransition(currentStanza.transition),
      clampTransitionDuration(currentStanza.transitionDuration ?? 1),
      normalizeOutlineWidth(currentStanza.outlineWidth ?? 2),
      normalizeStanzaWidthScale(currentStanza.scaleX ?? 1),
    ].join(':');
  }, [currentStanza]);

  useLayoutEffect(() => {
    if (!animatedStanzaKey || !isPlaying) {
      prevAnimatedStanzaKeyRef.current = animatedStanzaKey;
      setTransitionPhase('visible');
      return undefined;
    }

    if (prevAnimatedStanzaKeyRef.current !== animatedStanzaKey) {
      prevAnimatedStanzaKeyRef.current = animatedStanzaKey;
      setTransitionPhase('enter');
      const rafId = requestAnimationFrame(() => {
        requestAnimationFrame(() => setTransitionPhase('visible'));
      });
      return () => cancelAnimationFrame(rafId);
    }

    return undefined;
  }, [animatedStanzaKey, isPlaying]);

  useEffect(() => {
    if (!seekRequest || typeof seekRequest.time !== 'number') return;

    const targetTime = Math.max(0, seekRequest.time);
    pendingSeekTimeRef.current = targetTime;

    if (audioRef.current) {
      try {
        audioRef.current.currentTime = targetTime;
      } catch (error) {
        console.warn('Não foi possível aplicar o seek imediatamente:', error);
      }
    }

    syncBackgroundVideoTime(targetTime);
    onTimeUpdate(targetTime);
  }, [seekRequest, onTimeUpdate, syncBackgroundVideoTime]);

  useEffect(() => {
    if (backgroundMedia.type !== 'video' || !backgroundVideoRef.current) return undefined;

    const videoElement = backgroundVideoRef.current;

    const handleLoadedMetadata = () => {
      const nextDuration = Number(videoElement.duration || 0);
      setBackgroundVideoDuration(Number.isFinite(nextDuration) ? nextDuration : 0);
      syncBackgroundVideoTime(audioRef.current?.currentTime ?? currentTime);
    };

    const handleCanPlay = () => {
      syncBackgroundVideoTime(audioRef.current?.currentTime ?? currentTime);
    };

    videoElement.addEventListener('loadedmetadata', handleLoadedMetadata);
    videoElement.addEventListener('canplay', handleCanPlay);

    return () => {
      videoElement.removeEventListener('loadedmetadata', handleLoadedMetadata);
      videoElement.removeEventListener('canplay', handleCanPlay);
    };
  }, [backgroundMedia.type, currentTime, syncBackgroundVideoTime]);

  const getTextContainerStyle = (stanza) => {
    const transitionDuration = clampTransitionDuration(stanza?.transitionDuration ?? 1);
    const transitionType = normalizeStanzaTransition(stanza?.transition);
    const isCurrentStanza = currentStanza?.id === stanza?.id;
    const isAnimated = isPlaying && isCurrentStanza;

    // Usar os mapas memoizados para evitar buscas lineares por frame
    const stanzaId = stanza?.id;
    const localEntry = stanzaId ? (timelineEntryByStanzaId.get(stanzaId) ?? null) : null;
    const nextVisibleEntry = stanzaId ? (nextVisibleEntryByStanzaId.get(stanzaId) ?? null) : null;

    // A transição de saída deve ser pulada se a próxima estrofe começa logo em seguida
    // (gap menor que a duração da transição), para evitar sobreposição visual entre
    // a saída da estrofe atual e a entrada da próxima.
    const hasNearbyNextStanza = Boolean(
      nextVisibleEntry
      && Number.isFinite(localEntry?.displayEnd)
      && Number.isFinite(nextVisibleEntry.displayStart)
      && (nextVisibleEntry.displayStart - localEntry.displayEnd) < transitionDuration
    );

    const isExitWindow = Boolean(
      isCurrentStanza
      && localEntry?.isVisible
      && !hasNearbyNextStanza
      && Number.isFinite(localEntry?.displayEnd)
      && currentTime >= Math.max(localEntry.displayStart, localEntry.displayEnd - transitionDuration)
      && currentTime < localEntry.displayEnd
    );

    let currentPhase = 'visible';

    if (isExitWindow) {
      currentPhase = 'exit';
    } else if (isAnimated) {
      currentPhase = transitionPhase;
    }

    return {
      width: '100%',
      maxWidth: '100%',
      opacity: currentPhase === 'visible' ? 1 : 0,
      transform: buildTransform(transitionType, currentPhase, stanza),
      transition: `opacity ${transitionDuration}s ease, transform ${transitionDuration}s ease`,
      willChange: 'opacity, transform',
    };
  };

  const getPreviewLineStyle = (lineStyle) => {
    const appliedFontSize = Math.max(12, Number(lineStyle?.fontSize) || 32);

    return {
      fontSize: `${appliedFontSize}px`,
      fontFamily: getPreviewFontFamily(lineStyle?.fontFamily),
      color: lineStyle?.color || '#FFFFFF',
      fontWeight: lineStyle?.bold ? 'bold' : 'normal',
      fontStyle: lineStyle?.italic ? 'italic' : 'normal',
      textDecoration: lineStyle?.underline ? 'underline' : 'none',
      textAlign: lineStyle?.alignment || 'center',
      width: '100%',
      maxWidth: '100%',
      overflowWrap: 'anywhere',
      wordBreak: 'break-word',
      textShadow: buildOutlineShadow(lineStyle?.outlineColor || '#000000', lineStyle?.outlineWidth ?? 2),
    };
  };

  const renderPreviewStanza = () => {
    if (!stanzaForPreview) return null;

    const lineEntries = resolveStanzaLineEntries(stanzaForPreview);

    return (
      <div className="lyrics-canvas-layer">
        <div className="preview-stanza-anchor">
          <div
            key={animatedStanzaKey || stanzaForPreview.id}
            className="lyrics-display lyrics-plain preview-stanza"
            style={getTextContainerStyle(stanzaForPreview)}
          >
            <div className="preview-stanza-content preview-stanza-lines">
              {lineEntries.map((lineEntry) => (
                <div
                  key={`${stanzaForPreview.id}-line-${lineEntry.index}`}
                  className="preview-stanza-line"
                  style={getPreviewLineStyle(lineEntry.style)}
                >
                  {lineEntry.text || '\u00A0'}
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    );
  };

  const canToggleAudio = Boolean(
    ((effectivePreviewAudioType === 'original' && mediaFiles?.musicaInstrumental)
      || (effectivePreviewAudioType === 'instrumental' && mediaFiles?.musicaOriginal))
  );

  const applySeekTime = useCallback((nextTime) => {
    const requestedTime = Math.max(0, Number(nextTime) || 0);
    const metadataDuration = audioRef.current?.duration;
    const resolvedDuration = Number.isFinite(metadataDuration) && metadataDuration > 0
      ? metadataDuration
      : duration;
    const maxTime = Number.isFinite(resolvedDuration) && resolvedDuration > 0
      ? resolvedDuration
      : requestedTime;
    const clampedTime = clamp(requestedTime, 0, maxTime);

    if (audioRef.current) {
      try {
        audioRef.current.currentTime = clampedTime;
      } catch (error) {
        console.warn('Não foi possível ajustar o preview imediatamente:', error);
      }
    }

    syncBackgroundVideoTime(clampedTime);
    pendingSeekTimeRef.current = clampedTime;
    onTimeUpdate(clampedTime);
    return clampedTime;
  }, [duration, onTimeUpdate, syncBackgroundVideoTime]);

  const togglePlay = useCallback(async () => {
    if (!audioRef.current || !audioSrc) return;

    try {
      if (isPlaying) {
        audioRef.current.pause();
        setIsPlaying(false);
        stopRaf();
      } else {
        await audioRef.current.play();
        setIsPlaying(true);
        startRaf();
      }
    } catch (error) {
      console.error('Erro ao tentar tocar áudio:', error);
    }
  }, [audioSrc, isPlaying, startRaf, stopRaf]);

  const toggleAudioTrack = useCallback(() => {
    if (!canToggleAudio) return;

    onAudioTypeChange(effectivePreviewAudioType === 'original' ? 'instrumental' : 'original');
  }, [canToggleAudio, effectivePreviewAudioType, onAudioTypeChange]);

  useImperativeHandle(ref, () => ({
    togglePlay: () => {
      void togglePlay();
    },
    seekBy: (delta = 0) => applySeekTime((audioRef.current?.currentTime ?? currentTime) + (Number(delta) || 0)),
    seekTo: (time = 0) => applySeekTime(time),
    toggleAudioTrack,
    focus: () => panelRef.current?.focus(),
  }), [applySeekTime, currentTime, toggleAudioTrack, togglePlay]);

  const handleSeek = (event) => {
    applySeekTime(Number(event.target.value));
  };

  const formatTime = (seconds) => formatFixedTimecode(seconds);

  return (
    <div className="preview-panel" ref={panelRef} tabIndex={0} data-shortcut-scope="preview">
      <div className="preview-panel-header">
        <h2>Preview</h2>
        <span className="preview-tip">
          Preview fixo no formato 16:9.
        </span>
      </div>

      <div className="preview-stage" ref={stageRef}>
        <div
          className="preview-video"
          style={{
            backgroundColor,
            width: `${previewBoxSize.width}px`,
            height: `${previewBoxSize.height}px`,
          }}
        >
          <div
            className="preview-video-canvas"
            style={{
              width: `${LOGICAL_PREVIEW_SIZE.width}px`,
              height: `${LOGICAL_PREVIEW_SIZE.height}px`,
              transform: `translate(-50%, -50%) scale(${previewScale})`,
            }}
          >
            {backgroundMedia.type !== 'color' ? (
              <div className="preview-media-layer" style={mediaAnimationStyle}>
                {backgroundMedia.type === 'video' ? (
                  <video
                    ref={backgroundVideoRef}
                    className="preview-media-element"
                    src={backgroundMedia.src}
                    muted
                    playsInline
                    preload="auto"
                    loop
                    crossOrigin="anonymous"
                  />
                ) : (
                  <img
                    className="preview-media-element"
                    src={backgroundMedia.src}
                    alt="Fundo do preview"
                    crossOrigin="anonymous"
                  />
                )}
              </div>
            ) : null}

            {renderPreviewStanza()}
          </div>
        </div>
      </div>

      <audio
        ref={audioRef}
        crossOrigin="anonymous"
        onTimeUpdate={(event) => {
          if (!rafRef.current) onTimeUpdate(event.target.currentTime);
          syncBackgroundVideoTime(event.target.currentTime);
        }}
        onLoadedMetadata={(event) => {
          const target = pendingSeekTimeRef.current;
          setDuration(event.target.duration);

          if (typeof target === 'number') {
            try {
              event.target.currentTime = target;
            } catch (error) {
              console.warn('Seek pendente falhou após metadata:', error);
            }
            onTimeUpdate(target);
            syncBackgroundVideoTime(target);
          }
        }}
        onEnded={() => {
          setIsPlaying(false);
          stopRaf();
        }}
        onError={() => console.error('Erro ao carregar áudio:', audioSrc)}
        onPlay={() => {
          setIsPlaying(true);
          startRaf();
        }}
        onPause={() => {
          setIsPlaying(false);
          stopRaf();
        }}
      />

      <div className="preview-controls">
        <button className="control-btn" onClick={togglePlay} disabled={!audioSrc} title="Atalho Espaço">
          {isPlaying ? <Pause size={20} /> : <Play size={20} />}
        </button>

        <span className="time-display">
          {formatTime(currentTime)} / {formatTime(duration)}
        </span>

        <input
          type="range"
          min="0"
          max={duration || 0}
          step="0.1"
          value={currentTime}
          onChange={handleSeek}
          className="progress-bar"
          title="Atalhos Ctrl + ← e Ctrl + →"
        />

        <button
          className="audio-switch-btn"
          onClick={toggleAudioTrack}
          disabled={!canToggleAudio}
          title="Atalho T"
        >
          <Music size={18} />
          {effectivePreviewAudioType === 'original' ? 'Original' : 'Playback'}
        </button>

        <input
          type="color"
          value={backgroundColor}
          onChange={(event) => onBackgroundColorChange(event.target.value)}
          title="Cor de fundo"
        />
      </div>
    </div>
  );
});

export default PreviewPanel;
