import { useState, useEffect, useRef } from 'react'
import { useAppStore } from '../store/useAppStore'
import type { JobInfo } from '@veh/shared'

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
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  const activeJobs = jobs.filter(j => j.status === 'running' || j.status === 'queued')

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

  const avgProgress = activeJobs.length > 0
    ? activeJobs.reduce((sum, j) => sum + j.progress, 0) / activeJobs.length
    : 0

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
          {`実行中 ${activeJobs.length} (${typeBreakdown})`}
          <div className="bar">
            <span style={{ width: `${Math.round(avgProgress * 100)}%` }} />
          </div>
        </button>
      )}
      {open && (
        <div className="jobs-popover">
          {sortedJobs.map(j => (
            <div key={j.id} className="job-row">
              <span className="jt">{jobTypeLabel(j.type)}</span>
              <span className="jstatus">{jobStatusLabel(j.status)}</span>
              {(j.status === 'running' || j.status === 'queued') && (
                <span>{Math.round(j.progress * 100)}%</span>
              )}
              {j.error != null && <span>{j.error}</span>}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
