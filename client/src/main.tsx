import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '@fontsource/inter/400.css';
import '@fontsource/inter/500.css';
import '@fontsource/inter/600.css';
import '@fontsource/inter/700.css';
import '@fontsource/noto-nastaliq-urdu/400.css';
import '@fontsource/noto-nastaliq-urdu/700.css';
import './index.css';
import { App } from './app';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

// Installable on tablets (Chrome registers service workers only on secure origins).
if ('serviceWorker' in navigator && window.isSecureContext && !window.posDesktop) {
  navigator.serviceWorker.register('/sw.js').catch(() => undefined);
}
