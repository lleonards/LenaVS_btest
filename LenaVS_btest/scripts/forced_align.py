#!/usr/bin/env python3
"""forced_align.py — Alinhamento forçado (CTC) da letra EXATA com o áudio.

───────────────────────────────────────────────────────────────────────────────
Conceito (inspirado no projeto open-source Lyrics Aligner / CTC segmentation):
  1. O usuário fornece a letra já organizada em blocos na LenaVS;
  2. NADA é reorganizado, dividido ou juntado: cada bloco é alinhado como está;
  3. Internamente o alinhamento trabalha palavra por palavra;
  4. Bloco.início = frame da 1ª palavra do bloco;
     Bloco.fim    = frame da última palavra do bloco.

Engine: torchaudio.pipelines.MMS_FA — modelo wav2vec2 multilingue (MMS) com
head CTC, 100% local, gratuito, open-source (Apache-2.0 / MIT). Sem API key.

Uso:
  python3 forced_align.py --audio <wav 16k mono> --blocks <blocks.json>

  blocks.json: {"blocks": [{"text": "Eu quero cantar"}, {"text": "..."}]}

Saída (stdout, JSON):
  {
    "engine": "torchaudio-mms-fa",
    "sample_rate": 16000,
    "duration": <segundos>,
    "words": [{"word": "...", "start": s, "end": e}, ...],
    "blocks": [
      {"index": 0, "text": "...original...", "start": s|null,
       "end": e|null, "matched": bool,
       "words": [{"word": "...", "start": s, "end": e}]},
      ...
    ]
  }

Observação: a normalização (minúsculas/acentos/pontuação) é APENAS interna,
para casar com o vocabulário CTC. O texto exibido na LenaVS nunca é alterado.
───────────────────────────────────────────────────────────────────────────────
"""

import argparse
import array
import json
import re
import sys
import unicodedata
import wave


def eprint(*args, **kwargs):
    print(*args, file=sys.stderr, **kwargs)


def load_wav(path):
    """Carrega um WAV PCM (8/16 bits) para tensor float32 (C=1, N) em 16 kHz.

    Usa apenas a biblioteca padrão (wave + array) — não depende de torchcodec,
    soundfile nem ffmpeg. O backend já entrega WAV mono 16 kHz pcm_s16le.
    """
    import torch

    with wave.open(path, 'rb') as w:
        sr = w.getframerate()
        nch = w.getnchannels()
        sw = w.getsampwidth()
        raw = w.readframes(w.getnframes())

    if sw == 2:
        arr = array.array('h', raw)
        if sys.byteorder != 'little':
            arr.byteswap()
        x = torch.frombuffer(arr, dtype=torch.int16).float().view(-1, nch) / 32768.0
    elif sw == 1:
        arr = array.array('B', raw)
        x = (torch.frombuffer(arr, dtype=torch.uint8).float().view(-1, nch) - 128.0) / 128.0
    else:
        raise RuntimeError(f'Profundidade de amostra {sw * 8} bits não suportada (use WAV PCM 8/16 bits).')

    if nch > 1:
        x = torch.mean(x, dim=1, keepdim=True)

    return x.t().contiguous(), sr


def normalize_char(ch):
    """Lowercase, remove acentos, mantém [a-z0-9]; todo o resto vira espaço."""
    if ch.isspace():
        return ' '
    s = ch.lower()
    s = ''.join(c for c in unicodedata.normalize('NFD', s) if unicodedata.category(c) != 'Mn')
    if re.match(r'[a-z0-9]', s):
        return s
    return ' '


def normalize_text(text):
    s = ''.join(normalize_char(c) for c in str(text or ''))
    s = re.sub(r'\s+', ' ', s).strip()
    return s


def split_words(text):
    return text.split(' ') if text else []


