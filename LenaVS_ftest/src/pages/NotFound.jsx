import React from 'react';
import { Link } from 'react-router-dom';
import { Home } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';

const NotFound = () => {
  const { isAuthenticated } = useAuth();
  const homePath = isAuthenticated ? '/editor' : '/login';

  return (
    <div
      style={{
        minHeight: '100vh',
        background:
          'radial-gradient(circle at top, rgba(255,140,90,0.12), transparent 40%), #0a0a0a',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '24px',
      }}
    >
      <div
        style={{
          width: 'min(620px, 100%)',
          background: '#141414',
          border: '1px solid rgba(255,255,255,0.06)',
          borderRadius: 24,
          padding: '32px',
          color: '#fff',
          boxShadow: '0 30px 90px rgba(0,0,0,0.45)',
          textAlign: 'center',
        }}
      >
        <span
          style={{
            display: 'inline-block',
            padding: '6px 12px',
            borderRadius: 999,
            background: 'rgba(255,140,90,0.12)',
            color: '#ffb08d',
            fontWeight: 800,
            marginBottom: 16,
          }}
        >
          404 protegido
        </span>

        <h1
          style={{
            margin: 0,
            fontSize: '36px',
            lineHeight: 1.1,
          }}
        >
          Página não encontrada
        </h1>

        <p
          style={{
            margin: '14px 0 0',
            color: '#c9c9c9',
            lineHeight: 1.7,
          }}
        >
          A página que você tentou acessar não existe ou foi movida.
        </p>

        <div
          style={{
            display: 'flex',
            justifyContent: 'center',
            marginTop: 28,
          }}
        >
          <Link
            to={homePath}
            style={{
              background: '#ff8c5a',
              color: '#111',
              padding: '12px 18px',
              borderRadius: 12,
              fontWeight: 800,
              display: 'inline-flex',
              alignItems: 'center',
              gap: 8,
              textDecoration: 'none',
              transition: 'all 0.2s ease',
            }}
          >
            <Home size={16} />
            Ir para o início
          </Link>
        </div>
      </div>
    </div>
  );
};

export default NotFound;
