# Manual de deployment — LenaVS Backend

## 1) Pré-requisitos
- Node.js 20.x
- FFmpeg instalado no servidor
- Python 3 + PyTorch CPU + Demucs instalados no servidor
- Projeto Supabase configurado
- Conta Stripe configurada
- Conta Pagar.me configurada

## 2) Variáveis de ambiente
Use o arquivo `.env.example` como base.

### Obrigatórias no Render
```env
PORT=10000
NODE_ENV=production
BACKEND_URL=https://seu-backend.onrender.com
FRONTEND_URL=https://seu-frontend.onrender.com
ALLOWED_ORIGINS=https://seu-frontend.onrender.com,http://localhost:5173
MAX_FILE_SIZE=524288000
MAX_AUDIO_DURATION_MINUTES=15
DEMUCS_PYTHON_BIN=python3
DEMUCS_MODEL=htdemucs
DEMUCS_DEVICE=cpu
DEMUCS_TIMEOUT_MS=1200000
DEMUCS_MP3_BITRATE=320
SUPABASE_URL=https://seu-projeto.supabase.co
SUPABASE_ANON_KEY=...
SUPABASE_SERVICE_ROLE_KEY=...
SUPABASE_JWT_SECRET=...
STRIPE_SECRET_KEY=...
STRIPE_WEBHOOK_SECRET=...
STRIPE_PRICE_BRL=...
STRIPE_PRICE_USD=...
PAGARME_SECRET_KEY=...
UNLIMITED_PRICE_BRL=39.90
UNLIMITED_PRICE_USD=9.90
```

### Opcionais recomendadas
```env
UPLOAD_DIR=
ERRO_SUPPORT=
PAGARME_WEBHOOK_SECRET=
PAGARME_REQUIRE_WEBHOOK_SIGNATURE=false
PAGARME_API_BASE=https://api.pagar.me/core/v5
PAGARME_ACCEPTED_PAYMENT_METHODS=pix,credit_card,boleto
PAGARME_LINK_TYPE=order
PAGARME_EXPIRES_IN_MINUTES=1440
PAGARME_PAYMENT_LINK_TEMPLATE_JSON=
```

## 3) O que preencher em cada variável
- `BACKEND_URL`: URL pública do backend no Render.
- `FRONTEND_URL`: URL pública do frontend.
- `ALLOWED_ORIGINS`: domínios permitidos para o frontend acessar a API.
- `SUPABASE_URL`: URL do projeto Supabase.
- `SUPABASE_ANON_KEY`: chave pública do Supabase.
- `SUPABASE_SERVICE_ROLE_KEY`: chave privada do backend no Supabase.
- `SUPABASE_JWT_SECRET`: JWT Secret do projeto Supabase.
- `STRIPE_SECRET_KEY`: chave secreta do Stripe.
- `STRIPE_WEBHOOK_SECRET`: segredo do webhook do Stripe.
- `STRIPE_PRICE_BRL`: price ID do Stripe em BRL.
- `STRIPE_PRICE_USD`: price ID do Stripe em USD.
- `PAGARME_SECRET_KEY`: secret key da API V5 do Pagar.me. A integração usa autenticação Basic Auth com essa chave. [Pagar.me](https://docs.pagar.me/reference/getting-started-with-your-api)
- `PAGARME_WEBHOOK_SECRET`: opcional. Use se o seu webhook do Pagar.me enviar assinatura para validação HMAC no backend.
- `PAGARME_REQUIRE_WEBHOOK_SIGNATURE`: deixe `true` apenas se você confirmou que seu webhook envia assinatura e quer rejeitar qualquer chamada sem header válido.
- `PAGARME_API_BASE`: base da API do Pagar.me. Em produção normalmente fica `https://api.pagar.me/core/v5`. [Pagar.me](https://docs.pagar.me/reference/create-link)
- `PAGARME_ACCEPTED_PAYMENT_METHODS`: meios exibidos no checkout hospedado, separados por vírgula. Ex.: `pix,credit_card,boleto`.
- `PAGARME_LINK_TYPE`: tipo do link do Pagar.me. Para este projeto, use `order`. [Pagar.me](https://docs.pagar.me/reference/create-link)
- `PAGARME_EXPIRES_IN_MINUTES`: validade do link em minutos.
- `PAGARME_PAYMENT_LINK_TEMPLATE_JSON`: opcional. JSON para sobrescrever ou complementar o payload enviado ao endpoint de criação do link, útil caso sua conta exija algum campo extra no `payment_settings`, `customer_settings`, `cart_settings` ou `layout_settings`.
- `UNLIMITED_PRICE_BRL`: valor do upgrade de 30 dias em real.
- `UNLIMITED_PRICE_USD`: valor do upgrade de 30 dias em dólar.

## 4) Instalação
```bash
npm install
```

## 5) Desenvolvimento
```bash
npm run dev
```

## 6) Produção
```bash
npm start
```

## 7) Deploy no Render
1. Crie um Web Service apontando para a pasta do backend.
2. Defina `Node 20`.
3. Configure as variáveis acima no painel do serviço.
4. Use o script `render-build.sh` no build para instalar FFmpeg, Python, PyTorch CPU, Demucs e fontes.
5. Garanta que `BACKEND_URL` e `FRONTEND_URL` estejam com as URLs finais públicas.

## 8) Webhooks
- Stripe: `POST https://seu-backend.onrender.com/api/payment/webhook/stripe`
- Pagar.me: `POST https://seu-backend.onrender.com/api/payment/webhook/pagarme`

### Eventos recomendados no Pagar.me
Cadastre pelo menos eventos de pagamento confirmado, especialmente `order.paid` e `charge.paid`, porque são os eventos usados para liberar o acesso do usuário. O Pagar.me também possui eventos como `order.payment_failed`, `order.canceled`, `charge.payment_failed`, `charge.pending`, `charge.refunded`, `checkout.created`, `checkout.closed` e `checkout.canceled`. [Pagar.me](https://docs.pagar.me/docs/webhooks)

## 9) Banco / Supabase
Execute o arquivo `supabase_schema_corrigido.sql` no SQL Editor do Supabase antes de usar o sistema em produção.

## 10) Fluxo do checkout no frontend
No Pagar.me, o frontend abre o checkout hospedado em uma nova aba e mantém a aba atual do app em `/payment/pending?provider=pagarme`. Assim o usuário consegue acompanhar a liberação automática sem depender de redirect de retorno do checkout.

## 11) Observações
- O Stripe continua como checkout internacional recomendado.
- O Pagar.me substitui o SellX no fluxo brasileiro.
- O backend não precisa de `node_modules` no pacote final.
- A separação de voz usa Demucs localmente na rota `POST /api/media/instrumental`, sem depender de Replit ou Replicate.
- Em Render, prefira uma instância com memória folgada, porque Demucs em CPU consome mais RAM do que um upload normal.
