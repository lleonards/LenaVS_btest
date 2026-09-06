#!/usr/bin/env python3
"""Run ctc_forced_aligner 1.0.2 and preserve the user's lyric blocks.

The package returns word timestamps. This adapter deliberately does not ask the
aligner to split, merge, reorder, or rewrite the lyrics. It only groups the
returned timestamps back into the blocks supplied by the editor.
"""

from __future__ import annotations

import argparse
import json
import os
import re
import sys
import tempfile
import traceback
from pathlib import Path


WORD_RE = re.compile(r"\S+")


def emit_failure(code: str, message: str) -> None:
    print(json.dumps({
        "success": False,
        "code": code,
        "error": message,
    }, ensure_ascii=False))


def count_words(text: str) -> int:
    return len(WORD_RE.findall(str(text or "").replace("\r", " ")))


def read_stanzas(path: Path) -> list[dict]:
    value = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(value, list):
        raise ValueError("A lista de blocos de letra é inválida.")

    stanzas = []
    for index, item in enumerate(value):
        if not isinstance(item, dict):
            raise ValueError(f"O bloco {index + 1} da letra é inválido.")
        text = str(item.get("text") or "")
        stanzas.append({"index": index, "text": text})
    return stanzas


def run_alignment(audio_path: Path, stanzas_path: Path, output_path: Path, language: str) -> None:
    # Import lazily so the Node API can boot and expose a useful health check
    # even when the optional ML dependencies are not installed yet.
    from ctc_forced_aligner import AlignmentSingleton

    stanzas = read_stanzas(stanzas_path)
    if not any(item["text"].strip() for item in stanzas):
        raise ValueError("A letra não contém nenhum bloco com texto.")

    # The package consumes a plain transcript. Blank lines are retained here
    # for readability, while the package itself flattens whitespace before
    # alignment. The block order and word order therefore stay deterministic.
    transcript = "\n\n".join(item["text"] for item in stanzas).strip()

    with tempfile.TemporaryDirectory(prefix="lenavs-ctc-") as work_dir:
        work = Path(work_dir)
        transcript_path = work / "lyrics.txt"
        subtitle_path = work / "alignment.srt"
        transcript_path.write_text(transcript, encoding="utf-8")

        model_path = os.environ.get(
            "CTC_ALIGNER_MODEL_PATH",
            str(Path(tempfile.gettempdir()) / "lenavs" / "ctc_forced_aligner" / "model.onnx"),
        )
        batch_size = max(1, int(os.environ.get("CTC_ALIGNER_BATCH_SIZE", "4")))

        alignment_service = AlignmentSingleton(model_path=model_path)
        generated = alignment_service.generate_srt(
            str(audio_path),
            str(transcript_path),
            str(subtitle_path),
            language=language,
            batch_size=batch_size,
        )
        if generated is False:
            raise RuntimeError("O ctc-forced-aligner não gerou o resultado da análise.")

        timestamps = list(alignment_service.word_timestamps or [])
        expected_word_count = sum(count_words(item["text"]) for item in stanzas)

        # A mismatch would make it unsafe to assign a timestamp to a user's
        # block. Fail closed so the frontend can leave every existing time
        # untouched, exactly as requested.
        if len(timestamps) != expected_word_count:
            raise RuntimeError(
                "O aligner retornou uma quantidade de palavras diferente da letra "
                f"({len(timestamps)} recebido, {expected_word_count} esperado)."
            )

        blocks = []
        cursor = 0
        for item in stanzas:
            word_count = count_words(item["text"])
            if word_count == 0:
                blocks.append({
                    "index": item["index"],
                    "start": None,
                    "end": None,
                    "wordCount": 0,
                })
                continue

            words = timestamps[cursor:cursor + word_count]
            cursor += word_count
            start = float(words[0]["start"])
            end = float(words[-1]["end"])

            if not (start >= 0 and end >= start):
                raise RuntimeError(f"Tempo inválido retornado para o bloco {item['index'] + 1}.")

            blocks.append({
                "index": item["index"],
                "start": start,
                "end": end,
                "wordCount": word_count,
            })

        output_path.write_text(json.dumps({
            "success": True,
            "engine": "ctc_forced_aligner",
            "engineVersion": "1.0.2",
            "language": language,
            "blocks": blocks,
        }, ensure_ascii=False), encoding="utf-8")


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--audio", required=True)
    parser.add_argument("--stanzas-json", required=True)
    parser.add_argument("--output", required=True)
    parser.add_argument("--language", default="por")
    args = parser.parse_args()

    try:
        run_alignment(
            Path(args.audio),
            Path(args.stanzas_json),
            Path(args.output),
            args.language,
        )
        print(Path(args.output).read_text(encoding="utf-8"))
        return 0
    except Exception as error:  # pragma: no cover - exercised on the Render worker
        traceback.print_exc(file=sys.stderr)
        emit_failure("ALIGNMENT_FAILED", str(error))
        return 1


if __name__ == "__main__":
    raise SystemExit(main())