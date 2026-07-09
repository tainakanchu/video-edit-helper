import crypto from 'node:crypto';
import path from 'node:path';
import type { Clip, Day, GpsPoint, ID, ProjectSettings, SourceFile } from '@veh/shared';

/** ffprobe で抽出した 1 ファイル分のメタデータ(grouping の入力) */
export interface ProbedFile {
  /** 絶対パス */
  path: string;
  fileName: string;
  /** 親ディレクトリ(絶対パス) */
  dir: string;
  /** このファイルが属する mediaRoot(絶対パス) */
  mediaRoot: string;
  /** このファイルが属する保存形ルート(project.json の mediaRoots の要素そのもの)。
      走査時の実パス mediaRoot とは別(cross-OS のマウント対応で異なりうる) */
  storedRoot: string;
  sizeBytes: number;
  durationSec: number;
  /** コンテナの creation_time(ISO)。無ければ null */
  createdAt: string | null;
  /** ファイルシステム mtime(ISO) */
  mtime: string;
  width: number;
  height: number;
  videoCodec: string;
  audioCodec: string | null;
  fps: number | null;
  playableInBrowser: boolean;
  /** 撮影位置(location タグ ISO6709)。無ければ null */
  gps: GpsPoint | null;
}

/** 2GB(サイズ上限到達判定の閾値) */
const SIZE_CAP_BYTES = 2 * 1024 * 1024 * 1024;
/** サイズ上限到達とみなすチェーン内最大サイズ比 */
const SIZE_CAP_RATIO = 0.92;
/** 時刻連鎖の許容誤差(秒) */
const TIME_CHAIN_TOLERANCE = 3;

/** sha1 の先頭 12 文字 */
function shortHash(input: string): string {
  return crypto.createHash('sha1').update(input).digest('hex').slice(0, 12);
}

/** 指紋計算に使うファイルの内容固有フィールド(path / mtime は含めない) */
export interface FingerprintInput {
  fileName: string;
  sizeBytes: number;
  durationSec: number;
  createdAt: string | null;
}

/**
 * ファイル内容固有の指紋文字列を生成する純関数。
 *
 * ドライブ(外付け SSD → HDD 等)・フォルダ・OS(WSL ⇔ Windows)を移動しても、
 * 同じファイルなら同じ ID になるように、内容を代表するフィールドのみで構成する。
 *
 * - path は移動・コピーで変わるため使わない(パス由来 ID がデタッチを招いていた元凶)
 * - mtime はコピー(cp / エクスプローラの移動)で変わるため絶対に使わない
 *
 * fileName・sizeBytes・createdAt(コンテナの creation_time)・durationSec は
 * 同一素材であればドライブを跨いでも不変なので、これらで指紋を作る。
 * durationSec は浮動小数の丸め差で ID が揺れないよう ms 精度に量子化する。
 */
export function fileFingerprint(f: FingerprintInput): string {
  return [f.fileName, f.sizeBytes, Math.round(f.durationSec * 1000), f.createdAt ?? ''].join('|');
}

export function fileIdOf(f: FingerprintInput): string {
  // 'file|' 接頭辞で clipId と名前空間を分ける(同一入力でも別 ID になる)
  return shortHash('file|' + fileFingerprint(f));
}

export function clipIdOf(firstFile: FingerprintInput): string {
  // クリップ ID はチェーン先頭ファイル(最小番号)の指紋から算出する
  return shortHash('clip|' + fileFingerprint(firstFile));
}

/** ファイル名を (prefix, 数値サフィックス) に分解。数値が取れなければ num=null */
export function splitNumberedName(fileName: string): { prefix: string; num: number | null } {
  const ext = path.extname(fileName);
  const stem = fileName.slice(0, fileName.length - ext.length);
  // 末尾の連続した数字を抽出
  const m = stem.match(/^(.*?)(\d+)$/);
  if (!m) return { prefix: stem + ext, num: null };
  const prefix = m[1]!;
  const num = Number(m[2]!);
  return { prefix, num: Number.isFinite(num) ? num : null };
}

/**
 * recordedAt の算出に必要なフィールドのみの構造的型。
 * ProbedFile はこれを満たすため既存呼び出しは無変更。project.json に保存済みの
 * SourceFile(createdAt/mtime/durationSec を持つ)からも同じ計算を再利用できるようにする。
 */
export interface RecordedAtInput {
  createdAt: string | null;
  mtime: string;
  durationSec: number;
}

/** recordedAt を決定: createdAt があればそれ、無ければ mtime − durationSec */
export function recordedAtOf(file: RecordedAtInput): string {
  if (file.createdAt) return file.createdAt;
  const mtimeMs = Date.parse(file.mtime);
  const corrected = mtimeMs - file.durationSec * 1000;
  return new Date(corrected).toISOString();
}

