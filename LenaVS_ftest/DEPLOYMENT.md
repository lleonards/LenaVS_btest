# Manual de deployment — LenaVS Frontend

## 1) Pré-requisitos
- Node.js 20.x
- Backend LenaVS publicado e funcionando
- Projeto Supabase com Auth habilitado

## 2) Variáveis de ambiente
Use o arquivo `.env.example` como base e crie um `.env` com:

```env
VITE_API_URL=https://seu-backend.onrender.com
VITE_SUPABASE_URL=https://seu-projeto.supabase.co
VITE_SUPABASE_ANON_KEY=...
# Também é aceito o nome atual do Supabase:
# VITE_SUPABASE_PUBLISHABLE_KEY=...
```

## 3) O que preencher no Render
- `VITE_API_URL`: URL pública do backend.
- `VITE_SUPABASE_URL`: URL do seu projeto Supabase.
- `VITE_SUPABASE_ANON_KEY`: chave pública do Supabase usada no frontend.
- `VITE_SUPABASE_PUBLISHABLE_KEY`: alternativa equivalente à chave anon, caso o projeto Supabase use a nomenclatura publishable key.

## 4) Instalação
```bash
npm install
```

## 5) Desenvolvimento
```bash
npm run dev
```

## 6) Build de produção
```bash
npm run build
```

## 7) Publicação
- Pode ser publicado no Render Static Site, Netlify ou outro host estático.
- O frontend usa `HashRouter`, então as rotas privadas e públicas continuam funcionando sem tela branca por refresh direto.
- Mantenha o arquivo `public/_redirects` junto da build quando o host suportar redirects.

## 8) Observações do build atual
- Página de upgrade com duas opções: Pagar.me e Stripe.
- Pagar.me recomendado para clientes do Brasil.
- Stripe recomendado para clientes fora do Brasil.
- Ao clicar em Pagar.me, o checkout abre em nova aba e a aba atual do app vai para a tela de acompanhamento de pagamento.
- O botão dos 3 créditos gratuitos continua aparecendo como `Upgrade`.

## 9) Não incluir no pacote
- `node_modules`
