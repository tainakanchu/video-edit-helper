import type { Clip, Selection, SourceFile } from '@veh/shared';
import { locateInFiles } from '@veh/shared';
import { escapeXml } from './xml.js';
import { rationalTime, frameDurationString } from './rational.js';
import { pathToFileUrl } from './srcurl.js';

export interface ExportRow { selection: Selection; clip: Clip; }

/** FCPXML 1.8 を生成する */
export function buildFcpxml(
  orderedSelections: Selection[],
  clipById: (id: string) => Clip | undefined,
  dayDate: string,
): string {
  // クリップが解決できる選定のみ処理
  const rows: ExportRow[] = [];
  for (const sel of orderedSelections) {
    const clip = clipById(sel.clipId);
    if (clip) rows.push({ selection: sel, clip });
  }

  // フォーマット重複排除: (fps, width, height) をキーにする
  const formatKeyToId = new Map<string, string>();
  // アセット重複排除: file.id をキーにする
  const fileIdToAssetId = new Map<string, string>();
  // アセット情報を保持
  const assets: Array<{ id: string; file: SourceFile; formatId: string }> = [];
  const formats: Array<{ id: string; fps: number | null; width: number; height: number }> = [];

  // 参照されるファイルを収集
  for (const { selection: sel, clip } of rows) {
    const spans = clip.files.map(f => ({
      id: f.id,
      startOffsetSec: f.startOffsetSec,
      durationSec: f.durationSec,
    }));
    const inLoc = locateInFiles(spans, sel.inSec);
    const outLoc = locateInFiles(spans, sel.outSec);

    for (let i = inLoc.index; i <= outLoc.index; i++) {
      const file = clip.files[i];
      if (!file) continue;
      if (fileIdToAssetId.has(file.id)) continue;

      // フォーマット登録
      const fmtKey = `${file.fps ?? 'null'}:${file.width}:${file.height}`;
      if (!formatKeyToId.has(fmtKey)) {
        const fmtId = `r${formats.length + 1}`;
        formatKeyToId.set(fmtKey, fmtId);
        formats.push({ id: fmtId, fps: file.fps, width: file.width, height: file.height });
      }
      const formatId = formatKeyToId.get(fmtKey)!;

      // アセット登録
      const assetId = `a${assets.length + 1}`;
      fileIdToAssetId.set(file.id, assetId);
      assets.push({ id: assetId, file, formatId });
    }
  }

  // シーケンス fps: 最初の参照ファイルの fps
  let seqFps: number | null = null;
  let seqFormatId = 'r1';
  outer: for (const { selection: sel, clip } of rows) {
    for (const file of clip.files) {
      seqFps = file.fps;
      const fmtKey = `${file.fps ?? 'null'}:${file.width}:${file.height}`;
      seqFormatId = formatKeyToId.get(fmtKey) ?? 'r1';
      break outer;
    }
  }

  // スパイン生成
  const spineLines: string[] = [];
  let cumOffsetSec = 0;

  for (const { selection: sel, clip } of rows) {
    const spans = clip.files.map(f => ({
      id: f.id,
      startOffsetSec: f.startOffsetSec,
      durationSec: f.durationSec,
    }));
    const inLoc = locateInFiles(spans, sel.inSec);
    const outLoc = locateInFiles(spans, sel.outSec);
    let isFirstSegment = true;

    for (let i = inLoc.index; i <= outLoc.index; i++) {
      const file = clip.files[i];
      if (!file) continue;

      const segStartInFile = (i === inLoc.index ? inLoc.offsetSec : 0);
      const segEndInFile = (i === outLoc.index ? outLoc.offsetSec : file.durationSec);
      const segDur = segEndInFile - segStartInFile;
      if (segDur <= 0) continue;

      const assetId = fileIdToAssetId.get(file.id)!;
      const offset = rationalTime(cumOffsetSec, seqFps);
      const start = rationalTime(segStartInFile, file.fps);
      const duration = rationalTime(segDur, file.fps);
      const name = escapeXml(clip.name);

      if (sel.text && isFirstSegment) {
        spineLines.push(`            <asset-clip ref="${assetId}" offset="${offset}" start="${start}" duration="${duration}" name="${name}">`);
        spineLines.push(`              <note>${escapeXml(sel.text)}</note>`);
        spineLines.push(`            </asset-clip>`);
      } else {
        spineLines.push(`            <asset-clip ref="${assetId}" offset="${offset}" start="${start}" duration="${duration}" name="${name}"/>`);
      }

      cumOffsetSec += segDur;
      isFirstSegment = false;
    }
  }

  const totalDurationStr = rationalTime(cumOffsetSec, seqFps);

  // XML 出力
  const lines: string[] = [];
  lines.push('<?xml version="1.0" encoding="UTF-8"?>');
  lines.push('<!DOCTYPE fcpxml>');
  lines.push('<fcpxml version="1.8">');
  lines.push('  <resources>');

  // フォーマット要素
  for (const fmt of formats) {
    const fd = frameDurationString(fmt.fps);
    lines.push(`    <format id="${fmt.id}" frameDuration="${fd}" width="${fmt.width}" height="${fmt.height}"/>`);
  }

  // アセット要素
  for (const asset of assets) {
    const { file } = asset;
    const src = escapeXml(pathToFileUrl(file.path));
    const dur = rationalTime(file.durationSec, file.fps);
    const hasAudio = file.audioCodec ? '1' : '0';
    const stem = file.fileName.replace(/\.[^.]+$/, '');
    lines.push(`    <asset id="${asset.id}" name="${escapeXml(stem)}" src="${src}" start="0s" duration="${dur}" hasVideo="1" hasAudio="${hasAudio}" format="${asset.formatId}"/>`);
  }

  lines.push('  </resources>');
  lines.push('  <library>');
  lines.push('    <event name="video-edit-helper">');
  lines.push(`      <project name="${escapeXml(dayDate)} ラフカット">`);
  lines.push(`        <sequence format="${seqFormatId}" duration="${totalDurationStr}">`);
  lines.push('          <spine>');

  for (const l of spineLines) {
    lines.push(l);
  }

  lines.push('          </spine>');
  lines.push('        </sequence>');
  lines.push('      </project>');
  lines.push('    </event>');
  lines.push('  </library>');
  lines.push('</fcpxml>');

  return lines.join('\n');
}
