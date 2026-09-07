#!/usr/bin/env python3
"""whisperx_align.py

Alinha uma letra fornecida pelo usuário com o áudio usando WhisperX.

O WhisperX é usado APENAS para descobrir os tempos das palavras. Ele NÃO
cria, exclui, divide, junta ou reorganiza blocos — a estrutura de blocos
da LenaVS é sempre preservada (o mapeamento bloco -> tempo é feito no
backend Node, em utils/lyricsAligner.js).

Fluxo:
  1. Transcreve o áudio com Whisper (faster-whisper), usando a letra do
     usuário como initial_prompt para aproximar a transcrição da letra.
  2. Aplica forced alignment com wav2vec2 (whisperx.align) para gerar
     timestamps por palavra.
  3. Emite JSON em stdout:
     {
       "language": "pt",
       "words": [ {"word": "...", "start": 0.12, "end": 0.34}, ... ],
       "segments": [ {"start":..., "end":..., "text":"..."}, ... ]
     }

Ambiente:
  - Python compativel com WhisperX (3.10/3.11 — o Dockerfile usa Debian
    bookworm, que entrega Python 3.11 por padrao).
  - Instalar antes: requirements-whisperx.txt.

Uso:
  python3 scripts/whisperx_align.py --audio musica.mp3 --transcript letra.txt
"""

import argparse
import json
import os
import sys


def eprint(*args, **kwargs):
    print(*args, file=sys.stderr, **kwargs)


def read_transcript(path):
    with open(path, "r", encoding="utf-8") as handle:
        return handle.read()


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--audio", required=True, help="Caminho do audio local")
    parser.add_argument("--transcript", required=True, help="Caminho do .txt com a letra do usuario")
    parser.add_argument("--model", default=os.environ.get("WHISPERX_MODEL", "small"), help="tiny/base/small/medium/large-v2")
    parser.add_argument("--device", default=os.environ.get("WHISPERX_DEVICE", "cpu"), help="cpu|cuda")
    parser.add_argument("--language", default=os.environ.get("WHISPERX_LANGUAGE", ""), help="Ex: pt. Vazio = auto")
    parser.add_argument("--compute_type", default=os.environ.get("WHISPERX_COMPUTE_TYPE", "int8"), help="Ex: int8/float16")
    args = parser.parse_args()

    if not os.path.exists(args.audio):
        raise FileNotFoundError(f"Audio nao encontrado: {args.audio}")

    transcript = read_transcript(args.transcript)

    import whisperx  # noqa: E402

    device = args.device
    audio = whisperx.load_audio(args.audio)

    model = whisperx.load_model(args.model, device, compute_type=args.compute_type)

    transcribe_kwargs = {}
    if args.language.strip():
        transcribe_kwargs["language"] = args.language.strip()
    if transcript.strip():
        # Biasing: ajuda o ASR a transcrever exatamente a letra do usuario.
        transcribe_kwargs["initial_prompt"] = transcript.strip()[:1000]

    try:
        result = model.transcribe(audio, **transcribe_kwargs)
    except TypeError:
        # compatibilidade: versoes que nao aceitam initial_prompt
        transcribe_kwargs.pop("initial_prompt", None)
        result = model.transcribe(audio, **transcribe_kwargs)

    lang = result.get("language") or args.language.strip() or ""
    if not lang:
        lang = "pt"  # fallback seguro (app PT-BR)

    if not result.get("segments"):
        print(json.dumps({"language": lang, "words": [], "segments": []}, ensure_ascii=False))
        return

    model_a, metadata = whisperx.load_align_model(language_code=lang, device=device)
    aligned = whisperx.align(result["segments"], model_a, metadata, audio, device)

    words = []
    for word in (aligned.get("word_segments", []) or []):
        raw_word = (word.get("word") or "").strip()
        try:
            start = float(word["start"])
            end = float(word["end"])
        except Exception:
            continue
        if not raw_word:
            continue
        words.append({"word": raw_word, "start": start, "end": end})

    out = {
        "language": aligned.get("language") or lang,
        "words": words,
        "segments": [
            {
                "start": float(segment.get("start", 0.0)),
                "end": float(segment.get("end", 0.0)),
                "text": str(segment.get("text", "")),
            }
            for segment in (aligned.get("segments", []) or [])
        ],
    }

    print(json.dumps(out, ensure_ascii=False))


if __name__ == "__main__":
    try:
        main()
    except Exception as exc:
        eprint(f"[whisperx_align] ERROR: {exc}")
        sys.exit(1)