/**
 * 撮影時刻の補正分(分)を決定する共有ヘルパ。
 * カメラ本体時計のズレ(例: 台湾時間のまま等)を機器ごとに補正する。
 * 機器ごとの補正(cameraTimeOffsets)が未設定なら、素材ルート単位の補正
 * (rootTimeOffsets)にフォールバックする(優先順位: 機器 > ルート。加算ではなく上書き)。
 */
export function timeOffsetMinFor(
  cameraLabel: string,
  storedRoot: string | null,
  settings: ProjectSettings,
): number {
  return (
    settings.cameraTimeOffsets?.[cameraLabel] ??
    (storedRoot ? settings.rootTimeOffsets?.[storedRoot] : undefined) ??
    0
  );
}

/** mediaRoot からの相対パス先頭セグメントを cameraLabel とする */
export function cameraLabelOf(file: ProbedFile): string {
  const rel = path.relative(file.mediaRoot, file.path);
  const segments = rel.split(/[\\/]/).filter((s) => s.length > 0);
  if (segments.length > 1) {
    // サブフォルダがある → 先頭セグメント
    return segments[0]!;
  }
  // ルート直下のファイル → mediaRoot のフォルダ名
  return path.basename(file.mediaRoot);
}

/** dayStartHour 補正後の dayId('YYYY-MM-DD')をローカル時刻で算出 */
export function dayIdOf(recordedAtIso: string, dayStartHour: number): string {
  const d = new Date(recordedAtIso);
  // ローカル時刻から dayStartHour を引いた時点の日付
  const shifted = new Date(d.getTime() - dayStartHour * 3600 * 1000);
  const y = shifted.getFullYear();
  const mo = String(shifted.getMonth() + 1).padStart(2, '0');
  const da = String(shifted.getDate()).padStart(2, '0');
  return `${y}-${mo}-${da}`;
}

/** チェーン候補(同一ディレクトリ・同 prefix・番号連続)を構成する内部用エントリ */
interface ChainFile extends ProbedFile {
  num: number;
}

/**
 * 隣接 2 ファイルが同一クリップの分割と確定するか。
 * a が前、b が次。chainMaxSize はチェーン候補内の最大サイズ。
 */
function isSplitContinuation(a: ProbedFile, b: ProbedFile, chainMaxSize: number): boolean {
  // a: サイズ上限到達(>= 2GB かつチェーン最大の 92% 以上)
  const sizeCapped = a.sizeBytes >= SIZE_CAP_BYTES && a.sizeBytes >= chainMaxSize * SIZE_CAP_RATIO;
  if (sizeCapped) return true;
  // b: 時刻連鎖(両方 createdAt あり・前の終了 ≈ 次の開始)
  if (a.createdAt && b.createdAt) {
    const aEnd = Date.parse(a.createdAt) + a.durationSec * 1000;
    const bStart = Date.parse(b.createdAt);
    if (Math.abs(aEnd - bStart) <= TIME_CHAIN_TOLERANCE * 1000) return true;
  }
  return false;
}

/**
 * 同一ディレクトリ内のファイル群を連番チェーンでグルーピングし、
 * 論理クリップ単位のファイル列(ProbedFile[][])を返す。
 */
function groupDirIntoClips(filesInDir: ProbedFile[]): ProbedFile[][] {
  // 数値サフィックスの有無で分ける
  const numbered: ChainFile[] = [];
  const standalone: ProbedFile[] = [];
  for (const f of filesInDir) {
    const { prefix, num } = splitNumberedName(f.fileName);
    if (num === null) {
      standalone.push(f);
    } else {
      // prefix をキーに保持(同 prefix のみチェーン対象)
      numbered.push(Object.assign({}, f, { num, _prefix: prefix } as { num: number }));
    }
  }

  const clips: ProbedFile[][] = [];

  // prefix ごとにまとめる
  const byPrefix = new Map<string, ChainFile[]>();
  for (const f of numbered) {
    const prefix = (f as ChainFile & { _prefix: string })._prefix;
    const arr = byPrefix.get(prefix) ?? [];
    arr.push(f);
    byPrefix.set(prefix, arr);
  }

  for (const arr of byPrefix.values()) {
    arr.sort((a, b) => a.num - b.num);
    const chainMaxSize = arr.reduce((mx, f) => Math.max(mx, f.sizeBytes), 0);

    let current: ProbedFile[] = [];
    let prev: ChainFile | null = null;
    for (const f of arr) {
      if (prev === null) {
        current = [f];
      } else if (f.num === prev.num + 1 && isSplitContinuation(prev, f, chainMaxSize)) {
        // 番号連続かつ分割確定 → 同一クリップ
        current.push(f);
      } else {
        // チェーンを切る(番号飛び・条件不成立)
        clips.push(current);
        current = [f];
      }
      prev = f;
    }
    if (current.length > 0) clips.push(current);
  }

  for (const f of standalone) clips.push([f]);

  return clips;
}

