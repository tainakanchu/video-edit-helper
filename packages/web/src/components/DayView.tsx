import { useState, useEffect } from 'react'
import type { Clip, ClipAnalysisStatus, ExportFormat, ID } from '@veh/shared'
import { apiPaths, formatTime } from '@veh/shared'
import { useAppStore, summarizeDay, clipCoverage, notesForClip } from '../store/useAppStore'
import { thumbUrl, api } from '../api/client'
import { useRouter } from '../lib/useRouter'

interface ClipCardProps {
  clip: Clip
  coarseIntervalSec: number
  noteCount: number
  analysis?: ClipAnalysisStatus
  onOpen: () => void
}

/** 解析到達度のバッジ(済み=点灯 / 未=薄い) */
function AnalysisBadges({ a }: { a: ClipAnalysisStatus }) {
  const items: [boolean, string, string][] = [
    [a.thumbsFine, 'サ', 'サムネ(密)'],
    [a.vad, '声', '発話解析'],
    [a.proxy, 'プ', 'プロキシ'],
    [a.scenes, 'シ', 'シーン解析'],
    [a.transcript, '字', '文字起こし'],
  ]
  return (
    <div className="analysis-badges" title="解析状況(サ=サムネ 声=発話 プ=プロキシ シ=シーン 字=文字起こし)">
      {items.map(([done, label, tip]) => (
        <span key={label} className={done ? 'on' : 'off'} title={`${tip}: ${done ? '完了' : '未'}`}>
          {label}
        </span>
      ))}
    </div>
  )
}

function reviewIcon(status: string): string {
  if (status === 'reviewed') return '●'
  if (status === 'in_progress') return '◐'
  return '○'
}

function pad2(n: number): string {
  return String(n).padStart(2, '0')
}

function ClipCard({ clip, coarseIntervalSec, noteCount, analysis, onOpen }: ClipCardProps) {
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
        {analysis && <AnalysisBadges a={analysis} />}
      </div>
      <div className="bar">
        <span style={{ width: `${coveragePct}%` }} />
      </div>
    </button>
  )
}

const EXPORT_LABELS: Record<ExportFormat, string> = {
  fcpxml: 'FCPXML',
  csv: 'CSV',
  md: 'MD',
}

export function DayView() {
  const project = useAppStore(s => s.project)
  const selectedDayId = useAppStore(s => s.selectedDayId)
  const enqueue = useAppStore(s => s.enqueue)
  const toast = useAppStore(s => s.toast)
  const jobs = useAppStore(s => s.jobs)
  const { navigate } = useRouter()

  // クリップごとの解析到達度。ジョブの実行/完了で状況が変わるので、稼働ジョブ数の変化で再取得する
  const activeCount = jobs.filter(j => j.status === 'running' || j.status === 'queued').length
  const [analysis, setAnalysis] = useState<Record<string, ClipAnalysisStatus>>({})
  useEffect(() => {
    void api
      .getAnalysisStatus()
      .then(r => {
        const map: Record<string, ClipAnalysisStatus> = {}
        for (const s of r.clips) map[s.clipId] = s
        setAnalysis(map)
      })
      .catch(() => {})
  }, [activeCount])

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
  const selectionTotalMin = Math.round(summary.selectionTotalSec / 60)
  const hasSelections = summary.selectionCount > 0

  const handleTranscribeDay = () => {
    const n = day.clipIds.length
    if (n === 0) return
    if (
      window.confirm(
        `CPU で時間がかかります。${n} クリップを夜間バッチに投入しますか?`,
      )
    ) {
      void enqueue('whisper', day.clipIds.slice())
      toast(`${n} クリップを文字起こしキューに投入しました`, 'info')
    }
  }

  const handleProxyDay = () => {
    const n = day.clipIds.length
    if (n === 0) return
    const allFiles = project.settings.proxyAllFiles
    const note = allFiles
      ? '設定により全ファイルが対象です。'
      : '設定により再生不可素材のみが対象です。'
    if (
      window.confirm(
        `この日の ${n} クリップのプロキシ生成を投入しますか?\n${note}`,
      )
    ) {
      void enqueue('proxy', day.clipIds.slice())
      toast(`${n} クリップをプロキシ生成キューに投入しました`, 'info')
    }
  }

  return (
    <div className="dayview">
      <div className="day-head">
        <h1>Day {day.index}</h1>
        <div className="sub">
          {day.date} / {summary.clipCount}本 / {formatTime(summary.totalDurationSec)} / カバレッジ {coveragePct}%
          {' / '}選定 {summary.selectionCount}{selectionTotalMin > 0 ? `(計${selectionTotalMin}分)` : ''}
        </div>
        <span className="spacer" style={{ flex: 1 }} />
        <div className="day-actions">
          <button
            className="primary"
            onClick={() => navigate({ name: 'triage', dayId: day.id })}
            disabled={summary.openNoteCount === 0}
            title={summary.openNoteCount === 0 ? '未処理の付箋はありません' : '未処理の付箋を順に処理'}
          >
            トリアージ (残り {summary.openNoteCount})
          </button>
          <button onClick={handleTranscribeDay} title="この Day の全クリップを文字起こしキューに投入">
            この日を文字起こし
          </button>
          <button
            onClick={handleProxyDay}
            title="この Day の素材のプロキシを生成(対象は全ファイルプロキシ設定に従う)"
          >
            プロキシ生成(この日)
          </button>
          <div className="export-group" title={hasSelections ? '' : '選定が無いため書き出せません'}>
            <span className="exp-label">書き出し:</span>
            {(Object.keys(EXPORT_LABELS) as ExportFormat[]).map(fmt =>
              hasSelections ? (
                <a
                  key={fmt}
                  className="exp-btn"
                  href={apiPaths.dayExport(day.id, fmt)}
                  download
                >
                  {EXPORT_LABELS[fmt]}
                </a>
              ) : (
                <span key={fmt} className="exp-btn disabled" aria-disabled="true">
                  {EXPORT_LABELS[fmt]}
                </span>
              ),
            )}
          </div>
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
              analysis={analysis[clipId]}
              onOpen={() => navigate({ name: 'clip', clipId, t: null })}
            />
          )
        })}
      </div>
    </div>
  )
}
