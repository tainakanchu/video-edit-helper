import { useState } from 'react'
import type { ProjectSettings } from '@veh/shared'
import { defaultSettings } from '@veh/shared'
import { useAppStore } from '../store/useAppStore'
import { mediaPathExample } from '../lib/platform'
import { MountsPanel } from './MountsPanel'

export function SetupView() {
  // 素材フォルダのパス例は OS 別に出し分ける(Windows/mac/Linux)
  const pathExample = mediaPathExample()
  const project = useAppStore(s => s.project)
  const saveSettings = useAppStore(s => s.saveSettings)
  const startScan = useAppStore(s => s.startScan)
  const toast = useAppStore(s => s.toast)
  const jobs = useAppStore(s => s.jobs)

  const initSettings: ProjectSettings = project?.settings ?? defaultSettings

  const initRoots = initSettings.mediaRoots.length > 0 ? initSettings.mediaRoots : ['']

  const [roots, setRoots] = useState<string[]>(initRoots)
  const [dayStartHour, setDayStartHour] = useState<string>(String(initSettings.dayStartHour))
  const [thumbCoarseIntervalSec, setThumbCoarseIntervalSec] = useState<string>(
    String(initSettings.thumbCoarseIntervalSec)
  )
  const [thumbFineIntervalSec, setThumbFineIntervalSec] = useState<string>(
    String(initSettings.thumbFineIntervalSec)
  )
  const [proxyAllFiles, setProxyAllFiles] = useState<boolean>(initSettings.proxyAllFiles)

  const scanJob = jobs.find(
    j => j.type === 'scan' && (j.status === 'running' || j.status === 'queued')
  )
  const scanning = scanJob !== undefined
  const scanPct = Math.round((scanJob?.progress ?? 0) * 100)

  function getSettings(): Partial<ProjectSettings> {
    const dsh = Number(dayStartHour)
    const tci = Number(thumbCoarseIntervalSec)
    const tfi = Number(thumbFineIntervalSec)
    return {
      mediaRoots: roots.filter(Boolean),
      dayStartHour: isNaN(dsh) ? defaultSettings.dayStartHour : dsh,
      thumbCoarseIntervalSec: isNaN(tci) ? defaultSettings.thumbCoarseIntervalSec : tci,
      thumbFineIntervalSec: isNaN(tfi) ? defaultSettings.thumbFineIntervalSec : tfi,
      proxyAllFiles,
    }
  }

  async function handleSave() {
    await saveSettings(getSettings())
  }

  async function handleScan() {
    if (roots.every(r => r.trim() === '')) {
      toast('メディアルートを入力してください')
      return
    }
    await saveSettings(getSettings())
    await startScan()
  }

  function updateRoot(i: number, value: string) {
    setRoots(prev => prev.map((r, idx) => idx === i ? value : r))
  }

  function removeRoot(i: number) {
    setRoots(prev => {
      const next = prev.filter((_, idx) => idx !== i)
      return next.length > 0 ? next : ['']
    })
  }

  function addRoot() {
    setRoots(prev => [...prev, ''])
  }

  return (
    <div className="setup">
      <h1>素材の取り込み</h1>
      <p className="hint">
        外付けドライブ内の素材フォルダを指定してスキャンします。撮影日時で Day に振り分け、連番ファイルを論理クリップにまとめます。
      </p>
      <div className="roots">
        {roots.map((root, i) => (
          <div key={i} className="root-row">
            <input
              type="text"
              value={root}
              onChange={e => updateRoot(i, e.target.value)}
              placeholder={`例: ${pathExample}`}
              disabled={scanning}
            />
            <button
              className="ghost"
              onClick={() => removeRoot(i)}
              disabled={scanning}
            >
              削除
            </button>
          </div>
        ))}
        <button className="ghost" onClick={addRoot} disabled={scanning}>
          + ルート追加
        </button>
      </div>

      <div className="field-row">
        <label>
          日付切り替え時刻(時)
          <input
            type="number"
            value={dayStartHour}
            onChange={e => setDayStartHour(e.target.value)}
            disabled={scanning}
          />
        </label>
      </div>

      <div className="field-row">
        <label>
          粗サムネ間隔(秒)
          <input
            type="number"
            value={thumbCoarseIntervalSec}
            onChange={e => setThumbCoarseIntervalSec(e.target.value)}
            disabled={scanning}
          />
        </label>
      </div>

      <div className="field-row">
        <label>
          密サムネ間隔(秒)
          <input
            type="number"
            value={thumbFineIntervalSec}
            onChange={e => setThumbFineIntervalSec(e.target.value)}
            disabled={scanning}
          />
        </label>
      </div>

      <div className="field-row check-row">
        <label className="check-label">
          <input
            type="checkbox"
            checked={proxyAllFiles}
            onChange={e => setProxyAllFiles(e.target.checked)}
            disabled={scanning}
          />
          再生可能な素材も含め全ファイルのプロキシを生成(4K 素材が重い場合に)
        </label>
      </div>

      {scanning && (
        <div>
          <div className="bar">
            <span style={{ width: `${scanPct}%` }} />
          </div>
          <p>スキャン中… {scanJob?.message ?? `${scanPct}%`}</p>
        </div>
      )}

      <div className="actions">
        <button
          className="ghost"
          onClick={() => void handleSave()}
          disabled={scanning}
        >
          設定を保存
        </button>
        <button
          className="primary"
          onClick={() => void handleScan()}
          disabled={scanning}
        >
          スキャン開始
        </button>
      </div>

      <p className="hint">
        フォルダの絶対パスを入力してください(例: {pathExample})
      </p>

      <MountsPanel />
    </div>
  )
}
