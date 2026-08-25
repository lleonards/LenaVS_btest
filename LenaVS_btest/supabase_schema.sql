-- =========================================
-- LENA VS - SUPABASE SCHEMA COMPLETO E REVISADO
-- Atualizado para:
-- - remoção da funcionalidade de exclusão de conta
-- - pesquisa de cancelamento de assinatura (cancellation survey)
-- - manutenção de projetos públicos na Biblioteca da Comunidade
-- - cancelamento/sincronização de assinatura Stripe
-- - histórico e biblioteca pública de projetos
-- - fork/cópia de projetos públicos
-- - país salvo no cadastro (Brasil / Internacional)
-- - checkout Stripe com preço BRL ou USD
-- - atualização de perfil (display_name / avatar_url)
-- - exclusão em cascata: ao excluir usuário do Auth, apaga tudo relacionado
-- =========================================

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- =========================================
-- FUNÇÃO PADRÃO updated_at
-- =========================================

CREATE OR REPLACE FUNCTION public.update_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

-- =========================================
-- TABELA USERS
-- =========================================

CREATE TABLE IF NOT EXISTS public.users (
  id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email text UNIQUE NOT NULL,
  plan text NOT NULL DEFAULT 'free',
  credits integer NOT NULL DEFAULT 3,
  credits_reset_at timestamptz NOT NULL DEFAULT now(),
  subscription_status text NOT NULL DEFAULT 'trial',
  stripe_customer_id text,
  stripe_subscription_id text,
  trial_end timestamptz,
  unlimited_access_until timestamptz,
  subscription_cancel_at timestamptz,
  country_group text,
  preferred_currency text,
  display_name text,
  avatar_url text,
  cancellation_survey_pending boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT users_plan_check CHECK (plan IN ('free', 'pro')),
  CONSTRAINT users_subscription_status_check CHECK (
    subscription_status IN ('inactive', 'trial', 'active', 'past_due', 'canceled')
  ),
  CONSTRAINT users_credits_check CHECK (credits >= 0),
  CONSTRAINT users_country_group_check CHECK (country_group IN ('BR', 'INTL') OR country_group IS NULL),
  CONSTRAINT users_preferred_currency_check CHECK (preferred_currency IN ('BRL', 'USD') OR preferred_currency IS NULL)
);

ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS email text,
  ADD COLUMN IF NOT EXISTS plan text NOT NULL DEFAULT 'free',
  ADD COLUMN IF NOT EXISTS credits integer NOT NULL DEFAULT 3,
  ADD COLUMN IF NOT EXISTS credits_reset_at timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS subscription_status text NOT NULL DEFAULT 'trial',
  ADD COLUMN IF NOT EXISTS stripe_customer_id text,
  ADD COLUMN IF NOT EXISTS stripe_subscription_id text,
  ADD COLUMN IF NOT EXISTS trial_end timestamptz,
  ADD COLUMN IF NOT EXISTS unlimited_access_until timestamptz,
  ADD COLUMN IF NOT EXISTS subscription_cancel_at timestamptz,
  ADD COLUMN IF NOT EXISTS country_group text,
  ADD COLUMN IF NOT EXISTS preferred_currency text,
  ADD COLUMN IF NOT EXISTS display_name text,
  ADD COLUMN IF NOT EXISTS avatar_url text,
  ADD COLUMN IF NOT EXISTS cancellation_survey_pending boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS created_at timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

UPDATE public.users
SET email = COALESCE(public.users.email, auth_users.email)
FROM auth.users AS auth_users
WHERE auth_users.id = public.users.id
  AND public.users.email IS NULL;

ALTER TABLE public.users
  ALTER COLUMN email SET NOT NULL;

UPDATE public.users
SET trial_end = COALESCE(trial_end, created_at + interval '3 days')
WHERE trial_end IS NULL;

UPDATE public.users
SET credits_reset_at = COALESCE(credits_reset_at, now())
WHERE credits_reset_at IS NULL;

UPDATE public.users
SET credits = COALESCE(credits, 3)
WHERE credits IS NULL;

