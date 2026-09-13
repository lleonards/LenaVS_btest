import React, { useMemo, useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { useNavigate, Link } from 'react-router-dom';
import { Eye, EyeOff, ShieldCheck } from 'lucide-react';
import './Register.css';

const COUNTRY_OPTIONS = [
  { value: 'BR', label: 'Brasil' },
  { value: 'US', label: 'Estados Unidos' },
  { value: 'CA', label: 'Canadá' },
  { value: 'AU', label: 'Austrália' },
  { value: 'NZ', label: 'Nova Zelândia' },
  { value: 'SG', label: 'Singapura' },
  { value: 'HK', label: 'Hong Kong' },
  { value: 'OTHER', label: 'Outros' },
];

const Register = () => {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [countryGroup, setCountryGroup] = useState('BR');
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [acceptedLegal, setAcceptedLegal] = useState(false);
  const [error, setError] = useState('');
  const [successMessage, setSuccessMessage] = useState('');
  const [loading, setLoading] = useState(false);

  const { signUp, getSafeAuthMessage } = useAuth();
  const navigate = useNavigate();

  const isFormValid = useMemo(
    () => name && email && password && confirmPassword && countryGroup && acceptedLegal,
    [name, email, password, confirmPassword, countryGroup, acceptedLegal]
  );

  const handleSubmit = async (e) => {
    e.preventDefault();

    if (!name || !email || !password || !confirmPassword || !countryGroup) {
      setError('Por favor, preencha todos os campos');
      return;
    }

    if (!acceptedLegal) {
      setError('Você precisa aceitar os termos de uso e a política de privacidade para criar a conta.');
      return;
    }

    if (password !== confirmPassword) {
      setError('As senhas não coincidem');
      return;
    }

    if (password.length < 6) {
      setError('A senha deve ter pelo menos 6 caracteres');
      return;
    }

    setLoading(true);
    setError('');
    setSuccessMessage('');

    try {
      const result = await signUp(email, password, name, countryGroup, acceptedLegal);
      if (result?.emailConfirmationRequired) {
        console.log('[LenaVS Cadastro] Conta criada — confirmação de e-mail necessária para:', email);
        setSuccessMessage(result.message);
      } else {
        navigate('/login');
      }
    } catch (err) {
      setError(getSafeAuthMessage(err, 'signup'));
    } finally {
      setLoading(false);
    }
  };

  const togglePasswordVisibility = () => {
    setShowPassword((currentValue) => !currentValue);
  };

  const toggleConfirmPasswordVisibility = () => {
    setShowConfirmPassword((currentValue) => !currentValue);
  };

  return (
    <div className="register-container">
      <div className="register-box">
        <div className="logo-container register-logo-container">
          <img src="/logo_oficial.png" alt="LenaVS" className="logo-image" />
        </div>

        <h1 className="register-title">Criar Conta</h1>
        <p className="register-subtitle">Escolha seu país.</p>

        {successMessage && (
          <div className="success-message register-full-width">{successMessage}</div>
        )}
        {error && <div className="error-message register-full-width">{error}</div>}

        <form onSubmit={handleSubmit} className="register-form">
          <div className="form-group">
            <label htmlFor="name">Nome</label>
            <input
              type="text"
              id="name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Seu nome"
              disabled={loading}
              autoComplete="name"
            />
          </div>

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

          <div className="form-group register-full-width register-country-group">
            <label htmlFor="countryGroup">País</label>
            <select
              id="countryGroup"
              value={countryGroup}
              onChange={(e) => setCountryGroup(e.target.value)}
              disabled={loading}
            >
              {COUNTRY_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
            <span className="register-helper-text">

              
            </span>
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
                autoComplete="new-password"
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

          <div className="form-group">
            <label htmlFor="confirmPassword">Confirmar Senha</label>
            <div className="password-input-wrapper">
              <input
                type={showConfirmPassword ? 'text' : 'password'}
                id="confirmPassword"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                placeholder="········"
                disabled={loading}
                autoComplete="new-password"
              />
              <button
                type="button"
                className="toggle-password"
                onClick={toggleConfirmPasswordVisibility}
                disabled={loading}
                aria-label={showConfirmPassword ? 'Ocultar confirmação de senha' : 'Mostrar confirmação de senha'}
                aria-pressed={showConfirmPassword}
              >
                {showConfirmPassword ? <EyeOff size={20} /> : <Eye size={20} />}
              </button>
            </div>
          </div>

          <div className="register-full-width register-legal-box">
            <div className="register-legal-header">
              <ShieldCheck size={18} />
              <span>Confirmação obrigatória</span>
            </div>

            <label className="register-checkbox-label" htmlFor="acceptedLegal">
              <input
                type="checkbox"
                id="acceptedLegal"
                checked={acceptedLegal}
                onChange={(e) => setAcceptedLegal(e.target.checked)}
                disabled={loading}
                required
              />
              <span>
                Li e concordo com os termos de uso e com a{' '}
                <Link to="/privacy-policy" className="register-legal-link" target="_blank" rel="noreferrer">
                  Política de Privacidade
                </Link>
                .
              </span>
            </label>
          </div>

          <button type="submit" className="btn-submit register-full-width" disabled={loading || !isFormValid}>
            {loading ? 'Criando conta...' : 'Criar Conta'}
          </button>
        </form>

        <div className="form-footer register-full-width">
          <p className="login-text">
            Já tem uma conta?{' '}
            <Link to="/login" className="link-login">
              Faça login
            </Link>
          </p>
        </div>
      </div>
    </div>
  );
};

export default Register;
