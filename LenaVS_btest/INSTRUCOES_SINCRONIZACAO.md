# Sincronização automática de letras (LenaVS)

O usuário envia **apenas** a música original (áudio) e a letra. O sistema
descobre automaticamente **o tempo em que cada palavra é cantada** e, a partir
disso, define o tempo de cada bloco/estrofe:

- **início do bloco** = início da primeira palavra
- **fim do bloco** = fim da última palavra

O texto e a divisão em blocos **não são alterados** — só os tempos.
O Editor de Letras mostra apenas `MM:SS`, sem milissegundos.

```
Eu quero cantar        →  Eu 00:10 · quero 00:11 · cantar 00:12
Resultado do bloco     →  00:10 → 00:12
```

## Motor

`ctc-forced-aligner==1.0.2` (ONNX Runtime, CPU) com o modelo padrão do pacote.
O alinhador devolve o tempo de cada palavra; a agregação por bloco acontece em
`scripts/lyrics_align.py`.

## Instalação (servidor de 1 CPU / 2 GB de RAM)

A imagem Docker já traz `python3` e `ffmpeg`. O alinhador (torch/onnxruntime +
librosa + o modelo ONNX de ~1,2 GB) é **opcional** para manter o cold start
rápido.

```bash
# 1) Crie um venv exclusivo para o alinhador (não misture com o Demucs)
python3 -m venv /opt/lenavs-aligner
/opt/lenavs-aligner/bin/pip install --no-cache-dir --upgrade pip
/opt/lenavs-aligner/bin/pip install --no-cache-dir -r requirements-aligner.txt

# 2) Pré-baixe o modelo uma única vez (~1,2 GB) para não pagar o download
#    dentro da primeira sincronização
mkdir -p /opt/lenavs-aligner/models
LYRICS_ALIGN_MODEL_DIR=/opt/lenavs-aligner/models \
  /opt/lenavs-aligner/bin/python3 scripts/lyrics_align.py --warmup --out -

# 3) Verifique a instalação
/opt/lenavs-aligner/bin/python3 scripts/lyrics_align.py --check --out -
```

Build com o alinhador embutido:

```bash
docker build --build-arg INSTALL_ALIGNER=true -t lenavs-backend .
docker run --env-file .env lenavs-backend
```

### Variáveis de ambiente

| Variável | Padrão | Descrição |
| --- | --- | --- |
| `LYRICS_ALIGN_PYTHON_BIN` | `python3` | Python que contém o `ctc-forced-aligner` (use `/opt/lenavs-aligner/bin/python3`) |
| `LYRICS_ALIGN_LANGUAGE` | `por` | Idioma da letra em ISO 639-3 (`por`, `eng`, `spa`, `ita`, `fra`, …) |
| `LYRICS_ALIGN_MODE` | `align` | `align` = alinhamento real; `proportional` = plano B sem IA |
| `LYRICS_ALIGN_MODEL_DIR` | `~/.cache/lenavs/ctc-forced-aligner` | Pasta do modelo ONNX |
| `LYRICS_ALIGN_TIMEOUT_MS` | `1500000` | Tempo máximo por sincronização (25 min) |
| `LYRICS_ALIGN_BATCH_SIZE` | `1` | Janelas processadas por vez (memória) |
| `LYRICS_ALIGN_WINDOW_SECONDS` | `30` | Tamanho da janela de áudio |
| `LYRICS_ALIGN_CONTEXT_SECONDS` | `2` | Sobreposição entre janelas |
| `LYRICS_ALIGN_SCRIPT` | `<app>/scripts/lyrics_align.py` | Caminho do script |

## Economia de recursos

- Áudio convertido com ffmpeg para **WAV 16 kHz mono** antes de alinhar
  (~1,9 MB por minuto, contra dezenas de MB de um MP3 decodificado em 44,1 kHz).
- Python fixa `OMP/MKL/OPENBLAS/NUMEXPR_NUM_THREADS=1`, `batch_size=1` e sessão
  ONNX com `intra/inter_op_num_threads=1`, otimização básica e **sem arena de
  memória** — evita o processo abrir uma thread por núcleo detectado.
- **Fila serial**: apenas uma sincronização roda por vez (`enqueueSerial`).
- O processo Python **morre ao final de cada job**, devolvendo toda a RAM do
  modelo ao sistema operacional (nada fica residente no Node).
- Timeout por job + limpeza garantida de temporários no `finally`.
- Se o servidor ficar sem memória/tempo, o frontend recebe uma mensagem clara
  (HTTP 507/504) e a letra original permanece intacta.

## API

| Rota | Descrição |
| --- | --- |
| `POST /api/lyrics/sync` | Sincroniza. Body: `{ audioUrl, stanzas: string[] }` |
| `GET /api/lyrics/sync/status` | Diz se o alinhador está disponível e o tamanho da fila |
| `POST /api/lyrics/sync/warmup` | Pré-baixa/valida o modelo (manutenção) |

Resposta de `POST /api/lyrics/sync`:

```json
{
  "success": true,
  "engine": "ctc-forced-aligner-1.0.2",
  "mode": "forced-alignment",
  "language": "por",
  "durationSec": 192.4,
  "wordCount": 214,
  "elapsedSec": 96.2,
  "blocks": [
    { "index": 0, "startTime": "00:10", "endTime": "00:12",
      "startSec": 10.04, "endSec": 12.78, "wordCount": 3,
      "alignedWords": 3, "estimated": false }
  ],
  "words": [ { "block": 0, "text": "Eu", "start": 10.04, "end": 10.41 } ]
}
```

`words` (tempo por palavra) é devolvido para uso futuro; o Editor de Letras
consome apenas `blocks` (`startTime`/`endTime`).

## Arquivos desta funcionalidade

**Backend**

- `scripts/lyrics_align.py` — alinhador (CLI; `--check`, `--self-test`, `--warmup`, `--mode proportional`)
- `src/services/lyricsAlignService.js` — fila serial, download do áudio, ffmpeg → WAV, execução e limpeza
- `src/controllers/lyricsSyncController.js` — rotas e mensagens de erro amigáveis
- `src/utils/fixedTimecode.js` — segundos → `MM:SS`
- `src/routes/lyrics.js` — `GET /sync/status`, `POST /sync/warmup`, `POST /sync`
- `requirements-aligner.txt`, `Dockerfile` (`ARG INSTALL_ALIGNER`)

**Frontend**

- `src/components/FilesPanel.jsx` + `FilesPanel.css` — botão **Sincronizar automaticamente** abaixo de **Criar Instrumental com IA** + aviso
- `src/utils/useLyricsSync.js` — chamada à API e aplicação dos tempos
- `src/utils/lyricsSyncTimecode.js` — conversão para `MM:SS`
- `src/pages/Editor.jsx` — liga o painel Arquivos às estrofes atuais

## Testes rápidos

```bash
python3 scripts/lyrics_align.py --self-test --out -   # agregação bloco/palavra
python3 scripts/lyrics_align.py --check --out -       # dependências instaladas
```
