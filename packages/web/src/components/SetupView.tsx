import { useState, useMemo } from 'react'
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
  // 機器(cameraLabel)ごとの時刻補正(分)。入力の途中(空/"-")を許すため文字列で保持
  const [cameraOffsets, setCameraOffsets] = useState<Record<string, string>>(() => {
    const out: Record<string, string> = {}
    for (const [k, v] of Object.entries(initSettings.cameraTimeOffsets ?? {})) out[k] = String(v)
    return out
  })
  // 素材ルート(mediaRoots の要素)ごとの時刻補正(分)。入力の途中(空/"-")を許すため文字列で保持
  const [rootOffsets, setRootOffsets] = useState<Record<string, string>>(() => {
    const out: Record<string, string> = {}
    for (const [k, v] of Object.entries(initSettings.rootTimeOffsets ?? {})) out[k] = String(v)
    return out
  })

  // スキャン済みで検出された機器 + 既に補正設定済みのラベルを一覧化
  const cameras = useMemo(() => {
    const set = new Set<string>()
    if (project) for (const c of Object.values(project.clips)) set.add(c.cameraLabel)
    for (const k of Object.keys(cameraOffsets)) set.add(k)
    return Array.from(set).sort()
  }, [project, cameraOffsets])

  // 入力済み(非空)のルートのみを補正対象として一覧化
  const nonEmptyRoots = useMemo(() => roots.filter(r => r.trim() !== ''), [roots])

  function bumpOffset(cam: string, deltaMin: number) {
    setCameraOffsets(prev => {
      const cur = Math.trunc(Number(prev[cam] ?? '0')) || 0
      return { ...prev, [cam]: String(cur + deltaMin) }
    })
  }

  function bumpRootOffset(root: string, deltaMin: number) {
    setRootOffsets(prev => {
      const cur = Math.trunc(Number(prev[root] ?? '0')) || 0
      return { ...prev, [root]: String(cur + deltaMin) }
    })
  }

  const scanJob = jobs.find(
    j => j.type === 'scan' && (j.status === 'running' || j.status === 'queued')
  )
  const scanning = scanJob !== undefined
  const scanPct = Math.round((scanJob?.progress ?? 0) * 100)

  function getSettings(): Partial<ProjectSettings> {
    const dsh = Number(dayStartHour)
    const tci = Number(thumbCoarseIntervalSec)
    const tfi = Number(thumbFineIntervalSec)
    const cameraTimeOffsets: Record<string, number> = {}
    for (const [label, raw] of Object.entries(cameraOffsets)) {
      const n = Math.trunc(Number(raw))
      if (Number.isFinite(n) && n !== 0) cameraTimeOffsets[label] = n
    }
    const rootTimeOffsets: Record<string, number> = {}
    for (const [root, raw] of Object.entries(rootOffsets)) {
      const n = Math.trunc(Number(raw))
      if (Number.isFinite(n) && n !== 0) rootTimeOffsets[root] = n
    }
    return {
      mediaRoots: roots.filter(Boolean),
      dayStartHour: isNaN(dsh) ? defaultSettings.dayStartHour : dsh,
      thumbCoarseIntervalSec: isNaN(tci) ? defaultSettings.thumbCoarseIntervalSec : tci,
      thumbFineIntervalSec: isNaN(tfi) ? defaultSettings.thumbFineIntervalSec : tfi,
      proxyAllFiles,
      cameraTimeOffsets,
      rootTimeOffsets,
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

      {nonEmptyRoots.length > 0 && (
        <div className="field-group root-offsets">
          <div className="field-label">素材ルートごとの時刻補正</div>
          <p className="hint">
            ルート配下の全素材に適用します。機器ごとの補正が指定されている素材はそちらが優先されます。保存すると即座に反映されます(再スキャン不要)。
          </p>
          {nonEmptyRoots.map(root => (
            <div key={root} className="offset-row">
              <span className="offset-cam" title={root}>{root}</span>
              <div className="offset-input">
                <button className="ghost" onClick={() => bumpRootOffset(root, -60)} disabled={scanning}>
                  −1h
                </button>
                <input
                  type="number"
                  value={rootOffsets[root] ?? ''}
                  placeholder="0"
                  onChange={e => setRootOffsets(prev => ({ ...prev, [root]: e.target.value }))}
                  disabled={scanning}
                />
                <button className="ghost" onClick={() => bumpRootOffset(root, 60)} disabled={scanning}>
                  +1h
                </button>
                <span className="offset-unit">分</span>
              </div>
            </div>
          ))}
        </div>
      )}

      {cameras.length > 0 && (
        <div className="field-group camera-offsets">
          <div className="field-label">機器ごとの時刻補正</div>
          <p className="hint">
            本体時計がずれている機器を分単位で補正します(例: 台湾時間のまま撮った機器を日本時間に合わせるなら <b>+60</b>)。撮影時刻・Day 振り分け・並び順に反映され、保存すると即座に反映されます(再スキャン不要)。
          </p>
          {cameras.map(cam => (
            <div key={cam} className="offset-row">
              <span className="offset-cam" title={cam}>{cam}</span>
              <div className="offset-input">
                <button className="ghost" onClick={() => bumpOffset(cam, -60)} disabled={scanning}>
                  −1h
                </button>
                <input
                  type="number"
                  value={cameraOffsets[cam] ?? ''}
                  placeholder="0"
                  onChange={e => setCameraOffsets(prev => ({ ...prev, [cam]: e.target.value }))}
                  disabled={scanning}
                />
                <button className="ghost" onClick={() => bumpOffset(cam, 60)} disabled={scanning}>
                  +1h
                </button>
                <span className="offset-unit">分</span>
              </div>
            </div>
          ))}
        </div>
      )}

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
