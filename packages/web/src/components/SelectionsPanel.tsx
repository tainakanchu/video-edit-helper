import { useEffect, useRef, useState } from 'react';
import { formatTime } from '@veh/shared';
import { usePlayer } from './PlayerContext';
import { useAppStore, projectSelections } from '../store/useAppStore';
import { selectionsForClip } from '../lib/selection';
import { parseTags } from '../lib/keyboard';

export function SelectionsPanel() {
  const p = usePlayer();
  const project = useAppStore(s => s.project);
  const updateSelection = useAppStore(s => s.updateSelection);
  const deleteSelection = useAppStore(s => s.deleteSelection);
  const highlightSelectionId = useAppStore(s => s.highlightSelectionId);
  const setHighlightSelection = useAppStore(s => s.setHighlightSelection);

  const selections = project
    ? selectionsForClip(projectSelections(project), p.clip.id)
    : [];

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editValue, setEditValue] = useState('');

  const highlightRef = useRef<HTMLDivElement>(null);

  // 強調表示行をビューへスクロールし、再トリガーしないよう少し後にクリア
  useEffect(() => {
    if (!highlightSelectionId) return;
    highlightRef.current?.scrollIntoView({ block: 'nearest' });
    const t = setTimeout(() => setHighlightSelection(null), 1500);
    return () => clearTimeout(t);
  }, [highlightSelectionId, setHighlightSelection]);

  const handleEdit = (sel: { id: string; text: string; tags: string[] }) => {
    setEditingId(sel.id);
    setEditValue(sel.text + sel.tags.map(t => ' #' + t).join(''));
  };

  const handleSave = async (selectionId: string) => {
    const { text, tags } = parseTags(editValue);
    await updateSelection(selectionId, { text, tags });
    setEditingId(null);
  };

  const handleRating = async (selectionId: string, current: number, k: number) => {
    const rating = (current === k ? k - 1 : k) as 0 | 1 | 2 | 3;
    await updateSelection(selectionId, { rating });
  };

  const handleDelete = async (selectionId: string) => {
    if (window.confirm('この選定を削除しますか?')) {
      await deleteSelection(selectionId);
    }
  };

  return (
    <div className="selections">
      <div className="list">
        {selections.length === 0 ? (
          <div className="empty">
            まだ選定はありません。I / O 点で範囲を作成できます
          </div>
        ) : (
          selections.map(s => {
            const highlighted = s.id === highlightSelectionId;
            return (
              <div
                key={s.id}
                ref={highlighted ? highlightRef : undefined}
                className={highlighted ? 'sel-row highlight' : 'sel-row'}
              >
                <div className="top">
                  <span className="tc" onClick={() => p.seekTo(s.inSec)}>
                    {formatTime(s.inSec)}–{formatTime(s.outSec)}
                  </span>
                  <button
                    className="play-range"
                    onClick={() => p.playRange(s.inSec, s.outSec)}
                    title="範囲再生"
                  >
                    ▶
                  </button>
                  <span className="stars">
                    {[1, 2, 3].map(k => (
                      <span
                        key={k}
                        className={s.rating >= k ? 'star on' : 'star'}
                        onClick={() => handleRating(s.id, s.rating, k)}
                      >
                        ★
                      </span>
                    ))}
                  </span>
                </div>
                {editingId === s.id ? (
                  <div>
                    <textarea
                      value={editValue}
                      onChange={e => setEditValue(e.target.value)}
                    />
                    <button onClick={() => handleSave(s.id)}>保存</button>
                    <button onClick={() => setEditingId(null)}>キャンセル</button>
                  </div>
                ) : (
                  <>
                    <div className="text">{s.text}</div>
                    <div className="tags">
                      {s.tags.map(tag => (
                        <span key={tag} className="tag-chip">#{tag}</span>
                      ))}
                    </div>
                    <div className="acts">
                      <button onClick={() => handleEdit(s)}>編集</button>
                      <button onClick={() => handleDelete(s.id)}>削除</button>
                    </div>
                  </>
                )}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
