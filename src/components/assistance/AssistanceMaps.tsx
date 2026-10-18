import React, { useEffect, useRef, useState } from "react";
import { ArrowLeft } from "lucide-react";
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

// ---------------------------------------------------------------------------
// Expérience automobiliste : carte plein écran + panneau du bas (type Yango / Uber)
// ---------------------------------------------------------------------------

/** Libellé lisible (rue, quartier) de la position, via OpenStreetMap. Vide tant que non trouvé. */
export function useAddress(pos: LatLng | null): string {
  const [addr, setAddr] = useState("");
  useEffect(() => {
    if (!pos) { setAddr(""); return; }
    const ctrl = new AbortController();
    const t = window.setTimeout(async () => {
      try {
        const r = await fetch(
          `https://nominatim.openstreetmap.org/reverse?format=jsonv2&zoom=18&accept-language=fr&lat=${pos.lat}&lon=${pos.lng}`,
          { signal: ctrl.signal }
        );
        const d = await r.json();
        const a = d?.address || {};
        const road = a.road || a.pedestrian || a.footway || a.residential;
        const area = a.neighbourhood || a.suburb || a.city_district || a.town || a.city || a.village;
        const parts = [road, area].filter(Boolean);
        const label = parts.length ? parts.join(", ") : (d?.display_name ? String(d.display_name).split(",").slice(0, 2).join(",").trim() : "");
        if (!ctrl.signal.aborted) setAddr(label);
      } catch {
        if (!ctrl.signal.aborted) setAddr("");
      }
    }, 700);
    return () => { window.clearTimeout(t); ctrl.abort(); };
  }, [pos?.lat, pos?.lng]); // eslint-disable-line react-hooks/exhaustive-deps
  return addr;
}

const clientIcon = (pulse: boolean) =>
  L.divIcon({
    className: "",
    html: `<div class="dm-wrap">${pulse ? '<span class="dm-ring"></span><span class="dm-ring" style="animation-delay:.8s"></span><span class="dm-ring" style="animation-delay:1.6s"></span>' : ""}<span class="dm-dot"></span></div>`,
    iconSize: [24, 24],
    iconAnchor: [12, 12],
  });

const proIcon = () =>
  L.divIcon({
    className: "dm-pro",
    html: `<div class="dm-pro-dot"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"/></svg></div>`,
    iconSize: [34, 34],
    iconAnchor: [17, 17],
  });

const MAP_CSS = `
.dm-wrap{position:relative;width:24px;height:24px}
.dm-dot{position:absolute;inset:2px;border-radius:50%;background:#dc2626;border:3px solid #fff;box-shadow:0 2px 8px rgba(0,0,0,.5)}
.dm-ring{position:absolute;left:50%;top:50%;width:24px;height:24px;margin:-12px 0 0 -12px;border-radius:50%;background:rgba(220,38,38,.35);border:2px solid rgba(220,38,38,.7);animation:dm-pulse 2.4s ease-out infinite;pointer-events:none}
@keyframes dm-pulse{0%{transform:scale(.6);opacity:.9}100%{transform:scale(7);opacity:0}}
.dm-pro{transition:transform 1.2s linear}
.dm-pro-dot{width:34px;height:34px;border-radius:50%;background:#059669;border:3px solid #fff;box-shadow:0 2px 10px rgba(0,0,0,.55);display:flex;align-items:center;justify-content:center}
.dm-map .leaflet-control-attribution{font-size:9px;opacity:.7}
`;

