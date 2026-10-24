import { useEffect, useState } from "react";
type Account = {
  id: string;
  agent_id: string;
  label: string;
  enabled: boolean;
};
type Character = {
  id: string;
  account_id: string;
  name: string;
  slot: number;
  enabled: boolean;
  boss_id: number | null;
  expected_x: number | null;
  expected_y: number | null;
  expected_z: number | null;
  radius: number | null;
};
type Registry = {
  agents: { id: string; name: string }[];
  accounts: Account[];
  characters: Character[];
  settings: {
    agent_id: string;
    running: boolean;
    timer_clan_id: string | null;
  }[];
};
export function ScoutPanel({ token }: { token: string }) {
  const [data, setData] = useState<Registry | null>(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  async function request(path: string, payload?: unknown) {
    const response = await fetch(path, {
      method: payload === undefined ? "GET" : "PATCH",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
      },
      body: payload === undefined ? undefined : JSON.stringify(payload),
    });
    if (!response.ok) throw Error(`Запрос не выполнен (${response.status})`);
    return response.json();
  }
  async function refresh() {
    setData(await request("/api/scouts"));
  }
  useEffect(() => {
    let active = true;
    request("/api/scouts")
      .then((r) => {
        if (active) setData(r);
      })
      .catch((e) => {
        if (active) setError(e.message);
      });
    return () => {
      active = false;
    };
  }, [token]);
  async function save(path: string, value: unknown) {
    setBusy(true);
    setError("");
    try {
      await request(path, value);
      await refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="scout-panel">
      <h2>Управление разведкой</h2>
      <p>
        Здесь показаны только доступные вам агенты. Новые персонажи требуют
        настройки перед запуском.
      </p>
      {error && <p role="alert">{error}</p>}
      {!data ? (
        <p>Загрузка…</p>
      ) : (
        <>
          {!data.agents.length && <p>Нет доступных агентов для управления.</p>}
          {data.agents.map((agent) => {
            const settings = data.settings.find((s) => s.agent_id === agent.id);
            return (
              <section className="scout-fleet" key={agent.id}>
                <h3>{agent.name}</h3>
                <button
                  disabled={busy}
                  onClick={() =>
                    save(`/api/scouts/fleets/${agent.id}`, {
                      running: !settings?.running,
                      timerClanId: settings?.timer_clan_id ?? null,
                    })
                  }
                >
                  {settings?.running
                    ? "Приостановить обход"
                    : "Запустить обход"}
                </button>
                {data.accounts
                  .filter((a) => a.agent_id === agent.id)
                  .map((account) => (
                    <section className="scout-account" key={account.id}>
                      <h4>
                        <label>
                          <input
                            type="checkbox"
                            checked={account.enabled}
                            disabled={busy}
                            onChange={(e) =>
                              save(`/api/scouts/accounts/${account.id}`, {
                                enabled: e.target.checked,
                              })
                            }
                          />
                          {account.label}
                        </label>
                      </h4>
                      {data.characters
                        .filter((c) => c.account_id === account.id)
                        .map((c) => (
                          <form
                            className="scout-character"
                            key={`${c.id}-${JSON.stringify(c)}`}
                            onSubmit={(e) => {
                              e.preventDefault();
                              const f = new FormData(e.currentTarget);
                              save(`/api/scouts/characters/${c.id}`, {
                                enabled: f.has("enabled"),
                                bossId: Number(f.get("bossId")),
                                x: Number(f.get("x")),
                                y: Number(f.get("y")),
                                z: Number(f.get("z")),
                                radius: Number(f.get("radius")),
                              });
                            }}
                          >
                            <strong>
                              {c.name} · слот {c.slot + 1}
                            </strong>
                            <label>
                              Проверять{" "}
                              <input
                                name="enabled"
                                type="checkbox"
                                defaultChecked={c.enabled}
                              />
                            </label>
                            {(
                              [
                                ["bossId", "ID босса", c.boss_id],
                                ["x", "X", c.expected_x],
                                ["y", "Y", c.expected_y],
                                ["z", "Z", c.expected_z],
                                ["radius", "Радиус", c.radius ?? 500],
                              ] as const
                            ).map(([key, label, value]) => (
                              <label key={key}>
                                {label}
                                <input
                                  style={{ width: 100, display: "block" }}
                                  type="number"
                                  step="1"
                                  required
                                  name={key}
                                  defaultValue={value ?? ""}
                                />
                              </label>
                            ))}
                            <button disabled={busy}>Сохранить</button>
                          </form>
                        ))}
                    </section>
                  ))}
              </section>
            );
          })}
        </>
      )}
    </section>
  );
}
