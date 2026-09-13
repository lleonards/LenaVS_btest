import React, { useCallback, useLayoutEffect, useMemo, useRef } from 'react';
import { DEFAULT_TIMECODE, normalizeFixedTimecode } from '../utils/timecode';

const EDITABLE_POSITIONS = [0, 1, 3, 4];
const CARET_BY_DIGIT_INDEX = [0, 1, 3, 4, 5];

const NON_TEXT_INPUT_TYPES = new Set([
  'button',
  'checkbox',
  'color',
  'file',
  'hidden',
  'image',
  'radio',
  'range',
  'reset',
  'submit',
]);

const countEditableBeforeCaret = (caretPosition = 0) =>
  EDITABLE_POSITIONS.filter((position) => position < caretPosition).length;

const digitIndexToCaret = (digitIndex = 0) =>
  CARET_BY_DIGIT_INDEX[Math.max(0, Math.min(4, digitIndex))];

const isEmptyTimecodeValue = (value) => String(value ?? '').trim() === '';

const getDigitsFromValue = (value) =>
  normalizeFixedTimecode(value, DEFAULT_TIMECODE).replace(':', '');

const digitsToTimecode = (digits) => {
  const safeDigits = String(digits ?? '')
    .replace(/\D/g, '')
    .padStart(4, '0')
    .slice(-4);

  const minutes = Number(safeDigits.slice(0, 2)) || 0;
  const seconds = Math.min(59, Number(safeDigits.slice(2, 4)) || 0);

  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
};

