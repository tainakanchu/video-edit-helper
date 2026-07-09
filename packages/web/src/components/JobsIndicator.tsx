import { useState, useEffect, useRef } from 'react'
import { useAppStore } from '../store/useAppStore'

function jobTypeLabel(type: string): string {
  switch (type) {
    case 'scan': return 'スキャン'
    case 'thumbs-coarse': return 'サムネ(粗)'
    case 'thumbs-fine': return 'サムネ(密)'
    case 'vad': return '発話解析'
    case 'proxy': return 'プロキシ生成'
    case 'scenes': return 'シーン解析'
    case 'whisper': return '文字起こし'
    default: return type
  }
}

function jobStatusLabel(status: string): string {
  switch (status) {
    case 'queued': return '待機'
    case 'running': return '実行中'
    case 'done': return '完了'
    case 'error': return 'エラー'
    case 'canceled': return '中止'
    default: return status
  }
}

export function JobsIndicator() {
  const jobs = useAppStore(s => s.jobs)
  const clips = useAppStore(s => s.project?.clips)
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  // clipId → 「どのクリップか」が一目で分かる表示名(名前+カメララベル)
  function clipLabel(clipId?: string): string | null {
    if (!clipId) return null
    const c = clips?.[clipId]
    if (!c) return null
    return c.cameraLabel ? `${c.name}(${c.cameraLabel})` : c.name
  }

  const activeJobs = jobs.filter(j => j.status === 'running' || j.status === 'queued')
  const runningJobs = activeJobs.filter(j => j.status === 'running')
  const queuedCount = activeJobs.length - runningJobs.length

  useEffect(() => {
    if (!open) return
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener('click', handleClick)
    return () => document.removeEventListener('click', handleClick)
  }, [open])

  // 折りたたみ時に「今なにをやっているか」を代表表示する(実行中を優先)
  const current = runningJobs[0] ?? activeJobs[0]
  const currentLabel = current ? clipLabel(current.clipId) : null

  const typeGroups: Record<string, number> = {}
  for (const j of activeJobs) {
    typeGroups[j.type] = (typeGroups[j.type] ?? 0) + 1
  }
  const typeBreakdown = Object.entries(typeGroups)
    .map(([type, count]) => `${jobTypeLabel(type)} ${count}`)
    .join(' / ')

  const sortedJobs = [...jobs].sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
  )

  return (
    <div className="jobs-indicator" ref={ref}>
      {activeJobs.length === 0 ? (
        <button className="idle" onClick={() => setOpen(v => !v)}>
          <span className="dot" />
          待機中
        </button>
      ) : (
        <button className="pill" onClick={() => setOpen(v => !v)}>
          <span className="dot" />
          <span className="pill-body">
            <span className="pill-line">
              <span className="pill-type">{current ? jobTypeLabel(current.type) : ''}</span>
              {currentLabel && <span className="pill-target">{currentLabel}</span>}
              {activeJobs.length > 1 && (
                <span className="pill-more">ほか{activeJobs.length - 1}件</span>
              )}
            </span>
            <span className="bar thin">
              <span style={{ width: `${Math.round((current?.progress ?? 0) * 100)}%` }} />
            </span>
          </span>
        </button>
      )}
      {open && (
        <div className="jobs-popover">
          <div className="jobs-summary">
            {activeJobs.length > 0
              ? `実行中 ${runningJobs.length} · 待機 ${queuedCount}`
              : '実行中のジョブはありません'}
            {typeBreakdown && <div className="jobs-breakdown">{typeBreakdown}</div>}
          </div>
          {sortedJobs.slice(0, 40).map(j => {
            const active = j.status === 'running' || j.status === 'queued'
            const label = clipLabel(j.clipId)
            return (
              <div key={j.id} className={`job-row ${j.status}`}>
                <div className="job-head">
                  <span className="jt">{jobTypeLabel(j.type)}</span>
                  <span className="jstatus">
                    {jobStatusLabel(j.status)}
                    {active ? ` ${Math.round(j.progress * 100)}%` : ''}
                  </span>
                </div>
                {label ? (
                  <div className="jtarget">{label}</div>
                ) : j.type === 'scan' ? (
                  <div className="jtarget dim">全体スキャン</div>
                ) : null}
                {active && (
                  <div className="bar thin">
                    <span style={{ width: `${Math.round(j.progress * 100)}%` }} />
                  </div>
                )}
                {active && j.message && <div className="jmsg">{j.message}</div>}
                {j.error != null && <div className="jerror">{j.error}</div>}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
