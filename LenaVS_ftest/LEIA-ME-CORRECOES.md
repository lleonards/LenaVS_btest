# LenaVS Frontend — Correções Aplicadas

Este pacote é a versão corrigida do frontend da LenaVS.

## O que foi corrigido

1. **Erro `isSyncingLyrics is not defined` (tela de recuperação no login)**
   - No bundle que estava publicado, essa variável não existia no escopo em que era usada (build desatualizado/inconsistente).
   - O código atual declara `isSyncingLyrics` no `Editor.jsx` e a passa como prop para o `FilesPanel.jsx` — todas as 9 referências foram conferidas e estão dentro do escopo correto.
   - A nova build resolve o problema. Necessário **republicar com esta build** (o problema não é do código atual, é do bundle antigo no ar).

2. **Tela branca ao clicar no link de confirmação do e-mail**
   - O fluxo usa o padrão oficial do Supabase: o link traz `#access_token=...` e o `supabase-js` (com `detectSessionInUrl: true`) processa, limpa a URL e dispara `SIGNED_IN`.
   - Adicionados logs de diagnóstico (`[LenaVS Auth]`, `[LenaVS Supabase]`) no boot para confirmar se o token chegou.
   - **Importante (configuração no Supabase):** no painel do Supabase → *Authentication → URL Configuration*, defina o **Site URL** como a URL do frontend **sem** query/hash (ex.: `https://lenavs.com`) e adicione essa mesma URL na lista de *Redirect URLs*. Sem isso o link de confirmação não tem para onde retornar.

3. **Tela de recuperação agora mostra o erro real** (`ErrorBoundary.jsx` reescrito)
   - Mostra o **nome** do erro (ex.: `ReferenceError`) e a **mensagem exata** (ex.: `isSyncingLyrics is not defined`).
   - Inclui bloco expansível com o **stack do componente React** e o **stack do JavaScript**.
   - Botão **"Copiar detalhes do erro"** para colar no suporte.
   - Tudo também é impresso no **console (F12)**.

4. **Bug silencioso no header corrigido**
   - O `Header.jsx` usava `cancelScheduledAt`, mas o `AuthContext` nunca o expunha (ficava sempre `undefined`). O contexto agora entrega e calcula esse valor corretamente (inclusive o caso "plano cancelado, acesso ativo até X").

5. **Links quebrados corrigidos**
   - "Esqueci minha senha" apontava para rota `/forgot-password` inexistente (causava 404). Convertido para contato por e-mail.
   - Logs de erro adicionados no login e no cadastro para diagnóstico rápido.

## Variáveis de ambiente

Copie `.env.example` para `.env` e preencha:

```env
VITE_SUPABASE_URL=https://SEU-PROJETO.supabase.co
VITE_SUPABASE_ANON_KEY=SUA_ANON_KEY_AQUI
VITE_API_URL=https://SEU-BACKEND.onrender.com   # deixe em branco para localhost:10000 em dev
```

- O app usa **HashRouter**: qualquer URL com `#` funciona sem configuração extra de redirect no host.

## Instalação e execução

```bash
npm install          # instala as dependências (no seu dispositivo)
npm run dev          # desenvolvimento (http://localhost:5173)
npm run build        # build de produção → pasta dist/
```

## Publicação

- Publica a pasta `dist/` em qualquer host estático (Netlify, Render Static, Vercel...).
- Mantenha o arquivo `public/_redirects` na build (`/* → /index.html`) quando o host exigir.
