#!/usr/bin/env python3
"""Align the user's existing lyric blocks without changing their structure.

This worker intentionally uses ctc-forced-aligner 1.0.2.  The package returns
timestamps for the words in the transcript; this script only groups those
timestamps back into the non-empty lines supplied by LenaVS.
"""

from __future__ import annotations

import argparse
import json
import re
import sys
import unicodedata
from pathlib import Path


def fail(message: str, code: str = "ALIGNMENT_FAILED") -> None:
    print(json.dumps({"error": message, "code": code}, ensure_ascii=False), file=sys.stderr)
    raise SystemExit(1)


def normalized_word_count(line: str) -> int:
    """Mirror the package's practical word filtering closely enough to map lines.

    ctc-forced-aligner 1.0.2 lowercases each line and keeps only characters
    present in the selected model dictionary.  Removing combining accents and
    punctuation here preserves one word per spoken token for Portuguese text.
    """

    count = 0
    for raw_word in re.findall(r"\S+", line or ""):
        normalized = unicodedata.normalize("NFKD", raw_word.lower())
        normalized = "".join(
            char for char in normalized
            if not unicodedata.combining(char) and (char.isalnum() or char == "'")
        )
        if normalized:
            count += 1
    return count


def finite_number(value, fallback=None):
    try:
        number = float(value)
    except (TypeError, ValueError):
        return fallback
    return number if number == number and number not in (float("inf"), float("-inf")) else fallback


def main() -> None:
    if sys.version_info[:2] != (3, 12):
        fail(
            "A sincronização automática exige Python 3.12. "
            f"Versão encontrada: {sys.version_info.major}.{sys.version_info.minor}.",
            "PYTHON_VERSION_UNSUPPORTED",
        )

    parser = argparse.ArgumentParser()
    parser.add_argument("--audio-path", required=True)
    parser.add_argument("--text-path", required=True)
    parser.add_argument("--output-path", required=True)
    parser.add_argument("--model-type", default="MMS_FA")
    args = parser.parse_args()

    audio_path = Path(args.audio_path)
    text_path = Path(args.text_path)
    output_path = Path(args.output_path)

    if not audio_path.is_file():
        fail("O arquivo de áudio temporário não foi encontrado.", "AUDIO_NOT_FOUND")
    if not text_path.is_file():
        fail("O arquivo temporário da letra não foi encontrado.", "LYRICS_NOT_FOUND")

    raw_lines = text_path.read_text(encoding="utf-8").splitlines()
    block_word_counts = [normalized_word_count(line) for line in raw_lines]
    expected_word_count = sum(block_word_counts)

    if expected_word_count == 0:
        fail("A letra não contém palavras alinháveis.", "LYRICS_EMPTY")

    try:
        from ctc_forced_aligner import get_word_stamps
    except Exception as exc:  # pragma: no cover - depends on deployment packages
        fail(
            "ctc-forced-aligner 1.0.2 não está instalado no ambiente Python. "
            f"Detalhe: {exc}",
            "ALIGNER_UNAVAILABLE",
        )

    try:
        word_timestamps, _, _ = get_word_stamps(
            str(audio_path),
            str(text_path),
            model_type=args.model_type,
        )
    except Exception as exc:  # pragma: no cover - model/audio dependent
        fail(f"O Lyrics Aligner não conseguiu analisar o áudio: {exc}", "ALIGNMENT_FAILED")

    if not word_timestamps:
        fail("O Lyrics Aligner não encontrou palavras na música.", "NO_WORD_TIMESTAMPS")

    if len(word_timestamps) != expected_word_count:
        fail(
            "A quantidade de palavras reconhecidas não corresponde à letra enviada. "
            "Os blocos foram preservados e nenhum tempo foi aplicado.",
            "ALIGNMENT_WORD_COUNT_MISMATCH",
        )

    blocks = []
    word_index = 0
    for block_index, word_count in enumerate(block_word_counts):
        if word_count == 0:
            blocks.append({
                "index": block_index,
                "start": None,
                "end": None,
                "wordCount": 0,
            })
            continue

        block_words = word_timestamps[word_index:word_index + word_count]
        word_index += word_count
        starts = [finite_number(word.get("start")) for word in block_words]
        ends = [finite_number(word.get("end")) for word in block_words]

        if any(value is None for value in starts + ends):
            fail(
                "O Lyrics Aligner retornou um tempo inválido. "
                "Os blocos foram preservados e nenhum tempo foi aplicado.",
                "INVALID_WORD_TIMESTAMPS",
            )

        start = max(0.0, min(starts))
        end = max(start, max(ends))
        blocks.append({
            "index": block_index,
            "start": round(start, 6),
            "end": round(end, 6),
            "wordCount": word_count,
            "words": [
                {
                    "text": str(word.get("text", "")),
                    "start": round(float(word["start"]), 6),
                    "end": round(float(word["end"]), 6),
                }
                for word in block_words
            ],
        })

    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text(
        json.dumps(
            {
                "engine": "ctc-forced-aligner",
                "version": "1.0.2",
                "modelType": args.model_type,
                "blocks": blocks,
            },
            ensure_ascii=False,
        ),
        encoding="utf-8",
    )


if __name__ == "__main__":
    main()