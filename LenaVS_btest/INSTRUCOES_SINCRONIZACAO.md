# Sincronização automática de letras (LenaVS)

O usuário envia **apenas** a música original em áudio + a letra. O sistema analisa
os dois e descobre automaticamente o tempo em que cada palavra é cantada.

- **início do bloco** = início da primeira palavra do bloco
- **fim do bloco** = fim da última palavra do bloco
- o **texto** e a **divisão em blocos** da letra **não são alterados**
- no Editor de Letras aparece **somente MM:SS** (sem milissegundos)

Ferramenta usada: **`ctc-forced-aligner==1.0.2`**.

---

## 1. O que foi adicionado (nada existente foi modificado em comportamento)

| Arquivo | O que faz |
| --- | --- |
| `scripts/forced_align_words.py` | Roda o ctc-forced-aligner em processo filho e devolve as palavras com tempos em JSON. |
| `scripts/prefetch_aligner_model.py` | Pré-baixa o modelo de alinhamento para o cache (usado no build). |
| `src/services/alignmentQueue.js` | Fila com **concorrência 1**, timeout, checagem de memória livre e kill garantido. |
| `src/controllers/alignmentController.js` | Baixa o áudio, converte para WAV 16 kHz mono, alinha, mapeia para os blocos e responde. |
| `src/utils/lyricsAlignment.js` | Mapeia palavra → bloco **original** (sem re-tokenizar a letra) e formata MM:SS. |
| `src/routes/media.js` | Novas rotas `POST /api/media/sync-lyrics` e `GET /api/media/sync-lyrics/status`. |

Nenhuma alteração em: cadastro/login (`routes/auth.js`, `userController.js`),
projetos (`routes/projects.js`), editor de letras (frontend `LyricsEditorPanel.jsx`),
projetos públicos/privados, pagamentos ou geração de vídeo.

---

## 2. Instalação do alinhador (servidor com 1 CPU e 2 GB de RAM)

O `Dockerfile` já instala tudo em um **venv isolado** (`/opt/aligner`), para não
misturar o PyTorch com o runtime do Node:

```bash
python3 -m venv /opt/aligner
/opt/aligner/bin/pip install torch==2.2.2 torchaudio==2.2.2 \
    --index-url https://download.pytorch.org/whl/cpu
/opt/aligner/bin/pip install "ctc-forced-aligner[torch]==1.0.2"
```

O build também **pré-baixa o modelo** (~1,2 GB, `MahmoudAshraf/mms-300m-1130-forced-aligner`),
senão a primeira sincronização do usuário faria o download em tempo real.

Se quiser uma imagem menor/rápida sem o recurso:

```bash
docker build --build-arg INSTALL_ALIGNER=false -t lenavs-backend .
```

Em instalação manual (VPS sem Docker):

```bash
pip install "ctc-forced-aligner[torch]==1.0.2"   # requer ffmpeg instalado
export ALIGNER_PYTHON_BIN=$(which python3)
npm run prefetch:aligner      # baixa o modelo uma única vez
npm run verify:aligner        # confirma que o pacote está visível
```

### Variáveis de ambiente

| Variável | Padrão | Para que serve |
| --- | --- | --- |
| `ALIGNER_PYTHON_BIN` | `/opt/aligner/bin/python3` (se existir) ou `python3` | Interpretador do alinhador. |
| `ALIGNMENT_LANGUAGE` | `por` | Código ISO-639-3 do idioma (português = `por`). |
| `ALIGNMENT_THREADS` | `1` | Threads de CPU (mantenha 1 no plano de 1 CPU). |
| `ALIGNMENT_BATCH_SIZE` | `2` | Batch da inferência (menor = menos RAM). |
| `ALIGNMENT_WINDOW_SIZE` / `ALIGNMENT_CONTEXT_SIZE` | `30` / `2` | Janela e sobreposição do áudio (s). |
| `ALIGNMENT_TIMEOUT_MS` | `1500000` (25 min) | Limite por sincronização (kill do processo ao estourar). |
| `ALIGNMENT_MIN_FREE_MEMORY_MB` | `1000` | Se a RAM livre for menor, a sincronização recusa com HTTP 503. |
| `ALIGNMENT_MAX_AUDIO_SECONDS` | `900` (15 min) | Mesmo limite de áudio já usado no upload. |
| `ALIGNMENT_ROMANIZE` | `true` | Romanização (necessária para o modelo multilíngue). |

