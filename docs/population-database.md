# Population database

The local SQLite database stores one million stable synthetic NPC identities. It is a persistence layer only: no ECS loop, browser API, camera query, pathfinding, or visual NPC is connected yet. The existing `TimeManager` in `src/worlds/TimeManager.ts` remains the user-facing PC/internet clock. Database methods accept `worldTimeMs` from a caller; the database does not create a second simulation clock. The seeded database's clock is `null` until that integration supplies a value.

## Location and commands

The default file is `data/population.sqlite`, outside `public/` and ignored by Git. Node 24.21.0's built-in `node:sqlite` is used, so there is no database service or extra package. Run commands from the project root:

- `npm run population:seed:pilot` creates or resumes the 10,000-person pilot.
- `npm run population:seed` extends the same database to 1,000,000 people. Repeating it is safe if seed, map hash, and generator version are unchanged.
- `npm run population:status` prints schema, count, versions, and saved clock.
- `npm run population:check` runs SQLite integrity and foreign-key checks.
- `npm run population:benchmark` measures indexed ID and **home-area** reads.
- `npm run population:backup` makes a timestamped online backup under `data/backups/` and checks its integrity and population count. It refuses to overwrite an existing backup. `node scripts/population-db.mjs backup --to=path` chooses a different destination.
- `node scripts/population-db.mjs check --db=backup-path` independently verifies a backup.
- `node scripts/benchmark-population-writes.mjs data/pilot-100k.sqlite 10000` measures committed writes on a **disposable** seeded database; this command adds checkpoint and event rows.

The CLI also accepts `--db=path`. Seed accepts `--map=path`, `--count=number`, `--seed=number`, `--mapped-limit=number`, and `--batch-size=number`. Existing identities cannot be silently regenerated with different settings. Map changes after seeding require an explicit migration because building and road IDs could move.

## Schema and contract

Numbered SQL files in `server/population/migrations/` are applied transactionally through SQLite `user_version`; the current schema is version 3. A newer database version is refused. Foreign keys are enabled on connection; WAL and a bounded lock wait are configured for the local single-host database. SQL triggers keep NPC home-zone indexes aligned with household moves and reject road IDs used as homes or work sites.

- `population_meta`: seed, map hash/version, generator/source version, generated count, optional persisted world clock.
- `map_anchor`: current building, road-node, road, and explicit off-map IDs imported from `road-network.json`.
- `household`: stable ID and home anchor.
- `npc`: stable numeric ID, household, synthetic name, birth year, role, routine code, appearance seed, version, and indexed home zone.
- `npc_assignment`: synthetic or verified work/school anchor and schedule code.
- `npc_state`: latest meaningful checkpoint, supplied world time, activity, destination/road references, travel time range, and compact status object.
- `npc_event`: significant event history, supplied world time, compact payload, and optional idempotency key.

`getNpc(id)` returns identity, home, assignments, and checkpoint. `listNpcByHomeArea(zoneId, { afterId, limit })` pages by **home zone**, not current camera position; the future ECS must provide current-position queries. `moveHousehold`, `setAssignment`, `saveCheckpoint`, `appendEvent`, `saveWorldTime`, `listEvents`, and `transaction` provide the database write contract. Group a related clock/checkpoint/event change in one transaction. Older checkpoints do not overwrite newer ones. Significant events are retained until an explicit archive/retention process is designed; there is no silent deletion.

## Synthetic data limits

The current seed is deterministic sample data, **not** a Census-derived New York population. Names, age/role distribution, and work schedules are placeholders tagged `synthetic-placeholder-v1`. The map lists 4,026 buildings but does not classify their uses. Therefore mapped home/work locations are provisional and assignments have `provenance=synthetic`; school destinations are off-map. The generator maps the first 120,000 people to model buildings and marks 880,000 explicitly `OFFMAP:NYC`. This avoids pretending that the unclassified partial map has verified capacity for all one million. Stable IDs allow later data and placement migrations without changing identity.

## Measured baseline on this machine

| Count | Main DB file | ID read p95 (200 samples) | Home-area page of 100 p95 |
| ---: | ---: | ---: | ---: |
| 10,000 | 3.9 MB | 0.69 ms | 0.34 ms |
| 100,000 | 22.1 MB | 0.15 ms | 0.16 ms |
| 1,000,000 | 213.9 MB | 0.25 ms | 0.31 ms |

These are local warm-cache measurements, not service-level guarantees. The 10,000-person ID figure was measured before later warm-up and index changes; rerun the benchmark for direct comparison. The 100,000-person database committed 10,000 checkpoints plus 10,000 events in 0.61 seconds in 1,000-person transactions. The one-million import from the 10,000 pilot completed in about 13 seconds. A full online backup completed in under one second. SQLite integrity and foreign-key checks passed on both the original and restored files.

In a later read benchmark, the Node process used about 39 MiB RSS with the 100,000-person file and 45 MiB RSS with the one-million-person file. This measures the database command process, not a future ECS simulation or browser scene. The 100,000-person file grew after the write benchmark; the table above reports its size before those extra records.

## Recovery

The backup is itself a valid SQLite database. To restore, stop any process writing the target database, preserve the damaged target separately, copy a verified backup to a **new** database path, run `check --db=that-path`, and point the application at that path. Do not copy only the main file from a live WAL database. Backups under `data/backups/` are ignored by Git. The manual backup command now creates a distinct verified snapshot every time. A schedule and retention policy are still needed before this is treated as a durable production save.
