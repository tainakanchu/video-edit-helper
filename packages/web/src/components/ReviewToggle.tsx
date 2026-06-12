import type { ID, ReviewStatus } from '@veh/shared'
import { useAppStore } from '../store/useAppStore'

interface Props {
  clipId: ID
  status: ReviewStatus
}

function reviewIcon(status: ReviewStatus): string {
  switch (status) {
    case 'unreviewed': return '○'
    case 'in_progress': return '◐'
    case 'reviewed': return '●'
  }
}

function reviewLabel(status: ReviewStatus): string {
  switch (status) {
    case 'unreviewed': return '未確認'
    case 'in_progress': return '確認中'
    case 'reviewed': return '確認済み'
  }
}

export function ReviewToggle({ clipId, status }: Props) {
  const cycleReview = useAppStore(s => s.cycleReview)

  return (
    <button
      title="R キーで循環"
      onClick={() => void cycleReview(clipId)}
    >
      <span className={`status-dot status-${status}`}>
        {reviewIcon(status)}
      </span>
      {reviewLabel(status)}
    </button>
  )
}
