#!/usr/bin/env python3
"""lyrics_aligner.py

Lyrics Aligner — motor de forced alignment palavra-por-palavra usando o
ctc-forced-aligner (Hugging Face MMS / Wav2Vec2 / HuBERT).

Diferente do WhisperX (que usa transcrição do ASR), o Lyrics Aligner usa a
LETRA fornecida pelo usuário. Ele serve APENAS para descobrir os tempos das
palavras — não cria, exclui, divide, junta ou reorganiza blocos.

Entrada:
  --audio    caminho do áudio local (WAV mono 16kHz)
  --lyrics   caminho da letra local (.txt), exatamente como o usuário escreveu
  --language ISO 639-3 (ex.: por, eng)
  --device   cpu|cuda

Saída: JSON no stdout no formato:
[
  {"word": "Eu", "start": 10.012, "end": 10.240},
  {"word": "quero", "start": 10.301, "end": 10.502},
  ...
]

Instalação (requer FFmpeg como pré-requisito):
  pip install git+https://github.com/MahmoudAshraf97/ctc-forced-aligner.git
  # ou a versão estável:
  pip install ctc-forced-aligner

Modelo padrão: MahmoudAshraf/mms-300m-1130-forced-aligner
"""

import argparse
import json
import os
import sys


def eprint(*args, **kwargs):
    print(*args, file=sys.stderr, **kwargs)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--audio", required=True, help="Caminho do áudio local (WAV mono 16kHz)")
    parser.add_argument("--lyrics", required=True, help="Caminho da letra local (.txt)")
    parser.add_argument("--language", default=os.environ.get("LYRICS_ALIGNER_LANGUAGE", "por"),
                        help="ISO 639-3. Ex.: por, eng")
    parser.add_argument("--device", default=os.environ.get("LYRICS_ALIGNER_DEVICE", "cpu"),
                        help="cpu|cuda")
    parser.add_argument("--batch_size", default=int(os.environ.get("LYRICS_ALIGNER_BATCH_SIZE", "4")))
    args = parser.parse_args()

    audio_path = args.audio
    lyrics_path = args.lyrics

    if not os.path.exists(audio_path):
        raise FileNotFoundError(f"Áudio não encontrado: {audio_path}")
    if not os.path.exists(lyrics_path):
        raise FileNotFoundError(f"Letra não encontrada: {lyrics_path}")

    import torch
    from ctc_forced_aligner import (
        load_audio,
        load_alignment_model,
        generate_emissions,
        preprocess_text,
        get_alignments,
        get_spans,
        postprocess_results,
    )

    device = args.device

    # 1) Load audio
    alignment_model, alignment_tokenizer = load_alignment_model(
        device,
        dtype=torch.float16 if device == "cuda" else torch.float32,
    )

    audio_waveform = load_audio(audio_path, alignment_model.dtype, alignment_model.device)

    # 2) A letra é usada EXATAMENTE como o usuário escreveu.
    with open(lyrics_path, "r", encoding="utf-8") as f:
        lines = f.readlines()
    text = "".join(line for line in lines).replace("\n", " ").strip()

    if not text:
        raise ValueError("Letra vazia — não há palavras para alinhar.")

    # 3) Forced alignment — a letra do usuário é a transcrição de referência.
    emissions, stride = generate_emissions(
        alignment_model,
        audio_waveform,
        batch_size=int(args.batch_size),
    )

    tokens_starred, text_starred = preprocess_text(
        text,
        romanize=True,
        language=args.language,
    )

    segments, scores, blank_token = get_alignments(
        emissions,
        tokens_starred,
        alignment_tokenizer,
    )

    spans = get_spans(tokens_starred, segments, blank_token)

    word_timestamps = postprocess_results(text_starred, spans, stride, scores)

    # 4) Saída JSON: [{word, start, end}] na ordem exata da letra do usuário.
    words = []
    for word_timestamp in word_timestamps:
        word = word_timestamp.get("word")
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

        words.append({
            "word": str(word),
            "start": start_f,
            "end": end_f,
        })

    print(json.dumps(words, ensure_ascii=False))


if __name__ == "__main__":
    try:
        main()
    except Exception as exc:
        eprint(f"[lyrics_aligner] ERROR: {exc}")
        sys.exit(1)
