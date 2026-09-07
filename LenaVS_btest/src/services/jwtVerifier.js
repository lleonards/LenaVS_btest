import { createRemoteJWKSet, jwtVerify } from 'jose';
import jwt from 'jsonwebtoken';

const supabaseUrl = String(process.env.SUPABASE_URL || '').replace(/\/+$/, '');
const legacyJwtSecret =
  process.env.SUPABASE_JWT_SECRET
  || process.env.SUPABASE_SECRET_JWT_SECRET
  || '';

const JWKS_URL = `${supabaseUrl}/auth/v1/.well-known/jwks.json`;

let jwksRemoteSet = null;

const getJwksSet = () => {
  if (!jwksRemoteSet) {
    jwksRemoteSet = createRemoteJWKSet(new URL(JWKS_URL), {
      cacheMaxAge: 5 * 60 * 1000,
      cooldownDuration: 30 * 1000,
      timeoutDuration: 10 * 1000,
    });
  }
  return jwksRemoteSet;
};

/**
 * Verifica um access token do Supabase.
 *
 * 1) Tenta a verificação ASSIMÉTRICA (ES256/RS256) contra o JWKS do projeto
 *    (`/auth/v1/.well-known/jwks.json`), com cache e lookup por `kid`.
 *    É isso que resolve o erro "unrecognized JWT kid ... for algorithm ES256":
 *    o Supabase agora assina os tokens com chaves ES256 (novas signing keys,
 *    usadas com as chaves `sb_publishable_...`/`sb_secret_...`), e a lib
 *    precisa buscar a chave pública certa pelo `kid` no JWKS.
 * 2) Fallback legado: segredo compartilhado HS256 (config antiga).
 *
 * Retorna o payload decodificado ou null.
 */
export const verifySupabaseToken = async (token) => {
  if (!token) {
    return null;
  }

  // 1) JWKS (novas chaves de assinatura ES256/RS256)
  if (supabaseUrl) {
    try {
      const { payload } = await jwtVerify(token, getJwksSet(), {
        algorithms: ['ES256', 'RS256'],
      });
      return payload;
    } catch (err) {
      console.warn('[jwtVerifier] Verificação via JWKS falhou:', err?.message);
    }
  }

  // 2) Segredo legado HS256 (apenas se o token ainda for assinado com ele)
  if (legacyJwtSecret) {
    try {
      const decoded = jwt.verify(token, legacyJwtSecret, {
        algorithms: ['HS256'],
      });
      return typeof decoded === 'string' ? { sub: decoded } : decoded;
    } catch (err) {
      console.warn('[jwtVerifier] Verificação via segredo legado falhou:', err?.message);
    }
  }

  return null;
};