UPDATE public.users
SET plan = COALESCE(NULLIF(plan, ''), 'free')
WHERE plan IS NULL OR btrim(plan) = '';

UPDATE public.users
SET subscription_status = COALESCE(NULLIF(subscription_status, ''), 'trial')
WHERE subscription_status IS NULL OR btrim(subscription_status) = '';

UPDATE public.users
SET country_group = CASE
  WHEN upper(coalesce(country_group, '')) = 'BR' THEN 'BR'
  WHEN upper(coalesce(country_group, '')) = 'INTL' THEN 'INTL'
  WHEN upper(coalesce(preferred_currency, '')) = 'BRL' THEN 'BR'
  WHEN upper(coalesce(preferred_currency, '')) = 'USD' THEN 'INTL'
  ELSE NULL
END
WHERE country_group IS NULL OR upper(country_group) NOT IN ('BR', 'INTL');

UPDATE public.users
SET preferred_currency = CASE
  WHEN country_group = 'BR' THEN 'BRL'
  WHEN country_group = 'INTL' THEN 'USD'
  ELSE preferred_currency
END
WHERE preferred_currency IS NULL OR upper(preferred_currency) NOT IN ('BRL', 'USD');

UPDATE public.users AS u
SET
  display_name = COALESCE(
    NULLIF(u.display_name, ''),
    NULLIF(auth_u.raw_user_meta_data->>'display_name', ''),
    NULLIF(auth_u.raw_user_meta_data->>'full_name', ''),
    NULLIF(auth_u.raw_user_meta_data->>'name', ''),
    NULLIF(split_part(COALESCE(u.email, auth_u.email, ''), '@', 1), '')
  ),
  avatar_url = COALESCE(
    NULLIF(u.avatar_url, ''),
    NULLIF(auth_u.raw_user_meta_data->>'avatar_url', ''),
    NULLIF(auth_u.raw_user_meta_data->>'picture', ''),
    NULLIF(auth_u.raw_user_meta_data->>'photo_url', '')
  )
FROM auth.users AS auth_u
WHERE auth_u.id = u.id;

ALTER TABLE public.users
  DROP CONSTRAINT IF EXISTS users_country_group_check,
  DROP CONSTRAINT IF EXISTS users_preferred_currency_check;

ALTER TABLE public.users
  ADD CONSTRAINT users_country_group_check CHECK (country_group IN ('BR', 'INTL') OR country_group IS NULL),
  ADD CONSTRAINT users_preferred_currency_check CHECK (preferred_currency IN ('BRL', 'USD') OR preferred_currency IS NULL);

CREATE UNIQUE INDEX IF NOT EXISTS users_stripe_customer_id_idx
  ON public.users(stripe_customer_id)
  WHERE stripe_customer_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS users_stripe_subscription_id_idx
  ON public.users(stripe_subscription_id)
  WHERE stripe_subscription_id IS NOT NULL;

DROP TRIGGER IF EXISTS users_updated_at ON public.users;
CREATE TRIGGER users_updated_at
BEFORE UPDATE ON public.users
FOR EACH ROW
EXECUTE PROCEDURE public.update_updated_at();

ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "users_select_own" ON public.users;
DROP POLICY IF EXISTS "users_update_own" ON public.users;
DROP POLICY IF EXISTS "users_insert_own" ON public.users;

CREATE POLICY "users_select_own"
  ON public.users FOR SELECT
  USING (auth.uid() = id);

CREATE POLICY "users_update_own"
  ON public.users FOR UPDATE
  USING (auth.uid() = id)
  WITH CHECK (auth.uid() = id);

CREATE POLICY "users_insert_own"
  ON public.users FOR INSERT
  WITH CHECK (auth.uid() = id);

-- =========================================
-- NOVO USUÁRIO DO AUTH -> public.users
-- =========================================

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  auth_country_group text;
  auth_preferred_currency text;
  auth_display_name text;
  auth_avatar_url text;
