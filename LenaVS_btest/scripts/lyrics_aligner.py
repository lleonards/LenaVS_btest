#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
lyrics_aligner.py — Lyrics Aligner da LenaVS

Motor de forced alignment palavra-por-palavra usando o pacote
ctc-forced-aligner==1.0.2 (modelo ONNX CTC — Deskpai / Wav2Vec2).

REQUISITOS OBRIGATÓRIOS:
  - Python 3.12 (verificado no startup deste script)
  - ctc-forced-aligner==1.0.2  (NÃO usar 2.0.1 — a API mudou)
  - FFmpeg instalado (pré-requisito do áudio WAV)

O pacote 1.0.2 NÃO expõe load_alignment_model: a API é
  AlignmentSingleton(model_path=...) -> .alignment_model / .alignment_tokenizer
  generate_emissions / preprocess_text / get_alignments / get_spans / postprocess_results
e as palavras retornadas vêm na chave "text" (não "word").

Entrada:
  --audio    caminho do áudio local (WAV mono 16 kHz recomendado)
  --lyrics   caminho da letra local (.txt), exatamente como o usuário escreveu
  --language ISO 639-3 (por, eng, ...)
  --model-path caminho do modelo ONNX (padrão: ~/ctc_forced_aligner/model.onnx;
             baixado automaticamente na primeira execução, ~1,2 GB)
  --batch_size janela de inferência (padrão: 4)

Saída: JSON no stdout no formato:
  [{"word": "De", "start": 12.4, "end": 12.65}, ...]
"""

import argparse
import json
import os
import sys

MIN_PYTHON = (3, 12)
REQUIRED_VERSION_PREFIX = "1."


def eprint(*args, **kwargs):
    print(*args, file=sys.stderr, **kwargs)


def check_python_version():
    if sys.version_info < MIN_PYTHON:
        eprint(
            "[lyrics_aligner] ERROR: O Lyrics Aligner exige Python 3.12 ou superior. "
            f"Encontrado: {sys.version_info.major}.{sys.version_info.minor}.{sys.version_info.micro}."
        )
        eprint(
            "[lyrics_aligner] Crie o ambiente com Python 3.12:\n"
            "  python3.12 -m venv .venv-aligner\n"
            "  .venv-aligner/bin/pip install -r requirements-lyrics-aligner.txt"
        )
        sys.exit(2)


def check_aligner_version():
    try:
        from importlib.metadata import version as _pkg_version
        installed = _pkg_version("ctc-forced-aligner")
    except Exception:
        installed = "desconhecida"

    if not installed.startswith(REQUIRED_VERSION_PREFIX):
        eprint(
            "[lyrics_aligner] ERROR: O Lyrics Aligner exige ctc-forced-aligner==1.0.2. "
            f"Instalado: {installed}. A API da versão 2.x é incompatível com este script."
        )
        eprint("[lyrics_aligner] Corrija com: pip install ctc-forced-aligner==1.0.2")
        sys.exit(2)

    eprint(f"[lyrics_aligner] ctc-forced-aligner {installed} OK (Python {sys.version_info.major}.{sys.version_info.minor}).")


def main():
    check_python_version()

    parser = argparse.ArgumentParser(description="Lyrics Aligner da LenaVS (ctc-forced-aligner 1.0.2)")
    parser.add_argument("--audio", required=True, help="Caminho do áudio local (WAV mono 16 kHz)")
    parser.add_argument("--lyrics", required=True, help="Caminho da letra local (.txt)")
    parser.add_argument("--language", default=os.environ.get("LYRICS_ALIGNER_LANGUAGE", "por"),
                        help="ISO 639-3. Ex.: por, eng")
    parser.add_argument("--device", default=os.environ.get("LYRICS_ALIGNER_DEVICE", "cpu"),
                        help="cpu|cuda (a 1.0.2 roda via ONNX Runtime; cuda requer onnxruntime-gpu)")
    parser.add_argument("--model-path", default=os.environ.get("LYRICS_ALIGNER_MODEL_PATH", ""),
                        help="Caminho do modelo ONNX (~/ctc_forced_aligner/model.onnx por padrão)")
    parser.add_argument("--batch_size", type=int,
                        default=int(os.environ.get("LYRICS_ALIGNER_BATCH_SIZE", "4")),
                        help="Tamanho do batch de inferência")
    args = parser.parse_args()

    if not os.path.exists(args.audio):
        raise FileNotFoundError(f"Áudio não encontrado: {args.audio}")
    if not os.path.exists(args.lyrics):
        raise FileNotFoundError(f"Letra não encontrada: {args.lyrics}")

    check_aligner_version()

    import numpy
    from ctc_forced_aligner import (
        AlignmentSingleton,
        load_audio,
        generate_emissions,
        preprocess_text,
        get_alignments,
        get_spans,
        postprocess_results,
    )

    model_path = args.model_path or os.path.join(
        os.path.expanduser("~"), "ctc_forced_aligner", "model.onnx"
    )

    eprint(f"[lyrics_aligner] Carregando modelo de alinhamento: {model_path}")
    aligner = AlignmentSingleton(model_path=model_path)
    model = aligner.alignment_model
    tokenizer = aligner.alignment_tokenizer

    eprint("[lyrics_aligner] Carregando áudio…")
    audio_waveform = load_audio(args.audio, ret_type="np")

    with open(args.lyrics, "r", encoding="utf-8") as f:
        text = " ".join(line for line in f).strip()

    if not text:
        raise ValueError("Letra vazia — não há palavras para alinhar.")

    eprint("[lyrics_aligner] Gerando emissions (CTC)…")
    emissions, stride = generate_emissions(model, audio_waveform, batch_size=args.batch_size)

    eprint("[lyrics_aligner] Pré-processando a letra fornecida (referência)…")
    tokens_starred, text_starred = preprocess_text(
        text, romanize=True, language=args.language,
    )

    eprint("[lyrics_aligner] Executando forced alignment…")
    segments, scores, blank_token = get_alignments(emissions, tokens_starred, tokenizer)

    spans = get_spans(tokens_starred, segments, blank_token)

    word_timestamps = postprocess_results(text_starred, spans, stride, scores)

    words = []
    for word_timestamp in word_timestamps:
        # API 1.0.2 retorna a palavra na chave "text"; "word" é aceito como fallback.
        word = word_timestamp.get("word") or word_timestamp.get("text")
        start = word_timestamp.get("start")
        end = word_timestamp.get("end")

        if word is None:
            continue
        if start is None or end is None:
            continue
        try:
            start_f = float(start)
            end_f = float(end)
        except (TypeError, ValueError):
            continue
        if end_f < start_f:
            continue

        words.append({
            "word": str(word),
            "start": round(start_f, 3),
            "end": round(end_f, 3),
        })

    eprint(f"[lyrics_aligner] ✅ {len(words)} palavras alinhadas.")
    print(json.dumps(words, ensure_ascii=False))


if __name__ == "__main__":
    try:
        main()
    except Exception as exc:
        eprint(f"[lyrics_aligner] ERROR: {exc}")
        sys.exit(1)
