import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight, GripHorizontal, Pause, Play } from 'lucide-react';
import './MobileFloatingPreviewControls.css';

const STORAGE_KEY = 'lenavs-mobile-preview-controls-position-v1';
const CONTROL_WIDTH = 272;
const CONTROL_HEIGHT = 118;
const VIEWPORT_MARGIN = 16;

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

const getDefaultPosition = () => {
  if (typeof window === 'undefined') {
    return { x: VIEWPORT_MARGIN, y: VIEWPORT_MARGIN };
  }

  const maxX = Math.max(VIEWPORT_MARGIN, window.innerWidth - CONTROL_WIDTH - VIEWPORT_MARGIN);
  const maxY = Math.max(VIEWPORT_MARGIN, window.innerHeight - CONTROL_HEIGHT - VIEWPORT_MARGIN);

  return {
    x: maxX,
    y: maxY,
  };
};

const clampPositionToViewport = (position) => {
  if (typeof window === 'undefined') {
    return position;
  }

  const maxX = Math.max(VIEWPORT_MARGIN, window.innerWidth - CONTROL_WIDTH - VIEWPORT_MARGIN);
  const maxY = Math.max(VIEWPORT_MARGIN, window.innerHeight - CONTROL_HEIGHT - VIEWPORT_MARGIN);

  return {
    x: clamp(Number(position?.x) || 0, VIEWPORT_MARGIN, maxX),
    y: clamp(Number(position?.y) || 0, VIEWPORT_MARGIN, maxY),
  };
};

const MobileFloatingPreviewControls = ({
  visible = false,
  disabled = false,
  isPlaying = false,
  onTogglePlay = () => {},
  onSeekBy = () => {},
}) => {
  const [position, setPosition] = useState(() => getDefaultPosition());
  const dragStateRef = useRef(null);

  useEffect(() => {
    if (typeof window === 'undefined') return;

    try {
      const raw = window.localStorage.getItem(STORAGE_KEY);
      if (!raw) return;

      const parsed = JSON.parse(raw);
      setPosition(clampPositionToViewport(parsed));
    } catch (error) {
      console.warn('Não foi possível restaurar a posição dos controles flutuantes:', error);
    }
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined') return;

    const syncPosition = () => {
      setPosition((current) => clampPositionToViewport(current));
    };

    window.addEventListener('resize', syncPosition);
    window.addEventListener('orientationchange', syncPosition);

    return () => {
      window.removeEventListener('resize', syncPosition);
      window.removeEventListener('orientationchange', syncPosition);
    };
  }, []);

  useEffect(() => {
    if (!visible) return;

    setPosition((current) => {
      const hasUserPosition = Number.isFinite(current?.x) && Number.isFinite(current?.y);
      return hasUserPosition ? clampPositionToViewport(current) : getDefaultPosition();
    });
  }, [visible]);

  const persistPosition = useCallback((nextPosition) => {
    if (typeof window === 'undefined') return;

    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(nextPosition));
    } catch (error) {
      console.warn('Não foi possível salvar a posição dos controles flutuantes:', error);
    }
  }, []);

  const handleDragStart = useCallback((event) => {
    if (disabled) return;

    event.preventDefault();
    event.stopPropagation();

    const pointerEvent = event.nativeEvent;
    dragStateRef.current = {
      pointerId: pointerEvent.pointerId,
      startX: pointerEvent.clientX,
      startY: pointerEvent.clientY,
      originX: position.x,
      originY: position.y,
    };

    event.currentTarget.setPointerCapture?.(pointerEvent.pointerId);
  }, [disabled, position.x, position.y]);

  const handleDragMove = useCallback((event) => {
    const dragState = dragStateRef.current;
    if (!dragState || dragState.pointerId !== event.pointerId) return;

    event.preventDefault();

    const nextPosition = clampPositionToViewport({
      x: dragState.originX + (event.clientX - dragState.startX),
      y: dragState.originY + (event.clientY - dragState.startY),
    });

    setPosition(nextPosition);
  }, []);

  const handleDragEnd = useCallback((event) => {
    const dragState = dragStateRef.current;
    if (!dragState || dragState.pointerId !== event.pointerId) return;

    event.preventDefault();
    event.currentTarget.releasePointerCapture?.(event.pointerId);

    const finalPosition = clampPositionToViewport(position);
    dragStateRef.current = null;
    persistPosition(finalPosition);
  }, [persistPosition, position]);

  if (!visible) {
    return null;
  }

  return (
    <div
      className={`mobile-floating-preview-controls${disabled ? ' mobile-floating-preview-controls--disabled' : ''}`}
      style={{ left: `${position.x}px`, top: `${position.y}px` }}
      aria-label="Controles flutuantes do preview"
    >
      <button
        type="button"
        className="mobile-floating-preview-controls__drag"
        onPointerDown={handleDragStart}
        onPointerMove={handleDragMove}
        onPointerUp={handleDragEnd}
        onPointerCancel={handleDragEnd}
        aria-label="Mover controles flutuantes"
        title="Arraste para reposicionar"
      >
        <GripHorizontal size={18} />
        <span>Mover</span>
      </button>

      <div className="mobile-floating-preview-controls__buttons">
        <button
          type="button"
          className="mobile-floating-preview-controls__button"
          onClick={() => onSeekBy(-2)}
          disabled={disabled}
          aria-label="Voltar dois segundos"
          title="Voltar 2 segundos"
        >
          <ChevronLeft size={24} />
          <span>-2s</span>
        </button>

        <button
          type="button"
          className="mobile-floating-preview-controls__button mobile-floating-preview-controls__button--primary"
          onClick={onTogglePlay}
          disabled={disabled}
          aria-label={isPlaying ? 'Pausar preview' : 'Continuar preview'}
          title={isPlaying ? 'Pausar preview' : 'Continuar preview'}
        >
          {isPlaying ? <Pause size={24} /> : <Play size={24} />}
          <span>{isPlaying ? 'Pausar' : 'Continuar'}</span>
        </button>

        <button
          type="button"
          className="mobile-floating-preview-controls__button"
          onClick={() => onSeekBy(2)}
          disabled={disabled}
          aria-label="Avançar dois segundos"
          title="Avançar 2 segundos"
        >
          <ChevronRight size={24} />
          <span>+2s</span>
        </button>
      </div>
    </div>
  );
};

export default MobileFloatingPreviewControls;
