/**
 * fixedTimecode.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Conversão de segundos (float) para o formato MM:SS usado no Editor de Letras
 * da LenaVS (sem milissegundos), respeitando o mesmo teto do frontend
 * (99:59) e garantindo que o fim nunca fique igual/menor que o início.
 */

export const MAX_FIXED_TIMECODE_MINUTES = 99;
export const MAX_FIXED_TIMECODE_SECONDS = (MAX_FIXED_TIMECODE_MINUTES * 60) + 59;

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
const pad = (value) => String(value).padStart(2, '0');

/** Segundos -> "MM:SS" (segundos truncados, como no editor do projeto). */
export const secondsToFixedTimecode = (value) => {
  const numeric = Number(value);
  const safe = clamp(Number.isFinite(numeric) ? Math.floor(numeric) : 0, 0, MAX_FIXED_TIMECODE_SECONDS);
  const minutes = Math.floor(safe / 60);
  const seconds = safe % 60;

  return `${pad(minutes)}:${pad(seconds)}`;
};

/**
 * Monta os tempos finais de cada bloco a partir do resultado do alinhador.
 * Início = primeira palavra | Fim = última palavra.
 * Se o arredondamento para segundos zerar a duração do bloco, o fim recebe
 * +1s para que a estrofe continue visível no editor/preview.
 */
export const buildBlockTimecodes = (blocks = []) => {
  if (!Array.isArray(blocks)) return [];

  return blocks
    .map((block, position) => {
      const index = Number.isInteger(Number(block?.index)) ? Number(block.index) : position;
      const startSec = Number(block?.startSec);
      const endSec = Number(block?.endSec);

      if (!Number.isFinite(startSec) || !Number.isFinite(endSec)) {
        return null;
      }

      const safeStart = Math.max(0, Math.min(startSec, endSec));
      const safeEnd = Math.max(0, Math.max(startSec, endSec));

      const startTime = secondsToFixedTimecode(safeStart);
      const startSeconds = Math.floor(clamp(safeStart, 0, MAX_FIXED_TIMECODE_SECONDS));
      let endSeconds = Math.floor(clamp(safeEnd, 0, MAX_FIXED_TIMECODE_SECONDS));

      if (endSeconds <= startSeconds) {
        endSeconds = Math.min(startSeconds + 1, MAX_FIXED_TIMECODE_SECONDS);
      }

      return {
        index,
        startTime,
        endTime: secondsToFixedTimecode(endSeconds),
        startSec: Number(safeStart.toFixed(3)),
        endSec: Number(safeEnd.toFixed(3)),
        wordCount: Number(block?.wordCount) || 0,
        alignedWords: Number(block?.alignedWords) || 0,
        estimated: Boolean(block?.estimated),
      };
    })
    .filter(Boolean);
};

export default { secondsToFixedTimecode, buildBlockTimecodes, MAX_FIXED_TIMECODE_SECONDS };
