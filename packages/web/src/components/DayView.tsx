import { useState } from 'react'
import type { Clip, ID } from '@veh/shared'
import { formatTime } from '@veh/shared'
import { useAppStore, summarizeDay, clipCoverage, notesForClip } from '../store/useAppStore'
import { thumbUrl } from '../api/client'

interface ClipCardProps {
  clip: Clip
  coarseIntervalSec: number
  noteCount: number
  onOpen: () => void
}

function reviewIcon(status: string): string {
  if (status === 'reviewed') return '●'
  if (status === 'in_progress') return '◐'
  return '○'
}

function pad2(n: number): string {
  return String(n).padStart(2, '0')
}

function ClipCard({ clip, coarseIntervalSec, noteCount, onOpen }: ClipCardProps) {
  const [imgError, setImgError] = useState(false)
  const date = new Date(clip.recordedAt)
  const timeStr = `${pad2(date.getHours())}:${pad2(date.getMinutes())}`
  const coveragePct = Math.round(clipCoverage(clip) * 100)
  const firstThumbSec = 0

  return (
    <button className="clip-card" onClick={onOpen}>
      {imgError ? (
        <div className="thumb placeholder">No Thumb</div>
      ) : (
        <img
          className="thumb"
          src={thumbUrl(clip.id, coarseIntervalSec, firstThumbSec)}
          onError={() => setImgError(true)}
          alt={clip.name}
        />
      )}
      <div className="info">
        <div className="row1">
          <span className={`status-dot status-${clip.reviewStatus}`}>
            {reviewIcon(clip.reviewStatus)}
          </span>
          <span className="time">{timeStr}</span>
          <span className="cam-chip">{clip.cameraLabel}</span>
        </div>
        <div className="meta">
          <span>{formatTime(clip.durationSec)}</span>
          <span>メモ {noteCount}</span>
        </div>
      </div>
      <div className="bar">
        <span style={{ width: `${coveragePct}%` }} />
      </div>
    </button>
  )
}

export function DayView() {
  const project = useAppStore(s => s.project)
  const selectedDayId = useAppStore(s => s.selectedDayId)
  const openClip = useAppStore(s => s.openClip)

  if (project === null) {
    return <div className="dayview"><p>Day を選択してください</p></div>
  }

  const day = selectedDayId !== null
    ? project.days.find(d => d.id === selectedDayId) ?? null
    : null

  if (day === null) {
    return <div className="dayview"><p>Day を選択してください</p></div>
  }

  const summary = summarizeDay(project, day.id)
  const coarseIntervalSec = project.settings.thumbCoarseIntervalSec
  const coveragePct = Math.round(summary.coverage * 100)

  return (
    <div className="dayview">
      <div className="day-head">
        <h1>Day {day.index}</h1>
        <div className="sub">
          {day.date} / {summary.clipCount}本 / {formatTime(summary.totalDurationSec)} / カバレッジ {coveragePct}%
        </div>
      </div>
      <div className="clip-grid">
        {day.clipIds.map((clipId: ID) => {
          const clip = project.clips[clipId]
          if (clip === undefined) return null
          return (
            <ClipCard
              key={clipId}
              clip={clip}
              coarseIntervalSec={coarseIntervalSec}
              noteCount={notesForClip(project, clipId).length}
              onOpen={() => openClip(clipId)}
            />
          )
        })}
      </div>
    </div>
  )
}
