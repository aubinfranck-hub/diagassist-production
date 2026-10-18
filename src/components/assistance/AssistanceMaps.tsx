import { useEffect, useRef } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";

const ABIDJAN: [number, number] = [5.36, -4.0083];

const markerIcon = (color: string) =>
  L.divIcon({
    className: "",
    html: `<div style="width:22px;height:22px;border-radius:50%;background:${color};border:3px solid #fff;box-shadow:0 2px 8px rgba(0,0,0,.5)"></div>`,
    iconSize: [22, 22],
    iconAnchor: [11, 11],
  });

const TILES = "https://tile.openstreetmap.org/{z}/{x}/{y}.png";
const ATTR = "&copy; OpenStreetMap";

export interface LatLng { lat: number; lng: number }

/** Carte de sélection : toucher la carte ou faire glisser le point rouge. */
export function LocationPicker({
  value, onChange, accuracy,
}: { value: LatLng | null; onChange: (p: LatLng) => void; accuracy?: number }) {
  const el = useRef<HTMLDivElement>(null);
  const map = useRef<L.Map | null>(null);
  const marker = useRef<L.Marker | null>(null);
  const circle = useRef<L.Circle | null>(null);
  const cb = useRef(onChange);
  cb.current = onChange;

  useEffect(() => {
    if (!el.current || map.current) return;
    const m = L.map(el.current, { zoomControl: true }).setView(value ? [value.lat, value.lng] : ABIDJAN, value ? 17 : 12);
    L.tileLayer(TILES, { maxZoom: 19, attribution: ATTR }).addTo(m);
    m.on("click", (e: L.LeafletMouseEvent) => cb.current({ lat: e.latlng.lat, lng: e.latlng.lng }));
    map.current = m;
    setTimeout(() => m.invalidateSize(), 150);
    return () => { m.remove(); map.current = null; marker.current = null; circle.current = null; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const m = map.current;
    if (!m) return;
    if (!value) {
      marker.current?.remove(); marker.current = null;
      circle.current?.remove(); circle.current = null;
      return;
    }
    const ll: [number, number] = [value.lat, value.lng];
    if (!marker.current) {
      marker.current = L.marker(ll, { draggable: true, icon: markerIcon("#dc2626") }).addTo(m);
      marker.current.on("dragend", () => {
        const p = marker.current!.getLatLng();
        cb.current({ lat: p.lat, lng: p.lng });
      });
    } else {
      marker.current.setLatLng(ll);
    }
    if (accuracy && accuracy > 0 && accuracy < 2000) {
      if (!circle.current) circle.current = L.circle(ll, { radius: accuracy, color: "#dc2626", weight: 1, fillOpacity: 0.1 }).addTo(m);
      else { circle.current.setLatLng(ll); circle.current.setRadius(accuracy); }
    } else {
      circle.current?.remove(); circle.current = null;
    }
    m.setView(ll, Math.max(m.getZoom(), 16));
  }, [value?.lat, value?.lng, accuracy]);

  return <div ref={el} className="w-full h-72 rounded-2xl overflow-hidden border border-white/[0.08] z-0" />;
}

/** Carte de suivi : position du client (rouge) et du mécanicien (vert) ; cercle optionnel pour une zone approximative. */
export function TrackMap({
  client, pro, radiusM, height = "h-64",
}: { client?: LatLng | null; pro?: LatLng | null; radiusM?: number; height?: string }) {
  const el = useRef<HTMLDivElement>(null);
  const map = useRef<L.Map | null>(null);
  const layer = useRef<L.LayerGroup | null>(null);

  useEffect(() => {
    if (!el.current || map.current) return;
    const m = L.map(el.current).setView(ABIDJAN, 12);
    L.tileLayer(TILES, { maxZoom: 19, attribution: ATTR }).addTo(m);
    layer.current = L.layerGroup().addTo(m);
    map.current = m;
    setTimeout(() => m.invalidateSize(), 150);
    return () => { m.remove(); map.current = null; layer.current = null; };
  }, []);

  useEffect(() => {
    const m = map.current, g = layer.current;
    if (!m || !g) return;
    g.clearLayers();
    const pts: L.LatLngTuple[] = [];
    if (client) {
      pts.push([client.lat, client.lng]);
      if (radiusM) L.circle([client.lat, client.lng], { radius: radiusM, color: "#dc2626", weight: 1, fillOpacity: 0.12 }).addTo(g);
      else L.marker([client.lat, client.lng], { icon: markerIcon("#dc2626") }).addTo(g);
    }
    if (pro) {
      pts.push([pro.lat, pro.lng]);
      L.marker([pro.lat, pro.lng], { icon: markerIcon("#059669") }).addTo(g);
    }
    if (pts.length === 1) m.setView(pts[0], radiusM ? 14 : 16);
    else if (pts.length > 1) m.fitBounds(L.latLngBounds(pts), { padding: [40, 40], maxZoom: 17 });
  }, [client?.lat, client?.lng, pro?.lat, pro?.lng, radiusM]);

  return <div ref={el} className={`w-full ${height} rounded-2xl overflow-hidden border border-white/[0.08] z-0`} />;
}
