import { useEffect, useState } from 'react';
import { api } from '../api/client';
import { usePlayer } from './PlayerContext';
import type { VadResult } from '@veh/shared';

export function SpeechBar() {
  const p = usePlayer();
  const [vad, setVad] = useState<VadResult | null>(null);

  useEffect(() => {
    setVad(null);
    let cancelled = false;

    api.getVad(p.clip.id).then(res => {
      if (cancelled) return;
      if (res === null) {
        setVad(null);
      } else {
        setVad(res.vad);
      }
    }).catch(() => {
      if (cancelled) return;
      setVad(null);
    });

    return () => { cancelled = true; };
  }, [p.clip.id]);

  if (vad === null) {
    return (
      <div className="speechbar">
        <span className="label">解析待ち</span>
      </div>
    );
  }

  const handleClick = (e: React.MouseEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const ratio = (e.clientX - rect.left) / rect.width;
    p.seekTo(ratio * p.totalSec);
  };

  return (
    <div className="speechbar" onClick={handleClick}>
      {vad.segments.map((seg, idx) => (
        <div
          key={idx}
          className="seg"
          style={{
            left: (seg.start / p.totalSec) * 100 + '%',
            width: ((seg.end - seg.start) / p.totalSec) * 100 + '%',
            position: 'absolute',
          }}
        />
      ))}
    </div>
  );
}
