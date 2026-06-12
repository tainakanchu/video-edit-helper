import { useRef } from 'react';
import { formatTime } from '@veh/shared';
import { PLAYBACK_RATES } from '../lib/keyboard';
import { usePlayer } from './PlayerContext';

export function Player() {
  const p = usePlayer();
  const seekRef = useRef<HTMLDivElement>(null);

  const onSeekClick = (e: React.MouseEvent<HTMLDivElement>) => {
    const el = seekRef.current;
    if (!el || p.totalSec <= 0) return;
    const rect = el.getBoundingClientRect();
    const ratio = (e.clientX - rect.left) / rect.width;
    p.seekTo(ratio * p.totalSec);
  };

  const playedPct = p.totalSec > 0 ? (p.virtualTimeSec / p.totalSec) * 100 : 0;

  return (
    <>
      <div className="player">
        {p.currentSrc ? (
          <video
            ref={p.videoRef}
            src={p.currentSrc}
            // autoPlay は使わず、ユーザー操作で再生開始する
            playsInline
            preload="metadata"
          />
        ) : (
          <div className="unplayable">
            <p>この形式はブラウザで直接再生できません</p>
            <p className="muted">(Phase 2 でプロキシ対応予定)</p>
            <p className="muted">サムネイル・メモ操作は引き続き利用できます</p>
          </div>
        )}
      </div>

      <div className="player-controls">
        <button
          className="ghost"
          onClick={p.togglePlay}
          disabled={!p.currentSrc}
          aria-label={p.playing ? '一時停止' : '再生'}
          title={p.playing ? '一時停止 (Space)' : '再生 (Space)'}
        >
          {p.playing ? '⏸' : '▶'}
        </button>

        <span className="time">
          {formatTime(p.virtualTimeSec)} / {formatTime(p.totalSec)}
        </span>

        <div className="seekbar" ref={seekRef} onClick={onSeekClick}>
          <div className="track" />
          <div className="played" style={{ width: `${playedPct}%` }} />
          {/* ファイル境界の目印 */}
          {p.fileSpans.slice(1).map((f) => (
            <div
              key={f.id}
              className="file-mark"
              style={{ left: `${(f.startOffsetSec / p.totalSec) * 100}%` }}
            />
          ))}
          <div className="head" style={{ left: `${playedPct}%` }} />
        </div>

        <div className="rates">
          {PLAYBACK_RATES.map((r) => (
            <button
              key={r}
              className={r === p.rate ? 'active' : ''}
              onClick={() => p.setRate(r)}
            >
              {r}x
            </button>
          ))}
        </div>
      </div>
    </>
  );
}
