# LenaVS Backend — Verificação e Correções

Este pacote contém o backend da LenaVS verificado e pronto para uso.

## O que foi feito

1. **Verificação completa de sintaxe** de todos os arquivos (`node --check` em todos os `.js`/`.mjs`): passou sem nenhum erro.
2. **Fluxo de autenticação revisado** — não foi necessária mudança estrutural:
   - Cadastro, login e confirmação de e-mail acontecem **direto entre o frontend e o Supabase Auth**.
   - O backend apenas valida o token JWT que chega no header `Authorization: Bearer <token>` via `supabase.auth.getUser()` (padrão oficial) e **auto-repara** o perfil em `public.users` se o trigger falhar.
3. **Documentação de configuração abaixo** — a maioria dos problemas relatados (tela branca, erro de login) depende das variáveis de ambiente e da configuração do Supabase, não do código.

## Variáveis de ambiente (obrigatórias)

Copie `.env.example` para `.env` e preencha:

```env
SUPABASE_URL=https://SEU-PROJETO.supabase.co
SUPABASE_SERVICE_ROLE_KEY=SUA_SERVICE_ROLE_KEY_AQUI
PORT=10000
ALLOWED_ORIGINS=http://localhost:5173,https://SEU-FRONTEND.onrender.com
```

Integrações opcionais (não afetam login/cadastro): `OPENAI_API_KEY`, `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `SMTP_*`.

## Banco de dados (Supabase)

1. No painel do Supabase, abra o **SQL Editor**.
2. Execute **todo** o conteúdo de `supabase/schema.sql`.
3. Isso cria as tabelas (`users`, `projects`, `payment_transactions`, ...), as *policies* de RLS e o trigger `handle_new_user` que insere o usuário em `public.users` automaticamente ao cadastrar.
4. Em **Authentication → URL Configuration**: defina o *Site URL* igual à URL do frontend e inclua essa URL em *Redirect URLs* (sem `#`).

## Instalação e execução

```bash
npm install   # no seu dispositivo
npm start     # or npm run dev (nodemon)
```

Health check: `GET /health` e `GET /api/health`.

## Deploy

- Render (Web Service) com o `Dockerfile` incluso; garanta que o painel tenha as variáveis acima.
- Em produção, `ALLOWED_ORIGINS` deve conter o domínio real do frontend.
