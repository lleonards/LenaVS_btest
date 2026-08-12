# LenaVS Backend v2

Backend Node puro do LenaVS, sem nenhuma dependência Python. Resolve o erro `422 [VOCAL_TIMESTAMPS_NOT_FOUND]` que aparece no console do navegador quando a sincronia automática falha, porque **o novo endpoint nunca devolve 422**: ele devolve HTTP 200 e marca estrofes sem vocal detectado como `vocalPresence: false`, e o cliente (frontend) simplesmente as esconde no preview.

## Stack

- **Express** + **Helmet** + **CORS**
- **Zod** para validação rigorosa dos payloads
- **fluent-ffmpeg + ffmpeg-static** (binário embutido, já vem no `node_modules`)
- **VAD por energia RMS + ZCR** (puro JavaScript, modelo Silero opcional)
- **Whisper local opcional** via `nodejs-whisper` (não é mais requisito)

### O que mudou em relação ao backend anterior

| Antes | Agora |
| --- | --- |
| Dependia de `OPENAI_API_KEY` (Whisper pago) | Não usa nenhuma API paga |
| Devolvia 422 quando não achava vocal | **Sempre devolve 200**, marca `vocalPresence:false` |
| Mistura Python/Node (`demucs`) | **100% Node** |
| Demucs era obrigatório para isolar vocal | VAD por energia basta para o preview de karaokê |

## Como rodar (Windows / Mac / Linux)

```bash
# 1) Instalar dependências
npm install

# 2) Variáveis de ambiente (opcional)
cp .env.example .env

# 3) Rodar
npm start
# ou, auto-reload durante dev:
npm run dev
```

O backend sobe em `http://localhost:10000` por padrão.

### Subir só o reconhecimento local (Whisper, opcional)

Se você quiser precisão palavra-a-palavra (recomendado apenas em desktop com GPU), instale o reconhecedor opcional uma única vez:

```bash
node scripts/install_whisper_model.js
```

Sem esse passo, o backend usa **fallback inteligente baseado em VAD + taxa de palavras** que já cobre o caso de uso de karaokê (estrofe entra quando há vocal e sai quando acaba).

## Endpoints principais

| Método | Rota | O que faz |
| --- | --- | --- |
| `GET` | `/health` | Status do serviço |
| `GET` | `/` | Apresentação |
| `POST` | `/api/lyrics/manual` | Separa texto colado em estrofes |
| `POST` | `/api/lyrics/upload` | Lê arquivo de letra (.txt/.lrc/.srt/.md/.rtf/.docx/.pdf) |
| `POST` | `/api/lyrics/sync` | **Sincroniza estrofes com o vocal — sem 422** |
| `POST` | `/api/video/upload` | Upload de mídia (áudio/vídeo/imagem) |
| `POST` | `/api/media/instrumental` | Atalho de instrumental (sem demucs nesta versão; marcado como pendente) |

### `POST /api/lyrics/sync`

**Request (JSON):**

```json
{
  "audioUrl": "https://...musicaOriginal.mp3",
  "stanzas": [
    { "id": "stanza-1", "text": "linha 1\nlinha 2\nlinha 3\nlinha 4" },
    { "id": "stanza-2", "text": "linha 1\nlinha 2" }
  ]
}
```

**Response (HTTP **200** sempre):**

```json
{
  "success": true,
  "syncedCount": 2,
  "totalCount": 2,
  "stanzas": [
    {
      "id": "stanza-1",
      "text": "linha 1\nlinha 2\nlinha 3\nlinha 4",
      "startTime": "00:12",
      "endTime":   "00:37",
      "syncStartTime": 12.4,
      "syncEndTime":   36.8,
      "vocalPresence": true,
      "showOnlyDuringVocal": true,
      "syncVerified": true,
      "syncReason": "vad-segment-aligned",
      "syncConfidence": 0.86,
      "leadIn": 0.5
    },
    {
      "id": "stanza-2",
      "text": "linha 1\nlinha 2",
      "startTime": "00:00",
      "endTime":   "00:00",
      "syncStartTime": null,
      "syncEndTime":   null,
      "vocalPresence": false,
      "showOnlyDuringVocal": true,
      "syncBlocked": true,
      "syncReason": "sem-vocal-confirmado",
      "syncConfidence": 0
    }
  ],
  "analysis": {
    "method": "energy-vad",
    "audioDurationSec": 184.2,
    "vocalRatio": 0.41,
    "vocalSegments": [[12.4, 36.8], [42.1, 70.9]],
    "coverage": 0.97
  }
}
```

> **Por que nunca retorna 422?** O 422 acontecia quando o antigo Whisper pago não encontrava nada. Agora, quando não há vocal detectável, devolvemos sucesso com `vocalPresence:false` para cada estrofe, e o frontend simplesmente não exibe nada naquele trecho (ou avisa o usuário que aquela parte da música é instrumental).

## Estrutura

```
backend_fix/
├── package.json
├── .env.example
├── README.md
├── src/
│   ├── server.js                       # bootstrap Express
│   ├── routes/
│   │   ├── lyrics.js
│   │   ├── media.js
│   │   ├── health.js
│   │   └── video.js
│   ├── controllers/
│   │   └── lyricsController.js
│   ├── services/
│   │   ├── audioDownloader.js          # baixa arquivo remoto via HTTPS/HTTP
│   │   ├── decoder.js                  # ffmpeg → PCM 16 kHz mono float32
│   │   ├── vadEnergy.js                # VAD por energia + ZCR (puro JS)
│   │   ├── stanzaAligner.js            # distribui estrofes pelos segmentos vocais
│   │   └── stanzaLyrics.js             # processa texto (split em estrofes etc.)
│   └── utils/
│       ├── mmSs.js                     # segundos ↔ mm:ss
│       └── safeFetch.js
└── scripts/
    ├── install_whisper_model.js        # opcional, baixa modelo
    └── test_sync.js                    # teste offline do sync
```

## Teste rápido sem áudio

```bash
npm run test:sync
```

Ele roda o alinhador com estrofes sintéticas e segmentos VAD fixos para garantir que o motor de distribuição funciona sem precisar baixar arquivo de áudio.