function FullMap({
  client, pro, accuracy, editable, onChange, pulse, bottomInset,
}: {
  client?: LatLng | null; pro?: LatLng | null; accuracy?: number; editable?: boolean;
  onChange?: (p: LatLng) => void; pulse?: boolean; bottomInset: number;
}) {
  const el = useRef<HTMLDivElement>(null);
  const map = useRef<L.Map | null>(null);
  const cMarker = useRef<L.Marker | null>(null);
  const pMarker = useRef<L.Marker | null>(null);
  const circle = useRef<L.Circle | null>(null);
  const cb = useRef(onChange);
  cb.current = onChange;
  const editRef = useRef(!!editable);
  editRef.current = !!editable;
  const lastEmit = useRef<LatLng | null>(null);
  const inset = useRef(bottomInset);
  inset.current = bottomInset;
  const hadPro = useRef(false);

  useEffect(() => {
    if (!el.current || map.current) return;
    const m = L.map(el.current, { zoomControl: false, attributionControl: false }).setView(ABIDJAN, 12);
    L.control.attribution({ position: "topright", prefix: false }).addTo(m);
    L.tileLayer(TILES, { maxZoom: 19, attribution: ATTR }).addTo(m);
    m.on("click", (e: L.LeafletMouseEvent) => {
      if (!editRef.current) return;
      const p = { lat: e.latlng.lat, lng: e.latlng.lng };
      lastEmit.current = p;
      cb.current?.(p);
    });
    map.current = m;
    const t = window.setTimeout(() => m.invalidateSize(), 150);
    return () => { window.clearTimeout(t); m.remove(); map.current = null; cMarker.current = null; pMarker.current = null; circle.current = null; };
  }, []);

  // Marqueur du client
  useEffect(() => {
    const m = map.current;
    if (!m) return;
    if (!client) {
      cMarker.current?.remove(); cMarker.current = null;
      circle.current?.remove(); circle.current = null;
      return;
    }
    const ll: [number, number] = [client.lat, client.lng];
    if (!cMarker.current) {
      cMarker.current = L.marker(ll, { draggable: !!editable, icon: clientIcon(!!pulse), zIndexOffset: 500 }).addTo(m);
      cMarker.current.on("dragend", () => {
        const p = cMarker.current!.getLatLng();
        const v = { lat: p.lat, lng: p.lng };
        lastEmit.current = v;
        cb.current?.(v);
      });
    } else {
      cMarker.current.setLatLng(ll);
    }
    cMarker.current.setIcon(clientIcon(!!pulse));
    if (editable) cMarker.current.dragging?.enable(); else cMarker.current.dragging?.disable();
    if (accuracy && accuracy > 0 && accuracy < 2000 && editable) {
      if (!circle.current) circle.current = L.circle(ll, { radius: accuracy, color: "#dc2626", weight: 1, fillOpacity: 0.1 }).addTo(m);
      else { circle.current.setLatLng(ll); circle.current.setRadius(accuracy); }
    } else {
      circle.current?.remove(); circle.current = null;
    }
  }, [client?.lat, client?.lng, accuracy, pulse, editable]);

  // Marqueur du mécanicien : déplacé en douceur à chaque mise à jour
  useEffect(() => {
    const m = map.current;
    if (!m) return;
    if (!pro) { pMarker.current?.remove(); pMarker.current = null; return; }
    const ll: [number, number] = [pro.lat, pro.lng];
    if (!pMarker.current) pMarker.current = L.marker(ll, { icon: proIcon(), zIndexOffset: 400, interactive: false }).addTo(m);
    else pMarker.current.setLatLng(ll);
  }, [pro?.lat, pro?.lng]);

  // Cadrage
  useEffect(() => {
    const m = map.current;
    if (!m) return;
    const pts: L.LatLngTuple[] = [];
    if (client) pts.push([client.lat, client.lng]);
    if (pro) pts.push([pro.lat, pro.lng]);
    const proAppeared = !!pro && !hadPro.current;
    hadPro.current = !!pro;
    if (!pts.length) return;
    // Déplacement fait par l'utilisateur lui-même : on ne recadre pas.
    const le = lastEmit.current;
    if (le && client && le.lat === client.lat && le.lng === client.lng && !proAppeared) return;
    if (pro && !proAppeared && m.getBounds().pad(-0.1).contains([pro.lat, pro.lng]) && client && m.getBounds().contains([client.lat, client.lng])) return;
    const pad = { paddingTopLeft: [40, 70] as L.PointTuple, paddingBottomRight: [40, inset.current + 24] as L.PointTuple, maxZoom: pts.length > 1 ? 17 : 17 };
    m.fitBounds(L.latLngBounds(pts), pad);
  }, [client?.lat, client?.lng, pro?.lat, pro?.lng, bottomInset]);

  return <div ref={el} className="dm-map absolute inset-0 z-0" />;
}

/** Écran carte plein cadre avec panneau du bas. `children` = contenu défilant, `footer` = zone fixe (bouton principal). */
export function MapScreen({
  client, pro, accuracy, editable, onChange, pulse, onBack, backLabel = "Retour", topRight, children, footer,
}: {
  client?: LatLng | null; pro?: LatLng | null; accuracy?: number; editable?: boolean;
  onChange?: (p: LatLng) => void; pulse?: boolean; onBack?: () => void; backLabel?: string;
  topRight?: React.ReactNode; children: React.ReactNode; footer?: React.ReactNode;
}) {
  const sheet = useRef<HTMLDivElement>(null);
  const [inset, setInset] = useState(220);
  useEffect(() => {
    const node = sheet.current;
    if (!node) return;
    const measure = () => setInset(Math.round(node.getBoundingClientRect().height));
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(measure);
    ro.observe(node);
    return () => ro.disconnect();
  }, []);

  return (
    <div className="relative isolate w-full overflow-hidden rounded-3xl border border-white/[0.08] bg-slate-900 h-[calc(100dvh-11.5rem)] lg:h-[calc(100dvh-8rem)] min-h-[560px] animate-fade-in">
      <style>{MAP_CSS}</style>
      <FullMap client={client} pro={pro} accuracy={accuracy} editable={editable} onChange={onChange} pulse={pulse} bottomInset={inset} />
      {onBack && (
        <button onClick={onBack} aria-label={backLabel} className="absolute top-3 left-3 z-10 inline-flex items-center gap-1.5 min-h-[44px] pl-3 pr-4 rounded-full bg-slate-900/90 backdrop-blur border border-white/[0.12] text-sm font-bold text-slate-100 shadow-lg cursor-pointer">
          <ArrowLeft className="w-4 h-4" /> {backLabel}
        </button>
      )}
      {topRight && <div className="absolute top-3 right-3 z-10">{topRight}</div>}
      <div ref={sheet} className="absolute inset-x-0 bottom-0 z-10 flex flex-col max-h-[78%] bg-slate-900/[0.97] backdrop-blur-md border-t border-white/[0.1] rounded-t-3xl shadow-[0_-12px_40px_rgba(0,0,0,0.5)]">
        <div className="pt-2.5 pb-1 flex justify-center shrink-0"><span className="w-10 h-1.5 rounded-full bg-slate-700" /></div>
        <div className="overflow-y-auto px-5 pb-4 pt-1 space-y-4 min-h-0">{children}</div>
        {footer && <div className="shrink-0 px-5 pb-5 pt-3 border-t border-white/[0.06] space-y-2">{footer}</div>}
      </div>
    </div>
  );
}
