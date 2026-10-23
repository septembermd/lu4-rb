import { BossWorldMap } from "./BossWorldMap.tsx";
import { ScoutPanel } from "./ScoutPanel.tsx";
import { useEffect, useRef, useState } from "react";
import type { Boss, Kill } from "./domain/model.ts";
import { respawnWindow } from "./domain/rules.ts";
type Clan = { id: string; name: string; capabilities: string[] };
type ApiKill = {
  id: string;
  clan_id: string;
  server_id: string;
  boss_id: number;
  killed_at: string;
  recorded_at: string;
  author_id: string;
  version: number;
  voided_at: string | null;
};
type ApiBoss = {
  id: number;
  name: string;
  level: number;
  location: string;
  source_url: string;
  verified_at: string;
  min_minutes: number | null;
  max_minutes: number | null;
  spawns: Boss["spawns"];
  drops: Boss["drops"];
};
type ApiObservation = {
  id: string;
  boss_id: number;
  observed_at: string;
  result: "alive" | "not_found" | "failed";
  owner_clan_id: string | null;
};
const fmt = (value: string | number) => new Date(value).toLocaleString("ru-RU");
const inputTime = (value = Date.now()) =>
  new Date(value - new Date(value).getTimezoneOffset() * 60_000)
    .toISOString()
    .slice(0, 16);
