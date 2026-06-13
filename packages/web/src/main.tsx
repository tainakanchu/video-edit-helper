import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { RouterProvider } from './lib/useRouter';
import './styles.css';

const rootEl = document.getElementById('root');
if (!rootEl) {
  throw new Error('#root が見つかりません');
}

createRoot(rootEl).render(
  <StrictMode>
    <RouterProvider>
      <App />
    </RouterProvider>
  </StrictMode>,
);