---

## 3. Como o processamento fica econômico (1 CPU / 2 GB)

1. **Uma sincronização por vez** — fila FIFO com concorrência 1 (`alignmentQueue.js`).
   A segunda requisição entra na fila; a partir da terceira responde `429`.
2. **Processo filho** — o Python roda via `spawn`; ao terminar, **toda a RAM volta para o SO**
   (sem vazamento no processo do Node).
3. **1 thread** — `OMP_NUM_THREADS=1`, `MKL_NUM_THREADS=1`, `torch.set_num_threads(1)`.
4. **CPU + float32** — `dtype=torch.float32` no dispositivo `cpu`.
5. **Áudio normalizado** — ffmpeg converte para **WAV 16 kHz mono** antes de alinhar
   (bem mais leve e rápido que decodificar o arquivo original).
6. **Janelas de 30 s** — a inferência processa o áudio em blocos, limitando o pico de memória.
7. **Checagem de memória** — antes de iniciar, exige ~1 GB livre.
8. **Timeout com kill** — processo zumbi nunca fica segurando CPU/RAM.
9. **Limpeza** — áudio baixado, WAV, TXT e JSON temporários são apagados no `finally`.
10. **Modelo liberado** — `gc.collect()` após o alinhamento e descarte do processo.

---

## 4. API

### `POST /api/media/sync-lyrics`

Requer autenticação + acesso ativo (mesmos middlewares do upload).

```json
{
  "audioUrl": "https://…/musica-original.mp3",
  "stanzas": [ { "text": "Eu quero cantar\nSegunda linha" }, { "text": "Outro bloco" } ]
}
```

Resposta:

```json
{
  "success": true,
  "engine": "ctc-forced-aligner-python",
  "language": "por",
  "audioDuration": 123.45,
  "words": [ { "text": "Eu", "start": 10.02, "end": 10.45 } ],
  "blocks": [
    { "index": 0, "startTime": "00:10", "endTime": "00:12",
      "startSeconds": 10.02, "endSeconds": 12.51,
      "wordCount": 5, "alignableWordCount": 5 }
  ],
  "meta": { "mode": "anchors", "reliable": true, "anchorCount": 5,
            "alignedWordCount": 5, "lyricWordCount": 5, "elapsedSeconds": 41.2 }
}
```

Os tempos completos ficam no backend (`startSeconds`/`endSeconds`); a UI do
Editor de Letras usa apenas `startTime`/`endTime` em **MM:SS**.

### `GET /api/media/sync-lyrics/status`

Diagnóstico leve (não processa áudio): fila, RAM livre, jobs concluídos.

---

## 5. Teste rápido no servidor

```bash
# 1) O script está saudável e consegue ver o pacote?
/opt/aligner/bin/python3 scripts/forced_align_words.py --self-test \
  --audio /dev/null --text-file /tmp/letra.txt --output /tmp/out.json

# 2) O endpoint está respondendo? (precisa do token do usuário)
curl -H "Authorization: Bearer <TOKEN>" https://SEU_BACKEND/api/media/sync-lyrics/status
```

---

## 6. Limitações conhecidas

- O recurso **pode não funcionar 100%** (a própria interface avisa). Letras muito
  distantes do que é cantado, música sem voz ou com muitos efeitos tendem a gerar
  tempos aproximados — nesse caso a resposta volta com `meta.reliable: false`.
- O modelo padrão é multilíngue; para outro idioma troque `ALIGNMENT_LANGUAGE`
  (ex.: `eng`, `spa`).
- Em plano com 1 CPU, uma música de 4–5 minutos costuma levar alguns minutos.
