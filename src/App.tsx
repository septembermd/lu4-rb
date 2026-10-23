import { BossWorldMap } from "./BossWorldMap.tsx";
import { useEffect, useState } from "react";
import { LiveWorkspace } from "./LiveWorkspace.tsx";
import {
  demoBosses,
  demoMember,
  demoObservations,
  demoRights,
} from "./data/demo.ts";
import {
  createKill,
  latestObservation,
  respawnWindow,
  visibleObservations,
} from "./domain/rules.ts";
import type { Kill } from "./domain/model.ts";

const time = (value: number | string) =>
  new Date(value).toLocaleString("ru-RU", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
const localInput = (value: number) => {
  const d = new Date(value);
  return new Date(value - d.getTimezoneOffset() * 60_000)
    .toISOString()
    .slice(0, 16);
};
type Page = "map" | "history" | "agents" | "access";

export function App() {
  const [live, setLive] = useState(false);
  const [page, setPage] = useState<Page>("map");
  const [demo, setDemo] = useState(false);
  const [now, setNow] = useState(Date.now());
  const [observations, setObservations] = useState(() =>
    demoObservations(Date.now()),
  );
  const [selected, setSelected] = useState(1);
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState("all");
  const [kills, setKills] = useState<Kill[]>([]);
  const [form, setForm] = useState(false);
  const [killedAt, setKilledAt] = useState(localInput(Date.now()));
  const [error, setError] = useState("");
  const [source, setSource] = useState<"both" | "own" | "service">("both");
  const [zoom, setZoom] = useState(1);
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 10_000);
    return () => clearInterval(timer);
  }, []);
  const rows = visibleObservations(
    demoMember,
    demoRights,
    observations,
    "gamma",
    now,
  ).filter(
    (row) =>
      source === "both" ||
      (source === "own" ? row.ownerClanId !== null : row.ownerClanId === null),
  );
  const bosses = demo ? demoBosses : [];
  const filtered = bosses.filter(
    (boss) =>
      `${boss.name} ${boss.location} ${boss.drops.map((d) => d.name).join(" ")}`
        .toLowerCase()
        .includes(search.toLowerCase()) &&
      (filter === "all" ||
        latestObservation(rows, boss.id, now).confirmed?.result === filter),
  );
  const boss = bosses.find((item) => item.id === selected);
  const kill = boss ? kills.find((item) => item.bossId === boss.id) : undefined;
  const window = boss ? respawnWindow(boss, kill, now) : null;
  const status = boss ? latestObservation(rows, boss.id, now) : null;
  const statusLabel = (id: number) => {
    const s = latestObservation(rows, id, now);
    return s.stale
      ? "Нет свежих данных"
      : s.confirmed?.result === "alive"
        ? "Обнаружен"
        : "Не обнаружен";
  };
  function toggleDemo() {
    setDemo(!demo);
    setKills([]);
    setForm(false);
    setObservations(demoObservations(Date.now()));
  }
  function saveKill(event: React.FormEvent) {
    event.preventDefault();
    if (!boss) return;
    try {
      const record = createKill(
        {
          bossId: boss.id,
          serverId: "gamma",
          killedAt: new Date(killedAt).toISOString(),
        },
        demoMember,
        demoRights,
        Date.now(),
      );
      setKills((previous) => [record, ...previous]);
      setForm(false);
      setError("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Не удалось сохранить");
    }
  }
  return (
    <div className="app">
      <aside className="sidebar">
        <a className="brand" href="#" onClick={() => setPage("map")}>
          <span className="brand-symbol">⌖</span>
          <span>
            LU4 <b>RB</b>
            <small>CLAN INTELLIGENCE</small>
          </span>
        </a>
        <div className="workspace">
          <span className="avatar">RB</span>
          <div>
            {demo ? "Учебный клан" : "Рабочее пространство"}
            <small>
              {demo ? "Локальная демонстрация" : "Подключение ожидается"}
            </small>
          </div>
        </div>
        <nav aria-label="Основное меню">
          {(
            [
              ["map", "Карта боссов", "⌖"],
              ["history", "История убийств", "◷"],
              ["agents", "Разведка", "◈"],
              ["access", "Доступ и подписка", "◇"],
            ] as const
          ).map(([id, label, icon]) => (
            <button
              key={id}
              className={page === id ? "active" : ""}
              onClick={() => { setPage(id); if (live) setLive(false); }}
            >
              <span aria-hidden="true">{icon}</span>
              {label}
            </button>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <div className="connection">
            <i />
            IKAR не подключён
          </div>
          <small>Gamma · LU4 RB</small>
          <span className="version">Основа проекта · v0.1</span>
        </div>
      </aside>
      <main>
        {live ? <LiveWorkspace onExit={() => setLive(false)} /> : <>
        <header>
          <button className="button" onClick={() => setLive(true)}>
            Подключить API
          </button>
          <div>
            <span className="eyebrow">ОПЕРАТИВНАЯ КАРТА · GAMMA</span>
            <h1>
              {page === "map"
                ? "Рейдовые боссы"
                : page === "history"
                  ? "История убийств"
                  : page === "agents"
                    ? "Разведка клана"
                    : "Доступ и подписка"}
            </h1>
          </div>
          <button
            className={demo ? "button primary" : "button"}
            onClick={toggleDemo}
          >
            {demo ? "Выйти из демо" : "Проверить демо"}
          </button>
        </header>
        <div className="notice">
          {demo
            ? "Демонстрация: боссы, координаты, дроп и наблюдения вымышлены. Изменения хранятся только до перезагрузки."
            : "На карте показан справочник LU4. Для рабочих наблюдений и таймеров подключите API."}
        </div>
        {page === "map" && !demo && <BossWorldMap onOpenLive={() => setLive(true)} />}
        {page === "map" && demo && (
          <>
            <section className="stats">
              <div>
                <small>В справочнике</small>
                <strong>
                  {bosses.length}
                  <span>РБ</span>
                </strong>
              </div>
              <div>
                <small>Обнаружены недавно</small>
                <strong className="green">
                  {
                    bosses.filter((b) => statusLabel(b.id) === "Обнаружен")
                      .length
                  }
                  <span>целей</span>
                </strong>
              </div>
              <div>
                <small>Ручные отметки</small>
                <strong>
                  {kills.length}
                  <span>убийств</span>
                </strong>
              </div>
              <div>
                <small>Источники</small>
                <strong>
                  {demo ? 2 : 0}
                  <span>{demo ? "учебных" : "подключено"}</span>
                </strong>
              </div>
            </section>
            <section className="toolbar">
              <label className="search">
                <span aria-hidden="true">⌕</span>
                <input
                  placeholder="Босс, локация или предмет дропа"
                  aria-label="Поиск босса или дропа"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                />
              </label>
              <label>
                Статус
                <select
                  value={filter}
                  onChange={(e) => setFilter(e.target.value)}
                >
                  <option value="all">Все</option>
                  <option value="alive">Обнаружен</option>
                  <option value="not_found">Не обнаружен</option>
                </select>
              </label>
              <label>
                Разведка
                <select
                  value={source}
                  onChange={(e) => setSource(e.target.value as typeof source)}
                >
                  <option value="both">Все источники</option>
                  <option value="own">Боты клана</option>
                  <option value="service">Разведка сервиса</option>
                </select>
              </label>
            </section>
            <div className="operations">
              <section className="boss-list" aria-label="Список боссов">
                <div className="panel-heading">
                  Цели <span>{filtered.length}</span>
                </div>
                {filtered.length === 0 ? (
                  <div className="empty-small">
                    {demo
                      ? "Нет совпадений. Измените поиск или фильтр."
                      : "После импорта здесь появятся боссы Gamma."}
                  </div>
                ) : (
                  filtered.map((b) => (
                    <button
                      key={b.id}
                      className={`boss-row ${selected === b.id ? "selected" : ""}`}
                      onClick={() => {
                        setSelected(b.id);
                        setForm(false);
                      }}
                    >
                      <span className="level">{b.level}</span>
                      <span>
                        <b>{b.name}</b>
                        <small>{b.location}</small>
                        <em
                          className={
                            statusLabel(b.id) === "Обнаружен" ? "green" : ""
                          }
                        >
                          {statusLabel(b.id)}
                        </em>
                      </span>
                    </button>
                  ))
                )}
              </section>
              <section
                className="map"
                aria-label={
                  demo ? "Учебная схема точек" : "Карта ожидает импорта"
                }
              >
                <div className="map-label">
                  {demo ? "УЧЕБНАЯ СХЕМА" : "КАРТА МИРА"}
                  <small>
                    {demo ? "Условные координаты · не карта LU4" : "LU4 Gamma"}
                  </small>
                </div>
                {!demo ? (
                  <div className="map-empty">
                    <span>⌖</span>
                    <h2>Подготовка карты</h2>
                    <p>
                      Нужны изображение мира и проверенные координаты из базы
                      Gamma.
                    </p>
                    <button className="button" onClick={toggleDemo}>
                      Посмотреть работу интерфейса
                    </button>
                  </div>
                ) : (
                  <div className="map-scroll">
                    <div
                      className="map-canvas"
                      style={{
                        width: `${100 * zoom}%`,
                        height: `${100 * zoom}%`,
                      }}
                    >
                      {filtered.map((b) => (
                        <button
                          key={b.id}
                          className={`marker ${selected === b.id ? "chosen" : ""}`}
                          style={{
                            left: `${b.spawns[0].x}%`,
                            top: `${b.spawns[0].y}%`,
                          }}
                          onClick={() => {
                            setSelected(b.id);
                            setForm(false);
                          }}
                          aria-label={`Выбрать ${b.name}`}
                        >
                          <span>{b.level}</span>
                          <small>{b.location}</small>
                        </button>
                      ))}
                    </div>
                  </div>
                )}
                <div className="map-controls">
                  <button
                    aria-label="Увеличить карту"
                    disabled={!demo || zoom >= 2}
                    onClick={() => setZoom((z) => Math.min(2, z + 0.25))}
                  >
                    +
                  </button>
                  <button
                    aria-label="Уменьшить карту"
                    disabled={!demo || zoom <= 1}
                    onClick={() => setZoom((z) => Math.max(1, z - 0.25))}
                  >
                    −
                  </button>
                </div>
                <div className="legend">
                  <i /> Наблюдение и таймер учитываются отдельно
                </div>
              </section>
              <aside className="details">
                {boss ? (
                  <>
                    <span className="eyebrow">
                      УРОВЕНЬ {boss.level} · GAMMA
                    </span>
                    <h2>{boss.name}</h2>
                    <p className="muted">{boss.location}</p>
                    <div className="status-card">
                      <b
                        className={
                          statusLabel(boss.id) === "Обнаружен" ? "green" : ""
                        }
                      >
                        {statusLabel(boss.id)}
                      </b>
                      {status?.confirmed && (
                        <small>
                          {time(status.confirmed.observedAt)} ·{" "}
                          {status.confirmed.ownerClanId
                            ? "Бот клана"
                            : "Разведка сервиса"}
                        </small>
                      )}
                      {status?.latestAttempt?.result === "failed" && (
                        <small>Последняя проверка не удалась</small>
                      )}
                    </div>
                    <h3>Окно респауна</h3>
                    {window ? (
                      <>
                        <strong className="window">
                          {time(window.start)}
                          <br />— {time(window.end)}
                        </strong>
                        <p className="muted">
                          {window.phase === "waiting"
                            ? "Ожидается начало окна"
                            : window.phase === "window"
                              ? "Окно открыто"
                              : "Окно завершилось — нужна проверка"}
                        </p>
                      </>
                    ) : (
                      <p className="muted">
                        {boss.respawnMinMinutes === null
                          ? "Правило респауна ещё не подтверждено."
                          : "Отметьте время убийства, чтобы рассчитать окно."}
                      </p>
                    )}
                    {kill && (
                      <small className="muted">
                        Убийство: {time(kill.killedAt)} · Учебный пользователь
                      </small>
                    )}
                    <button
                      className="button primary full"
                      onClick={() => {
                        setForm(!form);
                        setKilledAt(localInput(Date.now()));
                        setError("");
                      }}
                    >
                      Отметить убийство
                    </button>
                    {form && (
                      <form className="kill-form" onSubmit={saveKill}>
                        <label>
                          Время убийства
                          <input
                            required
                            type="datetime-local"
                            value={killedAt}
                            max={localInput(Date.now())}
                            onChange={(e) => setKilledAt(e.target.value)}
                          />
                        </label>
                        <small>
                          Часовой пояс:{" "}
                          {Intl.DateTimeFormat().resolvedOptions().timeZone}
                        </small>
                        <div className="quick">
                          <button
                            type="button"
                            onClick={() => setKilledAt(localInput(Date.now()))}
                          >
                            Сейчас
                          </button>
                          <button
                            type="button"
                            onClick={() =>
                              setKilledAt(localInput(Date.now() - 300_000))
                            }
                          >
                            5 минут назад
                          </button>
                        </div>
                        {error && (
                          <p role="alert" className="error">
                            {error}
                          </p>
                        )}
                        <button className="button primary full">
                          Сохранить отметку
                        </button>
                      </form>
                    )}
                    <h3>
                      Возможный дроп <span>{boss.drops.length}</span>
                    </h3>
                    {boss.drops.length ? (
                      boss.drops.map((d) => (
                        <div className="drop" key={d.itemId}>
                          <span className="item-icon">◇</span>
                          <div>
                            <b>{d.name}</b>
                            <small>
                              {d.min}–{d.max} шт. ·{" "}
                              {d.chancePercent ?? "неизвестно"}%
                            </small>
                          </div>
                        </div>
                      ))
                    ) : (
                      <p className="muted">Данные о дропе ещё не добавлены.</p>
                    )}
                    <p className="footnote">
                      Данные этой карточки демонстрационные.
                    </p>
                  </>
                ) : (
                  <div className="empty-small">
                    <h2>Выберите босса</h2>
                    <p>Здесь будут наблюдения, таймер и возможный дроп.</p>
                  </div>
                )}
              </aside>
            </div>
          </>
        )}
        {page === "history" && (
          <section className="content-panel">
            <h2>Ручные отметки клана</h2>
            <p className="muted">
              Проверки ботов не создают и не исправляют время убийства.
            </p>
            {kills.length ? (
              <div className="history">
                {kills.map((k) => (
                  <div key={k.id}>
                    <b>{demoBosses.find((b) => b.id === k.bossId)?.name}</b>
                    <span>{time(k.killedAt)}</span>
                    <small>Учебный пользователь · ручная отметка</small>
                  </div>
                ))}
              </div>
            ) : (
              <div className="empty-small">
                Отметок пока нет. В демо выберите босса и укажите время
                убийства.
              </div>
            )}
          </section>
        )}
        {page === "agents" && (
          <section className="content-panel">
            <h2>Два независимых источника</h2>
            <div className="cards">
              <article>
                <span className="eyebrow">ПРИВАТНАЯ РАЗВЕДКА</span>
                <h3>Боты клана</h3>
                <p>
                  Наблюдения доступны только участникам вашего клана. Запускать
                  агент может клан или оператор сервиса.
                </p>
                <span className="pill">Не подключены</span>
              </article>
              <article>
                <span className="eyebrow">ДОПОЛНИТЕЛЬНОЕ ПОКРЫТИЕ</span>
                <h3>Разведка сервиса</h3>
                <p>
                  Данные оператора по выбранным серверам и боссам. Доступ
                  определяется подпиской.
                </p>
                <span className="pill">Подключение на следующем этапе</span>
              </article>
            </div>
            <p className="muted">
              Очередь, привязка агентов и получение наблюдений через API
              находятся в разработке.
            </p>
          </section>
        )}
        {page === "access" && (
          <section className="content-panel">
            <h2>Подписка на клан</h2>
            <p className="muted">
              Тарифы пока проектируются. Оплата и регистрация ещё не подключены.
            </p>
            <div className="cards">
              <article>
                <span className="pill">Основной пакет</span>
                <h3>С разведкой сервиса</h3>
                <p>
                  Карта, ручные таймеры, история и наблюдения ботов оператора.
                </p>
              </article>
              <article>
                <span className="pill">Альтернатива</span>
                <h3>Со своей разведкой</h3>
                <p>
                  Все функции сайта и собственные агенты. Разведку сервиса можно
                  добавить отдельно.
                </p>
              </article>
            </div>
            <h3>Права участников</h3>
            <p className="muted">
              Просмотр · Отметки убийств · Управление агентами · Участники ·
              Подписка
            </p>
            <p>
              История убийств, заметки и наблюдения собственных агентов приватны
              для клана.
            </p>
          </section>
        )}
        </>}
      </main>
    </div>
  );
}
