import type { Clip, ExportFormat, Selection } from '@veh/shared';
import { orderSelections } from './order.js';
import { buildFcpxml } from './fcpxml.js';
import { buildCsv } from './csv.js';
import { buildMarkdown } from './md.js';

/** エクスポート形式に応じてレンダリングする */
export function renderExport(
  format: ExportFormat,
  selections: Selection[],
  clipById: (id: string) => Clip | undefined,
  dayDate: string,
): { body: string; contentType: string; fileExt: string } {
  const ordered = orderSelections(selections, clipById);

  switch (format) {
    case 'fcpxml':
      return {
        body: buildFcpxml(ordered, clipById, dayDate),
        contentType: 'application/xml; charset=utf-8',
        fileExt: 'fcpxml',
      };
    case 'csv':
      return {
        body: buildCsv(ordered, clipById, dayDate),
        contentType: 'text/csv; charset=utf-8',
        fileExt: 'csv',
      };
    case 'md':
      return {
        body: buildMarkdown(ordered, clipById, dayDate),
        contentType: 'text/markdown; charset=utf-8',
        fileExt: 'md',
      };
  }
}

// 再エクスポート
export { escapeXml } from './xml.js';
export { rationalTime, frameDurationString, pickTimebase } from './rational.js';
export { pathToFileUrl } from './srcurl.js';
export { csvEscape, buildCsv } from './csv.js';
export { orderSelections } from './order.js';
export { buildFcpxml } from './fcpxml.js';
export { buildMarkdown } from './md.js';
