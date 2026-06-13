import { useEffect, useState } from 'react';
import { formatTime, type ID, type SearchResultItem, type SearchResultKind } from '@veh/shared';
import { api } from '../api/client';
import { useAppStore } from '../store/useAppStore';
import { useRouter } from '../lib/useRouter';

const KIND_ICON: Record<SearchResultKind, string> = {
  note: '📌',
  selection: '⭐',
  transcript: '💬',
};

export function SearchView({ query }: { query: string }) {
  const project = useAppStore((s) => s.project);
  const { navigate } = useRouter();

  const [results, setResults] = useState<SearchResultItem[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);

  const trimmed = query.trim();

  useEffect(() => {
    if (trimmed === '') {
      setResults(null);
      setLoading(false);
      setError(false);
      return;
    }

    let cancelled = false;
    setLoading(true);
    setError(false);

    api
      .search(query)
      .then((res) => {
        if (cancelled) return;
        setResults(res.results);
        setLoading(false);
      })
      .catch(() => {
        if (cancelled) return;
        setError(true);
        setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [query, trimmed]);

  if (trimmed === '') {
    return <div className="search-empty">キーワードを入力して検索してください</div>;
  }

  if (loading) {
    return <div className="search-empty">検索中…</div>;
  }

  if (error) {
    return <div className="search-empty">検索に失敗しました</div>;
  }

  if (!results || results.length === 0) {
    return <div className="search-empty">該当する結果がありません</div>;
  }

  // dayId ごとにグループ化(project の Day 順を保つ)
  const byDay = new Map<ID, SearchResultItem[]>();
  for (const item of results) {
    const arr = byDay.get(item.dayId);
    if (arr) arr.push(item);
    else byDay.set(item.dayId, [item]);
  }

  const dayOrder = project?.days ?? [];
  const orderedDayIds = [
    ...dayOrder.map((d) => d.id).filter((id) => byDay.has(id)),
    // project に無い dayId(念のため)も末尾に拾う
    ...[...byDay.keys()].filter((id) => !dayOrder.some((d) => d.id === id)),
  ];

  return (
    <div className="searchview">
      {orderedDayIds.map((dayId) => {
        const items = byDay.get(dayId) ?? [];
        const day = dayOrder.find((d) => d.id === dayId);
        const label = day ? `Day ${day.index}` : dayId;
        return (
          <section key={dayId} className="search-day">
            <h3>
              {label}
              {day ? <span className="date"> {day.date}</span> : null}
            </h3>
            {items.map((item, idx) => (
              <button
                key={`${item.kind}:${item.clipId}:${item.timeSec}:${idx}`}
                className="search-result"
                onClick={() =>
                  navigate({ name: 'clip', clipId: item.clipId, t: item.timeSec })
                }
              >
                <span className="kind-icon">{KIND_ICON[item.kind]}</span>
                <span className="clip-name">{item.clipName}</span>
                <span className="tc">
                  {formatTime(item.timeSec)}
                  {item.endSec != null ? `–${formatTime(item.endSec)}` : ''}
                </span>
                <span className="text">{item.text}</span>
              </button>
            ))}
          </section>
        );
      })}
    </div>
  );
}
