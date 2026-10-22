import "./boss-map.css";
import { useEffect, useMemo, useRef, useState } from 'react';
import type { PointerEvent as MapPointerEvent, WheelEvent as MapWheelEvent } from 'react';

type Point = { x: number; y: number };
type DropEntry = { id: number; name: string; quantity: string; chance: number | null; groupChance: number | null; icon: string | null };
type Drops = Record<string, { gamma?: DropEntry[]; bwc?: DropEntry[] }>;

type BossMapEntry = { id: number; name: string; level: number; category: string; group: string; sourceUrl: string; stats: Record<string, number>; points: Point[] };
type MapData = { map: { width: number; height: number; image: string; source: string }; bosses: BossMapEntry[] };

/** World map pixels are normalized against the original 3004px wiki image.
 *  The supplied 2048px image uses the same proportions, so no XYZ conversion is needed. */
type MapObservation = { result: 'alive' | 'not_found'; observedAt: string; source: string };
type MapWindow = { start: number | string; end: number | string; lastKill: string | null };
export function BossWorldMap({ onOpenLive, observations = {}, windows = {}, onRecordKill }: {
  onOpenLive?: () => void;
  observations?: Record<number, MapObservation>;
  windows?: Record<number, MapWindow>;
  onRecordKill?: (bossId: number, killedAt: string) => Promise<void>;
}) {
  const [data, setData] = useState<MapData | null>(null);
  const [error, setError] = useState('');
  const [drops, setDrops] = useState<Drops | null>(null);
  const [dropsError, setDropsError] = useState('');
  const [dropServer, setDropServer] = useState<'gamma'|'bwc'>('gamma');
  const [dropQuery, setDropQuery] = useState('');
  const [dropExpanded, setDropExpanded] = useState(true);
  const [killForm, setKillForm] = useState(false);
  const [killTime, setKillTime] = useState('');
  const [killError, setKillError] = useState('');
  const [killBusy, setKillBusy] = useState(false);
  const [query, setQuery] = useState('');
  const [group, setGroup] = useState('all');

  const [selected, setSelected] = useState<number | null>(null);
  const [view, setView] = useState({ zoom: 1, x: 0, y: 0 });
  const [viewportSize, setViewportSize] = useState({ width: 0, height: 0 });
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
    // Do not capture pointer events on interactive pins; capture retargets click to the viewport.
    if ((e.target as HTMLElement).closest('button, a, input, select')) return;
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
    const measure=()=>{setViewportSize({width:el.clientWidth,height:el.clientHeight});updateView(bounded(stateRef.current));};
    const observer=new ResizeObserver(measure);
    measure();
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
  useEffect(() => {
    const ctrl = new AbortController();
    fetch('/data/raid-boss-drops.json', {signal:ctrl.signal})
      .then(r => {if(!r.ok) throw new Error('HTTP '+r.status);return r.json() as Promise<Drops>;})
      .then(v => {if(!ctrl.signal.aborted)setDrops(v);})
      .catch(e => {if(!ctrl.signal.aborted)setDropsError(String(e));});
    return ()=>ctrl.abort();
  },[]);
  const groups = useMemo(() => [...new Set(data?.bosses.map(b => b.group) ?? [])], [data]);
  const filtered = useMemo(() => (data?.bosses ?? []).filter(b =>
    (group === 'all' || b.group === group) &&
    (`${b.name} ${b.id} ${b.group}`).toLowerCase().includes(query.trim().toLowerCase())
  ), [data, group, query]);
  const boss = data?.bosses.find(b => b.id === selected);
  const bossDrops = boss ? (drops?.[String(boss.id)]?.[dropServer] ?? []) : [];
  const shownDrops = bossDrops.filter(d => `${d.name} ${d.id}`.toLowerCase().includes(dropQuery.toLowerCase()));
  const highlightBoss = (id: number) => {
    setSelected(id);
    setKillForm(false);
    const target = data?.bosses.find(b => b.id === id)?.points[0];
    if (!target) return;
    const r = viewport.current?.getBoundingClientRect();
    if (!r) return;
    const zoom = Math.max(1.35, stateRef.current.zoom);
    updateView(bounded({ zoom, x: (0.5-target.x/100)*r.width*zoom, y: (0.5-target.y/100)*r.width*zoom }));
  };
  return <section className="rb-map-page" aria-label="Карта рейдовых боссов">
    <div className="rb-map-summary">
      <div><small>В справочнике</small><strong>{data?.bosses.length ?? 0}<span>РБ</span></strong></div>
      <div><small>Точек на карте</small><strong>{data?.bosses.reduce((sum,b)=>sum+b.points.length,0)??0}</strong></div>
      <div><small>Подтверждённые наблюдения</small><strong>{Object.keys(observations).length}</strong></div>
      <div><small>Статус разведки</small><strong className="rb-summary-muted">Не подключена</strong></div>
    </div>
    <div className="rb-map-toolbar">
      <input aria-label="Поиск босса" placeholder="Имя или NPC ID" value={query} onChange={e => setQuery(e.target.value)} />
      <select aria-label="Категория" value={group} onChange={e => setGroup(e.target.value)}>
        <option value="all">Все категории</option>{groups.map(v => <option key={v} value={v}>{v}</option>)}
      </select>
      
      <span>{filtered.length} / {data?.bosses.length ?? 0} боссов</span><small>Колесо — масштаб · перетаскивание — перемещение</small>
    </div>
    {error && <p role="alert">Не удалось загрузить карту: {error}</p>}
    <div className="rb-map-layout">
      <div className="rb-map-list">{filtered.map(b => <button type="button" className={`boss-row ${b.id === selected ? 'selected' : ''}`} key={b.id} onClick={() => highlightBoss(b.id)}><span className="level">{b.level}</span><span className="rb-map-list-label"><b>{b.name}</b><small>{observations[b.id]?.result === 'alive' ? 'Обнаружен' : observations[b.id]?.result === 'not_found' ? 'Не обнаружен' : 'Нет свежих наблюдений'}</small></span></button>)}</div>
      <div className="rb-map-viewport" ref={viewport} onWheel={onWheel} onPointerDown={onPointerDown}
        onPointerMove={onPointerMove} onPointerUp={onPointerEnd} onPointerCancel={onPointerEnd}
        onClickCapture={e=>{if(suppressClick.current){e.stopPropagation();e.preventDefault();suppressClick.current=false;}}}
        onDoubleClick={e=>{e.preventDefault();zoomAt(1.6,e.clientX,e.clientY);}}>
        {data && <>
          <div className="rb-map-image" style={{ transform: `translate(-50%, -50%) translate(${view.x}px, ${view.y}px) scale(${view.zoom})` }}>
            <img src={data.map.image} alt="Карта мира LU4" draggable={false} />
          </div>
          <div className="rb-map-overlay">
            {viewportSize.width > 0 && filtered.flatMap(b => b.points.map((p, i) => {
              const left = viewportSize.width / 2 + view.x + (p.x / 100 - 0.5) * viewportSize.width * view.zoom;
              const top = viewportSize.height / 2 + view.y + (p.y / 100 - 0.5) * viewportSize.width * view.zoom;
              if (left < -32 || left > viewportSize.width + 32 || top < -32 || top > viewportSize.height + 32) return null;
              return <button key={`${b.id}:${i}`} type="button" title={`${b.name} — Lv. ${b.level}`}
                aria-label={`${b.name}: точка ${i + 1}`}
                className={`rb-map-pin ${b.id === selected ? 'selected' : ''}`}
                style={{ left: `${Math.round(left)}px`, top: `${Math.round(top)}px` }}
                onPointerDown={e => { suppressClick.current = false; e.stopPropagation(); }} onClick={() => { setSelected(b.id); setKillForm(false); }}>
                <span className="rb-map-pin-number">{b.level}</span>
                <span className="rb-map-pin-tooltip" role="tooltip">{b.name}</span>
              </button>;
            }))}
          </div>
        </>}
        <div className="rb-map-zoom" onPointerDown={e=>e.stopPropagation()}><button type="button" aria-label="Увеличить" disabled={view.zoom>=5} onClick={() => centerZoom(1.3)}>+</button><button type="button" aria-label="Уменьшить" disabled={view.zoom<=1} onClick={() => centerZoom(1/1.3)}>−</button><button type="button" aria-label="Сбросить масштаб" onClick={() => updateView({zoom:1,x:0,y:0})}>↺</button><span>{Math.round(view.zoom*100)}%</span></div>
      </div>
      <aside className="rb-map-detail">{boss ? <>
        <div className="rb-map-detail-header"><small>УРОВЕНЬ {boss.level} · NPC #{boss.id}</small><h2>{boss.name}</h2><span className="rb-map-tag">{boss.group}</span></div>
        <div className="rb-map-info"><small>Статус разведки</small><strong className={boss && observations[boss.id]?.result === 'alive' ? 'rb-map-status-alive' : ''}>{boss && observations[boss.id] ? observations[boss.id].result === 'alive' ? 'Обнаружен' : 'Не обнаружен' : 'Нет свежих данных'}</strong>
{boss && observations[boss.id] ? <p>{new Date(observations[boss.id].observedAt).toLocaleString('ru-RU')} · {observations[boss.id].source}</p> : <p>Подтверждённых наблюдений пока нет.</p>}</div>
        <div className="rb-map-info"><small>Окно респауна</small>
{boss && windows[boss.id] ? <><strong>{new Date(windows[boss.id].start).toLocaleString('ru-RU')} — {new Date(windows[boss.id].end).toLocaleString('ru-RU')}</strong>{windows[boss.id].lastKill && <p>Последнее убийство: {new Date(windows[boss.id].lastKill!).toLocaleString('ru-RU')}</p>}</> : <><strong>Не определено</strong><p>Для расчёта необходимы подтверждённые правила респауна и последнее убийство.</p></>}
{onRecordKill ? <><button type="button" className="rb-map-record" onClick={()=>{setKillForm(v=>!v);setKillTime(new Date(Date.now()-new Date().getTimezoneOffset()*60000).toISOString().slice(0,16));setKillError('');}}>Отметить убийство</button>
{killForm && <form className="rb-map-kill-form" onSubmit={async event=>{event.preventDefault();if(!boss)return;setKillBusy(true);setKillError('');try{await onRecordKill(boss.id,new Date(killTime).toISOString());setKillForm(false)}catch(error){setKillError(error instanceof Error?error.message:'Не удалось сохранить')}finally{setKillBusy(false)}}}><label>Время убийства<input required type="datetime-local" max={new Date(Date.now()-new Date().getTimezoneOffset()*60000).toISOString().slice(0,16)} value={killTime} onChange={e=>setKillTime(e.target.value)}/></label><button type="submit" disabled={killBusy}>Сохранить</button>{killError&&<p role="alert">{killError}</p>}</form>}</> : onOpenLive && <button type="button" className="rb-map-record" onClick={onOpenLive}>Отметить убийство через API</button>}
</div>
        
        <details className="rb-map-accordion"><summary>Характеристики <span>{Object.keys(boss.stats).length}</span></summary>
          {Object.entries(boss.stats).map(([k,v]) => <div className="rb-stat" key={k}><span>{k}</span><b>{v.toLocaleString('ru-RU')}</b></div>)}
        </details>
        <div className="rb-map-drop">
          <button type="button" className="rb-map-drop-heading" onClick={()=>setDropExpanded(x=>!x)} aria-expanded={dropExpanded}>
            Возможный дроп <span>{bossDrops.length} {dropExpanded ? '⌄' : '›'}</span>
          </button>
          {dropExpanded && <>
            <div className="rb-map-drop-controls">
              <select aria-label="Сервер дропа" value={dropServer} onChange={e=>setDropServer(e.target.value as 'gamma'|'bwc')}>
                <option value="gamma">Gamma</option><option value="bwc">Black / White / Carmine</option>
              </select>
              <input aria-label="Поиск предмета" placeholder="Поиск дропа" value={dropQuery} onChange={e=>setDropQuery(e.target.value)}/>
            </div>
            {dropsError && <p className="rb-map-drop-note">Дроп ещё не загружен: файл raid-boss-drops.json отсутствует.</p>}
            {!dropsError && !drops && <p className="rb-map-drop-note">Загрузка дропа…</p>}
            {drops && shownDrops.length===0 && <p className="rb-map-drop-note">Предметы не найдены.</p>}
            <div className="rb-map-drop-items">{shownDrops.map((d,i)=><div className="rb-map-drop-row" key={`${d.id}-${d.groupChance}-${i}`}>
              {d.icon ? <img src={`https://masterwork.wiki${d.icon}`} loading="lazy" alt="" /> : <span className="rb-map-drop-placeholder">◇</span>}
              <div><a href={`https://masterwork.wiki/lu4-gamma/item/${d.id}`} target="_blank" rel="noreferrer">{d.name}</a><small>Кол-во: {d.quantity} · Шанс: {d.chance===null?'—':`${d.chance}%`}</small>
              {d.groupChance!==null&&<small>Шанс группы: {d.groupChance}%</small>}</div>
            </div>)}</div>
          </>}
        </div>
        <a className="rb-map-source" href={boss.sourceUrl} target="_blank" rel="noopener noreferrer">Открыть на LU4 Wiki ↗</a>
      </> : <p>Выберите босса</p>}</aside>
    </div>
  </section>;
}
