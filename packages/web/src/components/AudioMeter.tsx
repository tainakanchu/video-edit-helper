import { useEffect, useRef, useState } from 'react';

interface AudioMeterProps {
  /** 0..1 の現在音声レベル(RMS)を返す。PlayerContext.getAudioLevel を渡す */
  getLevel: () => number;
  /** Web Audio グラフが有効(再生開始済み)か。false なら待機表示 */
  active: boolean;
}

/**
 * プレビュー音声のレベルメーター。requestAnimationFrame で getLevel() を読み、
 * バー幅(%)と色クラス(緑→黄→赤)を更新する。純描画なのでテスト対象外。
 */
export function AudioMeter({ getLevel, active }: AudioMeterProps) {
  const fillRef = useRef<HTMLDivElement>(null);
  const rafRef = useRef<number | null>(null);
  // 色クラスはバー幅ほど頻繁に変えたくないので state は段階(level band)のみ保持
  const [band, setBand] = useState<'low' | 'mid' | 'high'>('low');
  const bandRef = useRef(band);
  bandRef.current = band;

  useEffect(() => {
    if (!active) {
      // 待機時はループを回さずバーをクリア
      if (fillRef.current) fillRef.current.style.width = '0%';
      return;
    }
    const loop = () => {
      const level = getLevel();
      // RMS は体感的に小さく出るので少しだけ持ち上げて視認性を上げる
      const pct = Math.min(100, level * 140);
      if (fillRef.current) fillRef.current.style.width = `${pct}%`;
      const nextBand: 'low' | 'mid' | 'high' = pct > 85 ? 'high' : pct > 55 ? 'mid' : 'low';
      if (nextBand !== bandRef.current) setBand(nextBand);
      rafRef.current = requestAnimationFrame(loop);
    };
    rafRef.current = requestAnimationFrame(loop);
    return () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    };
  }, [active, getLevel]);

  return (
    <div
      className={`audio-meter${active ? '' : ' inactive'}`}
      title={active ? '音声レベル' : '再生を開始するとレベルが表示されます'}
      aria-hidden="true"
    >
      {active ? (
        <div ref={fillRef} className={`audio-meter-fill ${band}`} style={{ width: '0%' }} />
      ) : (
        <span className="audio-meter-idle">—</span>
      )}
    </div>
  );
}
