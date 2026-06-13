/**
 * 地図ビューの純ロジック(テスト対象)。DOM / leaflet 非依存。
 *
 * - Day → 色の割り当て(パレットを順繰り)
 * - GPS を持つクリップからマーカー集合を作る
 * - マーカー集合の bounds 計算
 * - Day フィルタ(表示する dayId 集合)の適用
 */

import type { Clip, Day, GpsPoint, ID } from '@veh/shared';

/** Day マーカーの色分けパレット(順繰りで割り当て)。ダークテーマで視認しやすい色 */
export const DAY_PALETTE = [
  '#4ea1ff', // 青
  '#45c476', // 緑
  '#e0a93b', // 黄
  '#e0564f', // 赤
  '#c98bff', // 紫
  '#46c9c9', // シアン
  '#ff8f4e', // オレンジ
  '#f06fb0', // ピンク
] as const;

/**
 * 地図上のマーカー 1 点(クリップ由来)。
 * gps を持つクリップのみがマーカーになる。
 */
export interface MapMarker {
  clipId: ID;
  dayId: ID;
  name: string;
  lat: number;
  lon: number;
  /** Day の通し番号(色割り当て・表示用) */
  dayIndex: number;
  /** Day の色(DAY_PALETTE 由来) */
  color: string;
  /** 撮影時刻(ISO) */
  recordedAt: string;
}

export interface Bounds {
  minLat: number;
  minLon: number;
  maxLat: number;
  maxLon: number;
}

/**
 * Day の id → 色 を割り当てる。days の並び順(= index 昇順)にパレットを順繰り。
 * パレットを超えたら先頭に戻る。
 */
export function assignDayColors(days: Day[]): Record<ID, string> {
  const map: Record<ID, string> = {};
  days.forEach((day, i) => {
    map[day.id] = DAY_PALETTE[i % DAY_PALETTE.length]!;
  });
  return map;
}

/** GpsPoint が有限な緯度経度を持つか */
export function isValidGps(gps: GpsPoint | null | undefined): gps is GpsPoint {
  return (
    !!gps &&
    Number.isFinite(gps.lat) &&
    Number.isFinite(gps.lon) &&
    Math.abs(gps.lat) <= 90 &&
    Math.abs(gps.lon) <= 180
  );
}

/**
 * GPS を持つクリップからマーカー集合を作る。
 * days 順・各 Day 内は clipIds 順で並べる(再現性のため)。
 */
export function buildMarkers(
  days: Day[],
  clips: Record<ID, Clip>,
): MapMarker[] {
  const colors = assignDayColors(days);
  const markers: MapMarker[] = [];
  for (const day of days) {
    const color = colors[day.id]!;
    for (const clipId of day.clipIds) {
      const clip = clips[clipId];
      if (!clip || !isValidGps(clip.gps)) continue;
      markers.push({
        clipId: clip.id,
        dayId: day.id,
        name: clip.name,
        lat: clip.gps.lat,
        lon: clip.gps.lon,
        dayIndex: day.index,
        color,
        recordedAt: clip.recordedAt,
      });
    }
  }
  return markers;
}

/** 表示する dayId 集合でマーカーを絞り込む。visibleDayIds が null なら全件。 */
export function filterMarkersByDay(
  markers: MapMarker[],
  visibleDayIds: Set<ID> | null,
): MapMarker[] {
  if (visibleDayIds === null) return markers;
  return markers.filter((m) => visibleDayIds.has(m.dayId));
}

/**
 * マーカー集合の bounds(緯度経度の最小/最大)。
 * 空なら null。
 */
export function markerBounds(markers: MapMarker[]): Bounds | null {
  if (markers.length === 0) return null;
  let minLat = Infinity;
  let minLon = Infinity;
  let maxLat = -Infinity;
  let maxLon = -Infinity;
  for (const m of markers) {
    if (m.lat < minLat) minLat = m.lat;
    if (m.lat > maxLat) maxLat = m.lat;
    if (m.lon < minLon) minLon = m.lon;
    if (m.lon > maxLon) maxLon = m.lon;
  }
  return { minLat, minLon, maxLat, maxLon };
}

/** 地図ビューに出す Day のリスト(マーカーを 1 つ以上持つ Day のみ)。index 昇順。 */
export interface MapDayInfo {
  dayId: ID;
  index: number;
  date: string;
  color: string;
  markerCount: number;
}

export function mapDays(days: Day[], markers: MapMarker[]): MapDayInfo[] {
  const colors = assignDayColors(days);
  const counts = new Map<ID, number>();
  for (const m of markers) {
    counts.set(m.dayId, (counts.get(m.dayId) ?? 0) + 1);
  }
  return days
    .filter((d) => (counts.get(d.id) ?? 0) > 0)
    .map((d) => ({
      dayId: d.id,
      index: d.index,
      date: d.date,
      color: colors[d.id]!,
      markerCount: counts.get(d.id) ?? 0,
    }));
}
