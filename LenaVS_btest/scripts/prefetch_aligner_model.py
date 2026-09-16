#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
prefetch_aligner_model.py — baixa o modelo de alinhamento para o cache local.

Use no build/deploy (ou manualmente uma vez) para que a primeira sincronização
do usuário não precise baixar ~1,2 GB do Hugging Face (o que estouraria o
tempo de resposta e consumiria RAM/disco no servidor).

  python3 scripts/prefetch_aligner_model.py
  python3 scripts/prefetch_aligner_model.py --model MahmoudAshraf/mms-300m-1130-forced-aligner
"""

import argparse
import gc
import os
import sys

os.environ.setdefault("OMP_NUM_THREADS", "1")
os.environ.setdefault("MKL_NUM_THREADS", "1")
os.environ.setdefault("TOKENIZERS_PARALLELISM", "false")

DEFAULT_MODEL = "MahmoudAshraf/mms-300m-1130-forced-aligner"


def main():
    parser = argparse.ArgumentParser(description="Pré-baixa o modelo de alinhamento forçado.")
    parser.add_argument("--model", default=os.environ.get("ALIGNMENT_MODEL", DEFAULT_MODEL))
    args = parser.parse_args()

    import torch
    from ctc_forced_aligner import load_alignment_model

    torch.set_num_threads(1)

    print(f"Baixando/carregando o modelo {args.model} …", file=sys.stderr)

    model, tokenizer = load_alignment_model("cpu", dtype=torch.float32, model_path=args.model)

    del model
    del tokenizer
    gc.collect()

    print("Modelo disponível no cache local.", file=sys.stderr)


if __name__ == "__main__":
    main()