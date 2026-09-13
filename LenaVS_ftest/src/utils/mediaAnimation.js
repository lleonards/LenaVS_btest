export const MEDIA_TRANSITION_TYPES = ['fade', 'slide', 'zoom-in', 'zoom-out'];

export const MEDIA_ANIMATION_DURATION_MIN = 0.1;
export const MEDIA_ANIMATION_DURATION_MAX = 5;

export const DEFAULT_MEDIA_ANIMATION = {
  introTransition: 'fade',
  introDuration: 0.8,
  outroTransition: 'fade',
  outroDuration: 0.8,
  loopTransition: 'fade',
  loopTransitionDuration: 0.4,
};

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

export const normalizeMediaTransition = (value) => {
  const normalized = String(value || 'fade').trim().toLowerCase();
  return MEDIA_TRANSITION_TYPES.includes(normalized) ? normalized : 'fade';
};

export const clampMediaAnimationDuration = (value, fallback = 0.8) => {
  const numericValue = Number(value);

  if (!Number.isFinite(numericValue)) {
    return Number(clamp(fallback, MEDIA_ANIMATION_DURATION_MIN, MEDIA_ANIMATION_DURATION_MAX).toFixed(2));
  }

  return Number(
    clamp(numericValue, MEDIA_ANIMATION_DURATION_MIN, MEDIA_ANIMATION_DURATION_MAX).toFixed(2)
  );
};

export const normalizeMediaAnimation = (value = {}) => {
  const source = value && typeof value === 'object' && !Array.isArray(value)
    ? value
    : {};

  return {
    introTransition: normalizeMediaTransition(source.introTransition ?? DEFAULT_MEDIA_ANIMATION.introTransition),
    introDuration: clampMediaAnimationDuration(source.introDuration, DEFAULT_MEDIA_ANIMATION.introDuration),
    outroTransition: normalizeMediaTransition(source.outroTransition ?? DEFAULT_MEDIA_ANIMATION.outroTransition),
    outroDuration: clampMediaAnimationDuration(source.outroDuration, DEFAULT_MEDIA_ANIMATION.outroDuration),
    loopTransition: normalizeMediaTransition(source.loopTransition ?? DEFAULT_MEDIA_ANIMATION.loopTransition),
    loopTransitionDuration: clampMediaAnimationDuration(
      source.loopTransitionDuration,
      DEFAULT_MEDIA_ANIMATION.loopTransitionDuration
    ),
  };
};

export const getMediaTransitionVisual = (transition, phase, progress) => {
  const safeProgress = clamp(Number(progress) || 0, 0, 1);
  const isExitPhase = phase === 'exit';

  switch (normalizeMediaTransition(transition)) {
    case 'slide': {
      return {
        opacity: 1,
        translateY: isExitPhase ? 30 * safeProgress : 30 * (1 - safeProgress),
        scale: 1,
      };
    }
    case 'zoom-in': {
      return {
        opacity: 1,
        translateY: 0,
        scale: isExitPhase
          ? Number((1 - (0.18 * safeProgress)).toFixed(4))
          : Number((0.82 + (0.18 * safeProgress)).toFixed(4)),
      };
    }
    case 'zoom-out': {
      return {
        opacity: 1,
        translateY: 0,
        scale: isExitPhase
          ? Number((1 + (0.18 * safeProgress)).toFixed(4))
          : Number((1.18 - (0.18 * safeProgress)).toFixed(4)),
      };
    }
    case 'fade':
    default: {
      return {
        opacity: isExitPhase ? Number((1 - safeProgress).toFixed(4)) : Number(safeProgress.toFixed(4)),
        translateY: 0,
        scale: 1,
      };
    }
  }
};

export const getLoopPhaseState = ({ currentTime = 0, totalDuration = 0, mediaDuration = 0, config = DEFAULT_MEDIA_ANIMATION }) => {
  const safeTotalDuration = Number(totalDuration) || 0;
  const safeMediaDuration = Number(mediaDuration) || 0;

  if (!Number.isFinite(safeTotalDuration) || safeTotalDuration <= 0 || !Number.isFinite(safeMediaDuration) || safeMediaDuration <= 0) {
    return null;
  }

  if (safeMediaDuration >= safeTotalDuration) {
    return null;
  }

  const normalizedConfig = normalizeMediaAnimation(config);
  const safeLoopWindow = Math.min(
    clampMediaAnimationDuration(normalizedConfig.loopTransitionDuration, DEFAULT_MEDIA_ANIMATION.loopTransitionDuration),
    Math.max(MEDIA_ANIMATION_DURATION_MIN, safeMediaDuration * 0.45)
  );
  const halfWindow = safeLoopWindow / 2;

  if (halfWindow <= 0.05) {
    return null;
  }

  const safeCurrentTime = Math.max(0, Number(currentTime) || 0);
  const loopProgress = safeCurrentTime % safeMediaDuration;
  const loopIndex = Math.floor(safeCurrentTime / safeMediaDuration);

  if (loopProgress >= safeMediaDuration - halfWindow) {
    return {
      phase: 'exit',
      transition: normalizedConfig.loopTransition,
      progress: (loopProgress - (safeMediaDuration - halfWindow)) / halfWindow,
    };
  }

  if (loopIndex > 0 && loopProgress <= halfWindow) {
    return {
      phase: 'enter',
      transition: normalizedConfig.loopTransition,
      progress: loopProgress / halfWindow,
    };
  }

  return null;
};

export const getMediaAnimationPhase = ({ currentTime = 0, totalDuration = 0, mediaDuration = 0, config = DEFAULT_MEDIA_ANIMATION, isVideo = false }) => {
  const normalizedConfig = normalizeMediaAnimation(config);
  const safeCurrentTime = Math.max(0, Number(currentTime) || 0);
  const safeTotalDuration = Math.max(0, Number(totalDuration) || 0);

  if (safeTotalDuration > 0 && safeCurrentTime <= normalizedConfig.introDuration) {
    return {
      phase: 'enter',
      transition: normalizedConfig.introTransition,
      progress: safeCurrentTime / Math.max(normalizedConfig.introDuration, MEDIA_ANIMATION_DURATION_MIN),
    };
  }

  if (safeTotalDuration > 0 && safeCurrentTime >= Math.max(0, safeTotalDuration - normalizedConfig.outroDuration)) {
    const start = Math.max(0, safeTotalDuration - normalizedConfig.outroDuration);
    return {
      phase: 'exit',
      transition: normalizedConfig.outroTransition,
      progress: (safeCurrentTime - start) / Math.max(normalizedConfig.outroDuration, MEDIA_ANIMATION_DURATION_MIN),
    };
  }

  if (isVideo) {
    return getLoopPhaseState({
      currentTime: safeCurrentTime,
      totalDuration: safeTotalDuration,
      mediaDuration,
      config: normalizedConfig,
    });
  }

  return null;
};

export const getMediaAnimationStyle = ({ currentTime = 0, totalDuration = 0, mediaDuration = 0, config = DEFAULT_MEDIA_ANIMATION, isVideo = false }) => {
  const phaseState = getMediaAnimationPhase({ currentTime, totalDuration, mediaDuration, config, isVideo });

  if (!phaseState) {
    return {
      opacity: 1,
      transform: 'translate3d(0, 0, 0) scale(1)',
    };
  }

  const visual = getMediaTransitionVisual(phaseState.transition, phaseState.phase, phaseState.progress);

  return {
    opacity: visual.opacity,
    transform: `translate3d(0, ${visual.translateY}px, 0) scale(${visual.scale})`,
  };
};
