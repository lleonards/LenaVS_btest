# Sincronização automática (Lyrics Aligner)

Este guia cobre o sistema de sincronização automática do LenaVS.

## Como funciona

1. **Lyrics Aligner = motor de alinhamento.** Ele analisa a música junto com a
   letra fornecida pelo usuário e identifica o momento exato em que cada
   palavra da letra é cantada, gerando um timer para cada palavra. Ele usa
   forced alignment (a letra do usuário é a transcrição de referência) — não
   usa transcrição do ASR.

2. **LenaVS = usa esses timers para definir o início e o final de cada bloco.**
   A organização em blocos que já existe na LenaVS é mantida exatamente como
   está. O Lyrics Aligner **não** cria, exclui, divide, junta ou reorganiza
   blocos.

3. O mapeamento é por **consumo sequencial de tokens**: os blocos são
   tokenizados na ordem exata em que o usuário escreveu, e cada bloco consome,
   a partir do cursor, a mesma quantidade de palavras que ele já tem.
   `bloco.start` = tempo da primeira palavra consumida; `bloco.end` = tempo da
   última palavra consumida. Os tempos vêm **dos timestamps reais do
   alinhador** — nunca de uma divisão aproximada da duração da música. Se o
   alinhador não identificar as palavras de um bloco, o bloco mantém os tempos
   que já tinha — nunca recebe tempo inventado.

4. O usuário **não precisa informar manualmente os tempos**. No painel
   **Arquivos** existe o botão **"Sincronizar automaticamente"**, abaixo do
   botão **"Criar instrumental com IA"**. Ele só fica clicável depois que o
   usuário faz upload de música original **e** letra. Depois do processamento,
   os blocos já aparecem posicionados nos tempos encontrados pelo Aligner —
   e o usuário pode ajustar manualmente quando quiser. O editor mostra
   somente minutos e segundos (mm:ss), sem milissegundos.

## Ambiente obrigatório (Python 3.12)

O `ctc-forced-aligner==1.0.2` exige **Python 3.12**. A instalação é feita em
uma venv dedicada (`.venv-aligner`) para o Node nunca executar o script num
Python errado.

```bash
# 1) FFmpeg é pré-requisito
sudo apt-get install -y ffmpeg libsndfile1   # Debian/Ubuntu

# 2) Cria .venv-aligner (Python 3.12) e instala requirements
bash scripts/setup_aligner_venv.sh

# 3) Confirmação (opcional)
.venv-aligner/bin/python -c "from importlib.metadata import version; print(version('ctc-forced-aligner'))"
# → 1.0.2
```

> **IMPORTANTE — pinado em 1.0.2.** NÃO mudar para `ctc-forced-aligner==2.0.1`:
> a API Python mudou entre as versões (a 2.x expõe `load_alignment_model` e
> usa o modelo Hugging Face MMS; a 1.0.2 usa `AlignmentSingleton` + modelo
> ONNX e retorna a palavra na chave `text`). O `scripts/lyrics_aligner.py`
> valida a versão no startup e aborta com mensagem clara se encontrar 2.x.

**Modelo:** na 1.0.2 o modelo é o ONNX da Deskpai
(`https://huggingface.co/deskpai/ctc_forced_aligner/.../04ac86b6....onnx`,
~1,2 GB), baixado automaticamente na primeira execução para
`~/ctc_forced_aligner/model.onnx`. Para apontar outro caminho, defina
`LYRICS_ALIGNER_MODEL_PATH`.

## Novidades no backend

