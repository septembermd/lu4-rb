import { useEffect, useMemo, useState } from 'react';

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
  const [zoom, setZoom] = useState(1);
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
      <span>{filtered.length} / {data?.bosses.length ?? 0} боссов</span>
    </div>
    {error && <p role="alert">Не удалось загрузить карту: {error}</p>}
    <div className="rb-map-layout">
      <div className="rb-map-list">{filtered.map(b => <button className={b.id === selected ? 'chosen' : ''} key={b.id} onClick={() => setSelected(b.id)}><strong>{b.name}</strong><small>Lv. {b.level} · #{b.id}</small></button>)}</div>
      <div className="rb-map-viewport">
        {data && <div className="rb-map-image" style={{ width: `${100 * zoom}%` }}>
          <img src={data.map.image} alt="Карта мира LU4" draggable={false} />
          {filtered.flatMap(b => b.points.map((p, i) => <button key={`${b.id}:${i}`} type="button" title={`${b.name} — Lv. ${b.level}`} aria-label={`${b.name}: точка ${i + 1}`} className={`rb-map-pin ${b.id === selected ? 'selected' : ''}`} style={{ left: `${p.x}%`, top: `${p.y}%` }} onClick={() => setSelected(b.id)}>{b.level}</button>))}
        </div>}
        <div className="rb-map-zoom"><button type="button" onClick={() => setZoom(z => Math.min(z + .25, 3))}>+</button><button type="button" onClick={() => setZoom(z => Math.max(z - .25, 1))}>−</button></div>
      </div>
      <aside className="rb-map-detail">{boss ? <><small>NPC #{boss.id} · Уровень {boss.level}</small><h2>{boss.name}</h2><p>{boss.group}</p><p>Точек появления: {boss.points.length}</p><p>Назначенные персонажи: {assignments[boss.id]?.join(', ') || 'нет'}</p><a href={boss.sourceUrl} target="_blank" rel="noopener noreferrer">Открыть на LU4 Wiki ↗</a><h3>Характеристики</h3>{Object.entries(boss.stats).map(([k,v]) => <div className="rb-stat" key={k}><span>{k}</span><b>{v.toLocaleString('ru-RU')}</b></div>)}</> : <p>Выберите босса</p>}</aside>
    </div>
  </section>;
}
