/**
 * History API ベース手書きルーターの React 配線。
 *
 * - URL を唯一の真実とし、現在の Route を context で配る。
 * - navigate(route, {replace}) で pushState / replaceState + 再描画。
 * - popstate(戻る / 進む)で同期する。
 * - 純ロジック(parseRoute / buildPath)は lib/router.ts にある。
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from 'react';
import { buildPath, parseRoute, routesEqual, type Route } from './router';

export interface NavigateOptions {
  replace?: boolean;
}

export interface RouterApi {
  route: Route;
  navigate: (route: Route, opts?: NavigateOptions) => void;
}

const RouterContext = createContext<RouterApi | null>(null);

function currentRoute(): Route {
  return parseRoute(window.location.pathname, window.location.search);
}

export function RouterProvider({ children }: { children: ReactNode }) {
  const [route, setRoute] = useState<Route>(() => currentRoute());

  useEffect(() => {
    const onPop = () => setRoute(currentRoute());
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);

  const navigate = useCallback(
    (next: Route, opts: NavigateOptions = {}) => {
      const path = buildPath(next);
      const cur = currentRoute();
      // 同じ URL への push は履歴を汚すので no-op(replace は許容)
      if (!opts.replace && routesEqual(cur, next)) {
        setRoute(next);
        return;
      }
      if (opts.replace) {
        window.history.replaceState(null, '', path);
      } else {
        window.history.pushState(null, '', path);
      }
      setRoute(next);
    },
    [],
  );

  return (
    <RouterContext.Provider value={{ route, navigate }}>{children}</RouterContext.Provider>
  );
}

export function useRouter(): RouterApi {
  const ctx = useContext(RouterContext);
  if (!ctx) throw new Error('useRouter must be used within RouterProvider');
  return ctx;
}
