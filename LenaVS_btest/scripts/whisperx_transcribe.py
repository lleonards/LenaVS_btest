#!/usr/bin/env python3
"""whisperx_transcribe.py

Gera timestamps por palavra usando WhisperX.

Saída: JSON no stdout no formato:
{
  "language": "pt",
  "words": [ {"word": "...", "start": 0.12, "end": 0.34}, ... ],
  "segments": [ {"start":..., "end":..., "text":"..."}, ... ]
}

Obs:
- CPU-friendly por padrão (compute_type=int8).
- Em músicas, a qualidade melhora MUITO se você rodar em cima do áudio com vocal isolado.
"""

import argparse
import json
import os
import sys


def eprint(*args, **kwargs):
    print(*args, file=sys.stderr, **kwargs)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--audio", required=True, help="Caminho do áudio local")
    parser.add_argument("--model", default=os.environ.get("WHISPERX_MODEL", "small"), help="Modelo Whisper (tiny/base/small/medium/large-v2)")
    parser.add_argument("--device", default=os.environ.get("WHISPERX_DEVICE", "cpu"), help="cpu|cuda")
    parser.add_argument("--language", default=os.environ.get("WHISPERX_LANGUAGE", ""), help="Ex: pt. Vazio = auto")
    parser.add_argument("--compute_type", default=os.environ.get("WHISPERX_COMPUTE_TYPE", "int8"), help="Ex: int8/float16")
    args = parser.parse_args()

    audio_path = args.audio
    if not os.path.exists(audio_path):
        raise FileNotFoundError(f"Audio não encontrado: {audio_path}")

    import whisperx  # noqa: E402

    device = args.device

    # 1) Load audio
    audio = whisperx.load_audio(audio_path)

    # 2) Transcribe
    model = whisperx.load_model(args.model, device, compute_type=args.compute_type)
    transcribe_kwargs = {}
    if args.language.strip():
        transcribe_kwargs["language"] = args.language.strip()

    result = model.transcribe(audio, **transcribe_kwargs)

    # 3) Align
    lang = result.get("language") or (args.language.strip() or "")
    if not lang:
        lang = "en"  # fallback safe

    model_a, metadata = whisperx.load_align_model(language_code=lang, device=device)
    aligned = whisperx.align(result["segments"], model_a, metadata, audio, device)

    # Prefer aligned word_segments
    words = []
    for w in aligned.get("word_segments", []) or []:
        word = w.get("word")
        start = w.get("start")
        end = w.get("end")
        if word is None:
            continue
        if start is None or end is None:
            continue
        try:
            start_f = float(start)
            end_f = float(end)
        except Exception:
            continue
        words.append({"word": str(word), "start": start_f, "end": end_f})

    out = {
        "language": aligned.get("language") or lang,
        "words": words,
        "segments": [
            {"start": float(s.get("start", 0.0)), "end": float(s.get("end", 0.0)), "text": str(s.get("text", ""))}
            for s in (aligned.get("segments", []) or [])
        ],
    }

    print(json.dumps(out, ensure_ascii=False))


if __name__ == "__main__":
    try:
        main()
    except Exception as exc:
        eprint(f"[whisperx_transcribe] ERROR: {exc}")
        sys.exit(1)
