#!/usr/bin/env python3
"""align_lyrics.py

Alinha uma letra fornecida pelo usuário com o áudio usando o Lyrics Aligner
(ctc-forced-aligner==1.0.2, pipeline ONNX).

O Lyrics Aligner é usado APENAS para descobrir os tempos de cada palavra
cantada. Ele NÃO cria, exclui, divide, junta nem reorganiza blocos — a
estrutura de blocos da letra permanece sempre sob controle da LenaVS, que
recebe aqui apenas { start, end } por palavra.

Entradas:
  --audio       caminho do arquivo de áudio (mp3/wav/…)
  --transcript  caminho do arquivo de texto com a letra (uma linha por bloco)
  --language    código ISO-639-3 do idioma (padrão: "por" — português)

Saída:
  UMA linha de JSON em stdout no formato:
  {
    "language": "por",
    "words": [{ "word": "De", "start": 12.4, "end": 12.65, "score": 0.98 }, ...]
  }

Requisitos:
  - Python 3.12 OBRIGATÓRIO (o script falha em qualquer outra versão).
  - ctc-forced-aligner==1.0.2 instalado (requirements-aligner.txt).
  - O modelo ONNX é baixado automaticamente na primeira execução.

Exemplo:
  python3 scripts/align_lyrics.py --audio musica.mp3 --transcript letra.txt
"""

import argparse
import json
import os
import sys

# ── Python 3.12 obrigatório ─────────────────────────────────────────────────
if sys.version_info[:2] != (3, 12):
    found = f"{sys.version_info[0]}.{sys.version_info[1]}"
    print(
        json.dumps({
            "error": (
                f"O Lyrics Aligner exige Python 3.12, mas este ambiente está "
                f"usando Python {found}. Configure ALIGNER_PYTHON_BIN para o "
                f"binário do Python 3.12 (venv) e reinstale o "
                f"requirements-aligner.txt nele."
            )
        }),
        file=sys.stderr,
    )
    sys.exit(3)


def main() -> int:
    parser = argparse.ArgumentParser(description="Alinha letra com áudio (ctc-forced-aligner 1.0.2)")
    parser.add_argument("--audio", required=True, help="Caminho do arquivo de áudio")
    parser.add_argument("--transcript", required=True, help="Caminho do arquivo de texto com a letra")
    parser.add_argument("--language", default=os.environ.get("ALIGNER_LANGUAGE", "por"),
                        help="Código ISO-639-3 do idioma (ex.: por, eng, spa)")
    parser.add_argument("--model-path", default=os.environ.get("ALIGNER_MODEL_PATH", ""),
                        help="Caminho opcional do modelo ONNX (padrão: ~/ctc_forced_aligner/model.onnx)")
    parser.add_argument("--batch-size", type=int,
                        default=int(os.environ.get("ALIGNER_BATCH_SIZE", "4")),
                        help="Tamanho do batch da inferência ONNX")
    args = parser.parse_args()

    # Importes tardios para que a validação de versão rode primeiro.
    from ctc_forced_aligner import (
        load_audio,
        generate_emissions,
        preprocess_text,
        get_alignments,
        get_spans,
        postprocess_results,
        AlignmentSingleton,
    )

    if not os.path.isfile(args.audio):
        print(json.dumps({"error": f"Áudio não encontrado: {args.audio}"}), file=sys.stderr)
        return 2

    if not os.path.isfile(args.transcript):
        print(json.dumps({"error": f"Letra não encontrada: {args.transcript}"}), file=sys.stderr)
        return 2

    # A letra é enviada com uma linha por bloco; o aligner trabalha sobre o
    # texto completo, na ordem original das palavras.
    with open(args.transcript, "r", encoding="utf-8") as handle:
        text = " ".join(line.strip() for line in handle if line.strip())

    if not text.strip():
        print(json.dumps({"error": "A letra enviada está vazia."}), file=sys.stderr)
        return 2

    model_path = args.model_path or os.path.join(
        os.path.expanduser("~"), "ctc_forced_aligner", "model.onnx"
    )

    # AlignmentSingleton baixa o modelo ONNX automaticamente na 1ª execução
    # (fonte: deskpai/ctc_forced_aligner — ctc-forced-aligner==1.0.2).
    alignment = AlignmentSingleton(model_path=model_path)

    audio_waveform = load_audio(args.audio)  # numpy float32, 16 kHz, mono

    emissions, stride = generate_emissions(
        alignment.alignment_model,
        audio_waveform,
        batch_size=max(1, args.batch_size),
    )

    tokens_starred, text_starred = preprocess_text(
        text,
        romanize=True,  # necessário: o vocabulário do modelo é latino (a–z)
        language=args.language,
    )

    segments, scores, blank_token = get_alignments(
        emissions, tokens_starred, alignment.alignment_tokenizer
    )
    spans = get_spans(tokens_starred, segments, blank_token)
    word_timestamps = postprocess_results(text_starred, spans, stride, scores)

    result = {
        "language": args.language,
        "words": [
            {
                "word": str(word.get("text", "")),
                "start": round(float(word.get("start", 0.0)), 3),
                "end": round(float(word.get("end", 0.0)), 3),
                "score": round(float(word.get("score", 0.0)), 3),
            }
            for word in word_timestamps
            if word.get("text") != "<star>"
        ],
    }

    # Única linha de JSON em stdout — é assim que o backend faz o parse.
    print(json.dumps(result, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    sys.exit(main())
