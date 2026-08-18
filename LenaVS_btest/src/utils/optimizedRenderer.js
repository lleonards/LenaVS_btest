import ffmpeg from 'fluent-ffmpeg';
import { getResolutionDimensions, normalizeOutputFormat } from './videoProcessor.js';
import { DEFAULT_MEDIA_ANIMATION, normalizeMediaAnimation } from './stanzaNormalizer.js';

const sanitizeHexColor = (value, fallback = '#000000') => {
  const raw = String(value || '').trim();
  const match = raw.match(/^#?([0-9a-f]{6})$/i);
  return match ? `#${match[1].toUpperCase()}` : fallback;
};

const normalizeNumber = (value, fallback = 0) => {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
};

const formatExprNumber = (value) => Number(value || 0).toFixed(3);

const escapeAssFilterPath = (filePath) => {
  return String(filePath || '')
    .replace(/\\/g, '/')
    .replace(/:/g, '\\:')
    .replace(/'/g, "\\'");
};

const getVideoCodecOptionsByFormat = (format = 'mp4') => {
  const normalized = normalizeOutputFormat(format);

  if (normalized === 'avi') {
    return [
      '-c:v mpeg4',
      '-q:v 4',
      '-pix_fmt yuv420p',
      '-c:a libmp3lame',
      '-b:a 192k',
      '-shortest',
      '-max_muxing_queue_size 2048',
    ];
  }

  const preset = String(process.env.VIDEO_X264_PRESET || 'veryfast').trim() || 'veryfast';
  const crf = String(process.env.VIDEO_X264_CRF || '20').trim() || '20';

  const baseOptions = [
    '-c:v libx264',
    `-preset ${preset}`,
    `-crf ${crf}`,
    '-pix_fmt yuv420p',
    '-r 30',
    '-c:a aac',
    '-b:a 192k',
    '-shortest',
    '-max_muxing_queue_size 2048',
  ];

  if (normalized === 'mp4' || normalized === 'mov') {
    return [...baseOptions, '-movflags +faststart'];
  }

  return baseOptions;
};

const buildVideoBackgroundFilter = ({ width, height }) => {
  return `scale=${width}:${height}:force_original_aspect_ratio=decrease,pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2,setsar=1`;
};

const buildImageBackgroundFilter = ({ width, height }) => {
  return `scale=${width}:${height}:force_original_aspect_ratio=increase,crop=${width}:${height},setsar=1`;
};

const buildBackgroundOverlayStage = ({
  sourceLabel,
  width,
  height,
  totalDuration,
  mediaDuration,
  mediaAnimation,
  canvasLabel = '[canvas]',
}) => {
  const fadeFilters = buildFadeFilters({
    totalDuration,
    mediaDuration,
    config: mediaAnimation,
  });
  const transformExpressions = buildMediaTransformExpressions({
    totalDuration,
    mediaDuration,
    config: mediaAnimation,
    slideOffsetPx: Math.max(24, Math.round(height * 0.04)),
  });

  const backgroundChain = [
    `${sourceLabel},fps=30`,
    'setpts=PTS-STARTPTS',
    `trim=duration=${formatExprNumber(totalDuration)}`,
    ...fadeFilters,
    `scale=w='${width}*(${transformExpressions.scaleExpr})':h='${height}*(${transformExpressions.scaleExpr})':eval=frame`,
    'setsar=1[bgfx]',
  ].join(',');

  const overlayChain = `${canvasLabel}[bgfx]overlay=x='(W-w)/2':y='(H-h)/2+(${transformExpressions.yExpr})':eval=frame:shortest=1:eof_action=repeat[bgcomposed]`;

  return [backgroundChain, overlayChain];
};

const buildNestedExpression = (conditions = [], fallback = '1') => {
  let expression = fallback;

  for (let index = conditions.length - 1; index >= 0; index -= 1) {
    const condition = conditions[index];
    expression = `if(${condition.when}\\,${condition.value}\\,${expression})`;
  }

  return expression;
};

const buildScaleValue = (transition, phase, progressExpr) => {
  switch (String(transition || '').toLowerCase()) {
    case 'zoom-in':
      return phase === 'exit'
        ? `(1-(0.18*(${progressExpr})))`
        : `(0.82+(0.18*(${progressExpr})))`;
    case 'zoom-out':
      return phase === 'exit'
        ? `(1+(0.18*(${progressExpr})))`
        : `(1.18-(0.18*(${progressExpr})))`;
    default:
      return null;
  }
};

const buildYOffsetValue = (transition, phase, progressExpr, offsetPx) => {
  if (String(transition || '').toLowerCase() !== 'slide') {
    return null;
  }

  return phase === 'exit'
    ? `(${formatExprNumber(offsetPx)}*(${progressExpr}))`
    : `(${formatExprNumber(offsetPx)}*(1-(${progressExpr})))`;
};

const buildMediaTransformExpressions = ({
  totalDuration,
  mediaDuration,
  config,
  slideOffsetPx,
}) => {
  const scaleConditions = [];
  const yConditions = [];
  const safeTotalDuration = Math.max(0.1, normalizeNumber(totalDuration, 0.1));
  const safeMediaDuration = Math.max(0, normalizeNumber(mediaDuration, 0));
  const normalizedConfig = normalizeMediaAnimation(config || DEFAULT_MEDIA_ANIMATION);
  const introDuration = Math.max(0.1, normalizeNumber(normalizedConfig.introDuration, DEFAULT_MEDIA_ANIMATION.introDuration));
  const outroDuration = Math.max(0.1, normalizeNumber(normalizedConfig.outroDuration, DEFAULT_MEDIA_ANIMATION.outroDuration));
  const outroStart = Math.max(0, safeTotalDuration - outroDuration);

  const introProgress = `(t/${formatExprNumber(introDuration)})`;
  const introScale = buildScaleValue(normalizedConfig.introTransition, 'enter', introProgress);
  const introYOffset = buildYOffsetValue(normalizedConfig.introTransition, 'enter', introProgress, slideOffsetPx);

  if (introScale) {
    scaleConditions.push({
      when: `lt(t\\,${formatExprNumber(introDuration)})`,
      value: introScale,
    });
  }

  if (introYOffset) {
    yConditions.push({
      when: `lt(t\\,${formatExprNumber(introDuration)})`,
      value: introYOffset,
    });
  }

  const outroProgress = `((t-${formatExprNumber(outroStart)})/${formatExprNumber(outroDuration)})`;
  const outroScale = buildScaleValue(normalizedConfig.outroTransition, 'exit', outroProgress);
  const outroYOffset = buildYOffsetValue(normalizedConfig.outroTransition, 'exit', outroProgress, slideOffsetPx);

  if (outroScale) {
    scaleConditions.push({
      when: `gte(t\\,${formatExprNumber(outroStart)})`,
      value: outroScale,
    });
  }

  if (outroYOffset) {
    yConditions.push({
      when: `gte(t\\,${formatExprNumber(outroStart)})`,
      value: outroYOffset,
    });
  }

  if (safeMediaDuration > 0 && safeMediaDuration < safeTotalDuration) {
    const rawLoopDuration = Math.max(0.1, normalizeNumber(
      normalizedConfig.loopTransitionDuration,
      DEFAULT_MEDIA_ANIMATION.loopTransitionDuration
    ));
    const halfLoopDuration = Math.min(rawLoopDuration / 2, safeMediaDuration * 0.45);

    if (halfLoopDuration > 0.05) {
      const loopIntroCutoff = Math.max(introDuration, safeMediaDuration);
      const loopOutroCutoff = Math.max(0, safeTotalDuration - outroDuration);
      const modExpr = `mod(t\\,${formatExprNumber(safeMediaDuration)})`;
      const loopExitProgress = `((${modExpr}-${formatExprNumber(safeMediaDuration - halfLoopDuration)})/${formatExprNumber(halfLoopDuration)})`;
      const loopEnterProgress = `(${modExpr}/${formatExprNumber(halfLoopDuration)})`;
      const loopExitCondition = `gte(${modExpr}\\,${formatExprNumber(safeMediaDuration - halfLoopDuration)})*gte(t\\,${formatExprNumber(loopIntroCutoff)})*lt(t\\,${formatExprNumber(loopOutroCutoff)})`;
      const loopEnterCondition = `lte(${modExpr}\\,${formatExprNumber(halfLoopDuration)})*gte(t\\,${formatExprNumber(loopIntroCutoff)})*lt(t\\,${formatExprNumber(loopOutroCutoff)})`;
      const loopExitScale = buildScaleValue(normalizedConfig.loopTransition, 'exit', loopExitProgress);
      const loopEnterScale = buildScaleValue(normalizedConfig.loopTransition, 'enter', loopEnterProgress);
      const loopExitYOffset = buildYOffsetValue(normalizedConfig.loopTransition, 'exit', loopExitProgress, slideOffsetPx);
      const loopEnterYOffset = buildYOffsetValue(normalizedConfig.loopTransition, 'enter', loopEnterProgress, slideOffsetPx);

      if (loopExitScale) {
        scaleConditions.push({
          when: loopExitCondition,
          value: loopExitScale,
        });
      }

      if (loopEnterScale) {
        scaleConditions.push({
          when: loopEnterCondition,
          value: loopEnterScale,
        });
      }

      if (loopExitYOffset) {
        yConditions.push({
          when: loopExitCondition,
          value: loopExitYOffset,
        });
      }

      if (loopEnterYOffset) {
        yConditions.push({
          when: loopEnterCondition,
          value: loopEnterYOffset,
        });
      }
    }
  }

  return {
    scaleExpr: buildNestedExpression(scaleConditions, '1'),
    yExpr: buildNestedExpression(yConditions, '0'),
  };
};

const buildFadeFilters = ({ totalDuration, mediaDuration, config }) => {
  const normalizedConfig = normalizeMediaAnimation(config || DEFAULT_MEDIA_ANIMATION);
  const safeTotalDuration = Math.max(0.1, normalizeNumber(totalDuration, 0.1));
  const safeMediaDuration = Math.max(0, normalizeNumber(mediaDuration, 0));
  const filters = ['format=rgba'];

  if (normalizedConfig.introTransition === 'fade') {
    filters.push(`fade=t=in:st=0:d=${formatExprNumber(normalizedConfig.introDuration)}:alpha=1`);
  }

  if (normalizedConfig.outroTransition === 'fade') {
    const start = Math.max(0, safeTotalDuration - normalizedConfig.outroDuration);
    filters.push(`fade=t=out:st=${formatExprNumber(start)}:d=${formatExprNumber(normalizedConfig.outroDuration)}:alpha=1`);
  }

  if (normalizedConfig.loopTransition === 'fade' && safeMediaDuration > 0 && safeMediaDuration < safeTotalDuration) {
    const halfLoopDuration = Math.min(normalizedConfig.loopTransitionDuration / 2, safeMediaDuration * 0.45);

    if (halfLoopDuration > 0.05) {
      const outroStart = Math.max(0, safeTotalDuration - normalizedConfig.outroDuration);

      for (
        let boundary = safeMediaDuration;
        boundary + halfLoopDuration < outroStart;
        boundary += safeMediaDuration
      ) {
        if (boundary <= normalizedConfig.introDuration + 0.05) continue;

        const fadeOutStart = Math.max(0, boundary - halfLoopDuration);
        filters.push(`fade=t=out:st=${formatExprNumber(fadeOutStart)}:d=${formatExprNumber(halfLoopDuration)}:alpha=1`);
        filters.push(`fade=t=in:st=${formatExprNumber(boundary)}:d=${formatExprNumber(halfLoopDuration)}:alpha=1`);
      }
    }
  }

  return filters;
};

export const generateOptimizedFinalVideo = async ({
  backgroundType = 'color',
  backgroundPath = null,
  backgroundColor = '#000000',
  audioPath,
  audioDuration,
  outputPath,
  subtitlesPath = null,
  format = 'mp4',
  resolution = '720p',
  mediaAnimation = DEFAULT_MEDIA_ANIMATION,
  backgroundMediaDuration = 0,
}) => {
  const { width, height } = getResolutionDimensions(resolution);
  const normalizedFormat = normalizeOutputFormat(format);
  const safeDuration = Math.max(0.1, Number(audioDuration) || 0.1);
  const normalizedMediaAnimation = normalizeMediaAnimation(mediaAnimation || DEFAULT_MEDIA_ANIMATION);

  return new Promise((resolve, reject) => {
    const command = ffmpeg();

    if (backgroundType === 'video' && backgroundPath) {
      command
        .input(backgroundPath)
        .inputOptions(['-fflags +genpts']);
      command.input(audioPath);

      const safeColor = sanitizeHexColor(backgroundColor, '#000000');
      const complexFilters = [
        `color=c=${safeColor}:s=${width}x${height}:r=30:d=${formatExprNumber(safeDuration)}[canvas]`,
        ...buildBackgroundOverlayStage({
          sourceLabel: `[0:v]${buildVideoBackgroundFilter({ width, height })},format=rgba`,
          width,
          height,
          totalDuration: safeDuration,
          mediaDuration: backgroundMediaDuration,
          mediaAnimation: normalizedMediaAnimation,
          canvasLabel: '[canvas]',
        }),
      ];

      const finalVideoLabel = subtitlesPath ? '[vout]' : '[bgcomposed]';
      if (subtitlesPath) {
        complexFilters.push(`[bgcomposed]ass='${escapeAssFilterPath(subtitlesPath)}'[vout]`);
      }

      command
        .complexFilter(complexFilters)
        .outputOptions([
          `-map ${finalVideoLabel}`,
          '-map 1:a:0',
          `-t ${safeDuration}`,
          ...getVideoCodecOptionsByFormat(normalizedFormat),
        ])
        .output(outputPath)
        .on('end', () => resolve(outputPath))
        .on('error', (error) => reject(new Error(`Erro ao gerar vídeo final: ${error.message}`)));

      command.run();
      return;
    }

    if (backgroundType === 'image' && backgroundPath) {
      command
        .input(backgroundPath)
        .inputOptions(['-loop 1', '-framerate 30']);
      command.input(audioPath);

      const safeColor = sanitizeHexColor(backgroundColor, '#000000');
      const complexFilters = [
        `color=c=${safeColor}:s=${width}x${height}:r=30:d=${formatExprNumber(safeDuration)}[canvas]`,
        ...buildBackgroundOverlayStage({
          sourceLabel: `[0:v]${buildImageBackgroundFilter({ width, height })},format=rgba`,
          width,
          height,
          totalDuration: safeDuration,
          mediaDuration: 0,
          mediaAnimation: normalizedMediaAnimation,
          canvasLabel: '[canvas]',
        }),
      ];

      const finalVideoLabel = subtitlesPath ? '[vout]' : '[bgcomposed]';
      if (subtitlesPath) {
        complexFilters.push(`[bgcomposed]ass='${escapeAssFilterPath(subtitlesPath)}'[vout]`);
      }

      command
        .complexFilter(complexFilters)
        .outputOptions([
          `-map ${finalVideoLabel}`,
          '-map 1:a:0',
          `-t ${safeDuration}`,
          ...getVideoCodecOptionsByFormat(normalizedFormat),
        ])
        .output(outputPath)
        .on('end', () => resolve(outputPath))
        .on('error', (error) => reject(new Error(`Erro ao gerar vídeo final: ${error.message}`)));

      command.run();
      return;
    }

    const safeColor = sanitizeHexColor(backgroundColor, '#000000');
    command.input(audioPath);

    const complexFilters = [
      `color=c=${safeColor}:s=${width}x${height}:r=30:d=${formatExprNumber(safeDuration)},setsar=1[bgcolor]`,
    ];

    const finalVideoLabel = subtitlesPath ? '[vout]' : '[bgcolor]';
    if (subtitlesPath) {
      complexFilters.push(`[bgcolor]ass='${escapeAssFilterPath(subtitlesPath)}'[vout]`);
    }

    command
      .complexFilter(complexFilters)
      .outputOptions([
        `-map ${finalVideoLabel}`,
        '-map 0:a:0',
        `-t ${safeDuration}`,
        ...getVideoCodecOptionsByFormat(normalizedFormat),
      ])
      .output(outputPath)
      .on('end', () => resolve(outputPath))
      .on('error', (error) => reject(new Error(`Erro ao gerar vídeo final: ${error.message}`)));

    command.run();
  });
};
