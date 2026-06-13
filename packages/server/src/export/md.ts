import type { Clip, Selection } from '@veh/shared';
import { formatTime } from '@veh/shared';

/** Markdown テーブルセルの | をエスケープ */
function escapePipe(s: string): string {
  return s.replaceAll('|', '\\|');
}

/** Markdown 書き出し */
export function buildMarkdown(
  orderedSelections: Selection[],
  clipById: (clipId: string) => Clip | undefined,
  dayDate: string,
): string {
  const lines: string[] = [];
  lines.push(`# ${dayDate} ラフカット`);
  lines.push('');
  lines.push('| clip | camera | in | out | duration | rating | tags | text |');
  lines.push('|------|--------|----|-----|----------|--------|------|------|');

  for (const sel of orderedSelections) {
    const clip = clipById(sel.clipId);
    if (!clip) continue;

    const duration = sel.outSec - sel.inSec;
    const cells = [
      escapePipe(clip.name),
      escapePipe(clip.cameraLabel),
      escapePipe(formatTime(sel.inSec)),
      escapePipe(formatTime(sel.outSec)),
      escapePipe(formatTime(duration)),
      String(sel.rating),
      escapePipe(sel.tags.join(' ')),
      escapePipe(sel.text),
    ];
    lines.push(`| ${cells.join(' | ')} |`);
  }

  return lines.join('\n');
}
