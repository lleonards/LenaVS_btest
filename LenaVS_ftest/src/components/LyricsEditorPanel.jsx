import React, { useEffect, useMemo, useRef, useState } from 'react';
import TimecodeInput from './TimecodeInput';
import {
  Plus,
  Trash2,
  Bold,
  Italic,
  Underline,
  AlignLeft,
  AlignCenter,
  AlignRight,
  Copy,
  ArrowUp,
  ArrowDown,
  ChevronUp,
  ChevronDown,
} from 'lucide-react';
import './LyricsEditorPanel.css';
import {
  DEFAULT_TIMECODE,
  formatFixedTimecode,
  normalizeFixedTimecode,
} from '../utils/timecode';
import {
  applyStyleToSelectedLines,
  clampTransitionDuration,
  createStanzaFromText,
  duplicateStanza,
  FONT_OPTIONS,
  getActiveStanzaAtTime,
  getMaxSafeFontSizeForStanza,
  hasDefinedStartTime,
  normalizeOutlineWidth,
  resolveStanzaLineEntries,
  splitStanzaTextIntoLines,
  STANZA_FONT_SIZE_MIN,
  STANZA_OUTLINE_WIDTH_MAX,
  STANZA_OUTLINE_WIDTH_MIN,
  STANZA_TRANSITION_DURATION_MAX,
  STANZA_TRANSITION_DURATION_MIN,
} from '../utils/stanza';

const LINE_MODE_ALLOWED_FIELDS = new Set([
  'color',
  'outlineColor',
  'outlineWidth',
  'fontFamily',
  'bold',
  'italic',
  'underline',
  'alignment',
]);

const clampFontSize = (value, maxAllowed) => {
  const parsed = Number(value);

  if (!Number.isFinite(parsed)) {
    return Math.min(32, maxAllowed);
  }

  return Math.min(maxAllowed, Math.max(STANZA_FONT_SIZE_MIN, Math.round(parsed)));
};

const preventArrowStepOnFontSize = (event) => {
  if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
    event.preventDefault();
    event.stopPropagation();
  }
};

const stopEventPropagation = (event) => {
  event.stopPropagation();
};

const sanitizeIntegerDraft = (value) => String(value ?? '').replace(/\D/g, '').slice(0, 3);

const sanitizeDecimalDraft = (value) => {
  const normalized = String(value ?? '').replace(',', '.').replace(/[^\d.]/g, '');
  const [integerPart = '', ...fractionParts] = normalized.split('.');
  const fraction = fractionParts.join('');

  return fractionParts.length > 0
    ? `${integerPart.slice(0, 2)}.${fraction.slice(0, 2)}`
    : integerPart.slice(0, 2);
};

const getSharedSelectionValue = (lineEntries, field, fallbackValue) => {
  if (!lineEntries.length) {
    return fallbackValue;
  }

  const firstValue = lineEntries[0]?.style?.[field];
  const allEqual = lineEntries.every((entry) => entry?.style?.[field] === firstValue);

  if (allEqual) {
    return firstValue;
  }

  return lineEntries[0]?.style?.[field] ?? fallbackValue;
};

