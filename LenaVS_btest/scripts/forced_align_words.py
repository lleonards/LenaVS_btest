#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
forced_align_words.py — Alinhamento forçado palavra-a-palavra (ctc-forced-aligner==1.0.2)
─────────────────────────────────────────────────────────────────────────────────────────────
Recebe um áudio já normalizado (16 kHz, mono, WAV) e o texto da letra EXATAMENTE
como está no projeto (sem alterar nenhuma palavra). Devolve, em JSON, o tempo de
início/fim de cada palavra cantada.

Este script NÃO decide os tempos dos blocos: ele apenas devolve as palavras com
seus tempos. O mapeamento palavra → bloco é feito no Node
(src/utils/lyricsAlignment.js), onde os blocos originais já existem.

Uso:
  python3 forced_align_words.py \
      --audio  /tmp/audio-16k.wav \
      --text-file /tmp/letra.txt \
      --output /tmp/alinhamento.json \
      --language por

Saída JSON:
  {
    "success": true,
    "language": "por",
    "model": "MahmoudAshraf/mms-300m-1130-forced-aligner",
    "engine": "ctc-forced-aligner-python",
    "audioDuration": 123.45,
    "elapsedSeconds": 42.1,
    "words": [ { "text": "eu", "start": 10.02, "end": 10.45 }, ... ]
  }

Economia de recursos (servidor de 1 CPU e 2 GB de RAM):
  * 1 thread apenas (OMP/MKL/OpenBLAS/torch.set_num_threads)
  * inferência em janelas (--window-size) para limitar o pico de memória
  * float32 em CPU (fp16 em CPU é instável)
  * o modelo é liberado (gc.collect) antes de o processo terminar; como este
    script roda em um processo filho, toda a memória volta para o SO no fim.