BEGIN
  auth_country_group := CASE
    WHEN upper(coalesce(NEW.raw_user_meta_data->>'country_group', '')) = 'BR' THEN 'BR'
    WHEN lower(coalesce(NEW.raw_user_meta_data->>'country', '')) IN ('br', 'brasil', 'brazil') THEN 'BR'
    WHEN upper(coalesce(NEW.raw_user_meta_data->>'country_group', '')) = 'INTL' THEN 'INTL'
    WHEN lower(coalesce(NEW.raw_user_meta_data->>'country', '')) IN ('intl', 'international', 'internacional', 'other', 'outro') THEN 'INTL'
    ELSE NULL
  END;

  auth_preferred_currency := CASE
    WHEN auth_country_group = 'BR' THEN 'BRL'
    WHEN auth_country_group = 'INTL' THEN 'USD'
    ELSE NULL
  END;

  auth_display_name := COALESCE(
    NULLIF(NEW.raw_user_meta_data->>'display_name', ''),
    NULLIF(NEW.raw_user_meta_data->>'full_name', ''),
    NULLIF(NEW.raw_user_meta_data->>'name', ''),
    NULLIF(split_part(COALESCE(NEW.email, ''), '@', 1), '')
  );

  auth_avatar_url := COALESCE(
    NULLIF(NEW.raw_user_meta_data->>'avatar_url', ''),
    NULLIF(NEW.raw_user_meta_data->>'picture', ''),
    NULLIF(NEW.raw_user_meta_data->>'photo_url', '')
  );

  INSERT INTO public.users (
    id,
    email,
    plan,
    credits,
    credits_reset_at,
    subscription_status,
    stripe_customer_id,
    stripe_subscription_id,
    trial_end,
    unlimited_access_until,
    country_group,
    preferred_currency,
    display_name,
    avatar_url,
    cancellation_survey_pending,
    created_at,
    updated_at
  )
  VALUES (
    NEW.id,
    NEW.email,
    'free',
    3,
    now(),
    'trial',
    NULL,
    NULL,
    now() + interval '3 days',
    NULL,
    auth_country_group,
    auth_preferred_currency,
    auth_display_name,
    auth_avatar_url,
    false,
    now(),
    now()
  )
  ON CONFLICT (id) DO UPDATE
  SET email = EXCLUDED.email,
      country_group = COALESCE(users.country_group, EXCLUDED.country_group),
      preferred_currency = COALESCE(users.preferred_currency, EXCLUDED.preferred_currency),
      display_name = COALESCE(NULLIF(users.display_name, ''), EXCLUDED.display_name),
      avatar_url = COALESCE(NULLIF(users.avatar_url, ''), EXCLUDED.avatar_url);

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
AFTER INSERT ON auth.users
FOR EACH ROW
EXECUTE PROCEDURE public.handle_new_user();

-- =========================================
-- TABELA PROJECTS
-- =========================================
-- IMPORTANTE: user_id usa ON DELETE CASCADE.
-- Ao excluir um usuário do Auth, todos os seus projetos
-- privados são excluídos automaticamente.
-- Projetos que já eram públicos (is_public = true) também
-- são excluídos — se preferir mantê-los na biblioteca,
-- troque CASCADE por SET NULL e remova o CHECK constraint.
-- =========================================

