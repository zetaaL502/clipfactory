import {StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import App from './App.tsx';
import './index.css';

// Suppress Vite HMR WebSocket reconnection errors — these are not app crashes,
// they happen transiently when the dev server restarts.
window.addEventListener('unhandledrejection', (e) => {
  if (e.reason?.message?.includes('WebSocket')) e.preventDefault();
});

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
