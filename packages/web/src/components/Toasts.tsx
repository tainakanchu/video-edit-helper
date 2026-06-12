import { useAppStore } from '../store/useAppStore'

export function Toasts() {
  const toasts = useAppStore(s => s.toasts)
  const dismissToast = useAppStore(s => s.dismissToast)

  return (
    <div className="toasts">
      {toasts.map(t => (
        <div
          key={t.id}
          className={t.kind === 'info' ? 'toast info' : 'toast'}
          onClick={() => dismissToast(t.id)}
        >
          {t.message}
        </div>
      ))}
    </div>
  )
}