"""

import argparse
import gc
import inspect
import json
import os
import sys
import time
import wave

# ─ Limites de threads precisam ser definidos ANTES de importar torch/numpy ──
os.environ.setdefault("OMP_NUM_THREADS", "1")
os.environ.setdefault("MKL_NUM_THREADS", "1")
os.environ.setdefault("OPENBLAS_NUM_THREADS", "1")
os.environ.setdefault("NUMEXPR_NUM_THREADS", "1")
os.environ.setdefault("VECLIB_MAXIMUM_THREADS", "1")
os.environ.setdefault("TOKENIZERS_PARALLELISM", "false")
os.environ.setdefault("HF_HUB_DISABLE_TELEMETRY", "1")
os.environ.setdefault("HF_HUB_DISABLE_PROGRESS_BARS", "1")
os.environ.setdefault("TRANSFORMERS_NO_ADVISORY_WARNINGS", "1")

DEFAULT_MODEL = "MahmoudAshraf/mms-300m-1130-forced-aligner"

# Marcadores que o alinhador pode devolver e que não são palavras cantadas.
NOISE_TOKENS = {"<star>", "<blank>", "<pad>", "<unk>", "<s>", "</s>", "|"}


class AlignmentError(RuntimeError):
    def __init__(self, code, message):
        super().__init__(message)
        self.code = code
        self.message = message


# ═════════════════════════════════════════════════════════════════════════════
# Argumentos / utilitários
# ═════════════════════════════════════════════════════════════════════════════

def parse_args():
    parser = argparse.ArgumentParser(
        description="Alinhamento forçado palavra-a-palavra (ctc-forced-aligner)."
    )
    parser.add_argument("--audio", required=True, help="Caminho do WAV 16 kHz mono.")
    parser.add_argument("--text-file", dest="text_file", required=True, help="Arquivo com a letra.")
    parser.add_argument("--output", required=True, help="Arquivo JSON de saída.")
    parser.add_argument("--language", default=os.environ.get("ALIGNMENT_LANGUAGE", "por"),
                        help="Código ISO-639-3 do idioma (português = por).")
    parser.add_argument("--model", default=os.environ.get("ALIGNMENT_MODEL", DEFAULT_MODEL),
                        help="Modelo de alinhamento no Hugging Face Hub.")
    parser.add_argument("--threads", type=int, default=int(os.environ.get("ALIGNMENT_THREADS", "1")),
                        help="Número de threads de CPU (padrão: 1).")
    parser.add_argument("--batch-size", dest="batch_size", type=int,
                        default=int(os.environ.get("ALIGNMENT_BATCH_SIZE", "2")),
                        help="Batch size da inferência (menor = menos memória).")
    parser.add_argument("--window-size", dest="window_size", type=float,
                        default=float(os.environ.get("ALIGNMENT_WINDOW_SIZE", "30")),
                        help="Tamanho da janela de áudio em segundos.")
    parser.add_argument("--context-size", dest="context_size", type=float,
                        default=float(os.environ.get("ALIGNMENT_CONTEXT_SIZE", "2")),
                        help="Sobreposição entre janelas em segundos.")
    parser.add_argument("--no-romanize", dest="romanize", action="store_false", default=True,
                        help="Desliga a romanização (modelos não multilíngues).")
    parser.add_argument("--self-test", dest="self_test", action="store_true",
                        help="Valida argumentos/leitura e o pacote, sem rodar o modelo.")
    return parser.parse_args()


def log(message):
    print(f"[forced-align] {message}", file=sys.stderr, flush=True)


def load_text(file_path):
    with open(file_path, "r", encoding="utf-8", errors="replace") as handle:
        return handle.read()


def wav_duration_seconds(file_path):
    try:
        with wave.open(file_path, "rb") as handle:
            frames = handle.getnframes()
            rate = handle.getframerate() or 1
            return round(frames / float(rate), 3)
    except Exception:
        return None


def write_json(file_path, payload):
    temp_path = f"{file_path}.tmp"
    with open(temp_path, "w", encoding="utf-8") as handle:
        json.dump(payload, handle, ensure_ascii=False)
    os.replace(temp_path, file_path)


def emit(payload, exit_code=0):
    output_path = payload.pop("_output", None)
    if output_path:
        try:
            write_json(output_path, payload)
        except Exception as error:  # pragma: no cover - falha de disco
            log(f"Falha ao gravar a saída: {error}")
    print(json.dumps(payload, ensure_ascii=False), flush=True)
    sys.exit(exit_code)


def package_version():
    try:
        from importlib.metadata import version
        return version("ctc-forced-aligner")
    except Exception:
        return None


def aligner_available():
    try:
        import ctc_forced_aligner  # noqa: F401
        return True
    except Exception:
        return False


def call_filtered(func, *args, **kwargs):
    """Chama func passando apenas os kwargs que a assinatura aceita.

    Isso mantém o script compatível com pequenas variações de assinatura entre
    versões do ctc-forced-aligner (ex.: preprocess_text com/sem `language`).
    """
    try:
        signature = inspect.signature(func)
    except (TypeError, ValueError):
        return func(*args, **kwargs)

    parameters = list(signature.parameters.values())

    if any(param.kind == param.VAR_KEYWORD for param in parameters):
        return func(*args, **kwargs)

    allowed = {
        param.name for param in parameters
        if param.kind in (param.POSITIONAL_OR_KEYWORD, param.KEYWORD_ONLY)
    }

    return func(*args, **{key: value for key, value in kwargs.items() if key in allowed})


def filter_kwargs(func, kwargs):
    try:
        signature = inspect.signature(func)
    except (TypeError, ValueError):
        return dict(kwargs)

    parameters = list(signature.parameters.values())

    if any(param.kind == param.VAR_KEYWORD for param in parameters):
        return dict(kwargs)

    allowed = {
        param.name for param in parameters
        if param.kind in (param.POSITIONAL_OR_KEYWORD, param.KEYWORD_ONLY)
    }

    return {key: value for key, value in kwargs.items() if key in allowed}


# ════════════════════════════════════════════════════════════════════════════
# Normalização do resultado do alinhador
# ════════════════════════════════════════════════════════════════════════════

def normalize_results(results):
    """Converte a saída do alinhador em [{ text, start, end }]."""
    if results is None:
        return []

    if isinstance(results, dict):
        results = results.get("segments") or results.get("words") or results.get("result") or []

    words = []

    for item in results:
        text = start = end = None

        if isinstance(item, dict):
            text = item.get("text")
            if text is None:
                text = item.get("word")
            if text is None:
                text = item.get("words")
            start = item.get("start", item.get("start_time", item.get("startTime")))
            end = item.get("end", item.get("end_time", item.get("endTime")))
        elif isinstance(item, (list, tuple)):
            if len(item) >= 3:
                text, start, end = item[0], item[1], item[2]
            elif len(item) == 2:
                text, start = item[0], item[1]
                end = start
        else:
            text = getattr(item, "text", None) or getattr(item, "word", None)
            start = getattr(item, "start", None)
            end = getattr(item, "end", None)

        if text is None or start is None:
            continue

        cleaned = str(text).strip()
        if not cleaned or cleaned.lower() in NOISE_TOKENS:
            continue

        try:
            start_value = float(start)
        except (TypeError, ValueError):
            continue

        try:
            end_value = float(end) if end is not None else start_value
        except (TypeError, ValueError):
            end_value = start_value

        if end_value < start_value:
            end_value = start_value

        words.append({
            "text": cleaned,
            "start": round(max(0.0, start_value), 3),
            "end": round(max(0.0, end_value), 3),
        })

    return words


def load_model_with_fallback(loader, device, model_name):
    """Carrega o modelo tentando os nomes de parâmetro usados pelas versões conhecidas."""
    import torch

    base_kwargs = {"dtype": torch.float32}
    candidates = [
        {"model_path": model_name},
        {"model": model_name},
        {"model_name_or_path": model_name},
        {},
    ]

    last_error = None

    for extra in candidates:
        kwargs = filter_kwargs(loader, {**base_kwargs, **extra})
        try:
            loaded = loader(device, **kwargs)
        except TypeError as error:
            last_error = error
            continue

        used_model = model_name if extra else DEFAULT_MODEL
        if not extra:
            log("Modelo personalizado não aceito pela assinatura; usando o modelo padrão.")
        return (*loaded, used_model)

    raise last_error or AlignmentError("ALIGNMENT_MODEL_LOAD_FAILED", "Não foi possível carregar o modelo.")


# ════════════════════════════════════════════════════════════════════════════
# Alinhamento
# ═════════════════════════════════════════════════════════════════════════════

def align_with_python_api(args, text, language):
    import torch

    torch.set_num_threads(max(1, int(args.threads)))
    try:
        torch.set_num_interop_threads(1)
    except Exception:
        pass

    from ctc_forced_aligner import (
        load_audio,
        load_alignment_model,
        generate_emissions,
        preprocess_text,
        get_alignments,
        get_spans,
        postprocess_results,
    )

    alignment_model, alignment_tokenizer, used_model = load_model_with_fallback(
        load_alignment_model, "cpu", args.model
    )

    def run():
        waveform = load_audio(args.audio, alignment_model.dtype, alignment_model.device)

        tokens = call_filtered(
            preprocess_text,
            text,
            romanize=bool(args.romanize),
            language=language,
        )

        emissions, stride = call_filtered(
            generate_emissions,
            alignment_model,
            waveform,
            batch_size=max(1, int(args.batch_size)),
            window_size=float(args.window_size),
            context_size=float(args.context_size),
        )

        alignment_output = get_alignments(emissions, tokens, alignment_tokenizer)

        if isinstance(alignment_output, tuple) and len(alignment_output) >= 3:
            segments, scores, blank_token = alignment_output[0], alignment_output[1], alignment_output[2]
        elif isinstance(alignment_output, tuple) and len(alignment_output) == 2:
            segments, scores = alignment_output
            blank_token = getattr(alignment_tokenizer, "pad_token_id", 0) or 0
        else:
            segments, scores, blank_token = alignment_output, None, 0

        spans = call_filtered(
            get_spans,
            tokens,
            segments,
            blank_token,
            star_frequency="edges",
            merge_threshold=0.0,
        )

        return call_filtered(postprocess_results, tokens, spans, stride, offset=0)

    try:
        raw_results = run()
    finally:
        del alignment_model
        del alignment_tokenizer
        gc.collect()

    return normalize_results(raw_results), used_model, "ctc-forced-aligner-python"


def align_with_cli(args, text, language):
    """Fallback: usa o executável `ctc-forced-aligner` (mesma versão 1.0.2)."""
    import subprocess

    temp_text = f"{args.text_file}.cli.txt"
    with open(temp_text, "w", encoding="utf-8") as handle:
        handle.write(text)

    command = [
        "ctc-forced-aligner",
        "--audio_path", args.audio,
        "--text_path", temp_text,
        "--language", language,
        "--split_size", "word",
        "--device", "cpu",
        "--compute_dtype", "float32",
        "--batch_size", str(max(1, int(args.batch_size))),
        "--window_size", str(float(args.window_size)),
        "--context_size", str(float(args.context_size)),
        "--alignment_model", args.model,
    ]

    if args.romanize:
        command.append("--romanize")

    completed = subprocess.run(
        command,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
        check=False,
    )

    if completed.returncode != 0:
        raise AlignmentError(
            "ALIGNMENT_CLI_FAILED",
            f"O executável do alinhador falhou: {completed.stderr.strip()[-400:]}",
        )

    payload = None
    for line in reversed((completed.stdout or "").strip().splitlines()):
        line = line.strip()
        if line.startswith("{") and line.endswith("}"):
            try:
                payload = json.loads(line)
                break
            except json.JSONDecodeError:
                continue

    if payload is None:
        for candidate in (args.audio, temp_text):
            for suffix in (".json", ".aligned.json"):
                guess = f"{candidate}{suffix}"
                if os.path.exists(guess):
                    with open(guess, "r", encoding="utf-8") as handle:
                        payload = json.load(handle)
                    break
            if payload is not None:
                break

    if payload is None:
        raise AlignmentError("ALIGNMENT_CLI_NO_OUTPUT", "O alinhador não devolveu resultados.")

    segments = payload.get("segments") if isinstance(payload, dict) else payload
    return normalize_results(segments), args.model, "ctc-forced-aligner-cli"


# ═════════════════════════════════════════════════════════════════════════════

def main():
    args = parse_args()
    started_at = time.time()
    language = str(args.language or "por").strip().lower() or "por"

    try:
        text = load_text(args.text_file)
    except Exception as error:
        emit({
            "_output": args.output,
            "success": False,
            "code": "ALIGNMENT_TEXT_READ_ERROR",
            "error": f"Não foi possível ler a letra enviada: {error}",
        }, 1)

    words_in_text = [word for word in text.split() if word.strip()]

    if not words_in_text:
        emit({
            "_output": args.output,
            "success": False,
            "code": "ALIGNMENT_TEXT_EMPTY",
            "error": "A letra enviada não possui palavras para sincronizar.",
        }, 1)

    if args.self_test:
        emit({
            "_output": args.output,
            "success": True,
            "selfTest": True,
            "alignerAvailable": aligner_available(),
            "alignerVersion": package_version(),
            "model": args.model,
            "language": language,
            "threads": args.threads,
            "wordCount": len(words_in_text),
            "audioExists": os.path.exists(args.audio),
        }, 0)

    if not os.path.exists(args.audio):
        emit({
            "_output": args.output,
            "success": False,
            "code": "ALIGNMENT_AUDIO_NOT_FOUND",
            "error": "O áudio para sincronização não foi encontrado no servidor.",
        }, 1)

    if not aligner_available():
        emit({
            "_output": args.output,
            "success": False,
            "code": "ALIGNER_UNAVAILABLE",
            "error": (
                "O pacote ctc-forced-aligner não está instalado no servidor. "
                "Instale com: pip install ctc-forced-aligner[torch]==1.0.2"
            ),
        }, 1)

    duration = wav_duration_seconds(args.audio)
    log(f"alinhando {len(words_in_text)} palavras em {duration or '?'}s de áudio (idioma {language})")

    try:
        words, used_model, engine = align_with_python_api(args, text, language)
    except AlignmentError:
        raise
    except Exception as api_error:
        log(f"API Python falhou ({api_error}); tentando o executável do alinhador…")
        try:
            words, used_model, engine = align_with_cli(args, text, language)
        except Exception as cli_error:
            message = str(cli_error) or str(api_error)
            lowered = message.lower()
            code = "ALIGNMENT_FAILED"
            if "no module named" in lowered:
                code = "ALIGNER_UNAVAILABLE"
            elif "memory" in lowered or "killed" in lowered or "allocate" in lowered:
                code = "ALIGNMENT_OUT_OF_MEMORY"
            emit({
                "_output": args.output,
                "success": False,
                "code": code,
                "error": message[-600:],
            }, 1)

    if not words:
        emit({
            "_output": args.output,
            "success": False,
            "code": "ALIGNMENT_EMPTY_RESULT",
            "error": "O alinhador não encontrou palavras cantadas no áudio enviado.",
        }, 1)

    gc.collect()

    emit({
        "_output": args.output,
        "success": True,
        "language": language,
        "model": used_model,
        "engine": engine,
        "audioDuration": duration,
        "elapsedSeconds": round(time.time() - started_at, 2),
        "words": words,
    }, 0)


if __name__ == "__main__":
    main()