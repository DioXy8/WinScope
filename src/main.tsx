import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './ui/App';
import './ui/styles.css';

const rootEl = document.getElementById('root');
if (!rootEl) {
  throw new Error('Élément #root introuvable dans index.html');
}

ReactDOM.createRoot(rootEl).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