/** ProbedFile → SourceFile に変換(startOffsetSec を付与) */
function toSourceFile(file: ProbedFile, startOffsetSec: number): SourceFile {
  return {
    id: fileIdOf(file),
    path: file.path,
    fileName: file.fileName,
    sizeBytes: file.sizeBytes,
    durationSec: file.durationSec,
    width: file.width,
    height: file.height,
    videoCodec: file.videoCodec,
    audioCodec: file.audioCodec,
    fps: file.fps,
    createdAt: file.createdAt,
    mtime: file.mtime,
    startOffsetSec,
    playableInBrowser: file.playableInBrowser,
    gps: file.gps,
  };
}

/** クリップの代表 GPS: GPS を持つ最初のファイルの値(無ければ null) */
function clipGpsOf(files: SourceFile[]): GpsPoint | null {
  for (const f of files) {
    if (f.gps) return f.gps;
  }
  return null;
}

export interface GroupingResult {
  days: Day[];
  clips: Clip[];
}

/**
 * ProbedFile の配列を Day / Clip に構築する純関数。
 * reviewStatus / watchedRanges はデフォルト値(再スキャンマージは store 側)。
 */
export function buildDaysAndClips(
  probed: ProbedFile[],
  settings: ProjectSettings,
): GroupingResult {
  // ディレクトリ単位にまとめる
  const byDir = new Map<string, ProbedFile[]>();
  for (const f of probed) {
    const arr = byDir.get(f.dir) ?? [];
    arr.push(f);
    byDir.set(f.dir, arr);
  }

  const clips: Clip[] = [];
  for (const filesInDir of byDir.values()) {
    const clipFileGroups = groupDirIntoClips(filesInDir);
    for (const group of clipFileGroups) {
      // 先頭ファイルでソート安定化(番号順は groupDir 内で確定済み)
      const first = group[0]!;
      const clipId = clipIdOf(first);
      let offset = 0;
      const sourceFiles: SourceFile[] = group.map((f) => {
        const sf = toSourceFile(f, offset);
        offset += f.durationSec;
        return sf;
      });
      const durationSec = offset;
      const cameraLabel = cameraLabelOf(first);
      // 補正後の時刻を recordedAt として保存し、Day 振り分け・並び順・表示すべてに効かせる。
      const offsetMin = timeOffsetMinFor(cameraLabel, first.storedRoot, settings);
      const rawRecordedAt = recordedAtOf(first);
      const recordedAt = offsetMin
        ? new Date(Date.parse(rawRecordedAt) + offsetMin * 60_000).toISOString()
        : rawRecordedAt;
      const clip: Clip = {
        id: clipId,
        dayId: dayIdOf(recordedAt, settings.dayStartHour),
        name: first.fileName,
        cameraLabel,
        files: sourceFiles,
        durationSec,
        recordedAt,
        reviewStatus: 'unreviewed',
        watchedRanges: [],
        gps: clipGpsOf(sourceFiles),
      };
      clips.push(clip);
    }
  }

  return { days: buildDays(clips), clips };
}

/**
 * クリップ配列から Day 一覧を構築する純関数。
 * dayId ごとに集約し、日付昇順で index を振る。Day 内は recordedAt 昇順
 * (同時刻はクリップ名で安定化)で並べる。
 */
export function buildDays(clips: Clip[]): Day[] {
  const dayMap = new Map<ID, Clip[]>();
  for (const c of clips) {
    const arr = dayMap.get(c.dayId) ?? [];
    arr.push(c);
    dayMap.set(c.dayId, arr);
  }

  const sortedDayIds = Array.from(dayMap.keys()).sort();
  return sortedDayIds.map((dayId, i) => {
    const dayClips = dayMap.get(dayId)!;
    dayClips.sort((a, b) => {
      const ta = Date.parse(a.recordedAt);
      const tb = Date.parse(b.recordedAt);
      if (ta !== tb) return ta - tb;
      // 同時刻はクリップ名で安定化
      return a.name.localeCompare(b.name);
    });
    return {
      id: dayId,
      date: dayId,
      index: i + 1,
      clipIds: dayClips.map((c) => c.id),
    };
  });
}