export function LiveWorkspace({ onExit }: { onExit: () => void }) {
  const [entry, setEntry] = useState(""),
    [token, setToken] = useState(""),
    [clans, setClans] = useState<Clan[]>([]),
    [clanId, setClanId] = useState("");
  const [bosses, setBosses] = useState<ApiBoss[]>([]),
    [kills, setKills] = useState<ApiKill[]>([]),
    [observations, setObservations] = useState<ApiObservation[]>([]);
  const [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [revision, setRevision] = useState(0);
  const generation = useRef(0);
  const selectedClan = clans.find((c) => c.id === clanId);
  const canRecord = selectedClan?.capabilities.includes("record_kill");
  const mapObservations = Object.fromEntries(bosses.flatMap(b => {
    const recent = observations.find(o=>o.boss_id===b.id && o.result!=='failed' && Date.now()-Date.parse(o.observed_at)<900_000);
    return recent ? [[b.id,{result:recent.result as 'alive'|'not_found',observedAt:recent.observed_at,source:recent.owner_clan_id?'Бот клана':'Разведка сервиса'}]] : [];
  }));
  const mapWindows = Object.fromEntries(bosses.flatMap(b => {
    const event = kills.find(k=>k.boss_id===b.id&&!k.voided_at);
    const domainBoss: Boss = {id:b.id,name:b.name,level:b.level,location:b.location,respawnMinMinutes:b.min_minutes,respawnMaxMinutes:b.max_minutes,spawns:b.spawns,drops:b.drops,sourceUrl:b.source_url,verifiedAt:b.verified_at};
    const domainKill: Kill | undefined = event ? {id:event.id,clanId:event.clan_id,serverId:event.server_id,bossId:event.boss_id,killedAt:event.killed_at,recordedAt:event.recorded_at,authorId:event.author_id,version:event.version} : undefined;
    const window = respawnWindow(domainBoss,domainKill,Date.now());
    return window ? [[b.id,{start:window.start,end:window.end,lastKill:event?.killed_at??null}]] : [];
  }));
  async function request<T>(
    path: string,
    credential: string,
    options: RequestInit = {},
    signal?: AbortSignal,
  ): Promise<T> {
    const response = await fetch(path, {
      ...options,
      signal,
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${credential}`,
      },
    });
    if (!response.ok)
      throw Error(
        response.status === 401
          ? "Сессия истекла или ключ недействителен."
          : response.status === 403
            ? "Доступ к клану или подписка недействительны."
            : response.status === 409
              ? "Запись уже изменена. Обновите данные."
              : `Не удалось выполнить запрос (${response.status}).`,
      );
    return response.json() as Promise<T>;
  }
  async function login(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      const result = await request<{ clans: Clan[] }>("/api/me", entry);
      setClans(result.clans);
      setClanId(result.clans[0]?.id ?? "");
      setToken(entry);
      setEntry("");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  useEffect(() => {
    generation.current++;
    const current = generation.current;
    setBosses([]);
    setKills([]);
    setObservations([]);
    if (!token || !clanId) return;
    const abort = new AbortController();
    setBusy(true);
    setError("");
    const base = `/api/clans/${clanId}`;
    Promise.all([
      request<{ items: ApiBoss[] }>(`${base}/catalog`, token, {}, abort.signal),
      request<{ items: ApiKill[] }>(`${base}/kills`, token, {}, abort.signal),
      request<{ items: ApiObservation[] }>(
        `${base}/observations`,
        token,
        {},
        abort.signal,
      ),
    ])
      .then(([catalog, history, intel]) => {
        if (current !== generation.current) return;
        setBosses(catalog.items);
        setKills(history.items);
        setObservations(intel.items);
      })
      .catch((e) => {
        if (!abort.signal.aborted) setError(e.message);
      })
      .finally(() => {
        if (current === generation.current) setBusy(false);
      });
    return () => {
      abort.abort();
      generation.current++;
    };
  }, [token, clanId, revision]);
  async function mutate(path: string, method: string, payload: unknown) {
    setBusy(true);
    setError("");
    try {
      await request(path, token, { method, body: JSON.stringify(payload) });
      setRevision((n) => n + 1);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  const base = `/api/clans/${clanId}/kills`;
  return (
    <div className="live-workspace">
      <header>
        <div>
          <span className="eyebrow">LU4 RB · GAMMA</span>
          <h1>Разведка клана</h1>
        </div>
        <button className="button" onClick={onExit}>
          Выйти из подключения
        </button>
      </header>
      {token && (
        <details>
          <summary>Аккаунты и персонажи разведки</summary>
          <ScoutPanel token={token} />
        </details>
      )}
      <div className="notice">
        Ранний доступ: вход по временному ключу оператора. Ключ хранится только
        в памяти вкладки. Карта Gamma загружается из каталога LU4. Расписание респауна рассчитывается только для боссов с известными правилами.
      </div>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {!token ? (
        <form className="content-panel" onSubmit={login}>
          <h2>Подключение к рабочему пространству</h2>
          <label>
            Временный ключ доступа
            <input
              className="credential-input"
              type="password"
              autoComplete="off"
              required
              value={entry}
              onChange={(e) => setEntry(e.target.value)}
            />
          </label>
          <button className="button primary" disabled={busy}>
            {busy ? "Подключение…" : "Войти"}
          </button>
        </form>
      ) : (
        <>
          <section className="toolbar">
            <label>
              Клан
              <select
                disabled={busy}
                value={clanId}
                onChange={(e) => setClanId(e.target.value)}
              >
                {clans.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </label>
            <button
              className="button"
              disabled={busy || !clanId}
              onClick={() => setRevision((n) => n + 1)}
            >
              Обновить
            </button>
            <span className="muted">
              {busy ? "Загрузка…" : "Данные обновляются по запросу"}
            </span>
          </section>
          {!clans.length ? (
            <div className="content-panel">
              Нет доступных кланов с активной подпиской.
            </div>
          ) : (
            <>
              <BossWorldMap connected
                lastKills={Object.fromEntries(kills.filter(k => !k.voided_at).map(k => [k.boss_id, k.killed_at]))}
                observations={mapObservations}
                windows={mapWindows}
                onRecordKill={canRecord ? async (bossId, killedAt) => {
                  await request(`/api/clans/${clanId}/kills`,token,{method:'POST',body:JSON.stringify({bossId,serverId:'gamma',killedAt})});
                  setRevision(v=>v+1);
                } : undefined}
              />
              <section className="content-panel">
                <h2>История ручных отметок</h2>
                <p className="muted">
                  Показаны последние 200 записей. Исправления и отмены
                  сохраняются в аудите.
                </p>
                <div className="history">
                  {kills.map((k) => (
                    <KillRow
                      key={`${k.id}:${k.version}`}
                      kill={k}
                      name={
                        bosses.find((b) => b.id === k.boss_id)?.name ??
                        `РБ #${k.boss_id}`
                      }
                      writable={Boolean(canRecord) && !busy}
                      save={(value) =>
                        mutate(`${base}/${k.id}`, "PATCH", {
                          expectedVersion: k.version,
                          killedAt: value,
                        })
                      }
                      cancel={() =>
                        mutate(`${base}/${k.id}`, "DELETE", {
                          expectedVersion: k.version,
                        })
                      }
                    />
                  ))}
                </div>
              </section>
            </>
          )}
        </>
      )}
    </div>
  );
}
function KillRow({
  kill,
  name,
  writable,
  save,
  cancel,
}: {
  kill: ApiKill;
  name: string;
  writable: boolean;
  save: (date: string) => Promise<void>;
  cancel: () => Promise<void>;
}) {
  const [editing, setEditing] = useState(false),
    [date, setDate] = useState(inputTime(Date.parse(kill.killed_at))),
    [confirm, setConfirm] = useState(false);
  return (
    <div>
      <b>{name}</b>
      <span>{fmt(kill.killed_at)}</span>
      <small>{kill.voided_at ? "Отменена" : `Версия ${kill.version}`}</small>
      {writable && !kill.voided_at && (
        <>
          <button className="button" onClick={() => setEditing(!editing)}>
            Исправить
          </button>
          <button className="button" onClick={() => setConfirm(!confirm)}>
            Отменить отметку
          </button>
          {confirm && (
            <button className="button" onClick={() => void cancel()}>
              Подтвердить отмену
            </button>
          )}
          {editing && (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                void save(new Date(date).toISOString());
              }}
            >
              <input
                required
                type="datetime-local"
                max={inputTime()}
                value={date}
                onChange={(e) => setDate(e.target.value)}
              />
              <button className="button">Сохранить</button>
            </form>
          )}
        </>
      )}
    </div>
  );
}
