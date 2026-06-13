import type { Clip, Selection } from '@veh/shared';
import { locateInFiles, formatTime } from '@veh/shared';

/** CSV フィールドのエスケープ (RFC4180) */
export function csvEscape(field: string): string {
  // カンマ、ダブルクォート、改行を含む場合はダブルクォートで囲む
  if (/[,"\n\r]/.test(field)) {
    return `"${field.replaceAll('"', '""')}"`;
  }
  return field;
}

/** CSV 書き出し */
export function buildCsv(
  orderedSelections: Selection[],
  clipById: (clipId: string) => Clip | undefined,
  dayDate: string,
): string {
  // UTF-8 BOM
  const BOM = '﻿';
  const header = 'day,clip,camera,in,out,duration,rating,tags,text,sourceFiles';
  const rows: string[] = [];

  for (const sel of orderedSelections) {
    const clip = clipById(sel.clipId);
    if (!clip) continue;

    // FileSpan[] を構築
    const spans = clip.files.map(f => ({
      id: f.id,
      startOffsetSec: f.startOffsetSec,
      durationSec: f.durationSec,
    }));

    // 選定がまたがるファイルを特定
    const inLoc = locateInFiles(spans, sel.inSec);
    const outLoc = locateInFiles(spans, sel.outSec);
    const fileNames: string[] = [];
    for (let i = inLoc.index; i <= outLoc.index; i++) {
      const f = clip.files[i];
      if (f) fileNames.push(f.fileName);
    }

    const duration = sel.outSec - sel.inSec;
    const fields = [
      csvEscape(dayDate),
      csvEscape(clip.name),
      csvEscape(clip.cameraLabel),
      csvEscape(formatTime(sel.inSec)),
      csvEscape(formatTime(sel.outSec)),
      csvEscape(formatTime(duration)),
      csvEscape(String(sel.rating)),
      csvEscape(sel.tags.join(' ')),
      csvEscape(sel.text),
      csvEscape(fileNames.join(' ')),
    ];
    rows.push(fields.join(','));
  }

  return BOM + [header, ...rows].join('\r\n');
}
