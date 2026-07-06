import { useEffect, useState } from 'react'
import type { MountRootInfo } from '@veh/shared'
import { api } from '../api/client'
import { mediaPathExample } from '../lib/platform'

/**
 * cross-OS 対応: 素材ルートの「このマシンでの場所」を設定するパネル。
 * 別 OS/マシンで開いたときに、再スキャンせず素材を再生できるようにする。
 * 保存済みルートが無ければ何も表示しない。
 */
export function MountsPanel() {
  const [roots, setRoots] = useState<MountRootInfo[] | null>(null)
  const [edits, setEdits] = useState<Record<string, string>>({})
  const [saved, setSaved] = useState<Record<string, boolean>>({})

  useEffect(() => {
    void api
      .getMounts()
      .then(r => setRoots(r.roots))
      .catch(() => setRoots([]))
  }, [])

  if (!roots || roots.length === 0) return null

  const save = async (root: string) => {
    const localPath = edits[root] ?? ''
    const r = await api.setMount({ root, localPath })
    setRoots(r.roots)
    setSaved(s => ({ ...s, [root]: true }))
  }

  return (
    <div className="mounts">
      <h2>このマシンでの素材の場所(別 OS で開いた時)</h2>
      <p className="hint">
        別のマシンや OS で開くと、素材ドライブのパスが違うことがあります(例: Windows の{' '}
        <code>D:\Footage</code> が Mac では <code>/Volumes/Footage</code>)。ここで「このマシンでの場所」を
        指定すると、<strong>再スキャンせずに</strong>そのまま再生できます(この設定はこのマシンだけに保存され、同期されません)。
      </p>
      {roots.map(({ root, localPath }) => (
        <div key={root} className="root-row">
          <code className="mount-root">{root}</code>
          <span className="mount-arrow">→</span>
          <input
            type="text"
            defaultValue={localPath ?? ''}
            placeholder={`このマシンでの場所(例: ${mediaPathExample()})`}
            onChange={e => setEdits(s => ({ ...s, [root]: e.target.value }))}
          />
          <button className="ghost" onClick={() => void save(root)}>
            {saved[root] ? '保存済み' : '保存'}
          </button>
        </div>
      ))}
    </div>
  )
}
