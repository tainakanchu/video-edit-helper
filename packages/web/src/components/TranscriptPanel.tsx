import { useEffect, useRef, useState } from 'react';
import { formatTime, type Transcript } from '@veh/shared';
import { usePlayer } from './PlayerContext';
import { useAppStore } from '../store/useAppStore';
import { findCurrentSegment } from '../lib/selection';
import { api } from '../api/client';

export function TranscriptPanel() {
  const p = usePlayer();
  const clipId = p.clip.id;
  const enqueue = useAppStore(s => s.enqueue);
  const jobs = useAppStore(s => s.jobs);

  const [transcript, setTranscript] = useState<Transcript | null>(null);
  const [loading, setLoading] = useState(true);

  // 現在クリップの whisper ジョブが稼働中か
  const whisperActive = jobs.some(
    j =>
      j.type === 'whisper' &&
      j.clipId === clipId &&
      (j.status === 'running' || j.status === 'queued'),
  );

  // 直前の稼働状態(active→inactive 遷移検知用)
  const prevActiveRef = useRef(false);

  const fetchTranscript = (): (() => void) => {
    let cancelled = false;
    setLoading(true);
    api
      .getTranscript(clipId)
      .then(res => {
        if (cancelled) return;
        setTranscript(res === null ? null : res.transcript);
        setLoading(false);
      })
      .catch(() => {
        if (cancelled) return;
        setTranscript(null);
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  };

  // クリップ変更時に再取得
  useEffect(() => {
    setTranscript(null);
    const cancel = fetchTranscript();
    return cancel;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clipId]);

  // whisper ジョブが稼働中→停止に転じたら再取得
  useEffect(() => {
    const prev = prevActiveRef.current;
    prevActiveRef.current = whisperActive;
    if (prev && !whisperActive) {
      fetchTranscript();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [whisperActive]);

  const handleEnqueue = async () => {
    await enqueue('whisper', [clipId]);
  };

  // --- 現在再生中セグメントの自動スクロール ---
  const currentIndex = transcript
    ? findCurrentSegment(transcript.segments, p.virtualTimeSec)
    : -1;
  const rowRefs = useRef<(HTMLDivElement | null)[]>([]);
  const prevIndexRef = useRef(-1);

  useEffect(() => {
    if (currentIndex < 0) {
      prevIndexRef.current = currentIndex;
      return;
    }
    // インデックスが実際に変化したときのみスクロール(ユーザー操作と競合させない)
    if (currentIndex !== prevIndexRef.current) {
      prevIndexRef.current = currentIndex;
      rowRefs.current[currentIndex]?.scrollIntoView({ block: 'nearest' });
    }
  }, [currentIndex]);

  if (transcript) {
    rowRefs.current.length = transcript.segments.length;
    return (
      <div className="transcript">
        {transcript.model && (
          <div className="muted">モデル: {transcript.model}</div>
        )}
        <div className="list">
          {transcript.segments.map((seg, idx) => (
            <div
              key={idx}
              ref={el => {
                rowRefs.current[idx] = el;
              }}
              className={idx === currentIndex ? 'seg-row current' : 'seg-row'}
            >
              <span className="tc" onClick={() => p.seekTo(seg.start)}>
                {formatTime(seg.start)}
              </span>
              <span className="text">{seg.text}</span>
            </div>
          ))}
        </div>
      </div>
    );
  }

  // --- 文字起こし未生成 ---
  return (
    <div className="transcript">
      <div className="empty">
        {whisperActive ? (
          <span>文字起こし生成中…</span>
        ) : loading ? (
          <span>読み込み中…</span>
        ) : (
          <>
            <div>この区間の文字起こしはまだありません。</div>
            <button onClick={handleEnqueue}>文字起こしを実行</button>
          </>
        )}
      </div>
    </div>
  );
}
