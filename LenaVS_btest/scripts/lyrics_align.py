#!/usr/bin/env python3
"""lyrics_align.py

Alinha a letra fornecida (blocos) aos timestamps por palavra do WhisperX.

REGRAS:
- O WhisperX apenas DESCOBRE os tempos das palavras.
- Este script NÃO cria, exclui, divide, junta ou reorganiza blocos.
- Cada bloco da letra recebe:
    start = início da primeira palavra encontrada
    end   = fim da última palavra encontrada
- A comparação normaliza acentos, maiúsculas e pontuação ("Você" == "voce").

Entrada:
  --audio    caminho do arquivo de áudio (mp3/wav/etc.)
  --stanzas  caminho de um JSON: [{"id": "...", "text": "linha1\\nlinha2"}, ...]
  --language código de idioma (ex: pt). Vazio = detecção automática.

Saída (stdout, JSON):
  {
    "language": "pt",
    "words": [{ "word": "...", "start": 10.0, "end": 10.4 }, ...],
    "blocks": [{ "id": "...", "text": "...", "start": 10.0|null, "end": 12.5|null }, ...]
  }
"""

import argparse
import json
import os
import sys
import unicodedata


def eprint(*args, **kwargs):
    print(*args, file=sys.stderr, **kwargs)


def normalize_token(value):
    """Minúsculas, remove acentos e pontuação, preserva palavras."""
    text = unicodedata.normalize("NFD", str(value).lower())
    text = "".join(ch for ch in text if not unicodedata.combining(ch))
    text = "".join(ch for ch in text if ch.isalnum() or ch.isspace())
    return " ".join(text.split())


def tokenize(text):
    tokens = []
    for word in str(text or "").split():
        normalized = normalize_token(word)
        if normalized:
            tokens.append(normalized)
    return tokens


def build_word_index(segments):
    words = []
    for segment in segments or []:
        for item in segment.get("words") or []:
            word = str(item.get("word") or "").strip()
            if not word:
                continue
            start = item.get("start")
            end = item.get("end")
            if start is None or end is None:
                continue
            try:
                words.append({
                    "raw": word,
                    "norm": normalize_token(word),
                    "start": float(start),
                    "end": float(end),
                })
            except (TypeError, ValueError):
                continue
    return words


def align_blocks(blocks_spec, words):
    """Casa as palavras de cada bloco, EM ORDEM, contra o stream do WhisperX."""
    results = []
    cursor = 0

    for block in blocks_spec:
        tokens = tokenize(block.get("text", ""))

        if not tokens:
            results.append({
                "id": block.get("id"),
                "text": block.get("text", ""),
                "start": None,
                "end": None,
            })
            continue

        matched = []
        search_from = cursor

        for token in tokens:
            found_index = None
            for index in range(search_from, len(words)):
                if words[index]["norm"] == token:
                    found_index = index
                    break

            if found_index is None:
                # Palavra do usuário não encontrada na transcrição:
                # ignora SEM quebrar o bloco (o bloco fica com o que achou).
                continue

            matched.append((found_index, words[found_index]))
            search_from = found_index + 1

        if matched:
            cursor = matched[-1][0] + 1
            start = min(item[1]["start"] for item in matched)
            end = max(item[1]["end"] for item in matched)
        else:
            start = None
            end = None

        results.append({
            "id": block.get("id"),
            "text": block.get("text", ""),
            "start": start,
            "end": end,
        })

    return results


def main():
    parser = argparse.ArgumentParser(description="Alinha letra com WhisperX")
    parser.add_argument("--audio", required=True, help="Caminho do áudio local")
    parser.add_argument("--stanzas", required=True, help="Caminho do JSON de blocos")
    parser.add_argument("--language", default=os.environ.get("WHISPERX_LANGUAGE", ""), help="Ex: pt. Vazio = auto")
    parser.add_argument("--model", default=os.environ.get("WHISPERX_MODEL", "base"), help="tiny/base/small/medium/large-v2")
    parser.add_argument("--device", default=os.environ.get("WHISPERX_DEVICE", "cpu"), help="cpu|cuda")
    parser.add_argument("--compute_type", default=os.environ.get("WHISPERX_COMPUTE_TYPE", "int8"), help="int8/float16")
    args = parser.parse_args()

    if not os.path.exists(args.audio):
        raise FileNotFoundError(f"Áudio não encontrado: {args.audio}")

    if not os.path.exists(args.stanzas):
        raise FileNotFoundError(f"Blocos não encontrados: {args.stanzas}")

    with open(args.stanzas, "r", encoding="utf-8") as handle:
        blocks_spec = json.load(handle)

    if not isinstance(blocks_spec, list) or not blocks_spec:
        raise ValueError("stanzas.json deve ser uma lista não vazia de blocos")

    import whisperx  # noqa: E402

    device = args.device

    eprint(f"[lyrics_align] Carregando áudio: {args.audio}")
    audio = whisperx.load_audio(args.audio)

    model = whisperx.load_model(args.model, device, compute_type=args.compute_type)

    transcribe_kwargs = {}
    if args.language.strip():
        transcribe_kwargs["language"] = args.language.strip()

    eprint("[lyrics_align] Transcrevendo com WhisperX ...")
    result = model.transcribe(audio, **transcribe_kwargs)

    language = result.get("language") or args.language.strip() or ""
    if not language:
        language = "pt"

    eprint("[lyrics_align] Alinhando áudio (forced alignment) ...")
    align_model, metadata = whisperx.load_align_model(language_code=language, device=device)
    aligned = whisperx.align(result["segments"], align_model, metadata, audio, device)

    segments = aligned.get("segments") or []
    words = build_word_index(segments)

    eprint(f"[lyrics_align] {len(words)} palavras reconhecidas; alinhando {len(blocks_spec)} blocos ...")
    blocks = align_blocks(blocks_spec, words)

    output = {
        "language": aligned.get("language") or language,
        "words": [{"word": w["raw"], "start": w["start"], "end": w["end"]} for w in words],
        "blocks": blocks,
    }

    print(json.dumps(output, ensure_ascii=False))


if __name__ == "__main__":
    try:
        main()
    except Exception as exc:  # noqa: BLE001
        eprint(f"[lyrics_align] ERROR: {exc}")
        sys.exit(1)
