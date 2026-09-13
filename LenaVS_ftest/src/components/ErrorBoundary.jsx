import React from 'react';
import { AlertTriangle, ClipboardCopy, RefreshCcw } from 'lucide-react';
import { goToAppRoute } from '../utils/appPath';

/**
 * ErrorBoundary do LenaVS.
 *
 * Em vez de esconder o erro, esta tela de recuperação mostra:
 * - o NOME do erro (ex.: ReferenceError),
 * - a MENSAGEM exata (ex.: "isSyncingLyrics is not defined"),
 * - o stack do componente e do JavaScript (em "Ver detalhes técnicos"),
 * - um botão "Copiar detalhes" para enviar ao suporte,
 * - e imprime tudo no console (F12) para diagnóstico.
 */
class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null, errorInfo: null };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  componentDidCatch(error, errorInfo) {
    console.error('⛔ [LenaVS] Erro capturado pelo ErrorBoundary:');
    console.error('Nome:', error?.name || 'Erro desconhecido');
    console.error('Mensagem:', error?.message || '(sem mensagem)');
    console.error('Stack do erro:', error?.stack || '(sem stack)');
    console.error('Stack do componente:', errorInfo?.componentStack || '(sem stack de componente)');

    this.setState({ errorInfo });
  }

  handleReload = () => {
    goToAppRoute('/');
    // Força um carregamento completo (descarta qualquer bundle/cache antigo).
    window.location.reload();
  };

  handleCopyDetails = async () => {
    const { error, errorInfo } = this.state;

    const details = [
      'LenaVS — Relatório de erro',
      '',
      `Tipo: ${error?.name || 'Erro desconhecido'}`,
      `Mensagem: ${error?.message || '(sem mensagem)'}`,
      '',
      '— Stack do erro —',
      error?.stack || '(sem stack)',
      '',
      '— Stack do componente —',
      errorInfo?.componentStack || '(sem stack de componente)',
      '',
      `URL: ${typeof window !== 'undefined' ? window.location.href : ''}`,
      `Navegador: ${typeof navigator !== 'undefined' ? navigator.userAgent : ''}`,
    ].join('\n');

    try {
      await navigator.clipboard.writeText(details);
    } catch (copyError) {
      console.warn('Não foi possível copiar automaticamente:', copyError);
      window.prompt('Copie o relatório abaixo:', details);
    }
  };

  render() {
    if (!this.state.hasError) {
      return this.props.children;
    }

    const { error, errorInfo } = this.state;
    const errorName = error?.name || 'Erro JavaScript';
    const errorMessage = error?.message || '(sem mensagem)';

    return (
      <div style={{
        minHeight: '100vh',
        background: '#090909',
        color: '#fff',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '24px',
        fontFamily: 'Inter, ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif',
      }}>
        <div style={{
          width: 'min(680px, 100%)',
          background: '#151515',
          border: '1px solid rgba(255,140,90,0.18)',
          borderRadius: '22px',
          padding: '28px',
          boxShadow: '0 30px 80px rgba(0,0,0,0.45)',
        }}>
          <div style={{
            display: 'flex',
            alignItems: 'center',
            gap: '14px',
            marginBottom: '18px',
          }}>
            <div style={{
              width: 52,
              height: 52,
              flexShrink: 0,
              borderRadius: 16,
              background: 'rgba(255,140,90,0.14)',
              color: '#ff8c5a',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}>
              <AlertTriangle size={26} />
            </div>

            <div>
              <h1 style={{ margin: 0, fontSize: '24px', color: '#ffb08d' }}>Algo saiu do esperado</h1>
              <p style={{ margin: '4px 0 0', color: '#8f8f8f', fontSize: '13px' }}>
                Para evitar a tela branca, o LenaVS exibiu esta página de recuperação.
              </p>
            </div>
          </div>

          <div style={{
            background: '#0e0e0e',
            border: '1px solid rgba(255,255,255,0.08)',
            borderRadius: 14,
            padding: '14px 16px',
            marginBottom: 14,
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
              <span style={{
                background: 'rgba(239,68,68,0.16)',
                color: '#fca5a5',
                padding: '3px 10px',
                borderRadius: 999,
                fontSize: '12px',
                fontWeight: 800,
                letterSpacing: '0.04em',
              }}>
                {errorName}
              </span>
              <span style={{ color: '#6f687e', fontSize: '12px' }}>— erro capturado</span>
            </div>

            <p style={{
              margin: 0,
              color: '#e5e5e5',
              fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
              fontSize: '14px',
              lineHeight: 1.5,
              overflowWrap: 'anywhere',
            }}>
              {errorMessage}
            </p>
          </div>

          <details style={{ marginBottom: 18 }}>
            <summary style={{
              cursor: 'pointer',
              color: '#9aa3b2',
              fontSize: '13px',
              fontWeight: 700,
              padding: '4px 0',
            }}>
              Ver detalhes técnicos (stack completo)
            </summary>

            <div style={{ marginTop: 10, display: 'grid', gap: 10 }}>
              <div>
                <div style={{ color: '#6f687e', fontSize: '12px', fontWeight: 700, marginBottom: 4 }}>
                  Onde aconteceu (componentes React)
                </div>
                <pre style={{
                  margin: 0,
                  maxHeight: 180,
                  overflow: 'auto',
                  background: '#0b0b0b',
                  border: '1px solid rgba(255,255,255,0.07)',
                  borderRadius: 10,
                  padding: '10px 12px',
                  color: '#b7b7b7',
                  fontSize: '11.5px',
                  lineHeight: 1.5,
                  whiteSpace: 'pre-wrap',
                  overflowWrap: 'anywhere',
                }}>
                  {errorInfo?.componentStack || '(sem stack de componente)'}
                </pre>
              </div>

              <div>
                <div style={{ color: '#6f687e', fontSize: '12px', fontWeight: 700, marginBottom: 4 }}>
                  Stack do JavaScript
                </div>
                <pre style={{
                  margin: 0,
                  maxHeight: 180,
                  overflow: 'auto',
                  background: '#0b0b0b',
                  border: '1px solid rgba(255,255,255,0.07)',
                  borderRadius: 10,
                  padding: '10px 12px',
                  color: '#b7b7b7',
                  fontSize: '11.5px',
                  lineHeight: 1.5,
                  whiteSpace: 'pre-wrap',
                  overflowWrap: 'anywhere',
                }}>
                  {error?.stack || '(sem stack)'}
                </pre>
              </div>
            </div>
          </details>

          <p style={{ margin: '0 0 18px', color: '#6f687e', fontSize: '12.5px', lineHeight: 1.6 }}>
            As mesmas informações foram impressas no console do navegador (tecla F12).
            Se o problema persistir após recarregar, copie os detalhes acima e envie para o suporte.
          </p>

          <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap' }}>
            <button
              type="button"
              onClick={this.handleReload}
              style={{
                background: '#ff8c5a',
                color: '#111',
                padding: '12px 18px',
                borderRadius: 12,
                fontWeight: 800,
                display: 'inline-flex',
                alignItems: 'center',
                gap: 8,
                border: 0,
                cursor: 'pointer',
              }}
            >
              <RefreshCcw size={16} />
              Recarregar LenaVS
            </button>

            <button
              type="button"
              onClick={this.handleCopyDetails}
              style={{
                background: '#232323',
                color: '#fff',
                padding: '12px 18px',
                borderRadius: 12,
                fontWeight: 700,
                display: 'inline-flex',
                alignItems: 'center',
                gap: 8,
                border: 0,
                cursor: 'pointer',
              }}
            >
              <ClipboardCopy size={16} />
              Copiar detalhes do erro
            </button>

            <a
              href={`mailto:noreply@lenavs.com?subject=${encodeURIComponent(`Erro na LenaVS: ${errorName}`)}&body=${encodeURIComponent(`Tipo: ${errorName}\nMensagem: ${errorMessage}\nStack: ${error?.stack || ''}\nComponente: ${errorInfo?.componentStack || ''}`)}`}
              style={{
                background: '#232323',
                color: '#fff',
                padding: '12px 18px',
                borderRadius: 12,
                fontWeight: 700,
                textDecoration: 'none',
              }}
            >
              Falar com suporte
            </a>
          </div>
        </div>
      </div>
    );
  }
}

export default ErrorBoundary;
