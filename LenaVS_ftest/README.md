# LenaVS Frontend

Frontend do LenaVS, um web app para criação de vídeo karaokê com upload de mídia, edição de estrofes, preview de áudio e exportação com download automático.

## Visão geral

O frontend foi atualizado para refletir o fluxo real atual do sistema:

- upload de música original e/ou instrumental
- upload de vídeo **ou** foto de fundo
- upload/colagem de letra com separação automática em estrofes
- edição visual das estrofes com tempo, fonte, tamanho, cor, borda, alinhamento e transição
- preview sem borda fina ao redor da estrofe
- exportação com escolha do áudio final no painel **Exportar Vídeo**
- botão **Exportar vídeo** que primeiro gera o vídeo e depois inicia o download automaticamente
- 1 download = 1 crédito no plano free
- usuário novo começa com 3 créditos

---

## Tecnologias

- React 18
- Vite
- React Router DOM
- Supabase Auth
- Axios
- Lucide React
- CSS modular por componente

---

## Pré-requisitos

- Node.js 18+
- backend LenaVS rodando
- projeto Supabase configurado

---

## Variáveis de ambiente

Crie um arquivo `.env` na raiz do frontend:

```env
VITE_API_URL=https://seu-backend.onrender.com
VITE_SUPABASE_URL=https://seu-projeto.supabase.co
VITE_SUPABASE_ANON_KEY=sua-chave-anon
```

---

## Instalação

```bash
npm install
```

## Desenvolvimento

```bash
npm run dev
```

Aplicação disponível em:

```bash
http://localhost:5173
```

## Build de produção

```bash
npm run build
```

## Preview local da build

```bash
npm run preview
```

---

## Estrutura principal

```text
src/
├── components/
│   ├── FilesPanel.jsx
│   ├── PreviewPanel.jsx
│   ├── LyricsEditorPanel.jsx
│   ├── ExportPanel.jsx
│   └── ProjectsPanel.jsx
├── contexts/
│   └── AuthContext.jsx
├── pages/
│   ├── Login.jsx
│   ├── Register.jsx
│   ├── Upgrade.jsx
│   └── Editor.jsx
├── services/
│   ├── api.js
│   └── supabase.js
├── utils/
│   ├── stanza.js
│   └── timecode.js
└── App.jsx
```

---

# Guia completo de uso do web app

## 1. Login e créditos

Ao entrar no LenaVS, o usuário faz login com Supabase. Usuário novo entra com **3 créditos** no plano free. Cada exportação com download bem-sucedido consome **1 crédito**.

### Regras atuais de crédito

- plano free: 3 créditos iniciais
- cada download de vídeo consome 1 crédito
- o botão exportar gera o vídeo e já baixa em seguida
- se não houver crédito, o usuário é direcionado ao fluxo de upgrade
- o plano Unlimited libera o uso conforme a validade retornada pelo backend

---

## 2. Painel Arquivos

O painel Arquivos é sempre o primeiro passo.

### Campos disponíveis

- **Música Original**: áudio principal com voz
- **Música Instrumental**: playback sem voz
- **Vídeo / Foto**: fundo do vídeo final
- **Letra (arquivo)**: aceita `.txt`, `.lrc`, `.srt`, `.md`, `.rtf`, `.doc`, `.docx` e `.pdf`
- **Colar Letra**: para inserir a letra manualmente

### Comportamento importante

- o sistema processa **1 upload por vez**
- enquanto um upload está em andamento, os demais campos ficam bloqueados
- no botão **Vídeo / Foto**, se o arquivo enviado for imagem, o frontend envia corretamente para o backend como imagem de fundo; se for vídeo, envia como vídeo de fundo
- o seletor aceita os principais formatos de áudio e vídeo; o backend também valida a extensão quando o navegador não informa o MIME correto

### Formatos de mídia aceitos

Áudios: `.mp3`, `.wav`, `.ogg`, `.oga`, `.m4a`, `.aac`, `.flac`, `.wma`, `.opus`,
`.weba`, `.webm`, `.aiff`, `.aif`, `.amr`, `.caf`, `.mka`, `.alac`, `.mid` e `.midi`.

Vídeos: `.mp4`, `.mov`, `.avi`, `.mkv`, `.webm`, `.m4v`, `.mpeg`, `.mpg`, `.3gp`,
`.ts`, `.mts`, `.m2ts`, `.mxf`, `.flv`, `.wmv`, `.asf`, `.ogv`, `.vob`, `.rm` e `.rmvb`.

Documentos de letra `.docx` e `.pdf` são convertidos em texto no backend. PDFs com
texto selecionável são lidos diretamente; PDFs escaneados ou formados por imagens
passam por OCR para tentar reconhecer automaticamente a letra. Se a imagem estiver
com baixa qualidade e o OCR não conseguir reconhecer o conteúdo, o sistema informa
claramente o problema.

---

## 3. Como preparar a letra

Você pode usar 2 formas:

### Opção A — arquivo de letra

Faça upload de um arquivo com a letra.

### Opção B — colar letra

Cole o texto manualmente no modal **Colar Letra**.

### Dica de formatação

Use uma linha em branco entre blocos para separar as estrofes. Exemplo:

```text
Primeira linha da estrofe
Segunda linha da estrofe

Nova estrofe começa aqui
Continuação da nova estrofe
```

Depois do processamento, o editor cria automaticamente os blocos de estrofe.

