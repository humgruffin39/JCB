import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '@fontsource-variable/noto-sans-jp/wght.css';
import '@jcb/ui/tokens.css';
import './styles.css';
import { App } from './app.js';

const root = document.querySelector('#root');
if (root === null) throw new Error('Application root is missing.');

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
