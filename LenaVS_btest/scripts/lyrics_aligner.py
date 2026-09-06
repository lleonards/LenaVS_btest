#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
lyrics_aligner.py — Sincronização automática de letras (LenaVS)
─────────────────────────────────────────────────────────────────────────────
Usa o pacote ctc-forced-aligner 1.0.2 (Python 3.12) para descobrir o tempo
(start/end) de cada palavra cantada e devolve, para cada bloco de letra, o
tempo do bloco = primeira palavra (start) até a última palavra (end).

IMPORTANTE:
  - A divisão em blocos feita pelo usuário é PRESERVADA exatamente como está.
    Este script apenas descobre TEMPOS; ele nunca cria, exclui, divide, junta
    ou reorganiza blocos.
  - O mapeamento é por ÍNDICE SEQUENCIAL de palavras (atalho do fluxo):
    blocos -> palavras achatadas na ordem do usuário -> alinhamento -> tempos
    de volta por índice. Nenhuma busca/reordenação de texto.
  - Interface:
      python3 lyrics_aligner.py <audio> <blocks.json> <out.json>
    blocks.json: {"blocks": [{"text": "..."}, ...]} (ordem = ordem do usuário)
    out.json:    {"success": true, "blockTimings": [{"start": s, "end": s}, ...]}
                 ou {"success": false, "error": "..."} (com exit != 0)

Variáveis de ambiente:
  LYRICS_ALIGNER_MODEL_TYPE   modelo do torchaudio (padrão MMS_FA — multilíngue,
                              cobre português, licença MIT).
                              Alternativas: VOXPOPULI_ASR_BASE_10K_ES,
                              VOXPOPULI_ASR_BASE_10K_EN, WAV2VEC2_ASR_BASE_960H,
                              WAV2VEC2_ASR_LARGE_960H etc.
  LYRICS_ALIGNER_ONNX_MODEL   caminho para um modelo ONNX (usa a classe
                              AlignmentSingleton). Atenção: o modelo ONNX padrão
                              do pacote é CC-BY-NC (uso não comercial).
"""

import json
import os
import re
import sys
import unicodedata


def clean_word(word):
    """Normaliza uma palavra para o alfabeto do alinhador ([a-z']), removendo
    acentos e caracteres especiais. Preserva a CONTAGEM e a ORDEM das palavras.
    Ex.: 'música' -> 'musica', 'você' -> 'voce', '♪' -> '' (descartada)."""
    normalized = unicodedata.normalize('NFKD', str(word).lower())
    normalized = ''.join(ch for ch in normalized if not unicodedata.combining(ch))
    return re.sub(r"[^a-z']", '', normalized)


def extract_valid_words(text):
    """Extrai as palavras alinháveis de um texto (sem quebrar a ordem)."""
    words = []
    for raw in re.split(r'\s+', str(text or '').strip()):
        cleaned = clean_word(raw)
        if cleaned:
            words.append(cleaned)
    return words


def map_blocks_to_timings(blocks, word_timestamps):
    """Associa os tempos das palavras (lista plana, ordem do usuário) de volta
    aos blocos, apenas por índice sequencial — nunca por busca de texto.

    word_timestamps: lista de dicts {start, end, text} na mesma ordem das
    palavras achatadas dos blocos.

    Retorna: [{"start": float, "end": float}, ...] na ordem dos blocos.
    """
    block_timings = []
    idx = 0

    for block in blocks:
        text = str(block.get('text') or '')
        words = extract_valid_words(text)

        if not words:
            raise ValueError('Bloco sem palavras alinháveis: "%s"' % text[:60])

        if idx + len(words) > len(word_timestamps):
            raise ValueError(
                'O alinhador não cobriu todas as palavras do bloco: "%s"' % text[:60]
            )

        chunk = word_timestamps[idx:idx + len(words)]
        idx += len(words)

        block_timings.append({
            'start': float(min(item['start'] for item in chunk)),
            'end': float(max(item['end'] for item in chunk)),
        })

    if idx != len(word_timestamps):
        raise ValueError('Há palavras alinhadas que não pertencem a nenhum bloco.')

    return block_timings


def run_alignment(audio_path, transcript_path, model_type):
    """Executa o forced alignment com ctc-forced-aligner 1.0.2
    (função pública get_word_stamps, trilha PyTorch/torchaudio — MMS_FA)."""
    from ctc_forced_aligner import get_word_stamps
    word_timestamps, _model, _lines = get_word_stamps(
        audio_path, transcript_path, model_type=model_type
    )
    return word_timestamps


def main():
    if len(sys.argv) != 4:
        sys.stderr.write('usage: lyrics_aligner.py <audio> <blocks.json> <out.json>\n')
        sys.exit(2)

    audio_path, blocks_path, out_path = sys.argv[1], sys.argv[2], sys.argv[3]

    try:
        with open(blocks_path, 'r', encoding='utf-8') as handle:
            payload = json.load(handle)

        blocks = payload.get('blocks') or []
        if not blocks:
            raise ValueError('Nenhum bloco de letra foi fornecido.')

        # 1) Achata os blocos em uma lista ordenada de palavras alinháveis.
        #    A ORDEM dos blocos do usuário é mantida de ponta a ponta.
        transcript_words = []
        for block in blocks:
            transcript_words.extend(extract_valid_words(block.get('text') or ''))

        if not transcript_words:
            raise ValueError('Nenhuma palavra válida foi encontrada na letra.')

        # 2) Escreve o transcript (uma palavra por linha) para o alinhador.
        transcript_path = os.path.splitext(out_path)[0] + '_transcript.txt'
        with open(transcript_path, 'w', encoding='utf-8') as handle:
            handle.write('\n'.join(transcript_words) + '\n')

        # 3) Roda o forced alignment (ctc-forced-aligner 1.0.2).
        model_type = os.environ.get('LYRICS_ALIGNER_MODEL_TYPE', 'MMS_FA')
        word_timestamps = run_alignment(audio_path, transcript_path, model_type)

        # 4) Guarda: contagem e ordem precisam bater (senão o mapeamento por
        #    índice não seria fiel à letra do usuário).
        if len(word_timestamps) != len(transcript_words):
            raise ValueError(
                'Inconsistência no alinhamento: %d palavra(s) alinhada(s) para '
                '%d palavra(s) da letra.'
                % (len(word_timestamps), len(transcript_words))
            )

        # 5) Associa os tempos de volta aos blocos, SEM alterar a estrutura.
        block_timings = map_blocks_to_timings(blocks, word_timestamps)

        with open(out_path, 'w', encoding='utf-8') as handle:
            json.dump({
                'success': True,
                'blockTimings': block_timings,
                'words': len(transcript_words),
            }, handle)

    except Exception as error:  # noqa: BLE001 — qualquer falha = saída atômica
        try:
            with open(out_path, 'w', encoding='utf-8') as handle:
                json.dump({'success': False, 'error': str(error)}, handle)
        except Exception:  # noqa: BLE001
            pass
        sys.stderr.write('lyrics_aligner error: %s\n' % error)
        sys.exit(1)


if __name__ == '__main__':
    main()
