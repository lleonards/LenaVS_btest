# Configuracao do Supabase Storage (VIDEOS + VIDEOS_PUBLICOS)

## 1. Buckets (nomes SENSIVEIS A MAIUSCULAS)

| Bucket | Acesso | Uso |
|---|---|---|
| `VIDEOS` | **privado** | projetos privados, historico, editor, avatares, video gerado |
| `VIDEOS_PUBLICOS` | **publico** | somente projetos publicados na Biblioteca |

> Nao altere `VIDEOS` para publico. Os nomes devem ser exatamente
> `VIDEOS` e `VIDEOS_PUBLICOS` (maiusculas), pois o Supabase diferencia
> maiusculas de minusculas.

## 2. Variaveis de ambiente do backend

```
SUPABASE_STORAGE_BUCKET=VIDEOS
SUPABASE_PUBLIC_STORAGE_BUCKET=VIDEOS_PUBLICOS
SUPABASE_SIGNED_URL_TTL=604800
```

Os defaults ja apontam para `VIDEOS` e `VIDEOS_PUBLICOS`, entao o app funciona
mesmo sem definir as variaveis — mas defina-as para deixar explicito.

## 3. Como o app monta as URLs

- Bucket **privado** (`VIDEOS`): o backend gera **URL assinada**
  (`createSignedUrl`). O frontend nunca monta `/object/public/...` para esse
  bucket — era exatamente isso que causava o erro HTTP 400 e o
  "The element has no supported sources".
- Bucket **publico** (`VIDEOS_PUBLICOS`): o backend usa `getPublicUrl`.
- O backend devolve, para cada arquivo, `storagePath` + `bucket`. Esses dois
  campos permitem renovar a URL assinada quando ela expira, sem nunca perder a
  referencia do arquivo.

## 4. Politicas (RLS / Storage) — opcional, recomendado

O backend usa a `service_role`, que ignora RLS. Se quiser acesso direto do
cliente, crie no bucket `VIDEOS_PUBLICOS` (apenas leitura publica):

```sql
CREATE POLICY "public_read_videos_publicos"
  ON storage.objects FOR SELECT
  USING (bucket_id = 'VIDEOS_PUBLICOS');
```

Para o bucket privado `VIDEOS`, mantenha o acesso somente pelo backend
(URL assinada). Nao crie politica de leitura publica nele.

## 5. Como publicar / despublicar

- **Tornar publico**: o backend copia cada arquivo de `VIDEOS` para
  `VIDEOS_PUBLICOS` e remove a copia antiga, atualiza o `config` do projeto e
  marca `is_public = true`.
- **Tornar privado**: faz o caminho inverso (`VIDEOS_PUBLICOS` -> `VIDEOS`),
  voltando a usar URL assinada e marcando `is_public = false`. O projeto
  desaparece da Biblioteca e deixa de ser acessivel publicamente.
