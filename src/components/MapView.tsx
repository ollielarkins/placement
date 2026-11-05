'use client';

import 'mapbox-gl/dist/mapbox-gl.css';
import mapboxgl, { type GeoJSONSource, type Map as MapboxMap } from 'mapbox-gl';
import { useEffect, useRef, useState } from 'react';

type Filters = { route: string; verified: boolean; taken: boolean; live: boolean };

const ENGLAND: [number, number, number, number] = [-6.4, 49.9, 1.8, 55.8];

export function MapView({
  token,
  routes,
  origin,
  radiusKm,
}: {
  token: string;
  routes: { id: string; name: string }[];
  origin: { lat: number; lng: number; outcode: string } | null;
  radiusKm: number;
}) {
  const box = useRef<HTMLDivElement>(null);
  const map = useRef<MapboxMap | null>(null);
  const [filters, setFilters] = useState<Filters>({ route: '', verified: false, taken: false, live: false });
  const [status, setStatus] = useState<string>('Loading map…');
  const filtersRef = useRef(filters);
  filtersRef.current = filters;

  useEffect(() => {
    if (!box.current || map.current) return;
    mapboxgl.accessToken = token;
    const m = new mapboxgl.Map({
      container: box.current,
      style: 'mapbox://styles/mapbox/light-v11',
      bounds: origin ? undefined : ENGLAND,
      center: origin ? [origin.lng, origin.lat] : undefined,
      zoom: origin ? 9 : undefined,
      maxBounds: [[-12, 48], [5, 58]],
      attributionControl: true,
    });
    m.addControl(new mapboxgl.NavigationControl({ showCompass: false }), 'top-right');
    map.current = m;

    m.on('load', () => {
      m.addSource('sites', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
      // Grid clusters (zoomed out).
      m.addLayer({
        id: 'clusters', type: 'circle', source: 'sites', filter: ['has', 'count'],
        paint: {
          'circle-color': '#111111', 'circle-opacity': 0.75,
          'circle-radius': ['interpolate', ['linear'], ['get', 'count'], 1, 8, 100, 16, 2000, 30],
          'circle-stroke-color': '#fff', 'circle-stroke-width': 1.5,
        },
      });
      m.addLayer({
        id: 'cluster-count', type: 'symbol', source: 'sites', filter: ['has', 'count'],
        layout: { 'text-field': ['to-string', ['get', 'count']], 'text-size': 11 },
        paint: { 'text-color': '#d8ff3d' },
      });
      // Individual sites (zoomed in): verified in green, imported grey.
      m.addLayer({
        id: 'sites', type: 'circle', source: 'sites', filter: ['has', 'company_id'],
        paint: {
          'circle-color': ['match', ['get', 'data_source'], 'verified', '#d8ff3d', 'student_submitted', '#2f45ff', '#6a655b'],
          'circle-stroke-color': '#111111',
          'circle-radius': ['match', ['get', 'data_source'], 'verified', 7, 5],
          'circle-stroke-width': 1.5,
        },
      });

      if (origin) {
        m.addSource('radius', { type: 'geojson', data: circle(origin.lng, origin.lat, radiusKm) });
        m.addLayer({ id: 'radius', type: 'line', source: 'radius', paint: { 'line-color': '#111111', 'line-width': 2, 'line-dasharray': [2, 2] } });
      }

      m.on('click', 'clusters', (e) => {
        const f = e.features?.[0];
        if (f?.geometry.type === 'Point') m.easeTo({ center: f.geometry.coordinates as [number, number], zoom: m.getZoom() + 2 });
      });
      m.on('click', 'sites', (e) => {
        const f = e.features?.[0];
        if (!f || f.geometry.type !== 'Point') return;
        const p = f.properties as { company_id: string; name: string; data_source: string };
        const el = document.createElement('div');
        const a = document.createElement('a');
        a.href = `/companies/${p.company_id}`;
        a.textContent = p.name; // textContent: never inject HTML from data
        a.className = 'font-medium underline';
        const tag = document.createElement('div');
        tag.textContent = p.data_source === 'verified' ? 'Checked by a person' : 'From public records';
        tag.className = 'text-xs text-slate-600';
        el.append(a, tag);
        new mapboxgl.Popup({ offset: 8 }).setLngLat(f.geometry.coordinates as [number, number]).setDOMContent(el).addTo(m);
      });
      for (const layer of ['clusters', 'sites']) {
        m.on('mouseenter', layer, () => (m.getCanvas().style.cursor = 'pointer'));
        m.on('mouseleave', layer, () => (m.getCanvas().style.cursor = ''));
      }
      m.on('moveend', () => void load(m));
      void load(m);
    });

    return () => {
      m.remove();
      map.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  useEffect(() => {
    if (map.current?.isStyleLoaded()) void load(map.current);
  }, [filters]);

  async function load(m: MapboxMap) {
    const b = m.getBounds();
    if (!b) return;
    const f = filtersRef.current;
    const q = new URLSearchParams({
      w: b.getWest().toFixed(2), s: b.getSouth().toFixed(2), e: b.getEast().toFixed(2), n: b.getNorth().toFixed(2),
      z: String(Math.floor(m.getZoom())),
    });
    if (f.route) q.set('route', f.route);
    if (f.verified) q.set('verified', '1');
    if (f.taken) q.set('taken', '1');
    if (f.live) q.set('live', '1');
    setStatus('Loading…');
    try {
      const res = await fetch(`/api/map?${q}`);
      if (!res.ok) throw new Error(String(res.status));
      const data = await res.json();
      (m.getSource('sites') as GeoJSONSource | undefined)?.setData(data);
      const n = data.features.length;
      setStatus(
        data.clustered
          ? 'Zoom in to see individual employers.'
          : data.truncated
            ? `Showing the first ${n.toLocaleString('en-GB')} sites here. Zoom in or filter to see the rest.`
            : `${n.toLocaleString('en-GB')} sites in view.`,
      );
    } catch {
      setStatus('Could not load employers. Try again in a moment.');
    }
  }

  return (
    <div className="grid gap-3">
      <div className="flex flex-wrap items-end gap-4 text-sm">
        <label className="grid gap-1">
          <span className="font-medium">T Level</span>
          <select value={filters.route} onChange={(e) => setFilters({ ...filters, route: e.target.value })} className="rounded-md border border-slate-300 px-3 py-2">
            <option value="">Any</option>
            {routes.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
          </select>
        </label>
        <Toggle label="Checked by a person" on={filters.verified} set={(v) => setFilters({ ...filters, verified: v })} />
        <Toggle label="Has taken T Level students" on={filters.taken} set={(v) => setFilters({ ...filters, taken: v })} />
        <Toggle label="Live apprenticeship adverts" on={filters.live} set={(v) => setFilters({ ...filters, live: v })} />
      </div>
      <div ref={box} className="h-[70vh] min-h-[420px] w-full overflow-hidden border-2 border-ink shadow-hard" />
      <p className="text-sm text-slate-600" aria-live="polite">{status}</p>
    </div>
  );
}

function Toggle({ label, on, set }: { label: string; on: boolean; set: (v: boolean) => void }) {
  return (
    <label className="flex items-center gap-2 pb-2">
      <input type="checkbox" checked={on} onChange={(e) => set(e.target.checked)} className="size-4 accent-brand-600" />
      {label}
    </label>
  );
}

/** A 64-point polygon approximating a circle of `km` around a point. */
function circle(lng: number, lat: number, km: number): GeoJSON.Feature<GeoJSON.Polygon> {
  const pts: [number, number][] = [];
  for (let i = 0; i <= 64; i++) {
    const t = (i / 64) * 2 * Math.PI;
    const dLat = (km / 111.32) * Math.sin(t);
    const dLng = (km / (111.32 * Math.cos((lat * Math.PI) / 180))) * Math.cos(t);
    pts.push([lng + dLng, lat + dLat]);
  }
  return { type: 'Feature', properties: {}, geometry: { type: 'Polygon', coordinates: [pts] } };
}
