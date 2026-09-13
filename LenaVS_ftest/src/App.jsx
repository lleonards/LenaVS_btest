import React from 'react';
import { HashRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider, useAuth } from './contexts/AuthContext';

import Login from './pages/Login';
import Register from './pages/Register';
import PrivacyPolicy from './pages/PrivacyPolicy';
import Editor from './pages/Editor';
import Upgrade from './pages/Upgrade';
import PaymentStatus from './pages/PaymentStatus';
import NotFound from './pages/NotFound';
import ErrorBoundary from './components/ErrorBoundary';

const LoadingScreen = () => (
  <div
    style={{
      display: 'flex',
      justifyContent: 'center',
      alignItems: 'center',
      flexDirection: 'column',
      gap: '14px',
      height: '100vh',
      backgroundColor: '#000',
      color: '#ff8c5a',
      fontFamily: 'Montserrat, sans-serif',
      letterSpacing: '0.02em',
    }}
  >
    <div
      style={{
        width: '42px',
        height: '42px',
        borderRadius: '999px',
        border: '3px solid rgba(255, 140, 90, 0.22)',
        borderTopColor: '#ff8c5a',
        animation: 'lenavs-spin 0.9s linear infinite',
      }}
    />
    <p style={{ margin: 0, color: '#ff8c5a', fontWeight: 600 }}>Carregando LenaVS...</p>
    <style>{`
      @keyframes lenavs-spin {
        from { transform: rotate(0deg); }
        to { transform: rotate(360deg); }
      }
    `}</style>
  </div>
);

const AuthGuard = ({ children, isPrivate = true }) => {
  const { isAuthenticated, loading } = useAuth();

  if (loading) return <LoadingScreen />;

  if (isPrivate) {
    return isAuthenticated ? children : <Navigate to="/login" replace />;
  }

  return isAuthenticated ? <Navigate to="/editor" replace /> : children;
};

function AppRoutes() {
  return (
    <Routes>
      <Route
        path="/login"
        element={
          <AuthGuard isPrivate={false}>
            <Login />
          </AuthGuard>
        }
      />

      <Route
        path="/register"
        element={
          <AuthGuard isPrivate={false}>
            <Register />
          </AuthGuard>
        }
      />

      <Route path="/privacy-policy" element={<PrivacyPolicy />} />

      <Route
        path="/editor"
        element={
          <AuthGuard>
            <Editor />
          </AuthGuard>
        }
      />

      <Route
        path="/upgrade"
        element={
          <AuthGuard>
            <Upgrade />
          </AuthGuard>
        }
      />

      <Route
        path="/payment/:status"
        element={
          <AuthGuard>
            <PaymentStatus />
          </AuthGuard>
        }
      />

      {/* Rota de cancelamento agora redireciona direto ao editor (formulário está no Stripe) */}
      <Route
        path="/payment/cancelled"
        element={
          <AuthGuard>
            <Navigate to="/editor" replace />
          </AuthGuard>
        }
      />

      <Route
        path="/"
        element={
          <AuthGuard>
            <Editor />
          </AuthGuard>
        }
      />

      <Route path="*" element={<NotFound />} />
    </Routes>
  );
}

function App() {
  return (
    <ErrorBoundary>
      <AuthProvider>
        <HashRouter>
          <AppRoutes />
        </HashRouter>
      </AuthProvider>
    </ErrorBoundary>
  );
}

export default App;
