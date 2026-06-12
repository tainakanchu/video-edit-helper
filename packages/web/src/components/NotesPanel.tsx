import { useEffect, useRef, useState } from 'react';
import { formatTime } from '@veh/shared';
import { usePlayer } from './PlayerContext';
import { useAppStore, notesForClip } from '../store/useAppStore';
import { parseTags } from '../lib/keyboard';

interface NotesPanelProps {
  registerFocus: (focus: () => void) => void;
}

export function NotesPanel({ registerFocus }: NotesPanelProps) {
  const p = usePlayer();
  const project = useAppStore(s => s.project);
  const addNote = useAppStore(s => s.addNote);
  const updateNote = useAppStore(s => s.updateNote);
  const deleteNote = useAppStore(s => s.deleteNote);

  const notes = project ? notesForClip(project, p.clip.id) : [];

  const [inputValue, setInputValue] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editValue, setEditValue] = useState('');

  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    registerFocus(() => inputRef.current?.focus());
  }, [registerFocus]);

  const handleInputKeyDown = async (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      const { text, tags } = parseTags(inputValue);
      if (!text && tags.length === 0) return;
      await addNote(p.clip.id, p.virtualTimeSec, text, tags);
      setInputValue('');
    } else if (e.key === 'Escape') {
      setInputValue('');
      (e.target as HTMLInputElement).blur();
    }
  };

  const handleSave = async (noteId: string) => {
    const { text, tags } = parseTags(editValue);
    await updateNote(noteId, { text, tags });
    setEditingId(null);
  };

  const handleDiscard = async (noteId: string) => {
    await updateNote(noteId, { status: 'discarded' });
  };

  const handleRestore = async (noteId: string) => {
    await updateNote(noteId, { status: 'open' });
  };

  const handleEdit = (note: { id: string; text: string; tags: string[] }) => {
    setEditingId(note.id);
    setEditValue(note.text + note.tags.map(t => ' #' + t).join(''));
  };

  const handleDelete = async (noteId: string) => {
    if (window.confirm('この付箋を削除しますか?')) {
      await deleteNote(noteId);
    }
  };

  const statusLabel = (status: 'open' | 'promoted' | 'discarded'): string => {
    if (status === 'open') return '未処理';
    if (status === 'promoted') return '昇格済み';
    return '破棄';
  };

  return (
    <div className="notes">
      <div className="quick">
        <span className="tc">{formatTime(p.virtualTimeSec)}</span>
        <input
          ref={inputRef}
          value={inputValue}
          onChange={e => setInputValue(e.target.value)}
          onKeyDown={handleInputKeyDown}
          placeholder="付箋テキスト (#タグ)"
        />
      </div>
      <div className="list">
        {notes.length === 0 ? (
          <div className="empty">まだ付箋はありません。N キーで現在位置に追加できます</div>
        ) : (
          notes.map(note => (
            <div
              key={note.id}
              className={note.status === 'discarded' ? 'note-row discarded' : 'note-row'}
            >
              <div className="top">
                <span className="tc" onClick={() => p.seekTo(note.timeSec)}>
                  {formatTime(note.timeSec)}
                </span>
                <span className={`badge ${note.status}`}>{statusLabel(note.status)}</span>
              </div>
              {editingId === note.id ? (
                <div>
                  <textarea
                    value={editValue}
                    onChange={e => setEditValue(e.target.value)}
                  />
                  <button onClick={() => handleSave(note.id)}>保存</button>
                  <button onClick={() => setEditingId(null)}>キャンセル</button>
                </div>
              ) : (
                <>
                  <div className="text">{note.text}</div>
                  <div className="tags">
                    {note.tags.map(tag => (
                      <span key={tag} className="tag-chip">#{tag}</span>
                    ))}
                  </div>
                  <div className="acts">
                    {note.status !== 'discarded' ? (
                      <button onClick={() => handleDiscard(note.id)}>破棄</button>
                    ) : (
                      <button onClick={() => handleRestore(note.id)}>復活</button>
                    )}
                    <button onClick={() => handleEdit(note)}>編集</button>
                    <button onClick={() => handleDelete(note.id)}>削除</button>
                  </div>
                </>
              )}
            </div>
          ))
        )}
      </div>
    </div>
  );
}
