import { SHORTCUTS, type ShortcutHelp } from '../lib/keyboard'

export function HelpOverlay({
  onClose,
  shortcuts = SHORTCUTS,
}: {
  onClose: () => void
  shortcuts?: ShortcutHelp[]
}) {
  return (
    <div className="overlay" onClick={onClose}>
      <div className="panel" onClick={e => e.stopPropagation()}>
        <h2>キーボードショートカット</h2>
        <table className="help-table">
          <tbody>
            {shortcuts.map(s => (
              <tr key={s.keys}>
                <td className="k">{s.keys}</td>
                <td>{s.desc}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <button className="ghost" onClick={onClose}>閉じる</button>
      </div>
    </div>
  )
}
