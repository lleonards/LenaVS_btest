# LenaVS Backend

Backend do LenaVS, responsável por autenticação protegida via Supabase, upload de mídia, salvamento de projetos, controle de créditos e geração do vídeo karaokê final.

## O que este backend faz hoje

- recebe uploads de áudio, vídeo, imagem e letra
- processa letras por arquivo ou texto manual
- salva projetos do editor
- controla histórico e biblioteca pública
- gera o vídeo final com:
  - fundo por cor, imagem ou vídeo
  - áudio original ou instrumental
  - renderização das estrofes com estilo e transição
- libera o download do vídeo com consumo de crédito no plano free

---

## Stack

- Node.js
- Express
- Supabase
- FFmpeg
- Demucs (Python/PyTorch, execução local no servidor)
- Multer
- Jimp

---

## Requisitos

- Docker para produção (recomendado)
- Se rodar sem Docker: Node.js 20, FFmpeg instalado e Python 3.11 + PyTorch CPU + Demucs instalados
- dependências do OCR instaladas pelo `npm install` (`pdfjs-dist`, `@napi-rs/canvas` e `tesseract.js`)
- projeto Supabase configurado
- variáveis de ambiente válidas

---

## Instalação

```bash
npm install
```

## Executar em desenvolvimento

```bash
npm run dev
```

## Executar em produção

```bash
npm start
```

Servidor padrão:

```bash
http://localhost:10000
```

---

## Variáveis de ambiente principais

Exemplo mínimo:

```env
PORT=10000
BACKEND_URL=http://localhost:10000
SUPABASE_URL=https://seu-projeto.supabase.co
SUPABASE_SERVICE_ROLE_KEY=sua-service-role-key
SUPABASE_ANON_KEY=sua-anon-key
ALLOWED_ORIGINS=http://localhost:5173,https://seu-frontend.onrender.com
NODE_ENV=production
DEMUCS_PYTHON_BIN=python3
DEMUCS_MODEL=htdemucs
DEMUCS_DEVICE=cpu
DEMUCS_TIMEOUT_MS=1200000
DEMUCS_MP3_BITRATE=320
```

Se usar Render, também pode aproveitar `RENDER_EXTERNAL_URL` como fallback para a URL pública do backend.

---

## Fluxo atual de exportação

1. frontend salva ou atualiza o projeto
2. frontend chama `POST /api/video/generate`
3. backend monta o fundo final:
   - vídeo ajustado à duração do áudio
   - imagem convertida em vídeo
   - ou fundo por cor
4. backend gera um arquivo `.ass` com as estrofes para aplicar no vídeo
5. backend renderiza o vídeo final com FFmpeg
6. frontend chama `GET /api/video/download/:fileName`
7. no plano free, o download consome 1 crédito

---

## Créditos

### Regra atual

- usuário novo recebe **3 créditos** ao ser sincronizado pela primeira vez
- plano free consome **1 crédito por download de vídeo**
- a geração e o download fazem parte do fluxo do botão exportar no frontend
- o desconto acontece no endpoint de download

---

## Renderização das letras

O backend gera o vídeo final com base nas estrofes salvas no projeto e respeita os campos atuais do editor:

- texto
- tempo inicial e final
- fonte
- tamanho da fonte
- cor do texto
- cor da borda
- negrito
- itálico
- sublinhado
- alinhamento
- transição
- duração da transição

As legendas são convertidas para ASS e aplicadas sobre o vídeo final no FFmpeg.

---

## Uploads aceitos

### Áudio

- mp3
- wav
- ogg
- oga
- m4a
- aac
- flac
- wma
- opus
- weba / webm
- aiff / aif
- amr
- caf / mka
- alac
- mid / midi

### Vídeo

- mp4
- mov
- avi
- mkv
- webm
- m4v
- mpeg / mpg
- 3gp
- ts / mts / m2ts
- mxf
- flv
- wmv
- asf
- ogv
- vob

### Imagem

- jpg
- jpeg
- png
- gif
- bmp

### Letras

- txt
- lrc
- srt
- md
- rtf
- docx
- pdf
- doc

Arquivos `.docx` são lidos com extração de texto do documento, PDFs com texto digital
são lidos diretamente e arquivos `.doc` são processados com o extrator legado.
Quando um PDF não possui camada de texto — por exemplo, quando foi criado a partir
de um escaneamento ou fotografia — o backend renderiza as páginas e usa OCR para
reconhecer as letras. A variável `OCR_LANGUAGE` pode ser ajustada (por padrão,
`por+eng`) e `OCR_MAX_PAGES` limita o processamento a 30 páginas por segurança.
Se o OCR não conseguir reconhecer texto, o sistema retorna uma mensagem clara para
que o usuário tente uma imagem com melhor qualidade.

---

## Formatos de saída do vídeo

- mp4
- avi
- mov
- mkv

---

## Separação de voz / instrumental

A rota `POST /api/media/instrumental` agora executa o Demucs localmente no servidor, sem depender de Replit ou Replicate. O frontend envia a URL pública da música original, o backend baixa o arquivo, tenta executar o Demucs em modos compatíveis (`python -m demucs.separate`, `python -m demucs` ou `demucs` CLI), faz upload do `no_vocals` para o Supabase e devolve a URL final.

## Rotas principais

### Saúde

- `GET /`
- `GET /health`

### Auth / usuário

- `GET /api/auth/me`
- `POST /api/auth/check-email`

`POST /api/auth/check-email` é usado pelo cadastro para exibir uma mensagem
clara quando o e-mail já estiver cadastrado. O cadastro também trata o retorno
ambíguo do Supabase quando a proteção contra enumeração de e-mails está ativa.
- `GET /api/user/me`
- `POST /api/user/consume-credit`

### Letras

- `POST /api/lyrics/upload`
- `POST /api/lyrics/manual`

### Vídeo

- `POST /api/video/upload`
- `POST /api/video/generate`
- `GET /api/video/download/:fileName`

### Projetos

- `GET /api/projects`
- `POST /api/projects`
- `PUT /api/projects/:id`
- `DELETE /api/projects/:id`
- `GET /api/projects/library`
- `PATCH /api/projects/:id/toggle-public`
- `POST /api/projects/:id/fork`

A biblioteca pública retorna `owner_name` e `owner_email` para exibir o nome
do usuário que publicou o projeto. Aplique o arquivo `supabase_schema.sql`
para garantir as colunas `public_name` e `published_at` usadas na publicação.

---

## Deploy no Render

Use o script `render-build.sh`.

Ele instala:

- ffmpeg
- python3 / pip
- PyTorch CPU
- demucs
- fonts-dejavu-core
- fonts-liberation
- fonts-montserrat

Isso cobre tanto a renderização do texto no vídeo final quanto a separação local de voz/instrumental.

---

## Observações importantes

- uploads ficam em `uploads/<user_id>/`
- arquivos temporários de geração ficam em `uploads/temp/`
- downloads de vídeo são protegidos por autenticação
- o frontend precisa enviar o token do Supabase nas rotas protegidas

---

## Licença

MIT
