import fs from 'node:fs';
import path from 'node:path';
import type { Clip, ID, Note, ProjectState, Selection } from '@veh/shared';
import { clipIdOf, fileIdOf } from '../scan/grouping.js';

/**
 * v1(パス由来 ID)→ v2(内容指紋由来 ID)移行のためのユーティリティ。
 *
 * 素材を外付け SSD → HDD 等に移動するとパスが変わり、パス由来の
 * clipId / fileId が変わってしまい、メモ・選定・レビュー状態・視聴済み・
 * マーカー、そしてサムネ / VAD / 文字起こし / プロキシのキャッシュが
 * 全てデタッチされていた。指紋由来 ID(fileFingerprint)へ移行することで、
 * どのドライブ / フォルダ / OS に動かしても同じファイルなら同じ ID になる。
 */

/** 旧 ID → 新 ID の対応表。changed は 1 件でも変化があれば true */
export interface IdRemap {
  clipIdMap: Map<string, string>;
  fileIdMap: Map<string, string>;
  changed: boolean;
}

/** clip / file 単位キャッシュの格納ディレクトリ群 */
export interface CacheDirs {
  thumbsDir: string;
  vadDir: string;
  transcriptsDir: string;
  scenesDir: string;
  proxiesDir: string;
}

/**
 * 現行 state の各 clip / file について、指紋由来の新 ID を算出して対応表を作る。
 *
 * - clip の新 ID は clip.files[0](=グルーピングのチェーン先頭)の指紋から算出。
 *   これは grouping.buildDaysAndClips が clipIdOf(first) を使うのと同一で、
 *   保存済み clip.files[0] を first とみなせば再スキャン時の ID と一致する。
 * - file の新 ID は各 file 自身の指紋から算出。
 * - clip.files が空のクリップはスキップ(理論上存在しない)。
 */
export function computeIdRemap(state: ProjectState): IdRemap {
  const clipIdMap = new Map<string, string>();
  const fileIdMap = new Map<string, string>();
  let changed = false;

  for (const clip of Object.values(state.clips)) {
    const first = clip.files[0];
    if (!first) continue; // ファイルの無いクリップはスキップ

    const newClipId = clipIdOf(first);
    clipIdMap.set(clip.id, newClipId);
    if (clip.id !== newClipId) changed = true;

    for (const file of clip.files) {
      const newFileId = fileIdOf(file);
      fileIdMap.set(file.id, newFileId);
      if (file.id !== newFileId) changed = true;
    }
  }

  return { clipIdMap, fileIdMap, changed };
}

/**
 * 対応表を適用し、指紋由来 ID へ再マップした**新しい state** を返す純関数。
 * 入力 state は一切破壊しない。version は 2 にする。
 *
 * - clips: 新 clipId でキー化し、clip.id / 各 file.id を新 ID に差し替え。
 *   reviewStatus / watchedRanges / その他プロパティは維持する。
 * - 衝突(2 つの旧 clipId が同一新 clipId に): 先に入れた方を残し後続は破棄。
 *   ただし破棄側に紐づく notes / selections は clipIdMap 経由で生存側 clipId に
 *   自動的に寄る(両者とも同じ新 clipId に写像されるため)。
 * - days: 各 clipIds を old→new に変換(重複除去・消えた id は除外)。
 * - notes / selections: clipId を old→new に変換。対応が無い孤児は据え置きで温存。
 *   selection.id / noteId は不変。
 */
