import { useEffect, useMemo, useRef, useState } from "react";
import type { PointerEvent as ReactPointerEvent, WheelEvent as ReactWheelEvent } from "react";
import "./boss-map.css";

type Boss = { id: number; name: string; level: number; group: string; sourceUrl: string; points: { x: number; y: number }[]; stats: Record<string, number> };
type Catalog = { map: { image: string }; bosses: Boss[] };
type View = { zoom: number; x: number; y: number };
const MIN_ZOOM = 1;
const MAX_ZOOM = 5;
const clamp = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v));

export function BossWorldMap() {
  const [mapFallback, setMapFallback] = useState(false);
  const [data, setData] = useState<Catalog | null>(null);
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");
  const [group, setGroup] = useState("all");
  const [selected, setSelected] = useState<number | null>(null);
  const [view, setView] = useState<View>({ zoom: 1, x: 0, y: 0 });
  const viewport = useRef<HTMLDivElement>(null);
  const viewRef = useRef(view);
  const drag = useRef<{ id: number; x: number; y: number; startX: number; startY: number; moved: boolean } | null>(null);
  const suppressClick = useRef(false);

  // Keep event handlers in sync without waiting for React's next render.
  const setMapView = (next: View) => { viewRef.current = next; setView(next); };
  const bound = (next: View): View => {
    const box = viewport.current;
    if (!box) return next;
    const z = clamp(next.zoom, MIN_ZOOM, MAX_ZOOM);
    const image = box.clientWidth * z;
    return {
      zoom: z,
      x: clamp(next.x, -Math.max(0, (image - box.clientWidth) / 2), Math.max(0, (image - box.clientWidth) / 2)),
      y: clamp(next.y, -Math.max(0, (image - box.clientHeight) / 2), Math.max(0, (image - box.clientHeight) / 2)),
    };
  };
  const zoomAt = (factor: number, clientX: number, clientY: number) => {
    const box = viewport.current;
    if (!box) return;
    const rect = box.getBoundingClientRect();
    const prev = viewRef.current;
    const zoom = clamp(prev.zoom * factor, MIN_ZOOM, MAX_ZOOM);
    const cx = clientX - rect.left - rect.width / 2;
    const cy = clientY - rect.top - rect.height / 2;
    const ratio = zoom / prev.zoom;
    setMapView(bound({ zoom, x: cx - (cx - prev.x) * ratio, y: cy - (cy - prev.y) * ratio }));
  };
  const zoomCenter = (factor: number) => {
    const rect = viewport.current?.getBoundingClientRect();
    if (rect) zoomAt(factor, rect.left + rect.width / 2, rect.top + rect.height / 2);
  };
  const onWheel = (event: ReactWheelEvent<HTMLDivElement>) => {
    event.preventDefault();
    const delta = clamp(event.deltaY * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? 400 : 1), -500, 500);
    zoomAt(Math.exp(-delta * 0.0015), event.clientX, event.clientY);
  };
  const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.pointerType === "mouse" && event.button !== 0) return;
    if (drag.current) return;
    drag.current = { id: event.pointerId, x: event.clientX, y: event.clientY, startX: event.clientX, startY: event.clientY, moved: false };
    suppressClick.current = false;
    event.currentTarget.setPointerCapture(event.pointerId);
  };
  const onPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (!d || d.id !== event.pointerId) return;
    const dx = event.clientX - d.x, dy = event.clientY - d.y;
    if (Math.hypot(event.clientX - d.startX, event.clientY - d.startY) > 5) d.moved = true;
    d.x = event.clientX; d.y = event.clientY;
    if (d.moved) {
      suppressClick.current = true;
      setMapView(bound({ ...viewRef.current, x: viewRef.current.x + dx, y: viewRef.current.y + dy }));
    }
  };
  const onPointerEnd = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (drag.current?.id !== event.pointerId) return;
    drag.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
  };
  const onMapClickCapture = (event: React.MouseEvent<HTMLDivElement>) => {
    if (suppressClick.current) { event.preventDefault(); event.stopPropagation(); suppressClick.current = false; }
  };

  useEffect(() => {
    const c = new AbortController();
    fetch("/data/raid-bosses.json", { signal: c.signal })
      .then(r => { if (!r.ok) throw Error("HTTP " + r.status); return r.json() as Promise<Catalog>; })
      .then(v => { setData(v); setSelected(v.bosses[0]?.id ?? null); })
      .catch(e => { if (!c.signal.aborted) setError(String(e)); });
    return () => c.abort();
  }, []);
  useEffect(() => {
    const node = viewport.current;
    if (!node) return;
    const observer = new ResizeObserver(() => setMapView(bound(viewRef.current)));
    observer.observe(node);
    return () => observer.disconnect();
  }, []);
  const groups = useMemo(() => [...new Set(data?.bosses.map(b => b.group) ?? [])], [data]);
  const visible = (data?.bosses ?? []).filter(b => (group === "all" || b.group === group) && (`${b.name} ${b.id}`.toLowerCase().includes(query.toLowerCase())));
  const boss = data?.bosses.find(b => b.id === selected);
  return <section className="rb-world">
    <div className="rb-world-filters">
      <input aria-label="Поиск босса" placeholder="Босс или NPC ID" value={query} onChange={e => setQuery(e.target.value)} />
      <select aria-label="Уровень и категория" value={group} onChange={e => setGroup(e.target.value)}><option value="all">Все боссы</option>{groups.map(g => <option key={g}>{g}</option>)}</select>
      <span>{visible.length} / {data?.bosses.length ?? 0}</span>
      <small>Колесо — масштаб · перетаскивание — перемещение · двойной клик — приблизить</small>
    </div>
    {error && <p role="alert">Справочник карты ещё не установлен. ({error})</p>}
    <div className="rb-world-layout">
      <div className="rb-world-list">{visible.map(b => <button key={b.id} className={b.id === selected ? "chosen" : ""} onClick={() => setSelected(b.id)}>{b.name}<small>Lv.{b.level} · #{b.id}</small></button>)}</div>
      <div ref={viewport} className="rb-world-viewport" aria-label="Интерактивная карта рейдовых боссов"
        onWheel={onWheel} onPointerDown={onPointerDown} onPointerMove={onPointerMove}
        onPointerUp={onPointerEnd} onPointerCancel={onPointerEnd} onClickCapture={onMapClickCapture}
        onDoubleClick={event => { event.preventDefault(); zoomAt(1.6, event.clientX, event.clientY); }}>
        {data && <div className="rb-world-image" style={{ transform: `translate(-50%, -50%) translate(${view.x}px, ${view.y}px) scale(${view.zoom})` }}>
          <img src={mapFallback ? "https://masterwork.wiki/assets/a69a4ac5/images/map.jpg" : data.map.image}
            onError={() => setMapFallback(true)} alt="Карта LU4" draggable={false} />
          {visible.flatMap(b => b.points.map((p, i) => <button key={`${b.id}:${i}`} title={b.name} aria-label={b.name}
            className={b.id === selected ? "rb-world-marker chosen" : "rb-world-marker"}
            style={{ left: `${p.x}%`, top: `${p.y}%` }} onClick={() => setSelected(b.id)}>{b.level}</button>))}
        </div>}
        <div className="rb-world-zoom">
          <button aria-label="Увеличить карту" onClick={() => zoomCenter(1.3)} disabled={view.zoom >= MAX_ZOOM}>+</button>
          <button aria-label="Уменьшить карту" onClick={() => zoomCenter(1 / 1.3)} disabled={view.zoom <= MIN_ZOOM}>−</button>
          <button aria-label="Сбросить масштаб" onClick={() => setMapView({ zoom: 1, x: 0, y: 0 })}>↺</button>
          <span>{Math.round(view.zoom * 100)}%</span>
        </div>
      </div>
      <aside className="rb-world-details">{boss ? <><small>NPC #{boss.id} · Lv.{boss.level}</small><h2>{boss.name}</h2><p>{boss.group}</p><p>Точек: {boss.points.length}</p><a href={boss.sourceUrl} target="_blank" rel="noreferrer">Открыть LU4 Wiki ↗</a>{Object.entries(boss.stats).map(([k, v]) => <div className="rb-world-stat" key={k}><span>{k}</span><b>{v.toLocaleString("ru-RU")}</b></div>)}</> : <p>Выберите босса</p>}</aside>
    </div>
  </section>;
}
