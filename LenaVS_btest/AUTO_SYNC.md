# Sincronização automática (Lyrics Aligner)

Este guia cobre o sistema de sincronização automática adicionado ao LenaVS.

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
   última palavra consumida. Se o alinhador não identificar as palavras de um
   bloco, ele mantém os tempos que já tinha — nunca recebe tempo inventado.

4. O usuário **não precisa reorganizar a letra** para usar a sincronização
   automática. No painel **Arquivos** existe o botão **"Sincronizar
   automaticamente"**, abaixo do botão **"Criar instrumental com IA"**, com a
   observação **"este recurso pode não 100% funcional"**. Ele só fica clicável
   depois que o usuário faz upload de música original **e** letra. O editor
   continua mostrando **somente minutos e segundos (mm:ss)**, sem
   milissegundos.

## Novidades no backend

| Arquivo | Papel |
| --- | --- |
| `src/services/lyricsAlignerService.js` | Motor de alinhamento (download do áudio → WAV mono 16kHz → guia vocal via FFmpeg → ctc-forced-aligner → mapeamento por consumo sequencial de tokens) |
| `scripts/lyrics_aligner.py` | Script Python do Lyrics Aligner — saída JSON `[{word, start, end}]` |
| `src/controllers/autoSyncController.js` | `POST /api/lyrics/auto-sync` |
| `src/routes/autoSync.js` | Rota autenticada (`authenticateToken` + `requireActiveAccess`) |
| `requirements-lyrics-aligner.txt` | Dependências Python do Lyrics Aligner |

### Instalação do Lyrics Aligner

O Lyrics Aligner usa o pacote
[ctc-forced-aligner](https://github.com/MahmoudAshraf97/ctc-forced-aligner)
(Hugging Face MMS / Wav2Vec2 / HuBERT — suporte a mais de 1000 línguas).
**FFmpeg é pré-requisito.**

```bash
# versão estável:
pip install ctc-forced-aligner

# ou a versão mais recente do GitHub:
pip install git+https://github.com/MahmoudAshraf97/ctc-forced-aligner.git
```

O build do Render (`render-build.sh`) já instala
`requirements-lyrics-aligner.txt` automaticamente junto com as dependências do
Demucs. O modelo padrão é `MahmoudAshraf/mms-300m-1130-forced-aligner`
(baixado automaticamente na primeira execução).

### Fluxo da sincronização

```
Frontend                         Backend                          Lyrics Aligner
────────                         ───────                          ──────────────
POST /api/lyrics/auto-sync  →    autoSyncLyrics()
  { audioUrl, blocks }           └─ syncLyricsStanzasWithAligner()
                                    └─ alignLyricsWordsWithAudio() ──► ctc-forced-aligner
                                       (letra do usuário = referência)  [{word,start,end}]
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

- `FilesPanel.jsx`: novo botão **"Sincronizar automaticamente"** no painel
  **Arquivos**, abaixo de **"Criar instrumental com IA"**, com a observação
  **"este recurso pode não 100% funcional"**. Só fica clicável com música
  original **e** letra já enviadas (`canAutoSync`). Envia os blocos
  **exatamente como estão** e aplica os tempos recebidos por índice — nenhum
  bloco é criado, excluído, dividido, juntado ou reorganizado.
- `Editor.jsx`: novo callback `handleStanzasSynced` aplica os tempos
  sincronizados mantendo a estrutura de blocos existente.
