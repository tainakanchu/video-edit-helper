import { useEffect, useMemo, useRef, useState } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import type { ID } from '@veh/shared';
import { useAppStore } from '../store/useAppStore';
import { useRouter } from '../lib/useRouter';
import {
  buildMarkers,
  filterMarkersByDay,
  mapDays,
  markerBounds,
  type MapMarker,
} from '../lib/mapLayout';

const OSM_TILE_URL = 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';
const OSM_ATTRIBUTION =
  '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors';

/** 撮影時刻(ISO)を HH:MM 表示に */
function recordedTimeLabel(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function MapView() {
  const project = useAppStore((s) => s.project);
  const { navigate } = useRouter();

  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const layerRef = useRef<L.LayerGroup | null>(null);
  /** 初回 fitBounds 済みか(以降は Day フィルタでビューを動かさない) */
  const didFitRef = useRef(false);

  const days = project?.days ?? [];
  const clips = project?.clips ?? {};

  // 全マーカー(GPS を持つクリップ)。project 変化で再計算。
  const allMarkers = useMemo(() => buildMarkers(days, clips), [project]);

  // 地図に出す Day(マーカーを 1 つ以上持つ Day のみ)
  const dayInfos = useMemo(() => mapDays(days, allMarkers), [days, allMarkers]);

  // Day フィルタ: 表示する dayId 集合。null は全件表示。
  const [hiddenDayIds, setHiddenDayIds] = useState<Set<ID>>(new Set());
  const visibleDayIds = useMemo(() => {
    const visible = new Set<ID>();
    for (const di of dayInfos) {
      if (!hiddenDayIds.has(di.dayId)) visible.add(di.dayId);
    }
    return visible;
  }, [dayInfos, hiddenDayIds]);

  const visibleMarkers = useMemo(
    () => filterMarkersByDay(allMarkers, visibleDayIds),
    [allMarkers, visibleDayIds],
  );

  const hasGps = allMarkers.length > 0;

  // --- 地図インスタンスを 1 回だけ生成し、unmount で破棄 ---
  useEffect(() => {
    if (!hasGps) return;
    const el = containerRef.current;
    if (!el || mapRef.current) return;

    const map = L.map(el, { worldCopyJump: true });
    L.tileLayer(OSM_TILE_URL, {
      attribution: OSM_ATTRIBUTION,
      maxZoom: 19,
    }).addTo(map);
    // 仮の初期ビュー(直後の fitBounds で上書きされる)
    map.setView([0, 0], 2);

    const layer = L.layerGroup().addTo(map);
    mapRef.current = map;
    layerRef.current = layer;
    didFitRef.current = false;

    // レイアウト確定後にサイズを再計算(コンテナ寸法が遅れて決まるケース対策)
    requestAnimationFrame(() => {
      if (mapRef.current === map) map.invalidateSize();
    });

    return () => {
      map.remove();
      mapRef.current = null;
      layerRef.current = null;
    };
  }, [hasGps]);

  // --- マーカー更新(visibleMarkers / project 変化で再構築)---
  useEffect(() => {
    const layer = layerRef.current;
    const map = mapRef.current;
    if (!layer || !map) return;

    layer.clearLayers();
    for (const m of visibleMarkers) {
      const marker = L.circleMarker([m.lat, m.lon], {
        radius: 6,
        color: '#0b0e12',
        weight: 1.5,
        fillColor: m.color,
        fillOpacity: 0.9,
      });
      marker.bindPopup(() => buildPopup(m, () => navigate({ name: 'clip', clipId: m.clipId, t: null })));
      layer.addLayer(marker);
    }

    // 初回のみ全マーカーが収まるよう fitBounds
    if (!didFitRef.current) {
      const bounds = markerBounds(allMarkers);
      if (bounds) {
        map.fitBounds(
          [
            [bounds.minLat, bounds.minLon],
            [bounds.maxLat, bounds.maxLon],
          ],
          { padding: [40, 40], maxZoom: 14 },
        );
        didFitRef.current = true;
      }
    }
  }, [visibleMarkers, allMarkers, navigate]);

  const toggleDay = (dayId: ID) => {
    setHiddenDayIds((prev) => {
      const next = new Set(prev);
      if (next.has(dayId)) next.delete(dayId);
      else next.add(dayId);
      return next;
    });
  };

  if (!hasGps) {
    return (
      <div className="mapview">
        <div className="map-empty">
          GPS 情報のある素材がありません(スマホ素材などに位置情報が含まれる場合に表示されます)
        </div>
      </div>
    );
  }

  return (
    <div className="mapview">
      <div className="map-filters">
        <span className="map-filters-label">Day 表示:</span>
        {dayInfos.map((di) => {
          const on = !hiddenDayIds.has(di.dayId);
          return (
            <button
              key={di.dayId}
              className={on ? 'day-chip on' : 'day-chip'}
              onClick={() => toggleDay(di.dayId)}
              title={`Day ${di.index}(${di.markerCount} 件)の表示切替`}
            >
              <span className="day-chip-dot" style={{ background: di.color }} />
              Day {di.index}
              <span className="day-chip-count">{di.markerCount}</span>
            </button>
          );
        })}
      </div>
      <div ref={containerRef} className="map-canvas" />
    </div>
  );
}

/** ポップアップの DOM を組み立てる(「開く」で /clip へ navigate)。 */
function buildPopup(m: MapMarker, onOpen: () => void): HTMLElement {
  const root = document.createElement('div');
  root.className = 'map-popup';

  const title = document.createElement('div');
  title.className = 'mp-title';
  title.textContent = m.name;
  root.appendChild(title);

  const meta = document.createElement('div');
  meta.className = 'mp-meta';
  const timeLabel = recordedTimeLabel(m.recordedAt);
  meta.textContent = `Day ${m.dayIndex}${timeLabel ? ' / ' + timeLabel : ''}`;
  root.appendChild(meta);

  const open = document.createElement('button');
  open.className = 'mp-open';
  open.type = 'button';
  open.textContent = '開く';
  open.addEventListener('click', onOpen);
  root.appendChild(open);

  return root;
}
