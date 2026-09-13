import React, { useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { useNavigate, Link } from 'react-router-dom';
import { Eye, EyeOff, ShieldCheck } from 'lucide-react';
import './Login.css';

const Login = () => {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const { signIn, getSafeAuthMessage } = useAuth();
  const navigate = useNavigate();

  const handleSubmit = async (e) => {
    e.preventDefault();

    if (!email || !password) {
      setError('Por favor, preencha todos os campos');
      return;
    }

    setLoading(true);
    setError('');

    try {
      await signIn(email, password);
      navigate('/editor');
    } catch (err) {
      console.error('[LenaVS Login] Falha no login:', err?.message || err);
      setError(getSafeAuthMessage(err, 'login'));
    } finally {
      setLoading(false);
    }
  };

  const togglePasswordVisibility = () => {
    setShowPassword((currentValue) => !currentValue);
  };

  return (
    <div className="login-container">
      <div className="login-box">
        <div className="logo-container">
          <img
            src="/logo_oficial.png"
            alt="LenaVS"
            className="logo-image"
          />
        </div>

        <p className="seo-description">
          Crie vídeos de karaokê facilmente com o LenaVS.
          Sincronize letras, personalize o visual e exporte com alguns cliques.
        </p>

        <h1 style={{ display: 'none' }}>
          Criar karaokê online - LenaVS
        </h1>

        <h1 className="login-title">Login</h1>

        {error && <div className="error-message">{error}</div>}

        <form onSubmit={handleSubmit} className="login-form">
          <div className="form-group">
            <label htmlFor="email">Email</label>
            <input
              type="email"
              id="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="seu@email.com"
              disabled={loading}
              autoComplete="email"
            />
          </div>

          <div className="form-group">
            <label htmlFor="password">Senha</label>
            <div className="password-input-wrapper">
              <input
                type={showPassword ? 'text' : 'password'}
                id="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="········"
                disabled={loading}
                autoComplete="current-password"
              />
              <button
                type="button"
                className="toggle-password"
                onClick={togglePasswordVisibility}
                disabled={loading}
                aria-label={showPassword ? 'Ocultar senha' : 'Mostrar senha'}
                aria-pressed={showPassword}
              >
                {showPassword ? <EyeOff size={20} /> : <Eye size={20} />}
              </button>
            </div>
          </div>

          <button
            type="submit"
            className="btn-submit"
            disabled={loading}
          >
            {loading ? 'Entrando...' : 'Entrar'}
          </button>
        </form>

        <div className="legal-inline-note" role="note">
          <ShieldCheck size={16} />
          <span>
            Ao acessar a plataforma, você pode consultar nossa{' '}
            <Link to="/privacy-policy" className="legal-inline-link">
              Política de Privacidade
            </Link>
            .
          </span>
        </div>

        <div className="form-footer">
          <a href="mailto:noreply@lenavs.com?subject=Esqueci%20minha%20senha" className="link-forgot">
            Esqueci minha senha
          </a>
          <p className="signup-text">
            Não tem uma conta?{' '}
            <Link to="/register" className="link-register">
              Registre-se
            </Link>
          </p>
        </div>
      </div>
    </div>
  );
};

export default Login;