def frame_to_seconds(frame_idx, ratio, sample_rate):
    return frame_idx * ratio / float(sample_rate)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--audio', required=True, help='Caminho do WAV mono 16 kHz')
    parser.add_argument('--blocks', required=True, help='Caminho do JSON com os blocos')
    args = parser.parse_args()

    try:
        import torch  # noqa: F401
        import torchaudio
        import torchaudio.functional as F
    except ImportError as exc:
        eprint(f'[forced_align] ERROR: torch/torchaudio ausente: {exc}')
        sys.exit(2)

    if not hasattr(F, 'forced_align'):
        eprint('[forced_align] ERROR: torchaudio.functional.forced_align não encontrado (atualize o torchaudio >= 2.0)')
        sys.exit(2)

    with open(args.blocks, 'r', encoding='utf-8') as f:
        payload = json.load(f)

    raw_blocks = payload.get('blocks') or payload.get('stanzas') or []
    blocks = []
    for b in raw_blocks:
        if isinstance(b, dict):
            blocks.append({'text': str(b.get('text', ''))})
        else:
            blocks.append({'text': str(b)})

    blocks = [b for b in blocks if b['text'].strip()]

    if not blocks:
        print(json.dumps({'engine': 'torchaudio-mms-fa', 'sample_rate': 16000,
                          'duration': 0, 'words': [], 'blocks': []}, ensure_ascii=False))
        return

    # ── 1. Áudio ──────────────────────────────────────────────────────────────
    waveform, sr = load_wav(args.audio)
    if sr != 16000:
        waveform = torchaudio.functional.resample(waveform, sr, 16000)
        sr = 16000

    # ── 2. Modelo MMS_FA (wav2vec2 multilingue + CTC) ─────────────────────────
    bundle = torchaudio.pipelines.MMS_FA
    model = bundle.get_model()
    tokenizer = bundle.get_tokenizer()
    model.eval()

    with torch.inference_mode():
        emission, _ = model(waveform)  # (1, T', D) log-probabilidades

    emission = emission[0]  # (T', D)
    ratio = waveform.size(1) / emission.size(0)  # frames de áudio por frame CTC

    # ── 3. Texto normalizado (interno) + mapeamento bloco → palavras ──────────
    norm_blocks = [normalize_text(b['text']) for b in blocks]
    norm_words = []  # {'word', 'block'}
    for bi, txt in enumerate(norm_blocks):
        for w in split_words(txt):
            norm_words.append({'word': w, 'block': bi})

    segments = []  # (primeira palavra, última palavra) por bloco, inclusivo
    counter = 0
    for txt in norm_blocks:
        n = len(split_words(txt))
        segments.append((counter, counter + n - 1))
        counter += n

    full_text = ' '.join(w['word'] for w in norm_words) if norm_words else ''

    # ── 4. Tokenização (char-level) e CTC forced alignment ────────────────────
    #
    # O tokenizer do MMS_FA é nível de caractere. Diferentes versões tratam o
    # espaço de formas distintas (token próprio ou separador '|'). Tentamos as
    # duas estratégias e usamos a que reproduzir EXATAMENTE o texto fornecido.
    def tokenize_full(text, sep_mode):
        if sep_mode == 'pipe':
            seq = text.replace(' ', '|')
            return tokenizer(seq), seq
        return tokenizer(text), text

    def map_tokens_to_words(text_seq, toks):
        # word index por token (espaço/separador → -1)
        if len(toks) != len(text_seq):
            return None, False
        tok_word = []
        cur = -1
        prev_space = True
        for ch in text_seq:
            if ch == ' ' or ch == '|':
                tok_word.append(-1)
                prev_space = True
            else:
                if prev_space:
                    cur += 1
                tok_word.append(cur)
                prev_space = False
        return tok_word, True

    tokens = None
    tok_word = None
    for sep in ('spaces', 'pipe'):
        try:
            toks, seq = tokenize_full(full_text, sep)
            tw, ok = map_tokens_to_words(seq, toks)
            if ok and len(toks) > 0:
                tokens, tok_word = toks, tw
                break
        except Exception as exc:
            eprint(f'[forced_align] Aviso: estratégia de tokenização "{sep}" falhou: {exc}')

    if tokens is None:
        raise RuntimeError('Não foi possível tokenizar a letra para o vocabulário CTC (tokens != texto).')

    if not tok_word:
        out_blocks = [{
            'index': i, 'text': b['text'], 'start': None, 'end': None,
            'matched': False, 'words': [],
        } for i, b in enumerate(blocks)]
        print(json.dumps({'engine': 'torchaudio-mms-fa', 'sample_rate': sr,
                          'duration': round(waveform.size(1) / sr, 3),
                          'words': [], 'blocks': out_blocks}, ensure_ascii=False))
        return

    targets = torch.tensor([tokens], dtype=torch.int32)
    alignments, _scores = F.forced_align(emission.unsqueeze(0), targets, blank=0)
    align = alignments[0].tolist()  # id do token por frame CTC

    id2word = {t: tok_word[pos] for pos, t in enumerate(tokens)}
    id2word[0] = -1  # blank

    word_frames = {}
    for t_idx, token_id in enumerate(align):
        wi = id2word.get(token_id, -1)
        if wi is None or wi < 0:
            continue
        word_frames.setdefault(wi, []).append(t_idx)

    def secs(fr):
        return round(frame_to_seconds(fr, ratio, sr), 3)

    # ── 5. Palavras com tempos ────────────────────────────────────────────────
    words_out = []
    for wi, meta in enumerate(norm_words):
        frames = word_frames.get(wi)
        if frames:
            words_out.append({
                'word': meta['word'],
                'start': secs(min(frames)),
                'end': secs(max(frames) + 1),
            })
        else:
            words_out.append({'word': meta['word'], 'start': None, 'end': None})

    # ── 6. Blocos: início = 1ª palavra, fim = última palavra ──────────────────
    out_blocks = []
    for bi, b in enumerate(blocks):
        s, e = segments[bi]
        matched = [w for w in words_out[s:e + 1] if w['start'] is not None]
        if matched:
            out_blocks.append({
                'index': bi,
                'text': b['text'],
                'start': matched[0]['start'],
                'end': matched[-1]['end'],
                'matched': True,
                'words': matched,
            })
        else:
            out_blocks.append({
                'index': bi,
                'text': b['text'],
                'start': None,
                'end': None,
                'matched': False,
                'words': [],
            })

    result = {
        'engine': 'torchaudio-mms-fa',
        'sample_rate': sr,
        'duration': round(waveform.size(1) / sr, 3),
        'words': words_out,
        'blocks': out_blocks,
    }
    print(json.dumps(result, ensure_ascii=False))


if __name__ == '__main__':
    try:
        main()
    except Exception as exc:
        eprint(f'[forced_align] ERROR: {exc}')
        sys.exit(1)
