FROM node:22-bookworm-slim

ENV DEBIAN_FRONTEND=noninteractive \
    PYTHONUNBUFFERED=1 \
    NODE_ENV=production

WORKDIR /app

# Dependências do sistema: python3 (scripts auxiliares) e ffmpeg (vídeo).
# Demucs/torch foram REMOVIDOS do build para manter a imagem leve e o
# cold start rápido (era a principal causa de HTTP 504 no Render).
# Para habilitar a geração de instrumental, instale demucs no servidor
# e defina as variáveis DEMUCS_* (ver INSTRUCOES_DEPLOY.txt).
RUN apt-get update \
  && apt-get install -y --no-install-recommends \
    python3 \
    ffmpeg \
    ca-certificates \
  && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json* ./

RUN if [ -f package-lock.json ]; then \
      npm ci --omit=dev --no-audit --no-fund; \
    else \
      npm install --omit=dev --no-audit --no-fund; \
    fi

COPY . .

EXPOSE 10000

CMD ["npm", "start"]
