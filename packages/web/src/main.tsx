import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { RouterProvider } from './lib/useRouter';
import { establishSession } from './lib/authToken';
import './styles.css';

const rootEl = document.getElementById('root');
if (!rootEl) {
  throw new Error('#root が見つかりません');
}

// API トークン(#veh-token=...)を Cookie に換えてから描画する(最初の API 呼び出しを 401 にしない)
void establishSession().finally(() => {
  createRoot(rootEl).render(
    <StrictMode>
      <RouterProvider>
        <App />
      </RouterProvider>
    </StrictMode>,
  );
});
