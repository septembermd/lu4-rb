import { useEffect, useMemo, useRef, useState } from 'react';
import type { PointerEvent as MapPointerEvent, WheelEvent as MapWheelEvent } from 'react';

type Point = { x: number; y: number };
type BossMapEntry = { id: number; name: string; level: number; category: string; group: string; sourceUrl: string; stats: Record<string, number>; points: Point[] };
type MapData = { map: { width: number; height: number; image: string; source: string }; bosses: BossMapEntry[] };

/** World map pixels are normalized against the original 3004px wiki image.
 *  The supplied 2048px image uses the same proportions, so no XYZ conversion is needed. */
export function BossWorldMap({ assignments = {} }: { assignments?: Record<number, string[]> }) {
  const [data, setData] = useState<MapData | null>(null);
  const [error, setError] = useState('');
  const [query, setQuery] = useState('');
  const [group, setGroup] = useState('all');
  const [onlyAssigned, setOnlyAssigned] = useState(false);
  const [selected, setSelected] = useState<number | null>(null);
  const [view, setView] = useState({ zoom: 1, x: 0, y: 0 });
  const viewport = useRef<HTMLDivElement>(null);
  const stateRef = useRef(view);
  const dragging = useRef<{ id: number; lastX: number; lastY: number; originX: number; originY: number; moved: boolean } | null>(null);
  const suppressClick = useRef(false);
  const updateView = (value: typeof view) => { stateRef.current = value; setView(value); };
  const bounded = (v: typeof view) => {
    const el = viewport.current;
    if (!el) return v;
    const size = el.clientWidth * v.zoom;
    return { zoom: v.zoom,
      x: Math.max(-Math.max(0, (size - el.clientWidth)/2), Math.min(Math.max(0, (size - el.clientWidth)/2), v.x)),
      y: Math.max(-Math.max(0, (size - el.clientHeight)/2), Math.min(Math.max(0, (size - el.clientHeight)/2), v.y)) };
  };
  const zoomAt = (scale: number, x: number, y: number) => {
    const rect = viewport.current?.getBoundingClientRect();
    if (!rect) return;
    const old = stateRef.current;
    const zoom = Math.min(5, Math.max(1, old.zoom * scale));
    const factor = zoom / old.zoom;
    const dx = x - rect.left - rect.width/2, dy = y - rect.top - rect.height/2;
    updateView(bounded({ zoom, x: dx - (dx-old.x)*factor, y: dy - (dy-old.y)*factor }));
  };
  const centerZoom = (scale: number) => {
    const r = viewport.current?.getBoundingClientRect();
    if (r) zoomAt(scale, r.left+r.width/2, r.top+r.height/2);
  };
  const onWheel = (e: MapWheelEvent<HTMLDivElement>) => {
    e.preventDefault();
    const delta = Math.max(-400, Math.min(400, e.deltaY * (e.deltaMode===1 ? 16 : e.deltaMode===2 ? 400 : 1)));
    zoomAt(Math.exp(-delta*.0015), e.clientX, e.clientY);
  };
  const onPointerDown = (e: MapPointerEvent<HTMLDivElement>) => {
    if (e.pointerType==='mouse' && e.button!==0) return;
    if (dragging.current) return;
    dragging.current={id:e.pointerId,lastX:e.clientX,lastY:e.clientY,originX:e.clientX,originY:e.clientY,moved:false};
    suppressClick.current=false;
    e.currentTarget.setPointerCapture(e.pointerId);
  };
  const onPointerMove = (e: MapPointerEvent<HTMLDivElement>) => {
    const d=dragging.current;
    if (!d || d.id!==e.pointerId) return;
    const dx=e.clientX-d.lastX,dy=e.clientY-d.lastY;
    if (Math.hypot(e.clientX-d.originX,e.clientY-d.originY)>5) d.moved=true;
    d.lastX=e.clientX;d.lastY=e.clientY;
    if (d.moved) { suppressClick.current=true;updateView(bounded({...stateRef.current,x:stateRef.current.x+dx,y:stateRef.current.y+dy})); }
  };
  const onPointerEnd=(e: MapPointerEvent<HTMLDivElement>)=>{
    if (dragging.current?.id!==e.pointerId) return;
    dragging.current=null;
    if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
  };
  useEffect(()=>{
    const el=viewport.current;if (!el) return;
    const observer=new ResizeObserver(()=>updateView(bounded(stateRef.current)));
    observer.observe(el);return ()=>observer.disconnect();
  }, []);

  useEffect(() => {
    const ctrl = new AbortController();
    fetch('/data/raid-bosses.json', { signal: ctrl.signal })
      .then(r => { if (!r.ok) throw Error(`HTTP ${r.status}`); return r.json() as Promise<MapData>; })
      .then(v => { if (!ctrl.signal.aborted) { setData(v); setSelected(v.bosses[0]?.id ?? null); } })
      .catch(e => { if (!ctrl.signal.aborted) setError(String(e)); });
    return () => ctrl.abort();
  }, []);
  const groups = useMemo(() => [...new Set(data?.bosses.map(b => b.group) ?? [])], [data]);
  const filtered = useMemo(() => (data?.bosses ?? []).filter(b =>
    (group === 'all' || b.group === group) &&
    (!onlyAssigned || (assignments[b.id]?.length ?? 0) > 0) &&
    (`${b.name} ${b.id} ${b.group}`).toLowerCase().includes(query.trim().toLowerCase())
  ), [data, group, onlyAssigned, query, assignments]);
  const boss = data?.bosses.find(b => b.id === selected);
  return <section className="rb-map-page" aria-label="Карта рейдовых боссов">
    <div className="rb-map-toolbar">
      <input aria-label="Поиск босса" placeholder="Имя или NPC ID" value={query} onChange={e => setQuery(e.target.value)} />
      <select aria-label="Категория" value={group} onChange={e => setGroup(e.target.value)}>
        <option value="all">Все категории</option>{groups.map(v => <option key={v} value={v}>{v}</option>)}
      </select>
      <label><input type="checkbox" checked={onlyAssigned} onChange={e => setOnlyAssigned(e.target.checked)} /> Только назначенные</label>
      <span>{filtered.length} / {data?.bosses.length ?? 0} боссов</span><small>Колесо — масштаб · перетаскивание — перемещение</small>
    </div>
    {error && <p role="alert">Не удалось загрузить карту: {error}</p>}
    <div className="rb-map-layout">
      <div className="rb-map-list">{filtered.map(b => <button className={b.id === selected ? 'chosen' : ''} key={b.id} onClick={() => setSelected(b.id)}><strong>{b.name}</strong><small>Lv. {b.level} · #{b.id}</small></button>)}</div>
      <div className="rb-map-viewport" ref={viewport} onWheel={onWheel} onPointerDown={onPointerDown}
        onPointerMove={onPointerMove} onPointerUp={onPointerEnd} onPointerCancel={onPointerEnd}
        onClickCapture={e=>{if(suppressClick.current){e.stopPropagation();e.preventDefault();suppressClick.current=false;}}}
        onDoubleClick={e=>{e.preventDefault();zoomAt(1.6,e.clientX,e.clientY);}}>
        {data && <div className="rb-map-image" style={{ transform: `translate(-50%, -50%) translate(${view.x}px, ${view.y}px) scale(${view.zoom})` }}>
          <img src={data.map.image} alt="Карта мира LU4" draggable={false} />
          {filtered.flatMap(b => b.points.map((p, i) => <button key={`${b.id}:${i}`} type="button" title={`${b.name} — Lv. ${b.level}`} aria-label={`${b.name}: точка ${i + 1}`} className={`rb-map-pin ${b.id === selected ? 'selected' : ''}`} style={{ left: `${p.x}%`, top: `${p.y}%` }} onClick={() => setSelected(b.id)}>{b.level}</button>))}
        </div>}
        <div className="rb-map-zoom" onPointerDown={e=>e.stopPropagation()}><button type="button" aria-label="Увеличить" disabled={view.zoom>=5} onClick={() => centerZoom(1.3)}>+</button><button type="button" aria-label="Уменьшить" disabled={view.zoom<=1} onClick={() => centerZoom(1/1.3)}>−</button><button type="button" aria-label="Сбросить масштаб" onClick={() => updateView({zoom:1,x:0,y:0})}>↺</button><span>{Math.round(view.zoom*100)}%</span></div>
      </div>
      <aside className="rb-map-detail">{boss ? <><small>NPC #{boss.id} · Уровень {boss.level}</small><h2>{boss.name}</h2><p>{boss.group}</p><p>Точек появления: {boss.points.length}</p><p>Назначенные персонажи: {assignments[boss.id]?.join(', ') || 'нет'}</p><a href={boss.sourceUrl} target="_blank" rel="noopener noreferrer">Открыть на LU4 Wiki ↗</a><h3>Характеристики</h3>{Object.entries(boss.stats).map(([k,v]) => <div className="rb-stat" key={k}><span>{k}</span><b>{v.toLocaleString('ru-RU')}</b></div>)}</> : <p>Выберите босса</p>}</aside>
    </div>
  </section>;
}
