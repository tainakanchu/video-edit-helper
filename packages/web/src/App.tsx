import { useEffect } from 'react';
import { useAppStore } from './store/useAppStore';
import { DayNav } from './components/DayNav';
import { DayView } from './components/DayView';
import { ClipView } from './components/ClipView';
import { SetupView } from './components/SetupView';
import { JobsIndicator } from './components/JobsIndicator';
import { Toasts } from './components/Toasts';

export function App() {
  const view = useAppStore((s) => s.view);
  const loading = useAppStore((s) => s.loadingProject);
  const init = useAppStore((s) => s.init);
  const goSetup = useAppStore((s) => s.goSetup);

  useEffect(() => {
    void init();
    return () => useAppStore.getState().stopJobPolling();
  }, [init]);

  return (
    <div className="app">
      <header className="header">
        <span className="brand" onClick={goSetup} title="設定 / スキャン">
          Video Edit Helper
        </span>
        <span className="spacer" />
        <JobsIndicator />
      </header>

      {loading ? (
        <div className="loading">読み込み中…</div>
      ) : view === 'setup' ? (
        <SetupView />
      ) : view === 'clip' ? (
        <ClipView />
      ) : (
        <div className="body">
          <DayNav />
          <main className="main">
            <DayView />
          </main>
        </div>
      )}

      <Toasts />
    </div>
  );
}
