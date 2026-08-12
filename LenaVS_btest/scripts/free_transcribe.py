#!/usr/bin/env python3
"""Transcritor local gratuito para sincronização de letras.

Prioridade padrão: faster-whisper.
Opcionalmente pode usar WhisperX se o pacote estiver instalado e
LOCAL_SYNC_ENGINE/--backend=whisperx.
"""

import argparse
import json
import os
import sys
from typing import Any, Dict, List


def eprint(*args, **kwargs):
    print(*args, file=sys.stderr, **kwargs)


def normalize_word_payload(word: Any) -> Dict[str, Any] | None:
    if word is None:
        return None

    text = getattr(word, 'word', None) or getattr(word, 'text', None)
    start = getattr(word, 'start', None)
    end = getattr(word, 'end', None)

    if text is None or start is None or end is None:
        return None

    try:
        start_f = float(start)
        end_f = float(end)
    except Exception:
        return None

    if end_f <= start_f:
        return None

    return {"word": str(text), "start": start_f, "end": end_f}


def run_faster_whisper(audio_path: str, model_name: str, device: str, compute_type: str, language: str, beam_size: int, vad_filter: bool):
    from faster_whisper import WhisperModel

    model = WhisperModel(model_name, device=device, compute_type=compute_type)

    segments, info = model.transcribe(
        audio_path,
        language=language or None,
        beam_size=beam_size,
        condition_on_previous_text=False,
        word_timestamps=True,
        vad_filter=vad_filter,
        vad_parameters={"min_silence_duration_ms": 250} if vad_filter else None,
        temperature=0.0,
    )

    words: List[Dict[str, Any]] = []
    out_segments: List[Dict[str, Any]] = []

    for segment in segments:
        out_segments.append({
            "start": float(segment.start),
            "end": float(segment.end),
            "text": str(segment.text or ''),
        })

        for word in getattr(segment, 'words', []) or []:
            payload = normalize_word_payload(word)
            if payload:
                words.append(payload)

    return {
        "engine": "faster-whisper",
        "language": getattr(info, 'language', None) or language or '',
        "words": words,
        "segments": out_segments,
    }


def run_whisperx(audio_path: str, model_name: str, device: str, compute_type: str, language: str):
    import whisperx

    audio = whisperx.load_audio(audio_path)
    model = whisperx.load_model(model_name, device, compute_type=compute_type)

    kwargs = {}
    if language:
        kwargs['language'] = language

    result = model.transcribe(audio, **kwargs)
    lang = result.get('language') or language or 'en'
    model_a, metadata = whisperx.load_align_model(language_code=lang, device=device)
    aligned = whisperx.align(result['segments'], model_a, metadata, audio, device)

    words: List[Dict[str, Any]] = []
    for word in aligned.get('word_segments', []) or []:
        payload = normalize_word_payload(type('Word', (), word))
        if payload:
            words.append(payload)

    return {
        "engine": "whisperx",
        "language": aligned.get('language') or lang,
        "words": words,
        "segments": [
            {
                "start": float(segment.get('start', 0.0)),
                "end": float(segment.get('end', 0.0)),
                "text": str(segment.get('text', '')),
            }
            for segment in (aligned.get('segments', []) or [])
        ],
    }


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--audio', required=True, help='Caminho do áudio local')
    parser.add_argument('--backend', default=os.environ.get('LOCAL_SYNC_ENGINE', 'auto'), help='auto|faster-whisper|whisperx')
    parser.add_argument('--model', default=os.environ.get('WHISPER_LOCAL_MODEL', os.environ.get('WHISPERX_MODEL', 'small')), help='Modelo local')
    parser.add_argument('--device', default=os.environ.get('WHISPER_LOCAL_DEVICE', os.environ.get('WHISPERX_DEVICE', 'cpu')), help='cpu|cuda')
    parser.add_argument('--language', default=os.environ.get('WHISPER_LOCAL_LANGUAGE', os.environ.get('WHISPERX_LANGUAGE', '')), help='Ex: pt')
    parser.add_argument('--compute_type', default=os.environ.get('WHISPER_LOCAL_COMPUTE_TYPE', os.environ.get('WHISPERX_COMPUTE_TYPE', 'int8')), help='int8|float16|float32')
    parser.add_argument('--beam_size', type=int, default=int(os.environ.get('WHISPER_LOCAL_BEAM_SIZE', '5')), help='Beam size')
    parser.add_argument('--vad_filter', default=os.environ.get('WHISPER_LOCAL_VAD_FILTER', '1'), help='1/0 para VAD')
    args = parser.parse_args()

    if not os.path.exists(args.audio):
        raise FileNotFoundError(f'Áudio não encontrado: {args.audio}')

    backend = str(args.backend or 'auto').strip().lower()
    if backend not in {'auto', 'faster-whisper', 'whisperx'}:
        backend = 'auto'

    vad_filter = str(args.vad_filter).strip().lower() not in {'0', 'false', 'no', 'off'}

    errors = []

    if backend in {'auto', 'faster-whisper'}:
        try:
            result = run_faster_whisper(
                args.audio,
                args.model,
                args.device,
                args.compute_type,
                args.language.strip(),
                args.beam_size,
                vad_filter,
            )
            print(json.dumps(result, ensure_ascii=False))
            return
        except Exception as exc:
            errors.append(f'faster-whisper: {exc}')
            if backend == 'faster-whisper':
                raise

    try:
        result = run_whisperx(
            args.audio,
            args.model,
            args.device,
            args.compute_type,
            args.language.strip(),
        )
        print(json.dumps(result, ensure_ascii=False))
        return
    except Exception as exc:
        errors.append(f'whisperx: {exc}')
        raise RuntimeError(' | '.join(errors))


if __name__ == '__main__':
    try:
        main()
    except Exception as exc:
        eprint(f'[free_transcribe] ERROR: {exc}')
        sys.exit(1)