export function applyIdRemap(state: ProjectState, maps: IdRemap): ProjectState {
  const { clipIdMap, fileIdMap } = maps;

  // clips を新 clipId で再キー化(先勝ち)
  const newClips: Record<ID, Clip> = {};
  let collisions = 0;
  for (const clip of Object.values(state.clips)) {
    const first = clip.files[0];
    if (!first) continue; // ファイルの無いクリップはスキップ

    const newClipId = clipIdMap.get(clip.id) ?? clip.id;
    if (newClips[newClipId]) {
      // 既に同一の新 clipId が確定済み → 後続は破棄(notes/selections は下で吸収)
      collisions++;
      continue;
    }
    const newFiles = clip.files.map((f) => ({ ...f, id: fileIdMap.get(f.id) ?? f.id }));
    newClips[newClipId] = { ...clip, id: newClipId, files: newFiles };
  }
  if (collisions > 0) {
    console.warn(`[migrate] 指紋衝突で ${collisions} 件のクリップを統合しました(先勝ち)`);
  }

  // days: clipIds を再マップ(重複除去・生存クリップのみ)
  const newDays = state.days.map((day) => {
    const seen = new Set<ID>();
    const clipIds: ID[] = [];
    for (const oldId of day.clipIds) {
      const newId = clipIdMap.get(oldId) ?? oldId;
      if (!newClips[newId]) continue; // 消えた(破棄 or 未知)id は除外
      if (seen.has(newId)) continue; // 重複除去
      seen.add(newId);
      clipIds.push(newId);
    }
    return { ...day, clipIds };
  });

  // notes: clipId を再マップ(孤児は据え置き)
  const newNotes: Record<ID, Note> = {};
  for (const note of Object.values(state.notes)) {
    const newClipId = clipIdMap.get(note.clipId);
    newNotes[note.id] = newClipId ? { ...note, clipId: newClipId } : { ...note };
  }

  // selections: clipId を再マップ(id / noteId は不変。孤児は据え置き)
  const newSelections: Record<ID, Selection> = {};
  for (const sel of Object.values(state.selections)) {
    const newClipId = clipIdMap.get(sel.clipId);
    newSelections[sel.id] = newClipId ? { ...sel, clipId: newClipId } : { ...sel };
  }

  return {
    ...state,
    version: 2,
    days: newDays,
    clips: newClips,
    notes: newNotes,
    selections: newSelections,
  };
}

/**
 * キャッシュフォルダ / ファイルを旧 ID → 新 ID に rename する(fs 副作用)。
 *
 * - thumbs: `<thumbsDir>/<oldClipId>` ディレクトリ → `<newClipId>`
 * - vad / transcripts / scenes: `<dir>/<oldClipId>.json` → `<newClipId>.json`
 * - proxies: `<proxiesDir>/<oldFileId>.mp4` → `<newFileId>.mp4`
 *
 * old===new はスキップ。old が存在し new が存在しない場合のみ実行。
 * 各操作は try/catch で囲み、失敗は console.warn して継続する
 * (1 つの失敗で移行全体を止めない)。
 */
export function migrateCacheDirsSync(dirs: CacheDirs, maps: IdRemap): void {
  // clip 単位キャッシュ(thumbs ディレクトリ / vad・transcripts・scenes の JSON)
  for (const [oldId, newId] of maps.clipIdMap) {
    if (oldId === newId) continue;
    renameSafe(path.join(dirs.thumbsDir, oldId), path.join(dirs.thumbsDir, newId), 'thumbs');
    for (const dir of [dirs.vadDir, dirs.transcriptsDir, dirs.scenesDir]) {
      renameSafe(path.join(dir, `${oldId}.json`), path.join(dir, `${newId}.json`), 'json');
    }
  }
  // file 単位キャッシュ(proxies の mp4)
  for (const [oldId, newId] of maps.fileIdMap) {
    if (oldId === newId) continue;
    renameSafe(
      path.join(dirs.proxiesDir, `${oldId}.mp4`),
      path.join(dirs.proxiesDir, `${newId}.mp4`),
      'proxy',
    );
  }
}

/** old が存在し new が無いときのみ rename。失敗は握りつぶしてログのみ */
function renameSafe(oldPath: string, newPath: string, kind: string): void {
  try {
    if (!fs.existsSync(oldPath)) return;
    if (fs.existsSync(newPath)) {
      console.warn(`[migrate] ${kind} の移動先が既存のためスキップ: ${oldPath} -> ${newPath}`);
      return;
    }
    fs.renameSync(oldPath, newPath);
  } catch (err) {
    console.warn(`[migrate] ${kind} の rename に失敗(継続): ${oldPath} -> ${newPath}: ${String(err)}`);
  }
}
