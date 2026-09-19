#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
lyrics_align.py — Sincronização automática de letras (timestamp por palavra)
para a LenaVS, usando ctc-forced-aligner==1.0.2.

Como funciona
-------------
1. Recebe o áudio já convertido em WAV 16 kHz mono (feito pelo Node com ffmpeg).
2. Recebe os blocos/estrofes EXATAMENTE como estão no editor (texto inalterado).
3. Alinha a letra completa contra o áudio e obtém o tempo de CADA palavra.
4. Agrega por bloco:  início = início da 1ª palavra | fim = fim da última palavra.

Economia de recursos (servidor de 1 CPU / 2 GB de RAM)
------------------------------------------------------
* Threads fixadas em 1 (OMP/MKL/OpenBLAS/ORT) — evita o processo abrir
  1 thread por núcleo detectado e estourar a memória do container.
* batch_size = 1 no gerador de emissões (janelas de 30 s, contexto de 2 s).
* O modelo é carregado por um único processo filho, que morre no final do
  job: toda a RAM volta para o sistema operacional a cada execução.
* Sessão ONNX com graph optimization básica e mem-pattern desligado.

Saídas (JSON) — ver `--out`.
"""

import os

# ── Deve vir ANTES de importar numpy / onnxruntime ───────────────────────────
for _var in (
    "OMP_NUM_THREADS",
    "MKL_NUM_THREADS",
    "OPENBLAS_NUM_THREADS",
    "NUMEXPR_NUM_THREADS",
    "VECLIB_MAXIMUM_THREADS",
):
    os.environ.setdefault(_var, "1")

import argparse  # noqa: E402
import json  # noqa: E402
import math  # noqa: E402
import sys  # noqa: E402
import time  # noqa: E402

DEFAULT_LANGUAGE = os.environ.get("LYRICS_ALIGN_LANGUAGE", "por").strip() or "por"
ALLOWED_ROMANIZE = True  # o modelo ONNX padrão usa vocabulário latino


# ════════════════════════════════════════════════════════════════════════════
# Helpers puros (sem dependência do ctc-forced-aligner) — testáveis via --self-test
# ════════════════════════════════════════════════════════════════════════════

def raw_word_count(block):
    return len(str(block or "").split())


def aggregate_blocks(results, block_of_word, blocks):
    """
    results        -> [{'start': s, 'end': e, 'text': w}, ...] na ordem da letra
    block_of_word  -> índice do bloco para cada palavra alinhada
    blocks         -> textos originais dos blocos (para contagem/fallback)

    Devolve lista de dicts: {'index', 'startSec', 'endSec', 'wordCount',
                             'alignedWords', 'estimated'}
    """
    per_block = [None] * len(blocks)

    for position, result in enumerate(results):
        if position >= len(block_of_word):
            break

        block_index = block_of_word[position]
        if block_index is None or block_index < 0 or block_index >= len(blocks):
            continue

        start = float(result.get("start") or 0.0)
        end = float(result.get("end") or start)
        if end < start:
            end = start

        current = per_block[block_index]
        if current is None:
            per_block[block_index] = {"start": start, "end": end, "words": 1}
        else:
            current["start"] = min(current["start"], start)
            current["end"] = max(current["end"], end)
            current["words"] += 1

    # Blocos cujo texto não gerou nenhuma palavra alinhável (ex.: só pontuação)
    # são preenchidos proporcionalmente entre os vizinhos já resolvidos.
    duration = 0.0
    for item in per_block:
        if item:
            duration = max(duration, item["end"])

    for index, item in enumerate(per_block):
        if item is not None:
            continue

        previous_end = 0.0
        for previous in range(index - 1, -1, -1):
            if per_block[previous]:
                previous_end = per_block[previous]["end"]
                break

        next_start = duration
        for following in range(index + 1, len(per_block)):
            if per_block[following]:
                next_start = max(previous_end, per_block[following]["start"])
                break

        words = max(1, raw_word_count(blocks[index]))
        estimated_end = max(previous_end + words * 0.35, min(next_start, previous_end + 4.0))

        per_block[index] = {
            "start": previous_end,
            "end": max(previous_end + 0.4, estimated_end),
            "words": 0,
            "estimated": True,
        }

    output = []
    for index, item in enumerate(per_block):
        output.append(
            {
                "index": index,
                "startSec": round(float(item["start"]), 3),
                "endSec": round(float(item["end"]), 3),
                "wordCount": raw_word_count(blocks[index]),
                "alignedWords": int(item.get("words") or 0),
                "estimated": bool(item.get("estimated")),
            }
        )

    return output


def build_proportional_blocks(blocks, duration_seconds):
    """Distribuição proporcional por nº de palavras (usada como plano B)."""
    counts = [max(1, raw_word_count(block)) for block in blocks]
    total = sum(counts) or 1
    duration = max(1.0, float(duration_seconds or 0.0))

    output = []
    cursor = 0.0
    for index, count in enumerate(counts):
        slice_duration = duration * (count / total)
        start = cursor
        end = min(duration, cursor + slice_duration)
        if end <= start:
            end = min(duration, start + 0.5)
        cursor = end
        output.append(
            {
                "index": index,
                "startSec": round(start, 3),
                "endSec": round(end, 3),
                "wordCount": count,
                "alignedWords": 0,
                "estimated": True,
            }
        )

    return output


def write_json(payload, target):
    text = json.dumps(payload, ensure_ascii=False)

    if not target or target == "-":
        sys.stdout.write(text)
        return

    directory = os.path.dirname(os.path.abspath(target))
    if directory:
        os.makedirs(directory, exist_ok=True)

    with open(target, "w", encoding="utf-8") as handle:
        handle.write(text)


# ════════════════════════════════════════════════════════════════════════════
# Alinhamento real
# ════════════════════════════════════════════════════════════════════════════

def build_session(model_path, model_url):
    import onnxruntime
    from ctc_forced_aligner import ensure_onnx_model

    ensure_onnx_model(model_path, model_url)

    options = onnxruntime.SessionOptions()
    options.intra_op_num_threads = 1
    options.inter_op_num_threads = 1
    options.execution_mode = onnxruntime.ExecutionMode.ORT_SEQUENTIAL
    options.graph_optimization_level = onnxruntime.GraphOptimizationLevel.ORT_ENABLE_BASIC
    options.enable_mem_pattern = False
    options.enable_cpu_mem_arena = False

    return onnxruntime.InferenceSession(model_path, sess_options=options, providers=["CPUExecutionProvider"])


def build_word_plan(blocks, language):
    """
    Mantém o texto dos blocos intacto e apenas filtra, para o alinhador, as
    palavras que sobrevivem à normalização do modelo (números soltos e
    pontuação viram nada e quebrariam o mapeamento palavra → bloco).
    """
    from ctc_forced_aligner import text_normalize

    words = []
    block_of_word = []

    for block_index, block in enumerate(blocks):
        for raw_word in str(block or "").split():
            if not text_normalize(raw_word, language).strip():
                continue
            words.append(raw_word)
            block_of_word.append(block_index)

    return words, block_of_word


def run_alignment(session, tokenizer, wav_path, words, language, window, context, batch_size):
    from ctc_forced_aligner import (
        generate_emissions,
        get_alignments,
        get_spans,
        load_audio,
        postprocess_results,
        preprocess_text,
    )

    waveform = load_audio(wav_path, ret_type="np")
    emissions, stride = generate_emissions(
        session,
        waveform,
        window_length=int(window),
        context_length=int(context),
        batch_size=int(batch_size),
    )

    text = " ".join(words)
    tokens_starred, text_starred = preprocess_text(text, romanize=True, language=language)
    segments, scores, blank_token = get_alignments(emissions, tokens_starred, tokenizer)
    spans = get_spans(tokens_starred, segments, blank_token)
    results = postprocess_results(text_starred, spans, stride, scores)

    return results, stride


# ════════════════════════════════════════════════════════════════════════════
# Modos de execução
# ════════════════════════════════════════════════════════════════════════════

def mode_check(target):
    report = {"ok": False, "packages": {}, "error": None}

    try:
        import ctc_forced_aligner  # noqa: F401
        import numpy
        import onnxruntime

        try:
            import librosa

            report["packages"]["librosa"] = getattr(librosa, "__version__", "?")
        except Exception as error:  # pragma: no cover
            report["packages"]["librosa"] = f"indisponível: {error}"

        report["packages"]["ctc_forced_aligner"] = getattr(
            ctc_forced_aligner, "__version__", "1.0.2"
        )
        report["packages"]["onnxruntime"] = getattr(onnxruntime, "__version__", "?")
        report["packages"]["numpy"] = getattr(numpy, "__version__", "?")
        report["ok"] = True
    except Exception as error:
        report["error"] = f"{type(error).__name__}: {error}"

    write_json(report, target)
    return 0 if report["ok"] else 3


def mode_self_test(target):
    """Valida a agregação bloco/palavra + distribuição proporcional (sem modelo)."""
    checks = []

    blocks = ["Eu quero cantar", "sozinho\nno silêncio", "…"]
    results = [
        {"start": 10.0, "end": 10.4, "text": "Eu"},
        {"start": 11.0, "end": 11.3, "text": "quero"},
        {"start": 12.0, "end": 12.8, "text": "cantar"},
        {"start": 20.1, "end": 20.6, "text": "sozinho"},
        {"start": 21.0, "end": 21.4, "text": "no"},
        {"start": 21.5, "end": 22.0, "text": "silêncio"},
    ]
    block_of_word = [0, 0, 0, 1, 1, 1]

    aggregated = aggregate_blocks(results, block_of_word, blocks)

    checks.append(("bloco 1 inicia no tempo da 1ª palavra", aggregated[0]["startSec"] == 10.0))
    checks.append(("bloco 1 termina no tempo da última palavra", aggregated[0]["endSec"] == 12.8))
    checks.append(("bloco 2 usa 1ª/última palavra", (aggregated[1]["startSec"], aggregated[1]["endSec"]) == (20.1, 22.0)))
    checks.append(("bloco vazio é estimado", aggregated[2]["estimated"] is True))
    checks.append(("bloco vazio começa no fim do anterior", aggregated[2]["startSec"] == 22.0))
    checks.append(("blocos vazios não sobrepõem", aggregated[2]["endSec"] >= aggregated[1]["endSec"]))
    checks.append(("contagem de palavras preservada", aggregated[1]["wordCount"] == 3))

    proportional = build_proportional_blocks(["a b c d", "e f", "g h"], 60.0)
    checks.append(("proporcional cobre a duração", proportional[-1]["endSec"] == 60.0))
    checks.append(("proporcional é crescente", all(proportional[i]["startSec"] <= proportional[i + 1]["startSec"] for i in range(len(proportional) - 1))))
    dur0 = proportional[0]["endSec"] - proportional[0]["startSec"]
    dur1 = proportional[1]["endSec"] - proportional[1]["startSec"]
    checks.append(("proporcional respeita o nº de palavras", dur0 > dur1))
    checks.append(("proporcional sem sobreposição", all(
        proportional[i]["endSec"] <= proportional[i + 1]["startSec"] + 1e-6
        for i in range(len(proportional) - 1)
    )))

    failed = [name for name, passed in checks if not passed]

    for name, passed in checks:
        # stderr para manter o stdout 100% JSON (o Node faz o parse dele)
        sys.stderr.write(f"{'OK  ' if passed else 'FALHA'} — {name}\n")

    write_json(
        {
            "ok": not failed,
            "checks": len(checks),
            "failed": failed,
            "blocks": aggregated,
            "proportional": proportional,
        },
        target,
    )

    return 0 if not failed else 4


def mode_warmup(args):
    """Baixa o modelo ONNX e valida a sessão — sem processar áudio."""
    started = time.time()

    existed_before = os.path.exists(args.model_path)
    session = build_session(args.model_path, args.model_url)
    size_bytes = os.path.getsize(args.model_path) if os.path.exists(args.model_path) else 0
    inputs = session.get_inputs()

    write_json(
        {
            "ok": True,
            "mode": "warmup",
            "modelPath": args.model_path,
            "downloaded": not existed_before,
            "sizeBytes": size_bytes,
            "inputName": inputs[0].name if inputs else None,
            "elapsedSec": round(time.time() - started, 2),
        },
        args.out,
    )
    return 0


def mode_align(args):
    started = time.time()

    with open(args.blocks_json, "r", encoding="utf-8") as handle:
        payload = json.load(handle)

    blocks = payload.get("stanzas") if isinstance(payload, dict) else payload
    if not isinstance(blocks, list) or not blocks:
        raise ValueError("blocks.json sem estrofes válidas")

    blocks = [str(block or "") for block in blocks]

    if args.mode == "proportional":
        alignment = build_proportional_blocks(blocks, args.duration)
        write_json(
            {
                "ok": True,
                "engine": "distribuicao-proporcional",
                "mode": "proportional",
                "language": args.language,
                "durationSec": round(float(args.duration or 0.0), 3),
                "blocks": alignment,
                "words": [],
                "elapsedSec": round(time.time() - started, 2),
            },
            args.out,
        )
        return 0

    import onnxruntime  # noqa: F401
    from ctc_forced_aligner import Tokenizer

    words, block_of_word = build_word_plan(blocks, args.language)
    if not words:
        raise ValueError("nenhuma palavra alinhável na letra")

    session = build_session(args.model_path, args.model_url)
    tokenizer = Tokenizer()

    results, stride = run_alignment(
        session,
        tokenizer,
        args.audio,
        words,
        args.language,
        args.window,
        args.context,
        args.batch_size,
    )

    if len(results) != len(words):
        raise ValueError(
            f"alinhamento inconsistente: {len(results)} tempos para {len(words)} palavras"
        )

    alignment = aggregate_blocks(results, block_of_word, blocks)

    words_payload = []
    for position, result in enumerate(results):
        words_payload.append(
            {
                "block": block_of_word[position],
                "text": result.get("text"),
                "start": round(float(result.get("start") or 0.0), 3),
                "end": round(float(result.get("end") or 0.0), 3),
            }
        )

    write_json(
        {
            "ok": True,
            "engine": "ctc-forced-aligner-1.0.2",
            "mode": "forced-alignment",
            "language": args.language,
            "romanize": ALLOWED_ROMANIZE,
            "strideMs": stride,
            "durationSec": round(max([word["end"] for word in words_payload] + [0.0]), 3),
            "wordCount": len(words),
            "blocks": alignment,
            "words": words_payload,
            "elapsedSec": round(time.time() - started, 2),
        },
        args.out,
    )

    return 0


def main():
    parser = argparse.ArgumentParser(description="Sincronização automática de letras (LenaVS)")
    parser.add_argument("--audio")
    parser.add_argument("--blocks-json")
    parser.add_argument("--out", default="-")
    parser.add_argument("--language", default=DEFAULT_LANGUAGE)
    parser.add_argument("--mode", default="align", choices=["align", "proportional"])
    parser.add_argument("--duration", type=float, default=0.0)
    parser.add_argument("--batch-size", type=int, default=int(os.environ.get("LYRICS_ALIGN_BATCH_SIZE", "1")))
    parser.add_argument("--window", type=float, default=float(os.environ.get("LYRICS_ALIGN_WINDOW_SECONDS", "15")))
    parser.add_argument("--context", type=float, default=float(os.environ.get("LYRICS_ALIGN_CONTEXT_SECONDS", "1")))
    parser.add_argument(
        "--model-dir",
        default=os.environ.get("LYRICS_ALIGN_MODEL_DIR", "").strip()
        or os.path.join(os.path.expanduser("~"), ".cache", "lenavs", "ctc-forced-aligner"),
    )
    parser.add_argument("--model-url", default=os.environ.get("LYRICS_ALIGN_MODEL_URL", "").strip())
    parser.add_argument("--check", action="store_true")
    parser.add_argument("--self-test", action="store_true")
    parser.add_argument("--warmup", action="store_true")

    args = parser.parse_args()

    if args.self_test:
        return mode_self_test(args.out)

    if args.check:
        return mode_check(args.out)

    from ctc_forced_aligner import MODEL_URL  # importado só nos modos reais

    args.model_url = args.model_url or MODEL_URL
    args.model_path = os.path.join(args.model_dir, os.path.basename(args.model_url))

    if args.warmup:
        return mode_warmup(args)

    if not args.audio:
        raise SystemExit("--audio é obrigatório")
    if not args.blocks_json:
        raise SystemExit("--blocks-json é obrigatório")

    args.audio = os.path.abspath(args.audio)

    if args.mode == "align" and not os.path.exists(args.audio):
        raise SystemExit(f"áudio não encontrado: {args.audio}")

    return mode_align(args)


if __name__ == "__main__":
    try:
        sys.exit(main() or 0)
    except Exception as error:  # mensagem curta para o Node exibir ao usuário
        sys.stderr.write(f"ERRO_ALINHADOR: {type(error).__name__}: {error}\n")
        sys.exit(1)
