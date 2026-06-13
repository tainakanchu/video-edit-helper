import { useEffect } from 'react';
import { useAppStore } from './store/useAppStore';
import { useRouter } from './lib/useRouter';
import type { Route } from './lib/router';
import { DayNav } from './components/DayNav';
import { DayView } from './components/DayView';
import { ClipView } from './components/ClipView';
import { TriageView } from './components/TriageView';
import { SearchView } from './components/SearchView';
import { SetupView } from './components/SetupView';
import { MapView } from './components/MapView';
import { JobsIndicator } from './components/JobsIndicator';
import { SearchBox } from './components/SearchBox';
import { Toasts } from './components/Toasts';

export function App() {
  const { route, navigate } = useRouter();
  const loading = useAppStore((s) => s.loadingProject);
  const project = useAppStore((s) => s.project);
  const init = useAppStore((s) => s.init);
  const setSelected = useAppStore((s) => s.setSelected);

  useEffect(() => {
    void init();
    return () => useAppStore.getState().stopJobPolling();
  }, [init]);

  // --- URL(route)→ ストアの選択状態を同期 ---
  useEffect(() => {
    switch (route.name) {
      case 'day':
      case 'triage':
        setSelected({ dayId: route.dayId, clipId: null });
        break;
      case 'clip': {
        const clip = project?.clips[route.clipId];
        setSelected({ clipId: route.clipId, dayId: clip?.dayId ?? undefined });
        break;
      }
      default:
        break;
    }
  }, [route, project, setSelected]);

  // --- '/' と未解決ルートを解決(プロジェクト読み込み後) ---
  useEffect(() => {
    if (loading) return;
    if (route.name !== 'home') return;
    navigate(resolveHome(project), { replace: true });
  }, [loading, route, project, navigate]);

  return (
    <div className="app">
      <header className="header">
        <span className="brand" onClick={() => navigate(resolveHome(project))} title="ホーム">
          Video Edit Helper
        </span>
        <SearchBox />
        <span className="spacer" />
        <button
          className={route.name === 'map' ? 'ghost active' : 'ghost'}
          onClick={() => navigate({ name: 'map' })}
          title="撮影地の地図"
        >
          地図
        </button>
        <button
          className="ghost"
          onClick={() => navigate({ name: 'setup' })}
          title="設定 / スキャン"
        >
          設定
        </button>
        <JobsIndicator />
      </header>

      {loading ? <div className="loading">読み込み中…</div> : <Body route={route} />}

      <Toasts />
    </div>
  );
}

/** '/' の解決先: クリップがあれば最初の Day、無ければ /setup */
function resolveHome(project: ReturnType<typeof useAppStore.getState>['project']): Route {
  if (project && Object.keys(project.clips).length > 0) {
    const firstDay = project.days[0]?.id;
    if (firstDay) return { name: 'day', dayId: firstDay };
  }
  return { name: 'setup' };
}

function Body({ route }: { route: Route }) {
  switch (route.name) {
    case 'setup':
      return <SetupView />;
    case 'map':
      return <MapView />;
    case 'clip':
      return <ClipView key={route.clipId} clipId={route.clipId} initialSeekSec={route.t} />;
    case 'triage':
      return <TriageView key={route.dayId} dayId={route.dayId} />;
    case 'search':
      return <SearchView query={route.q} />;
    case 'day':
      return (
        <div className="body">
          <DayNav />
          <main className="main">
            <DayView />
          </main>
        </div>
      );
    case 'home':
    default:
      // resolveHome で replace されるまでの一瞬
      return <div className="loading">…</div>;
  }
}
