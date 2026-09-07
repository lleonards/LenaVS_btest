import { createRemoteJWKSet, jwtVerify } from 'jose';
import dotenv from 'dotenv';

dotenv.config();

const SUPABASE_URL = String(process.env.SUPABASE_URL || '').trim().replace(/\/+$/, '');
const ISSUER = `${SUPABASE_URL}/auth/v1`;
const AUDIENCE = 'authenticated';
const ALLOWED_ALGORITHMS = ['ES256', 'RS256'];

let jwksPromise = null;

const buildJwksUrl = () => `${ISSUER}/.well-known/jwks.json`;

const fetchRemoteJwks = () => {
  if (!SUPABASE_URL) {
    throw new Error('SUPABASE_URL não configurada para verificação JWKS.');
  }

  return createRemoteJWKSet(new URL(buildJwksUrl()));
};

const getJwks = ({ force = false } = {}) => {
  if (force || !jwksPromise) {
    jwksPromise = fetchRemoteJwks().catch((error) => {
      jwksPromise = null;
      throw error;
    });
  }

  return jwksPromise;
};

const isKeyRelatedError = (error) => {
  const code = String(error?.code || '');
  const message = String(error?.message || '');

  return (
    code.includes('JWKS')
    || code.includes('JWT_SIGNATURE')
    || /kid|no matching key|keyfunc|signature/i.test(message)
  );
};

/**
 * Verifica um access_token do Supabase contra o JWKS público do projeto
 * (https://<projeto>.supabase.co/auth/v1/.well-known/jwks.json).
 *
 * Suporta as chaves assimétricas novas (ES256/RS256) emitidas pelo GoTrue,
 * inclusive os tokens emitidos em projetos com as chaves sb_publishable/sb_secret.
 * Em caso de rotação de chave ("unrecognized JWT kid"), busca o JWKS
 * novamente uma vez antes de falhar.
 */
export const verifySupabaseToken = async (token) => {
  if (!token) {
    return { payload: null, error: new Error('Token não fornecido') };
  }

  let lastError = null;

  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const jwks = await getJwks({ force: attempt === 1 });
      const { payload } = await jwtVerify(token, jwks, {
        issuer: ISSUER,
        audience: AUDIENCE,
        algorithms: ALLOWED_ALGORITHMS,
      });

      return { payload, error: null };
    } catch (error) {
      lastError = error;

      if (attempt === 0 && isKeyRelatedError(error)) {
        continue; // chave pode ter sido rotacionada: refetch do JWKS uma vez
      }

      return { payload: null, error };
    }
  }

  return { payload: null, error: lastError };
};

export default verifySupabaseToken;