---

## 4. Preview

O preview mostra o comportamento visual da estrofe e permite ouvir o áudio.

### O que existe no preview

- player de áudio com play/pause
- barra de progresso
- tempo atual e duração
- alternância entre **Original** e **Playback** apenas para escuta no preview
- seletor de cor de fundo
- exibição da estrofe ativa no centro do quadro

### Correção aplicada

A borda fina que aparecia ao redor da estrofe no preview foi removida. Agora a visualização da letra fica limpa, sem contorno de caixa ao redor do bloco de texto.

---

## 5. Editor de Letras

Depois de enviar a letra, o painel **Editor de Letras** aparece.

Cada bloco representa uma estrofe.

### O que pode ser editado por estrofe

- texto
- início
- fim
- tamanho da fonte
- fonte
- cor do texto
- cor da borda
- negrito
- itálico
- sublinhado
- alinhamento: esquerda, centro ou direita
- transição: fade, slide, zoom-in, zoom-out
- duração da transição
- duplicar bloco
- mover para cima
- mover para baixo
- remover bloco

### Sincronização de tempo

Você pode:

- digitar o tempo manualmente
- usar o botão de marcação para capturar o tempo atual do player

Formato padrão de tempo:

```text
MM:SS
```

Exemplo:

```text
00:12
01:34
```

---

## 6. Escolha do áudio final no painel Exportar Vídeo

A escolha do áudio que vai sair no vídeo final deve ser feita no painel **Exportar Vídeo**.

### Opções

- **Original**
- **Playback**

### Regra importante

O áudio selecionado no preview serve para escuta durante a edição. Já o áudio selecionado no painel **Exportar Vídeo** é o que será usado de fato no arquivo final.

---

## 7. Exportar e baixar o vídeo

No painel **Exportar Vídeo**, configure:

- nome do projeto
- resolução
- formato
- áudio final

Depois clique em **Exportar vídeo**.

### Fluxo atual do botão

1. salva/atualiza o projeto
2. envia as configurações atuais para o backend
3. gera o vídeo com base no preview e nas configurações feitas
4. inicia o download automaticamente
5. consome 1 crédito no plano free

### Formatos disponíveis

- MP4
- AVI
- MOV
- MKV

### Resoluções disponíveis

- 360p
- 480p
- 720p
- 1080p (bloqueado no seletor com aviso "disponível em breve")

---

## 8. Biblioteca e histórico

O app também possui histórico de projetos e biblioteca pública.

Você pode:

- abrir projetos antigos
- duplicar projetos
- publicar/despublicar projetos
- excluir projetos

Ao reabrir um projeto, o app restaura:

- estrofes
- mídia
- cor de fundo
- áudio selecionado no projeto

---

## 9. Comportamento do vídeo exportado

O backend gera o vídeo usando:

- fundo por cor, imagem ou vídeo
- áudio final escolhido no painel Exportar Vídeo
- renderização das estrofes com cor, borda, alinhamento, negrito, itálico, sublinhado e transição

As letras são renderizadas no vídeo final com base nas configurações atuais do editor.

---

## 10. Fluxo recomendado para o usuário final

1. faça login
2. envie a música original
3. envie a música instrumental, se houver
4. envie vídeo ou foto de fundo, se quiser
5. envie a letra ou cole a letra
6. ajuste tempos e estilos no editor
7. confira o áudio no preview
8. no painel Exportar Vídeo, escolha o áudio final
9. clique em **Exportar vídeo**
10. aguarde a geração e o download automático

---

## 11. Endpoints usados pelo frontend

- `POST /api/video/upload`
- `POST /api/lyrics/upload`
- `POST /api/lyrics/manual`
- `POST /api/video/generate`
- `GET /api/video/download/:fileName`
- `POST /api/projects`
- `PUT /api/projects/:id`
- `GET /api/projects`
- `GET /api/projects/library`

Todas as requisições protegidas recebem automaticamente o token do Supabase via interceptor Axios.

---

## 12. Observações de deploy

### Render / Static Site

- Build Command: `npm install && npm run build`
- Publish Directory: `dist`

### Redirect SPA

O projeto já inclui `_redirects` para rotas SPA.

---

## 13. Checklist rápido de validação

Antes de publicar, valide:

- login funcionando
- uploads funcionando
- separação de estrofes funcionando
- preview sem borda fina na estrofe
- escolha do áudio final no painel Exportar Vídeo
- exportação gerando o vídeo
- download automático após gerar
- consumo de 1 crédito por download
- histórico de projeto salvando corretamente

---

## Licença

MIT

---

## Autenticação (lógica refeita — simples)

- O app usa o cliente padrão do Supabase (`src/services/supabase.js`): sessão salva e renovada automaticamente, com `detectSessionInUrl` para o link de confirmação de e-mail.
- O `AuthContext` restaura a sessão com `supabase.auth.getSession()` e escuta `onAuthStateChange` — sem manipulação manual de token ou localStorage.
- Toda requisição ao backend leva `Authorization: Bearer <access_token>` (interceptor em `src/services/api.js`).
- Se o backend responder que a sessão é inválida, o `signOut` do Supabase é chamado e o AuthGuard redireciona ao login.
- Variáveis de ambiente: `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY` e `VITE_API_URL` (veja `.env.example`).

## Instalação e execução

```bash
npm install
npm run dev
```