const TimecodeInput = ({
  value = DEFAULT_TIMECODE,
  onChange = () => {},
  onCommit = () => {},
  className = '',
  placeholder = 'MM:SS',
  ariaLabel = 'Tempo',
  title,
  disabled = false,
}) => {
  const inputRef = useRef(null);
  const pendingSelectionRef = useRef(null);

  const displayValue = useMemo(() => {
    if (isEmptyTimecodeValue(value)) {
      return '';
    }

    return normalizeFixedTimecode(value, DEFAULT_TIMECODE);
  }, [value]);

  useLayoutEffect(() => {
    if (!inputRef.current || pendingSelectionRef.current === null) return;

    const caretPosition = pendingSelectionRef.current;

    inputRef.current.setSelectionRange(caretPosition, caretPosition);

    pendingSelectionRef.current = null;
  }, [displayValue]);

  const clearValue = useCallback(() => {
    pendingSelectionRef.current = 0;
    onChange('');
  }, [onChange]);

  const applyNextValue = useCallback((nextDigits, nextDigitIndex) => {
    const nextCaret = digitIndexToCaret(nextDigitIndex);
    pendingSelectionRef.current = nextCaret;
    onChange(digitsToTimecode(nextDigits));

    // Fallback: se o novo timecode for igual ao valor atual, o React não
    // re-renderiza e o useLayoutEffect não dispara — o cursor não avança.
    // O requestAnimationFrame garante que o cursor seja posicionado mesmo
    // quando o dígito digitado é idêntico ao que já estava na posição (ex: "0").
    requestAnimationFrame(() => {
      if (!inputRef.current || pendingSelectionRef.current === null) return;
      const caretPosition = pendingSelectionRef.current;
      inputRef.current.setSelectionRange(caretPosition, caretPosition);
      pendingSelectionRef.current = null;
    });
  }, [onChange]);

  const handleDigitInput = useCallback((digit, selectionStart, selectionEnd) => {
    const digits = getDigitsFromValue(displayValue).split('');
    const startDigit = countEditableBeforeCaret(selectionStart);
    const endDigit = countEditableBeforeCaret(selectionEnd);

    if (selectionStart === selectionEnd && selectionStart >= 5) {
      const shifted = [digits[1], digits[2], digits[3], digit];
      applyNextValue(shifted.join(''), 4);
      return;
    }

    const targetDigit = Math.min(startDigit, 3);

    if (targetDigit === 2 && Number(digit) > 5) {
      return;
    }

    if (startDigit !== endDigit) {
      for (let index = startDigit; index < endDigit; index += 1) {
        digits[index] = '0';
      }
    }

    digits[targetDigit] = digit;

    applyNextValue(digits.join(''), Math.min(targetDigit + 1, 4));
  }, [applyNextValue, displayValue]);

  const handleBackspace = useCallback((selectionStart, selectionEnd) => {
    const digits = getDigitsFromValue(displayValue).split('');
    const startDigit = countEditableBeforeCaret(selectionStart);
    const endDigit = countEditableBeforeCaret(selectionEnd);
    const selectedAllDigits = startDigit === 0 && endDigit >= 4;

    if (selectedAllDigits) {
      clearValue();
      return;
    }

    if (startDigit !== endDigit) {
      for (let index = startDigit; index < endDigit; index += 1) {
        digits[index] = '0';
      }

      applyNextValue(digits.join(''), startDigit);
      return;
    }

    if (startDigit <= 0) {
      return;
    }

    const targetDigit = startDigit - 1;
    digits[targetDigit] = '0';
    applyNextValue(digits.join(''), targetDigit);
  }, [applyNextValue, clearValue, displayValue]);

  const handleDelete = useCallback((selectionStart, selectionEnd) => {
    const digits = getDigitsFromValue(displayValue).split('');
    const startDigit = countEditableBeforeCaret(selectionStart);
    const endDigit = countEditableBeforeCaret(selectionEnd);
    const selectedAllDigits = startDigit === 0 && endDigit >= 4;

    if (selectedAllDigits) {
      clearValue();
      return;
    }

    if (startDigit !== endDigit) {
      for (let index = startDigit; index < endDigit; index += 1) {
        digits[index] = '0';
      }

      applyNextValue(digits.join(''), startDigit);
      return;
    }

    if (startDigit >= 4) {
      return;
    }

    digits[startDigit] = '0';
    applyNextValue(digits.join(''), startDigit);
  }, [applyNextValue, clearValue, displayValue]);

  const moveCaret = useCallback((nextDigitIndex) => {
    pendingSelectionRef.current = digitIndexToCaret(nextDigitIndex);

    requestAnimationFrame(() => {
      if (!inputRef.current || pendingSelectionRef.current === null) {
        return;
      }

      const caretPosition = pendingSelectionRef.current;
      inputRef.current.setSelectionRange(caretPosition, caretPosition);
      pendingSelectionRef.current = null;
    });
  }, []);

  const handleKeyDown = useCallback((event) => {
    if (!inputRef.current) return;

    const { selectionStart = 0, selectionEnd = 0 } = inputRef.current;

    if ((event.ctrlKey || event.metaKey) && (event.key === 'ArrowLeft' || event.key === 'ArrowRight')) {
      return;
    }

    if (event.ctrlKey || event.metaKey || event.altKey) {
      return;
    }

    if (/^\d$/.test(event.key)) {
      event.preventDefault();
      handleDigitInput(event.key, selectionStart, selectionEnd);
      return;
    }

    if (event.key === 'Backspace') {
      event.preventDefault();
      handleBackspace(selectionStart, selectionEnd);
      return;
    }

    if (event.key === 'Delete') {
      event.preventDefault();
      handleDelete(selectionStart, selectionEnd);
      return;
    }

    if (event.key === 'ArrowLeft') {
      event.preventDefault();
      const currentDigit = countEditableBeforeCaret(selectionStart);
      moveCaret(Math.max(0, currentDigit - 1));
      return;
    }

    if (event.key === 'ArrowRight') {
      event.preventDefault();
      const currentDigit = countEditableBeforeCaret(selectionEnd);
      moveCaret(Math.min(4, currentDigit + (selectionStart === selectionEnd ? 1 : 0)));
      return;
    }

    if (event.key === 'Home') {
      event.preventDefault();
      moveCaret(0);
      return;
    }

    if (event.key === 'End') {
      event.preventDefault();
      moveCaret(4);
    }
  }, [handleBackspace, handleDelete, handleDigitInput, moveCaret]);

  const handlePaste = useCallback((event) => {
    event.preventDefault();

    const pastedText = event.clipboardData?.getData('text') || '';
    const trimmedText = pastedText.trim();

    if (!trimmedText) {
      clearValue();
      return;
    }

    const normalized = normalizeFixedTimecode(trimmedText, DEFAULT_TIMECODE);
    onChange(normalized);
    pendingSelectionRef.current = digitIndexToCaret(4);
  }, [clearValue, onChange]);

  const handleChange = useCallback((event) => {
    const rawValue = event.target.value;

    if (rawValue === '') {
      clearValue();
      return;
    }

    onChange(normalizeFixedTimecode(rawValue, displayValue || DEFAULT_TIMECODE));
  }, [clearValue, displayValue, onChange]);

  const handleBlur = useCallback((event) => {
    const rawValue = event.target.value.trim();

    if (!rawValue) {
      onCommit('');
      return;
    }

    onCommit(normalizeFixedTimecode(rawValue, DEFAULT_TIMECODE));
  }, [onCommit]);

  const handleMouseUp = useCallback(() => {
    if (!inputRef.current) return;

    const { selectionStart = 0, selectionEnd = 0 } = inputRef.current;

    if (selectionStart === selectionEnd && selectionStart === 2) {
      moveCaret(2);
    }
  }, [moveCaret]);

  return (
    <input
      ref={inputRef}
      className={className}
      type="text"
      inputMode="numeric"
      autoComplete="off"
      spellCheck={false}
      maxLength={5}
      value={displayValue}
      onChange={handleChange}
      onKeyDown={handleKeyDown}
      onPaste={handlePaste}
      onBlur={handleBlur}
      onMouseUp={handleMouseUp}
      placeholder={placeholder}
      aria-label={ariaLabel}
      title={title}
      disabled={disabled}
      data-timecode-input="true"
    />
  );
};

export const isTextEntryElement = (element) => {
  if (!element || !(element instanceof HTMLElement)) {
    return false;
  }

  if (element.isContentEditable) {
    return true;
  }

  const tagName = element.tagName;

  if (tagName === 'TEXTAREA' || tagName === 'SELECT') {
    return true;
  }

  if (tagName !== 'INPUT') {
    return false;
  }

  const type = String(element.getAttribute('type') || 'text').toLowerCase();

  return !NON_TEXT_INPUT_TYPES.has(type);
};

export default TimecodeInput;