CREATE TABLE IF NOT EXISTS public.projects (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE,
  name text NOT NULL,
  public_name text,
  config jsonb NOT NULL DEFAULT '{}'::jsonb,
  is_public boolean NOT NULL DEFAULT false,
  published_at timestamptz,
  resolution text NOT NULL DEFAULT '720p',
  description text NOT NULL DEFAULT '',
  download_count integer NOT NULL DEFAULT 0,
  forked_from uuid REFERENCES public.projects(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT projects_name_not_blank CHECK (btrim(name) <> ''),
  CONSTRAINT projects_download_count_check CHECK (download_count >= 0)
);

ALTER TABLE public.projects
  ADD COLUMN IF NOT EXISTS public_name text,
  ADD COLUMN IF NOT EXISTS config jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS is_public boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS published_at timestamptz,
  ADD COLUMN IF NOT EXISTS resolution text NOT NULL DEFAULT '720p',
  ADD COLUMN IF NOT EXISTS description text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS download_count integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS forked_from uuid REFERENCES public.projects(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS created_at timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

DO $$
DECLARE
  existing_constraint text;
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'projects'
      AND column_name = 'project_data'
  ) THEN
    EXECUTE $migration$
      UPDATE public.projects
      SET config = CASE
        WHEN config IS NULL OR config = '{}'::jsonb THEN COALESCE(project_data, '{}'::jsonb)
        ELSE config
      END
      WHERE project_data IS NOT NULL
    $migration$;
  END IF;
END $$;

UPDATE public.projects
SET
  public_name = COALESCE(NULLIF(btrim(public_name), ''), name),
  published_at = COALESCE(published_at, created_at)
WHERE is_public = true;

-- Remove constraint antigo que bloqueava ON DELETE SET NULL em projetos privados
ALTER TABLE public.projects
  DROP CONSTRAINT IF EXISTS projects_private_requires_owner_check;

-- Remove FK antiga e recria com ON DELETE CASCADE
ALTER TABLE public.projects
  DROP CONSTRAINT IF EXISTS projects_user_id_fkey;

ALTER TABLE public.projects
  ADD CONSTRAINT projects_user_id_fkey
  FOREIGN KEY (user_id)
  REFERENCES auth.users(id)
  ON DELETE CASCADE;

-- user_id pode ser NULL apenas durante a migration; com CASCADE nunca será NULL
ALTER TABLE public.projects
  ALTER COLUMN user_id DROP NOT NULL;

CREATE INDEX IF NOT EXISTS projects_user_id_idx ON public.projects(user_id);
CREATE INDEX IF NOT EXISTS projects_is_public_idx ON public.projects(is_public);
CREATE INDEX IF NOT EXISTS projects_created_at_idx ON public.projects(created_at DESC);
CREATE INDEX IF NOT EXISTS projects_published_at_idx ON public.projects(published_at DESC) WHERE is_public = true;
CREATE INDEX IF NOT EXISTS projects_forked_from_idx ON public.projects(forked_from);
CREATE INDEX IF NOT EXISTS projects_public_library_created_idx ON public.projects(created_at DESC) WHERE is_public = true;
CREATE INDEX IF NOT EXISTS projects_public_name_idx ON public.projects(public_name);
CREATE INDEX IF NOT EXISTS projects_name_search_idx
  ON public.projects USING gin (to_tsvector('simple', coalesce(name, '') || ' ' || coalesce(public_name, '') || ' ' || coalesce(description, '')));

DROP TRIGGER IF EXISTS projects_updated_at ON public.projects;
CREATE TRIGGER projects_updated_at
BEFORE UPDATE ON public.projects
FOR EACH ROW
EXECUTE PROCEDURE public.update_updated_at();

ALTER TABLE public.projects ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "projects_select_own" ON public.projects;
DROP POLICY IF EXISTS "projects_select_public" ON public.projects;
DROP POLICY IF EXISTS "projects_insert_own" ON public.projects;
DROP POLICY IF EXISTS "projects_update_own" ON public.projects;
DROP POLICY IF EXISTS "projects_delete_own" ON public.projects;

CREATE POLICY "projects_select_own"
  ON public.projects FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "projects_select_public"
  ON public.projects FOR SELECT
  USING (is_public = true);

CREATE POLICY "projects_insert_own"
  ON public.projects FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "projects_update_own"
  ON public.projects FOR UPDATE
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "projects_delete_own"
  ON public.projects FOR DELETE
  USING (auth.uid() = user_id);

CREATE OR REPLACE FUNCTION public.increment_download_count(project_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.projects
  SET download_count = download_count + 1
  WHERE id = project_id;
END;
$$;

-- =========================================
-- HISTÓRICO DE DOWNLOADS / FORKS
-- ON DELETE CASCADE em ambas as FKs:
-- apaga o registro se o projeto ou o usuário for excluído.
-- =========================================

CREATE TABLE IF NOT EXISTS public.project_downloads (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  downloaded_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS pdl_project_idx ON public.project_downloads(project_id);
CREATE INDEX IF NOT EXISTS pdl_user_idx ON public.project_downloads(user_id);
CREATE INDEX IF NOT EXISTS pdl_downloaded_at_idx ON public.project_downloads(downloaded_at DESC);

ALTER TABLE public.project_downloads ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "pdl_insert_own" ON public.project_downloads;
DROP POLICY IF EXISTS "pdl_select_own" ON public.project_downloads;

CREATE POLICY "pdl_insert_own"
  ON public.project_downloads FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "pdl_select_own"
  ON public.project_downloads FOR SELECT
  USING (auth.uid() = user_id);

-- =========================================
-- TRANSAÇÕES DE PAGAMENTO / WEBHOOKS
-- ON DELETE SET NULL: mantém o registro financeiro
-- mesmo após exclusão do usuário (histórico de auditoria).
-- =========================================

CREATE TABLE IF NOT EXISTS public.payment_transactions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider text NOT NULL,
  external_id text NOT NULL,
  user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  email text,
  payment_type text,
  status text,
  raw_payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  access_granted_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT payment_transactions_provider_check CHECK (provider IN ('stripe', 'pagarme', 'sellx'))
);

ALTER TABLE public.payment_transactions
  ADD COLUMN IF NOT EXISTS provider text,
  ADD COLUMN IF NOT EXISTS external_id text,
  ADD COLUMN IF NOT EXISTS user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS email text,
  ADD COLUMN IF NOT EXISTS payment_type text,
  ADD COLUMN IF NOT EXISTS status text,
  ADD COLUMN IF NOT EXISTS raw_payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS access_granted_at timestamptz,
  ADD COLUMN IF NOT EXISTS created_at timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

UPDATE public.payment_transactions
SET raw_payload = COALESCE(raw_payload, '{}'::jsonb)
WHERE raw_payload IS NULL;

ALTER TABLE public.payment_transactions
  ALTER COLUMN provider SET NOT NULL,
  ALTER COLUMN external_id SET NOT NULL;

ALTER TABLE public.payment_transactions
  DROP CONSTRAINT IF EXISTS payment_transactions_provider_check;

ALTER TABLE public.payment_transactions
  ADD CONSTRAINT payment_transactions_provider_check CHECK (provider IN ('stripe', 'pagarme', 'sellx'));

CREATE UNIQUE INDEX IF NOT EXISTS payment_transactions_provider_external_id_idx
  ON public.payment_transactions(provider, external_id);
CREATE INDEX IF NOT EXISTS payment_transactions_user_id_idx ON public.payment_transactions(user_id);
CREATE INDEX IF NOT EXISTS payment_transactions_email_idx ON public.payment_transactions(email);
CREATE INDEX IF NOT EXISTS payment_transactions_status_idx ON public.payment_transactions(status);
CREATE INDEX IF NOT EXISTS payment_transactions_created_at_idx ON public.payment_transactions(created_at DESC);

DROP TRIGGER IF EXISTS payment_transactions_updated_at ON public.payment_transactions;
CREATE TRIGGER payment_transactions_updated_at
BEFORE UPDATE ON public.payment_transactions
FOR EACH ROW
EXECUTE PROCEDURE public.update_updated_at();

ALTER TABLE public.payment_transactions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "payment_transactions_select_own" ON public.payment_transactions;

CREATE POLICY "payment_transactions_select_own"
  ON public.payment_transactions FOR SELECT
  USING (
    auth.uid() = user_id
    OR lower(coalesce(email, '')) = lower(coalesce(auth.jwt() ->> 'email', ''))
  );

-- =========================================
-- FEEDBACK DE CANCELAMENTO DE ASSINATURA
-- user_id com ON DELETE SET NULL: mantém o feedback
-- mesmo após exclusão do usuário (dado analítico).
-- Acessível apenas pelo backend (service_role).
-- =========================================

CREATE TABLE IF NOT EXISTS public.subscription_cancellation_feedback (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  email text,
  reason text NOT NULL,
  feedback text,
  plan text,
  subscription_status text,
  stripe_subscription_id text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT subscription_cancellation_feedback_reason_check CHECK (
    reason IN (
      'not_found',
      'difficult_to_use',
      'alternative_tool',
      'technical_issues',
      'price',
      'no_longer_use',
      'other'
    )
  )
);

ALTER TABLE public.subscription_cancellation_feedback
  ADD COLUMN IF NOT EXISTS user_id uuid,
  ADD COLUMN IF NOT EXISTS email text,
  ADD COLUMN IF NOT EXISTS reason text,
  ADD COLUMN IF NOT EXISTS feedback text,
  ADD COLUMN IF NOT EXISTS plan text,
  ADD COLUMN IF NOT EXISTS subscription_status text,
  ADD COLUMN IF NOT EXISTS stripe_subscription_id text,
  ADD COLUMN IF NOT EXISTS metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS created_at timestamptz NOT NULL DEFAULT now();

-- Adiciona FK com ON DELETE SET NULL caso a coluna já exista sem FK
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.table_constraints tc
    JOIN information_schema.key_column_usage kcu
      ON tc.constraint_name = kcu.constraint_name
    WHERE tc.table_schema = 'public'
      AND tc.table_name = 'subscription_cancellation_feedback'
      AND tc.constraint_type = 'FOREIGN KEY'
      AND kcu.column_name = 'user_id'
  ) THEN
    ALTER TABLE public.subscription_cancellation_feedback
      ADD CONSTRAINT scf_user_id_fkey
      FOREIGN KEY (user_id)
      REFERENCES auth.users(id)
      ON DELETE SET NULL;
  END IF;
END $$;

UPDATE public.subscription_cancellation_feedback
SET metadata = COALESCE(metadata, '{}'::jsonb)
WHERE metadata IS NULL;

ALTER TABLE public.subscription_cancellation_feedback
  ALTER COLUMN reason SET NOT NULL,
  ALTER COLUMN metadata SET NOT NULL,
  ALTER COLUMN created_at SET NOT NULL;

ALTER TABLE public.subscription_cancellation_feedback
  DROP CONSTRAINT IF EXISTS subscription_cancellation_feedback_reason_check;

ALTER TABLE public.subscription_cancellation_feedback
  ADD CONSTRAINT subscription_cancellation_feedback_reason_check CHECK (
    reason IN (
      'not_found',
      'difficult_to_use',
      'alternative_tool',
      'technical_issues',
      'price',
      'no_longer_use',
      'other'
    )
  );

CREATE INDEX IF NOT EXISTS scf_user_id_idx
  ON public.subscription_cancellation_feedback(user_id);
CREATE INDEX IF NOT EXISTS scf_reason_idx
  ON public.subscription_cancellation_feedback(reason);
CREATE INDEX IF NOT EXISTS scf_created_at_idx
  ON public.subscription_cancellation_feedback(created_at DESC);
CREATE INDEX IF NOT EXISTS scf_email_idx
  ON public.subscription_cancellation_feedback(email);

ALTER TABLE public.subscription_cancellation_feedback ENABLE ROW LEVEL SECURITY;

-- =========================================
-- GRANTS E DEFAULT PRIVILEGES
-- Evita incompatibilidades de acesso no Supabase
-- =========================================

GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO authenticated, service_role;
GRANT SELECT ON ALL TABLES IN SCHEMA public TO anon;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO authenticated, service_role;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO authenticated, service_role;

ALTER DEFAULT PRIVILEGES IN SCHEMA public
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO authenticated, service_role;

ALTER DEFAULT PRIVILEGES IN SCHEMA public
GRANT SELECT ON TABLES TO anon;

ALTER DEFAULT PRIVILEGES IN SCHEMA public
GRANT USAGE, SELECT ON SEQUENCES TO authenticated, service_role;

ALTER DEFAULT PRIVILEGES IN SCHEMA public
GRANT EXECUTE ON FUNCTIONS TO authenticated, service_role;

-- Bloqueia acesso direto à tabela de feedback para usuários comuns.
-- O service_role (backend) ignora RLS e acessa normalmente.
-- Deve vir APÓS os GRANTs acima para sobrescrever corretamente.
DROP POLICY IF EXISTS "scf_service_only" ON public.subscription_cancellation_feedback;
REVOKE ALL ON public.subscription_cancellation_feedback FROM anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.subscription_cancellation_feedback TO service_role;