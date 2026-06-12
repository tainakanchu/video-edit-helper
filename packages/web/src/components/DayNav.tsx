import { useAppStore, summarizeDay } from '../store/useAppStore'
import { formatTime } from '@veh/shared'

export function DayNav() {
  const project = useAppStore(s => s.project)
  const selectedDayId = useAppStore(s => s.selectedDayId)
  const selectDay = useAppStore(s => s.selectDay)

  if (project === null) return null

  return (
    <nav className="daynav">
      <h2>日別</h2>
      {project.days.map(day => {
        const summary = summarizeDay(project, day.id)
        const coveragePct = Math.round(summary.coverage * 100)
        const isActive = day.id === selectedDayId
        return (
          <button
            key={day.id}
            className={isActive ? 'day-item active' : 'day-item'}
            onClick={() => selectDay(day.id)}
          >
            <div className="day-title">
              <span className="day-name">Day {day.index}</span>
              <span className="day-date">{day.date}</span>
            </div>
            <div className="day-meta">
              <span>{summary.clipCount}本</span>
              <span>{formatTime(summary.totalDurationSec)}</span>
              <span>メモ{summary.noteCount}</span>
              <span>確認{summary.reviewedCount}/{summary.clipCount}</span>
            </div>
            <div className="cov-row">
              <div className="bar thin">
                <span style={{ width: `${coveragePct}%` }} />
              </div>
              <span className="cov-pct">{coveragePct}%</span>
            </div>
          </button>
        )
      })}
    </nav>
  )
}