| Arquivo | Papel |
| --- | --- |
| `src/services/lyricsAlignerService.js` | Motor de alinhamento (download do áudio → WAV mono 16kHz → guia vocal via FFmpeg → ctc-forced-aligner 1.0.2 → clamp à duração real → mapeamento por consumo sequencial de tokens) |
| `scripts/lyrics_aligner.py` | Script Python do Lyrics Aligner (API 1.0.2) — saída JSON `[{word, start, end}]` |
| `scripts/setup_aligner_venv.sh` | Cria a venv `.venv-aligner` com Python 3.12 e instala `requirements-lyrics-aligner.txt` |
| `src/controllers/autoSyncController.js` | `POST /api/lyrics/auto-sync` |
| `src/routes/autoSync.js` | Rota autenticada (`authenticateToken` + `requireActiveAccess`) |
| `requirements-lyrics-aligner.txt` | Dependências Python (pinadas em `ctc-forced-aligner==1.0.2`) |

### Execução

- O serviço Node detecta automaticamente `.venv-aligner/bin/python`
  (Python 3.12) e o usa para rodar o script. Para sobrescrever, defina
  `LYRICS_ALIGNER_PYTHON` para o caminho do binário.
- Áudios com menos de ~35s recebem silêncio de preenchimento (`apad`) só o
  suficiente para o ONNX processar uma janela; os tempos resultantes são
  limitados à duração real da música (`clampWordTimesToDuration`), para o
  silêncio não gerar blocos além do fim da faixa.

### Variáveis de ambiente

| Variável | Padrão | Descrição |
| --- | --- | --- |
| `LYRICS_ALIGNER_ENABLED` | `1` | `0` desativa a rota (responde 503) |
| `LYRICS_ALIGNER_PYTHON` | venv `.venv-aligner` | Binário Python 3.12 que executa o script |
| `LYRICS_ALIGNER_LANGUAGE` | `por` | ISO 639-3 da letra |
| `LYRICS_ALIGNER_DEVICE` | `cpu` | `cpu` ou `cuda` (cuda exige `onnxruntime-gpu`) |
| `LYRICS_ALIGNER_MODEL_PATH` | `~/ctc_forced_aligner/model.onnx` | Caminho do modelo ONNX |
| `LYRICS_ALIGNER_BATCH_SIZE` | `4` | Tamanho do batch de inferência |
| `LYRICS_ALIGNER_TIMEOUT_MS` | `900000` | Tempo limite do alinhamento |

### Fluxo da sincronização

```
Frontend                         Backend                          Lyrics Aligner
────────                         ───────                          ──────────────
POST /api/lyrics/auto-sync  →    autoSyncLyrics()
  { audioUrl, blocks }           └─ syncLyricsStanzasWithAligner()
                                    └─ alignLyricsWordsWithAudio() ──► ctc-forced-aligner 1.0.2
                                       (letra do usuário = referência)  [{word,start,end}]
                                    └─ clampWordTimesToDuration()
                                    └─ mapAlignedWordsToBlocks()
                                       consumo sequencial de tokens
 resposta:                    ◄──
  { success, engine,
    blocks: [{text, startTime, endTime}] }
```

`startTime`/`endTime` chegam em **segundos com milissegundos** (ex.: `10.012`).
O frontend converte para **mm:ss** com `formatFixedTimecode` — o editor nunca
mostra milissegundos.

## Novidades no frontend

- `FilesPanel.jsx`: botão **"Sincronizar automaticamente"** no painel
  **Arquivos**, abaixo de **"Criar instrumental com IA"**. Envia os blocos
  **exatamente como estão** e aplica os tempos recebidos por índice — nenhum
  bloco é criado, excluído, dividido, juntado ou reorganizado.
- Mensagens durante o processamento:
  - Ao iniciar: **"🎵 Estamos ouvindo a música para sincronizar sua letra
    automaticamente..."**
  - Ao concluir: **"✨ Pronto! Sua letra foi sincronizada automaticamente."**
  - Em erro: mensagem amigável ("Não conseguimos concluir a sincronização
    automática...") — nunca exibe erro técnico cru.
- `Editor.jsx`: callback `handleStanzasSynced` aplica os tempos
  sincronizados mantendo a estrutura de blocos existente.
