# Variáveis de autenticação — backend

Configure estas variáveis no Web Service do backend (Render).

## Obrigatórias

| Nome | Valor | Onde encontrar | Uso |
| --- | --- | --- | --- |
| `SUPABASE_URL` | URL do projeto, por exemplo `https://xxxx.supabase.co` | Supabase → **Project Settings → Data API → Project URL** | Define o projeto Supabase usado pelo backend. Deve ser o mesmo projeto usado no frontend. |
| `SUPABASE_SERVICE_ROLE_KEY` | Chave secreta/service role do mesmo projeto | Supabase → **Project Settings → API Keys → Secret keys** ou a chave legada `service_role` | Permite ao backend consultar o usuário autenticado e acessar a tabela `users` com privilégios administrativos. **Nunca exponha no frontend.** |
| `SUPABASE_ANON_KEY` | Chave pública `anon` do mesmo projeto | Supabase → **Project Settings → API Keys → Legacy API Keys → anon** | Usada pelo endpoint de login/cadastro mantido para compatibilidade. |

### Nomes novos de chaves do Supabase

Se o painel mostrar apenas as chaves novas, também são aceitos:

- `SUPABASE_SECRET_KEY` no lugar de `SUPABASE_SERVICE_ROLE_KEY`;
- `SUPABASE_PUBLISHABLE_KEY` no lugar de `SUPABASE_ANON_KEY`.

Use apenas um nome para cada finalidade. Não coloque a `service_role`/secret key no frontend.

## Obrigatórias para as demais funções do app

Estas não participam da validação do JWT, mas são necessárias se o recurso correspondente estiver habilitado:

- `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_PRICE_BRL`, `STRIPE_PRICE_USD`: checkout Stripe.
- `PAGARME_SECRET_KEY`: checkout Pagar.me.
- `UNLIMITED_PRICE_BRL`, `UNLIMITED_PRICE_USD`: valores do plano.
- `FRONTEND_URL`, `BACKEND_URL`, `ALLOWED_ORIGINS`: URLs públicas e CORS.

Consulte o `DEPLOYMENT.md` para as variáveis de processamento de mídia, FFmpeg e Demucs.

## Não configurar

`SUPABASE_JWT_SECRET` não é necessário e não deve ser usado para validar o access token. O backend chama `supabase.auth.getUser(access_token)`, que é o caminho compatível com JWTs HS256 antigos e com os JWTs ES256/JWKS atuais, incluindo o `kid`.

## Regra mais importante

`SUPABASE_URL`, a chave pública do frontend e as chaves do backend precisam apontar para **o mesmo projeto Supabase**. Misturar URL/chave de projetos diferentes produz tokens que o outro projeto não consegue verificar e causa erros como `unrecognized JWT kid`.