# LenaVS Backend — instalação em máquina de 1 vCPU / 2GB

Este backend foi ajustado para rodar dentro de 1 vCPU e 2GB de RAM sem derrubar.
Todas as mudanças abaixo já estão aplicadas no código; este guia só documenta como
subir o servidor.

## 1) Pré-requisitos
- Node.js 22.x (recomendado)
- FFmpeg instalado no sistema (`sudo apt-get install -y ffmpeg`)
- Python 3.12 APENAS se quiser usar o Lyrics Aligner (sincronização automática de letra)
  e o Demucs (instrumental). Opcional — o app funciona sem eles (com fallback).

## 2) Instalar e rodar
```bash
npm install                 # instala dependências (sem node_modules no zip)
cp .env.example .env        # preencha SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY
npm start                   # node --max-old-space-size=768 src/server.js
```

## 3) PM2 (recomendado — garante 1 instância e restart automático)
```bash
npm install -g pm2
pm2 start src/server.js --name lenavs-backend \
  --node-args="--max-old-space-size=768" \
  --max-memory-restart 1500M
pm2 save
pm2 startup
```
`--max-memory-restart 1500M` reinicia o processo se ele passar de ~1,5GB (proteção
contra OOM em 2GB). Rode SEMPRE 1 instância — nunca `pm2 scale` ou cluster mode.

## 4) O que foi alterado para caber em 1vCPU/2GB
- **Polling de status do vídeo com backoff** no frontend (3s → 15s) em vez de 1,5s fixo.
- **Cache do token Supabase (120s)** no middleware de auth: menos chamadas de rede ao Auth.
- **Cache do snapshot de acesso (10s)**: `requireActiveAccess` deixou de consultar o banco
  a cada requisição de polling.
- **Fila de vídeo**: 1 worker por vez (default), máx. 8 tarefas pendentes, gravação de
  progresso no disco limitada a 1×/2s por tarefa.
- **ffmpeg com `-threads 1`**: renderização não satura a CPU.
- **Resolução limitada a 1080p**: pedidos de 4K caem para 1080p.
- **Processos pesados serializados** (Demucs/Lyrics Aligner): 1 executando + 1 na fila,
  acima disso devolve 503 amigável.
- **Letras (OCR/PDF/DOCX) com importação preguiçosa**: o servidor não carrega tesseract,
  pdfjs, canvas, mammoth e word-extractor na inicialização (economia de RAM).
- **Paginação nas listas de projetos** (100 meus / 60 da biblioteca pública).
- **Logs `morgan tiny`**, body limit 25MB, `trust proxy`.

## 5) Variáveis importantes
Veja `.env.example`. Principais limitações de recurso:
`VIDEO_WORKER_CONCURRENCY=1`, `VIDEO_MAX_PENDING_TASKS=8`,
`DEMUCS_THREADS=1`, `ALIGNER_BATCH_SIZE=1`, `NODE_OPTIONS=--max-old-space-size=768`.

## 6) Criar venv do Aligner (opcional — só para sync automática)
```bash
sudo apt-get install -y python3.12-venv
python3.12 -m venv .venv-aligner
.venv-aligner/bin/pip install -r requirements-aligner.txt
```
Depois aponte `ALIGNER_PYTHON_BIN=/caminho/do/projeto/.venv-aligner/bin/python3.12`.
Para o Demucs (instrumental): `pip install -r requirements-demucs.txt` e ajuste
`DEMUCS_PYTHON_BIN`/`DEMUCS_CLI_BIN` (o `demucs` CLI precisa estar no PATH).