const LyricsEditorPanel = ({
  stanzas,
  selectedStanzaId,
  onStanzasChange,
  currentTime,
  onTapSync,
  onStanzaSelect,
  previewMetrics,
  focusSelectedSignal = 0,
  isDesktopLayout = false,
}) => {
  const blockRefs = useRef({});
  const [fontSizeDrafts, setFontSizeDrafts] = useState({});
  const [activeFontSizeId, setActiveFontSizeId] = useState(null);
  const [transitionDrafts, setTransitionDrafts] = useState({});
  const [activeTransitionId, setActiveTransitionId] = useState(null);
  const [lineModeMap, setLineModeMap] = useState({});
  const [lineSelectionMap, setLineSelectionMap] = useState({});
  const lastTapPointerRef = useRef(null);

  useEffect(() => {
    if (!selectedStanzaId) return;

    const node = blockRefs.current[selectedStanzaId];
    if (node) {
      node.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
  }, [selectedStanzaId]);

  useEffect(() => {
    if (!selectedStanzaId || !focusSelectedSignal) return;

    const node = blockRefs.current[selectedStanzaId];
    if (node) {
      node.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      node.focus({ preventScroll: true });
    }
  }, [focusSelectedSignal, selectedStanzaId]);

  const activeStanzaId = useMemo(
    () => getActiveStanzaAtTime(stanzas, currentTime)?.id || null,
    [stanzas, currentTime]
  );

  const visualSelectedStanzaId = useMemo(
    () => selectedStanzaId || activeStanzaId || null,
    [activeStanzaId, selectedStanzaId]
  );

  const selectedIndex = useMemo(
    () => stanzas.findIndex((stanza) => stanza.id === visualSelectedStanzaId),
    [stanzas, visualSelectedStanzaId]
  );

  useEffect(() => {
    setFontSizeDrafts((prev) => {
      const next = {};

      stanzas.forEach((stanza) => {
        next[stanza.id] = stanza.id === activeFontSizeId && prev[stanza.id] !== undefined
          ? prev[stanza.id]
          : String(stanza.fontSize ?? '');
      });

      return next;
    });
  }, [activeFontSizeId, stanzas]);

  useEffect(() => {
    setTransitionDrafts((prev) => {
      const next = {};

      stanzas.forEach((stanza) => {
        const safeValue = clampTransitionDuration(stanza.transitionDuration);

        next[stanza.id] = stanza.id === activeTransitionId && prev[stanza.id] !== undefined
          ? prev[stanza.id]
          : String(safeValue);
      });

      return next;
    });
  }, [activeTransitionId, stanzas]);

  useEffect(() => {
    setLineModeMap((prev) => {
      const next = {};
      stanzas.forEach((stanza) => {
        if (prev[stanza.id]) {
          next[stanza.id] = true;
        }
      });
      return next;
    });

    setLineSelectionMap((prev) => {
      const next = {};

      stanzas.forEach((stanza) => {
        const lineCount = splitStanzaTextIntoLines(stanza.text || '').length;
        const currentSelection = Array.isArray(prev[stanza.id]) ? prev[stanza.id] : [];
        const filteredSelection = currentSelection.filter((index) => index >= 0 && index < lineCount);

        if (filteredSelection.length) {
          next[stanza.id] = filteredSelection;
        }
      });

      return next;
    });
  }, [stanzas]);

  const replaceStanza = (id, transform) => {
    onStanzasChange(
      stanzas.map((stanza) => {
        if (stanza.id !== id) {
          return stanza;
        }

        return transform(stanza);
      })
    );
  };

  const updateStanza = (id, field, value) => {
    replaceStanza(id, (stanza) => ({
      ...stanza,
      [field]: value,
    }));
  };

  const updateStanzaOrSelectedLines = (id, field, value) => {
    const selectedLineIndexes = lineSelectionMap[id] || [];
    const canApplyToLines = selectedLineIndexes.length > 0 && LINE_MODE_ALLOWED_FIELDS.has(field) && lineModeMap[id];

    if (canApplyToLines) {
      replaceStanza(id, (stanza) => applyStyleToSelectedLines(stanza, selectedLineIndexes, {
        [field]: value,
      }));
      return;
    }

    updateStanza(id, field, value);
  };

  const normalizeTimeDraft = (rawValue) => {
    const trimmedValue = String(rawValue ?? '').trim();
    if (!trimmedValue) {
      return '';
    }

    return normalizeFixedTimecode(trimmedValue, DEFAULT_TIMECODE);
  };

  const updateTimeField = (id, field, rawValue, markConfigured = false) => {
    const normalized = normalizeTimeDraft(rawValue);
    const flagField = field === 'startTime' ? 'hasManualStart' : 'hasManualEnd';

    onStanzasChange(
      stanzas.map((stanza) =>
        stanza.id === id
          ? {
              ...stanza,
              [field]: normalized,
              [flagField]: normalized === '' ? false : (markConfigured ? true : stanza[flagField]),
            }
          : stanza
      )
    );
  };

  const handleTimeInputChange = (id, field, rawValue) => {
    const normalized = normalizeTimeDraft(rawValue);
    const flagField = field === 'startTime' ? 'hasManualStart' : 'hasManualEnd';

    onStanzasChange(
      stanzas.map((stanza) =>
        stanza.id === id
          ? {
              ...stanza,
              [field]: normalized,
              [flagField]: normalized === '' ? false : stanza[flagField],
            }
          : stanza
      )
    );
  };

  const addStanza = () => {
    const newStanza = createStanzaFromText('Nova estrofe');
    onStanzasChange([...stanzas, newStanza]);
    onStanzaSelect?.(newStanza.id);
  };

  const removeStanza = (id) => {
    onStanzasChange(stanzas.filter((stanza) => stanza.id !== id));
    setLineModeMap((prev) => {
      const next = { ...prev };
      delete next[id];
      return next;
    });
    setLineSelectionMap((prev) => {
      const next = { ...prev };
      delete next[id];
      return next;
    });
  };

  const moveStanza = (id, direction) => {
    const index = stanzas.findIndex((stanza) => stanza.id === id);
    if (index === -1) return;

    const nextIndex = direction === 'up' ? index - 1 : index + 1;
    if (nextIndex < 0 || nextIndex >= stanzas.length) return;

    const reordered = [...stanzas];
    const [moved] = reordered.splice(index, 1);
    reordered.splice(nextIndex, 0, moved);

    onStanzasChange(reordered);
    onStanzaSelect?.(id);
  };

  const handleDuplicate = (id) => {
    const index = stanzas.findIndex((stanza) => stanza.id === id);
    if (index === -1) return;

    const cloned = duplicateStanza(stanzas[index]);
    const nextStanzas = [...stanzas];
    nextStanzas.splice(index + 1, 0, cloned);

    onStanzasChange(nextStanzas);
    onStanzaSelect?.(cloned.id);
  };

  const enterLineMode = (stanzaId) => {
    setLineModeMap((prev) => ({
      ...prev,
      [stanzaId]: true,
    }));
  };

  const applyLineMode = (stanzaId) => {
    setLineModeMap((prev) => {
      const next = { ...prev };
      delete next[stanzaId];
      return next;
    });

    setLineSelectionMap((prev) => {
      const next = { ...prev };
      delete next[stanzaId];
      return next;
    });
  };

  const toggleLineSelection = (stanzaId, lineIndex) => {
    if (!lineModeMap[stanzaId]) {
      return;
    }

    setLineSelectionMap((prev) => {
      const currentSelection = Array.isArray(prev[stanzaId]) ? prev[stanzaId] : [];
      const alreadySelected = currentSelection.includes(lineIndex);
      const nextSelection = alreadySelected
        ? currentSelection.filter((index) => index !== lineIndex)
        : [...currentSelection, lineIndex].sort((a, b) => a - b);

      return {
        ...prev,
        [stanzaId]: nextSelection,
      };
    });
  };

  const formatCurrentTime = (seconds) => formatFixedTimecode(seconds);

  const handleFontSizeDraftChange = (stanzaId, rawValue) => {
    setActiveFontSizeId(stanzaId);
    setFontSizeDrafts((prev) => ({
      ...prev,
      [stanzaId]: sanitizeIntegerDraft(rawValue),
    }));
  };

  const commitFontSizeDraft = (stanzaId, maxAllowed, fallbackValue) => {
    const rawDraft = fontSizeDrafts[stanzaId] ?? String(fallbackValue ?? '');
    const hasDraftValue = rawDraft.trim() !== '';
    const nextValue = hasDraftValue
      ? clampFontSize(rawDraft, maxAllowed)
      : clampFontSize(fallbackValue, maxAllowed);

    updateStanza(stanzaId, 'fontSize', nextValue);
    setFontSizeDrafts((prev) => ({
      ...prev,
      [stanzaId]: String(nextValue),
    }));
    setActiveFontSizeId((current) => (current === stanzaId ? null : current));
  };

  const handleTransitionDurationChange = (stanzaId, rawValue) => {
    setActiveTransitionId(stanzaId);
    setTransitionDrafts((prev) => ({
      ...prev,
      [stanzaId]: sanitizeDecimalDraft(rawValue),
    }));
  };

  const adjustFontSize = (stanzaId, direction, maxAllowed, fallbackValue) => {
    const baseValue = Number(fontSizeDrafts[stanzaId] ?? fallbackValue ?? 32);
    const nextValue = clampFontSize(baseValue + direction, maxAllowed);

    updateStanza(stanzaId, 'fontSize', nextValue);
    setFontSizeDrafts((prev) => ({
      ...prev,
      [stanzaId]: String(nextValue),
    }));
    setActiveFontSizeId((current) => (current === stanzaId ? null : current));
  };

  const commitTransitionDurationDraft = (stanzaId, fallbackValue) => {
    const rawDraft = transitionDrafts[stanzaId] ?? String(fallbackValue ?? '');
    const hasDraftValue = rawDraft.trim() !== '';
    const nextValue = hasDraftValue
      ? clampTransitionDuration(rawDraft)
      : clampTransitionDuration(fallbackValue);

    updateStanza(stanzaId, 'transitionDuration', nextValue);
    setTransitionDrafts((prev) => ({
      ...prev,
      [stanzaId]: String(nextValue),
    }));
    setActiveTransitionId((current) => (current === stanzaId ? null : current));
  };

  const handleOutlineWidthChange = (stanzaId, rawValue) => {
    updateStanzaOrSelectedLines(stanzaId, 'outlineWidth', normalizeOutlineWidth(rawValue));
  };

  const handleTapPointerDown = (event, stanzaId, field) => {
    event.preventDefault();
    event.stopPropagation();

    lastTapPointerRef.current = {
      stanzaId,
      field,
      timestamp: Date.now(),
    };

    onTapSync?.(stanzaId, field);
  };

  const handleTapClick = (event, stanzaId, field) => {
    event.preventDefault();
    event.stopPropagation();

    const lastTap = lastTapPointerRef.current;
    const isSameRecentTap = lastTap
      && lastTap.stanzaId === stanzaId
      && lastTap.field === field
      && (Date.now() - lastTap.timestamp) < 600;

    if (isSameRecentTap) {
      lastTapPointerRef.current = null;
      return;
    }

    onTapSync?.(stanzaId, field);
  };

  return (
    <div className="lyrics-editor-panel" data-shortcut-scope="editor">
      <div className="lep-header">
        <h2>Editor de Letras</h2>

        <div className="lep-header-right">
          <span className="lep-time-badge" title="Tempo atual do áudio">
            ⏱ {formatCurrentTime(currentTime)}
          </span>

          <button className="lep-add-btn" onClick={addStanza} title="Adicionar estrofe">
            <Plus size={16} />
          </button>
        </div>
      </div>

      <div className="lep-list">
        {stanzas.map((stanza, idx) => {
          const active = !selectedStanzaId && activeStanzaId === stanza.id;
          const playbackActive = activeStanzaId === stanza.id;
          const selected = stanza.id === visualSelectedStanzaId;
          const needsStartTime = !hasDefinedStartTime(stanza, { allowFirstBlockAtZero: idx === 0 });
          const maxFontSize = getMaxSafeFontSizeForStanza(stanza, previewMetrics);
          const safeTransitionDuration = clampTransitionDuration(stanza.transitionDuration);
          const safeOutlineWidth = normalizeOutlineWidth(stanza.outlineWidth);
          const lineModeActive = Boolean(lineModeMap[stanza.id]);
          const selectedLineIndexes = lineSelectionMap[stanza.id] || [];
          const selectedLineSet = new Set(selectedLineIndexes);
          const lineEntries = resolveStanzaLineEntries(stanza);
          const selectedLineEntries = lineEntries.filter((entry) => selectedLineSet.has(entry.index));
          const hasSelectedLines = lineModeActive && selectedLineEntries.length > 0;
          const restrictToLineControls = lineModeActive;
          const resolvedFontFamily = hasSelectedLines
            ? getSharedSelectionValue(selectedLineEntries, 'fontFamily', stanza.fontFamily)
            : stanza.fontFamily;
          const resolvedTextColor = hasSelectedLines
            ? getSharedSelectionValue(selectedLineEntries, 'color', stanza.color)
            : stanza.color;
          const resolvedOutlineColor = hasSelectedLines
            ? getSharedSelectionValue(selectedLineEntries, 'outlineColor', stanza.outlineColor)
            : stanza.outlineColor;
          const resolvedOutlineWidth = hasSelectedLines
            ? normalizeOutlineWidth(getSharedSelectionValue(selectedLineEntries, 'outlineWidth', stanza.outlineWidth))
            : safeOutlineWidth;
          const resolvedBold = hasSelectedLines
            ? Boolean(getSharedSelectionValue(selectedLineEntries, 'bold', stanza.bold))
            : stanza.bold;
          const resolvedItalic = hasSelectedLines
            ? Boolean(getSharedSelectionValue(selectedLineEntries, 'italic', stanza.italic))
            : stanza.italic;
          const resolvedUnderline = hasSelectedLines
            ? Boolean(getSharedSelectionValue(selectedLineEntries, 'underline', stanza.underline))
            : stanza.underline;
          const resolvedAlignment = hasSelectedLines
            ? getSharedSelectionValue(selectedLineEntries, 'alignment', stanza.alignment)
            : stanza.alignment;
          const lineControlsDisabled = lineModeActive && !hasSelectedLines;

          return (
            <div
              key={stanza.id}
              ref={(node) => {
                if (node) blockRefs.current[stanza.id] = node;
              }}
              className={`lep-block${active ? ' lep-block-active' : ''}${selected ? ' lep-block-selected' : ''}${lineModeActive ? ' lep-block-line-mode' : ''}`}
              tabIndex={0}
              onClick={() => onStanzaSelect?.(stanza.id)}
              onFocusCapture={() => {
                if (isDesktopLayout) {
                  onStanzaSelect?.(stanza.id);
                }
              }}
            >
              <div className="lep-block-header">
                <span className="lep-badge">{idx + 1}</span>
                <span className="lep-block-title">Estrofe</span>

                {stanza.isDuplicateCopy && <span className="lep-copy-pill">cópia</span>}
                {lineModeActive && <span className="lep-line-mode-pill">modo linha</span>}
                {selected && <span className="lep-selected-pill">SELECIONADA</span>}
                {playbackActive && <span className="lep-active-dot" title="Ativa agora">● ATIVA</span>}
              </div>

              <div className="lep-block-actions" onClick={(e) => e.stopPropagation()}>
                <button
                  className="lep-mini-btn"
                  onClick={() => moveStanza(stanza.id, 'up')}
                  disabled={idx === 0 || restrictToLineControls}
                  title="Mover para cima"
                >
                  <ArrowUp size={14} />
                </button>

                <button
                  className="lep-mini-btn"
                  onClick={() => moveStanza(stanza.id, 'down')}
                  disabled={idx === stanzas.length - 1 || restrictToLineControls}
                  title="Mover para baixo"
                >
                  <ArrowDown size={14} />
                </button>

                <button
                  className="lep-mini-btn"
                  onClick={() => handleDuplicate(stanza.id)}
                  disabled={restrictToLineControls}
                  title="Duplicar estrofe"
                >
                  <Copy size={14} />
                </button>

                <button
                  type="button"
                  className={`lep-mini-btn lep-mini-btn--line-mode${lineModeActive ? ' active' : ''}`}
                  onClick={() => {
                    if (!lineModeActive) {
                      enterLineMode(stanza.id);
                    }
                  }}
                  title={lineModeActive ? 'Modo Linha ativo' : 'Ativar o Modo Linha'}
                >
                  Modo Linha
                </button>

                {lineModeActive ? (
                  <button
                    type="button"
                    className="lep-mini-btn lep-mini-btn--line-apply"
                    onClick={() => applyLineMode(stanza.id)}
                    title="Salvar alterações do Modo Linha e sair"
                  >
                    Aplicar
                  </button>
                ) : null}
              </div>

              <textarea
                className={`lep-textarea${lineModeActive ? ' lep-textarea--line-mode' : ''}`}
                value={stanza.text}
                onClick={stopEventPropagation}
                onPointerDown={stopEventPropagation}
                onChange={(e) => updateStanza(stanza.id, 'text', e.target.value)}
                rows={4}
                disabled={lineModeActive}
              />

              {lineModeActive && (
                <div className="lep-line-mode-panel" onClick={stopEventPropagation} onPointerDown={stopEventPropagation}>
                  <div className="lep-line-mode-header">
                    <span className="lep-line-mode-title">Selecione as linhas para personalizar</span>
                    <span className="lep-line-mode-count">
                      {selectedLineEntries.length
                        ? `${selectedLineEntries.length} selecionada${selectedLineEntries.length > 1 ? 's' : ''}`
                        : 'nenhuma selecionada'}
                    </span>
                  </div>

                  <div className="lep-line-list">
                    {lineEntries.map((entry) => {
                      const isSelectedLine = selectedLineSet.has(entry.index);

                      return (
                        <button
                          key={`${stanza.id}-line-${entry.index}`}
                          type="button"
                          className={`lep-line-item${isSelectedLine ? ' active' : ''}`}
                          onClick={() => toggleLineSelection(stanza.id, entry.index)}
                          title={`Linha ${entry.index + 1}`}
                        >
                          <span className="lep-line-item-number">{entry.index + 1}</span>
                          <span className="lep-line-item-text">{entry.text || 'Linha vazia'}</span>
                        </button>
                      );
                    })}
                  </div>

                  <div className="lep-line-mode-hint">
                    Com o Modo Linha ativo, apenas cor, contorno, fonte, negrito, itálico, sublinhado e alinhamento podem ser alterados nas linhas selecionadas.
                  </div>
                </div>
              )}

              <div className="lep-time-row">
                <div className="lep-field lep-field-time">
                  <label className="lep-label">Início</label>
                  <div className="lep-time-input-group">
                    <TimecodeInput
                      className="lep-input lep-input--time"
                      value={stanza.startTime}
                      onChange={(nextValue) => handleTimeInputChange(stanza.id, 'startTime', nextValue)}
                      onCommit={(nextValue) => updateTimeField(stanza.id, 'startTime', nextValue, true)}
                      placeholder="MM:SS"
                      ariaLabel={`Início da estrofe ${idx + 1}`}
                      title="Edite normalmente em MM:SS"
                      disabled={restrictToLineControls}
                    />

                    <button
                      type="button"
                      className="lep-tap-btn"
                      onPointerDown={(event) => handleTapPointerDown(event, stanza.id, 'startTime')}
                      onClick={(event) => handleTapClick(event, stanza.id, 'startTime')}
                      data-tooltip="Marca o início no tempo atual • Atalho M"
                      aria-label="Marca o início no tempo atual • Atalho M"
                      disabled={restrictToLineControls}
                    >
                      <span className="lep-tap-icon" aria-hidden="true">
                        <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                          <circle cx="12" cy="12" r="7" stroke="currentColor" strokeWidth="2" />
                          <circle cx="12" cy="12" r="1.6" fill="currentColor" />
                          <line x1="12" y1="3" x2="12" y2="7" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                          <line x1="12" y1="17" x2="12" y2="21" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                          <line x1="3" y1="12" x2="7" y2="12" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                          <line x1="17" y1="12" x2="21" y2="12" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                        </svg>
                      </span>
                    </button>
                  </div>
                </div>

                <div className="lep-field lep-field-time">
                  <label className="lep-label">Fim</label>
                  <div className="lep-time-input-group">
                    <TimecodeInput
                      className="lep-input lep-input--time"
                      value={stanza.endTime}
                      onChange={(nextValue) => handleTimeInputChange(stanza.id, 'endTime', nextValue)}
                      onCommit={(nextValue) => updateTimeField(stanza.id, 'endTime', nextValue, true)}
                      placeholder="MM:SS"
                      ariaLabel={`Fim da estrofe ${idx + 1}`}
                      title="Edite normalmente em MM:SS"
                      disabled={restrictToLineControls}
                    />

                    <button
                      type="button"
                      className="lep-tap-btn"
                      onPointerDown={(event) => handleTapPointerDown(event, stanza.id, 'endTime')}
                      onClick={(event) => handleTapClick(event, stanza.id, 'endTime')}
                      data-tooltip="Marca o fim no tempo atual • Atalho N"
                      aria-label="Marca o fim no tempo atual • Atalho N"
                      disabled={restrictToLineControls}
                    >
                      <span className="lep-tap-icon" aria-hidden="true">
                        <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                          <circle cx="12" cy="12" r="7" stroke="currentColor" strokeWidth="2" />
                          <circle cx="12" cy="12" r="1.6" fill="currentColor" />
                          <line x1="12" y1="3" x2="12" y2="7" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                          <line x1="12" y1="17" x2="12" y2="21" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                          <line x1="3" y1="12" x2="7" y2="12" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                          <line x1="17" y1="12" x2="21" y2="12" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                        </svg>
                      </span>
                    </button>
                  </div>
                </div>

                <div className="lep-field lep-field-sm">
                  <label className="lep-label">Tam.</label>
                  {isDesktopLayout ? (
                    <div
                      className={`lep-font-stepper${restrictToLineControls ? ' lep-font-stepper--disabled' : ''}`}
                      onClick={stopEventPropagation}
                      onPointerDown={stopEventPropagation}
                    >
                      <span className="lep-font-stepper-value" title={`Máximo seguro para esta estrofe: ${maxFontSize}`}>
                        {fontSizeDrafts[stanza.id] ?? String(stanza.fontSize ?? '')}
                      </span>
                      <div className="lep-font-stepper-buttons">
                        <button
                          type="button"
                          className="lep-font-stepper-btn"
                          onClick={() => adjustFontSize(stanza.id, 1, maxFontSize, stanza.fontSize)}
                          aria-label={`Aumentar tamanho da fonte da estrofe ${idx + 1}`}
                          title="Aumentar tamanho"
                          disabled={restrictToLineControls}
                        >
                          <ChevronUp size={11} />
                        </button>
                        <button
                          type="button"
                          className="lep-font-stepper-btn"
                          onClick={() => adjustFontSize(stanza.id, -1, maxFontSize, stanza.fontSize)}
                          aria-label={`Diminuir tamanho da fonte da estrofe ${idx + 1}`}
                          title="Diminuir tamanho"
                          disabled={restrictToLineControls}
                        >
                          <ChevronDown size={11} />
                        </button>
                      </div>
                    </div>
                  ) : (
                    <input
                      className="lep-input lep-input-num"
                      type="text"
                      inputMode="numeric"
                      pattern="[0-9]*"
                      enterKeyHint="done"
                      value={fontSizeDrafts[stanza.id] ?? String(stanza.fontSize ?? '')}
                      onClick={stopEventPropagation}
                      onPointerDown={stopEventPropagation}
                      onFocus={() => setActiveFontSizeId(stanza.id)}
                      onChange={(e) => handleFontSizeDraftChange(stanza.id, e.target.value)}
                      onBlur={() => commitFontSizeDraft(stanza.id, maxFontSize, stanza.fontSize)}
                      onKeyDown={(event) => {
                        preventArrowStepOnFontSize(event);

                        if (event.key === 'Enter') {
                          event.preventDefault();
                          commitFontSizeDraft(stanza.id, maxFontSize, stanza.fontSize);
                        }
                      }}
                      title={`Máximo seguro para esta estrofe: ${maxFontSize}`}
                      aria-label={`Tamanho da fonte da estrofe ${idx + 1}`}
                      disabled={restrictToLineControls}
                    />
                  )}
                </div>
              </div>

              <div className="lep-size-limit-info">
                Máximo seguro desta estrofe: <strong>{maxFontSize}px</strong>
              </div>

              {needsStartTime && (
                <div className="lep-timing-warning">
                  Defina o início desta estrofe para o preview abrir nela automaticamente.
                </div>
              )}

              <div className="lep-font-row">
                <div className="lep-field lep-field-grow">
                  <label className="lep-label">Fonte</label>
                  <select
                    className="lep-select"
                    value={resolvedFontFamily}
                    onClick={stopEventPropagation}
                    onPointerDown={stopEventPropagation}
                    onChange={(e) => updateStanzaOrSelectedLines(stanza.id, 'fontFamily', e.target.value)}
                    disabled={lineControlsDisabled}
                  >
                    {FONT_OPTIONS.map((font) => (
                      <option key={font.value} value={font.value}>
                        {font.label}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="lep-style-row">
                <div className="lep-color-wrap" title="Cor da letra">
                  <label className="lep-label lep-label-center">Texto</label>
                  <div className="lep-color-swatch" style={{ backgroundColor: resolvedTextColor }}>
                    <input
                      type="color"
                      value={resolvedTextColor}
                      onClick={stopEventPropagation}
                      onPointerDown={stopEventPropagation}
                      onChange={(e) => updateStanzaOrSelectedLines(stanza.id, 'color', e.target.value)}
                      disabled={lineControlsDisabled}
                    />
                  </div>
                </div>

                <div className="lep-color-wrap" title="Cor do contorno">
                  <label className="lep-label lep-label-center">Borda</label>
                  <div className="lep-color-swatch lep-color-swatch-outline" style={{ backgroundColor: resolvedOutlineColor }}>
                    <input
                      type="color"
                      value={resolvedOutlineColor}
                      onClick={stopEventPropagation}
                      onPointerDown={stopEventPropagation}
                      onChange={(e) => updateStanzaOrSelectedLines(stanza.id, 'outlineColor', e.target.value)}
                      disabled={lineControlsDisabled}
                    />
                  </div>
                </div>

                <div className="lep-style-sep" />

                <button
                  className={`lep-style-btn${resolvedBold ? ' active' : ''}`}
                  onClick={() => updateStanzaOrSelectedLines(stanza.id, 'bold', !resolvedBold)}
                  title="Negrito"
                  disabled={lineControlsDisabled}
                >
                  <Bold size={14} />
                </button>

                <button
                  className={`lep-style-btn${resolvedItalic ? ' active' : ''}`}
                  onClick={() => updateStanzaOrSelectedLines(stanza.id, 'italic', !resolvedItalic)}
                  title="Itálico"
                  disabled={lineControlsDisabled}
                >
                  <Italic size={14} />
                </button>

                <button
                  className={`lep-style-btn${resolvedUnderline ? ' active' : ''}`}
                  onClick={() => updateStanzaOrSelectedLines(stanza.id, 'underline', !resolvedUnderline)}
                  title="Sublinhado"
                  disabled={lineControlsDisabled}
                >
                  <Underline size={14} />
                </button>
              </div>

              <div className="lep-adjustments-grid">
                <div className="lep-adjust-card lep-adjust-card--minimal">
                  <div className="lep-adjust-card__head">
                    <span className="lep-adjust-card__title">Contorno</span>
                    <span className="lep-adjust-card__value lep-adjust-card__value--pill">{resolvedOutlineWidth}px</span>
                  </div>

                  <div className="lep-adjust-card__slider-wrap">
                    <span className="lep-adjust-card__edge">fino</span>
                    <input
                      className="lep-slider lep-slider--minimal"
                      type="range"
                      min={STANZA_OUTLINE_WIDTH_MIN}
                      max={STANZA_OUTLINE_WIDTH_MAX}
                      step="1"
                      value={resolvedOutlineWidth}
                      onClick={stopEventPropagation}
                      onPointerDown={stopEventPropagation}
                      onChange={(e) => handleOutlineWidthChange(stanza.id, e.target.value)}
                      title={`Espessura do contorno entre ${STANZA_OUTLINE_WIDTH_MIN} e ${STANZA_OUTLINE_WIDTH_MAX}`}
                      disabled={lineControlsDisabled}
                    />
                    <span className="lep-adjust-card__edge">forte</span>
                  </div>
                </div>
              </div>

              <div className="lep-align-row">
                <button
                  className={`lep-align-btn${resolvedAlignment === 'left' ? ' active' : ''}`}
                  onClick={() => updateStanzaOrSelectedLines(stanza.id, 'alignment', 'left')}
                  disabled={lineControlsDisabled}
                >
                  <AlignLeft size={14} />
                </button>
                <button
                  className={`lep-align-btn${resolvedAlignment === 'center' ? ' active' : ''}`}
                  onClick={() => updateStanzaOrSelectedLines(stanza.id, 'alignment', 'center')}
                  disabled={lineControlsDisabled}
                >
                  <AlignCenter size={14} />
                </button>
                <button
                  className={`lep-align-btn${resolvedAlignment === 'right' ? ' active' : ''}`}
                  onClick={() => updateStanzaOrSelectedLines(stanza.id, 'alignment', 'right')}
                  disabled={lineControlsDisabled}
                >
                  <AlignRight size={14} />
                </button>
              </div>

              <div className="lep-transition-panel">
                <div className="lep-transition-panel-head">
                  <span className="lep-transition-title">Transição</span>
                  <span className="lep-transition-duration-badge">{safeTransitionDuration.toFixed(1)}s</span>
                </div>

                <div className="lep-transition-row">
                  <div className="lep-transition-control lep-transition-control-type">
                    <span className="lep-transition-field-label">Efeito</span>
                    <select
                      className="lep-select lep-select-transition"
                      value={stanza.transition}
                      onClick={stopEventPropagation}
                      onPointerDown={stopEventPropagation}
                      onChange={(e) => updateStanza(stanza.id, 'transition', e.target.value)}
                      disabled={restrictToLineControls}
                    >
                      <option value="fade">Fade</option>
                      <option value="slide">Slide</option>
                      <option value="zoom-in">Zoom In</option>
                      <option value="zoom-out">Zoom Out</option>
                    </select>
                  </div>

                  <div className="lep-transition-control lep-transition-control-duration">
                    <span className="lep-transition-field-label">Duração</span>
                    <div className="lep-transition-duration-wrap">
                      <input
                        className="lep-input lep-input-num lep-transition-input"
                        type="text"
                        inputMode="decimal"
                        enterKeyHint="done"
                        value={transitionDrafts[stanza.id] ?? String(safeTransitionDuration)}
                        onClick={stopEventPropagation}
                        onPointerDown={stopEventPropagation}
                        onFocus={() => setActiveTransitionId(stanza.id)}
                        onChange={(e) => handleTransitionDurationChange(stanza.id, e.target.value)}
                        onBlur={() => commitTransitionDurationDraft(stanza.id, safeTransitionDuration)}
                        onKeyDown={(event) => {
                          if (event.key === 'Enter') {
                            event.preventDefault();
                            commitTransitionDurationDraft(stanza.id, safeTransitionDuration);
                          }
                        }}
                        title={`Duração máxima permitida: ${STANZA_TRANSITION_DURATION_MAX}s`}
                        aria-label={`Duração da transição da estrofe ${idx + 1}`}
                        disabled={restrictToLineControls}
                      />
                      <span className="lep-transition-unit">s</span>
                    </div>
                  </div>

                  <div className="lep-transition-control lep-transition-control-slider">
                    <span className="lep-transition-field-label">Ajuste fino</span>
                    <input
                      className="lep-slider"
                      type="range"
                      min={STANZA_TRANSITION_DURATION_MIN}
                      max={STANZA_TRANSITION_DURATION_MAX}
                      step="0.1"
                      value={safeTransitionDuration}
                      onClick={stopEventPropagation}
                      onPointerDown={stopEventPropagation}
                      onChange={(e) => {
                        const nextValue = clampTransitionDuration(e.target.value);
                        updateStanza(stanza.id, 'transitionDuration', nextValue);
                        setTransitionDrafts((prev) => ({
                          ...prev,
                          [stanza.id]: String(nextValue),
                        }));
                      }}
                      title={`Duração da transição: ${safeTransitionDuration}s`}
                      disabled={restrictToLineControls}
                    />
                  </div>
                </div>
              </div>

              <button
                className="lep-remove-btn"
                onClick={(e) => {
                  e.stopPropagation();
                  removeStanza(stanza.id);
                }}
                title="Remover esta estrofe"
                disabled={restrictToLineControls}
              >
                <Trash2 size={14} />
                remover
              </button>
            </div>
          );
        })}

        {stanzas.length === 0 && (
          <div className="lep-empty">
            <p>Nenhuma estrofe ainda.</p>
            <p>Use o botão <strong>+</strong> para adicionar.</p>
          </div>
        )}
      </div>

      {selectedIndex >= 0 && (
        <div className="lep-selection-footer">
          Bloco selecionado: <strong>{selectedIndex + 1}</strong>
        </div>
      )}
    </div>
  );
};

export default LyricsEditorPanel;
