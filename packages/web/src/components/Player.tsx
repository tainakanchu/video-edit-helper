import { useRef } from 'react';
import { formatTime } from '@veh/shared';
import { PLAYBACK_RATES } from '../lib/keyboard';
import { formatGainPercent, isBoosting } from '../lib/audio';
import { usePlayer } from './PlayerContext';
import { AudioMeter } from './AudioMeter';
import { useAppStore, projectSelections } from '../store/useAppStore';
import { selectionsForClip } from '../lib/selection';

/** 音量ブースト用プリセット(ゲイン倍率) */
const GAIN_PRESETS = [1, 2, 4] as const;

interface PlayerProps {
  /** ペンディング中のイン点(秒)。シークバーにマーカー表示 */
  pendingInSec?: number | null;
  /** シーン転換点(秒)。シークバーに細い縦線で表示 */
  sceneTimes?: number[] | null;
}

export function Player({ pendingInSec, sceneTimes }: PlayerProps) {
  const p = usePlayer();
  const seekRef = useRef<HTMLDivElement>(null);
  const project = useAppStore((s) => s.project);
  const enqueue = useAppStore((s) => s.enqueue);
  const jobs = useAppStore((s) => s.jobs);
  const preferProxy = useAppStore((s) => s.preferProxy);
  const setPreferProxy = useAppStore((s) => s.setPreferProxy);

  const selections = project ? selectionsForClip(projectSelections(project), p.clip.id) : [];

  // クリップ内にプロキシ生成済みの素材があれば、プロキシ優先トグルを出す
  const anyProxyAvailable = p.clip.files.some((f) => f.proxyAvailable === true);

  const onSeekClick = (e: React.MouseEvent<HTMLDivElement>) => {
    const el = seekRef.current;
    if (!el || p.totalSec <= 0) return;
    const rect = el.getBoundingClientRect();
    const ratio = (e.clientX - rect.left) / rect.width;
    p.seekTo(ratio * p.totalSec);
  };

  const playedPct = p.totalSec > 0 ? (p.virtualTimeSec / p.totalSec) * 100 : 0;

  // プロキシ生成ジョブが進行中か(現在クリップ対象)
  const proxyJobActive = jobs.some(
    (j) =>
      j.type === 'proxy' &&
      j.clipId === p.clip.id &&
      (j.status === 'queued' || j.status === 'running'),
  );

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
        ) : p.needsProxy ? (
          <div className="unplayable">
            <p>この形式はブラウザで直接再生できません</p>
            {proxyJobActive ? (
              <p className="muted">プロキシ生成中…(完了後に自動で再生可能になります)</p>
            ) : (
              <>
                <p className="muted">軽量プロキシを生成すると再生できます</p>
                <button
                  className="primary"
                  onClick={() => void enqueue('proxy', [p.clip.id])}
                >
                  プロキシを生成
                </button>
              </>
            )}
            <p className="muted">サムネイル・メモ操作は引き続き利用できます</p>
          </div>
        ) : (
          <div className="unplayable">
            <p>再生できるファイルがありません</p>
          </div>
        )}
        {p.usingProxy && <span className="proxy-badge">プロキシ再生</span>}
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
          {/* 選定範囲のハイライト(視聴済みバーとは別色) */}
          {p.totalSec > 0 &&
            selections.map((s) => (
              <div
                key={s.id}
                className="sel-range"
                style={{
                  left: `${(s.inSec / p.totalSec) * 100}%`,
                  width: `${((s.outSec - s.inSec) / p.totalSec) * 100}%`,
                }}
                title={`選定 ${formatTime(s.inSec)}–${formatTime(s.outSec)}`}
              />
            ))}
          <div className="played" style={{ width: `${playedPct}%` }} />
          {/* ファイル境界の目印 */}
          {p.fileSpans.slice(1).map((f) => (
            <div
              key={f.id}
              className="file-mark"
              style={{ left: `${(f.startOffsetSec / p.totalSec) * 100}%` }}
            />
          ))}
          {/* シーン転換点の目盛り(細い縦線) */}
          {p.totalSec > 0 &&
            sceneTimes?.map((t, idx) =>
              t > 0 && t < p.totalSec ? (
                <div
                  key={`scene-${idx}`}
                  className="scene-mark"
                  style={{ left: `${(t / p.totalSec) * 100}%` }}
                  title={`シーン転換 ${formatTime(t)}`}
                />
              ) : null,
            )}
          {/* ペンディング中のイン点マーカー */}
          {pendingInSec != null && p.totalSec > 0 && (
            <div
              className="in-mark"
              style={{ left: `${(pendingInSec / p.totalSec) * 100}%` }}
              title={`イン点 ${formatTime(pendingInSec)}`}
            />
          )}
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

        <div className="audio-controls">
          <button
            className="ghost mute-btn"
            onClick={p.toggleMute}
            aria-pressed={p.audioMuted}
            title={p.audioMuted ? 'ミュート解除' : 'ミュート'}
          >
            {p.audioMuted ? '🔇' : '🔊'}
          </button>

          <input
            type="range"
            className="volume-slider"
            min={0}
            max={500}
            step={5}
            value={Math.round(p.audioGain * 100)}
            onChange={(e) => p.setAudioGain(Number(e.target.value) / 100)}
            aria-label="プレビュー音量"
            title="プレビュー音量(100% 超はブースト。Shift+↑ / ↓ でも調整)"
          />

          <span
            className={isBoosting(p.audioGain) ? 'vol-label boosting' : 'vol-label'}
            title={isBoosting(p.audioGain) ? 'ブースト中(原音より増幅)' : undefined}
          >
            {formatGainPercent(p.audioGain)}
            {isBoosting(p.audioGain) && <span className="boost-tag">ブースト中</span>}
          </span>

          <div className="gain-presets">
            {GAIN_PRESETS.map((g) => (
              <button
                key={g}
                className={Math.abs(p.audioGain - g) < 0.001 ? 'active' : ''}
                onClick={() => p.setAudioGain(g)}
                title={`音量を ${g * 100}% に`}
              >
                {g * 100}%
              </button>
            ))}
          </div>

          <AudioMeter getLevel={p.getAudioLevel} active={p.audioActive && !p.audioMuted} />

          {p.setSinkSupported && (
            <select
              className="sink-select"
              value={p.audioSinkId}
              onChange={(e) => void p.setAudioSink(e.target.value)}
              disabled={!p.audioActive}
              title={
                p.audioActive
                  ? '音声出力デバイス'
                  : '再生を開始すると出力デバイスを切り替えられます'
              }
              aria-label="音声出力デバイス"
            >
              <option value="">既定の出力</option>
              {p.audioOutputs
                .filter((d) => d.deviceId !== 'default' && d.deviceId !== '')
                .map((d) => (
                  <option key={d.deviceId} value={d.deviceId}>
                    {d.label}
                  </option>
                ))}
            </select>
          )}
        </div>

        {anyProxyAvailable && (
          <button
            className={preferProxy ? 'proxy-toggle active' : 'proxy-toggle'}
            onClick={() => setPreferProxy(!preferProxy)}
            title="再生可能な素材もプロキシで再生する(4K 直再生が重い場合に)"
            aria-pressed={preferProxy}
          >
            プロキシ
          </button>
        )}
      </div>
    </>
  );
}
