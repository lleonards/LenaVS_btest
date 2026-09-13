import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App' // Removi o .jsx para evitar problemas de resolução de nomes em alguns builds
import './index.css'

// 🔎 LOG DE DIAGNÓSTICO: Se este log NÃO aparecer no console (F12), 
// o problema é o arquivo index.html que não está conseguindo carregar o main.jsx.
console.log('Main.jsx carregado com sucesso!');

const rootElement = document.getElementById('root');

if (!rootElement) {
  console.error('ERRO CRÍTICO: Elemento root não encontrado no index.html');
} else {
  ReactDOM.createRoot(rootElement).render(
    <React.StrictMode>
      <App />
    </React.StrictMode>
  );
}
