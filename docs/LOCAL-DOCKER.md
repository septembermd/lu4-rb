# LU4 RB — запуск одной командой (локально)

Требуется только установленный и запущенный **Docker Desktop** на Windows 11, Linux или macOS.

Из корня репозитория:

```powershell
docker compose up --build -d
```

Docker автоматически:
1. создаёт PostgreSQL и базу `lu4_rb` (если том ещё пуст);
2. создаёт ограниченную роль `rb_runtime`;
3. выполняет все SQL-миграции `db/*.sql` в порядке имени через `schema_migrations` и импортирует 158 боссов с координатами карты;
4. выдаёт runtime-роли нужные права;
5. запускает API и Vite.

Сайт: http://localhost:5173
API health: http://localhost:3001/health

Контейнер `migrate` должен завершиться с кодом 0, это нормально.
Для логов: `docker compose logs -f migrate api web`.
Для повторного запуска: `docker compose up -d`.
Для остановки: `docker compose down`. База при этом **сохраняется** в Docker volume.
**Не выполняйте** `docker compose down -v`, если хотите сохранить данные.

## Создать временный ключ доступа

В Docker нет готового пользовательского ключа. Для нового клана создайте файл:
```powershell
New-Item -ItemType Directory -Force .credentials | Out-Null
@'
{"kind":"clan","name":"Admin","nickname":"Admin","until":"2027-01-01T00:00:00Z","ownAgents":true}
'@ | Set-Content -Encoding utf8 .credentials/provision-input.json
```

Затем создайте пользователя и ключ локально (это дополнительная однократная команда, чтобы при каждом запуске не появлялся новый пользователь):

```powershell
Get-Content -Raw .credentials/provision-input.json | docker compose run -T --rm provision
Get-Content .credentials/clan.json
```

Возьмите `sessionToken` из `.credentials/clan.json` и введите на странице «Подключить API». Сессия действует до семи дней; файл с существующим ключом не будет перезаписан. Не копируйте sessionToken и agentToken в репозиторий или чат.

## Безопасность

Конфигурация использует **фиксированные пароли только для локальной разработки**. Порт PostgreSQL наружу не опубликован; API и Vite доступны только через `127.0.0.1`. Не использовать этот compose-файл на публичном сервере или в production. Для production нужны отдельные секреты, TLS и ограниченный runtime.
