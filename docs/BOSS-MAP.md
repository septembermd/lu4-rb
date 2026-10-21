# LU4 RB boss map integration

The map data is in `public/data/raid-bosses.json` (158 NPCs, 158 map markers).
Map marker percentages refer to the original 3004 x 3004 LU4 Wiki map.
The repository intentionally stores **map** coordinates separately from in-game XYZ.

## Required image
Copy the user-provided LU4 JPG from the integration archive to:
`public/maps/lu4-world.jpg`.
Do not resize/crop the image non-proportionally. The source JPG in the integration
archive is 2048 x 2048 with the same extent as the 3004 x 3004 Wiki map.

Until the local asset is uploaded, the frontend attempts the Wiki asset as fallback.
This may be blocked by the site's anti-DDoS protection and is not production-ready.

## Validation and DB import
```sh
npm ci
npm test
npm run build
npm run migrate
node --env-file-if-exists=.env scripts/import-map-catalog.mjs
```
Migration/import require MIGRATION_DATABASE_URL with appropriate privileges.
Existing `scout_characters.boss_id` already stores the configured boss per character.
The map migration does not modify that relation.

The catalog API returns `map_points` to authenticated clan sessions.
Do not treat map position as the character's expected in-game XYZ.
