# 100,000 NPC data map

Updated 2026-11-16. Scope: the **current 3D map in partial Manhattan**, not all five New York City boroughs. The 100,000 NPCs are fictional simulation identities. Public data describes tax lots and places; it does not identify where any real New Yorker lives or works.

## Public source layers

| Source | Fields used | Role and limit |
| --- | --- | --- |
| [NYC PLUTO](https://data.cityofnewyork.us/d/64uk-42ks), version 26v2 | BBL, address, residential units, residential/office/retail area, coordinates | Tax-lot use evidence. Residential/office/retail statistics are applied to a 3D building only when its street address also matches. A tax lot may contain multiple buildings. |
| [NYC DOHMH Restaurant Inspection Results](https://data.cityofnewyork.us/d/43nn-pn8j) | CAMIS, business name, address, cuisine, coordinates, BBL | Cafe and restaurant points. Inspections may lag openings, closures, and name changes. A point or lot is matched to an existing 3D building approximately. |
| [OpenStreetMap](https://www.openstreetmap.org/copyright) | Building, amenity, shop, office, and name tags | Residential/office tags and other mapped places. Tag coverage and names vary. |

`scripts/fetch-nyc-place-sources.mjs` downloads and caches these public datasets in `.cache/nyc-place-sources/`. `scripts/build-nyc-place-catalog.mjs` matches them to the existing 4,026 3D building anchors and writes `public/assets/nju-jork/place-catalog.json`. The catalog includes source IDs, match method, match distance where available, fetch timestamps, building uses, and source links. Its current counts are **1,427 residential building candidates**, **1,194 office building candidates**, and **11,315 mapped POIs**. POIs may share buildings; counts do not imply unique buildings or verified current businesses.

| Mapped POI category | Count |
| --- | ---: |
| Cafe | 1,276 |
| Restaurant | 6,525 |
| Grocery | 229 |
| Retail | 1,941 |
| Office | 762 |
| School | 236 |
| Clinic | 241 |
| Library | 39 |
| Community | 66 |

The city view has a **MAP PLACES** picker for these categories plus residential and office buildings. Markers show source and approximate match information. The map renders nearby markers to avoid covering the whole city with 11,315 labels. The catalog retains every matched record for search and future map views.

`public/assets/nju-jork/npc-place-occupancy.json` publishes **aggregate fictional NPC counts per building** for the live map: 100,000 cohort members in 39,827 households, including 61,963 workers and 15,596 students. Home and office markers and cards show these simulation counts. The file contains no individual NPC records.

## NPC home, work, and visit assignments

The local SQLite cohort key is `nju-jork-100k-v1`. `scripts/apply-nyc-place-catalog.mjs` maps **39,827 cohort households** to residential candidates while keeping cohort household members together. It assigns workers and students to mapped office, retail, grocery, restaurant, cafe, clinic, library, community, or school places based on their synthetic occupation. Regular cafe, grocery, and leisure locations are remapped to public-source places. Assignment distances and capacities are simulation estimates; they are not observed occupancy, employment, or commuting data.

`sim_household_home` stores the simulation home override so the other 900,000 NPCs in the underlying population are not moved when a household contains both cohort and noncohort members. `npc_assignment` is updated for the 100,000 cohort members' synthetic work or school placement. `map_building_use` stores building classification evidence, and `sim_place_source` stores the source for each active place. Old synthetic places stay in SQLite for foreign-key and history safety but are inactive in the read API. The current database has **14,065 active places**: 1,427 homes, 1,956 offices (building and POI entries), 11,315 POIs in all categories, plus 24 park and 105 station access points. All 100,000 members' home, work, cafe, errand, and leisure references point to active non-synthetic places when applicable.

The 3D building anchor is an approximate spatial match. The real data supports **possible building uses and place names**, while the fictional NPC home, employer, and visit choices remain generated. No record claims that a real person lives or works at a given address. A building with a name may be excluded from home or office candidacy if lot and building addresses do not agree; this conservative rule leaves some true uses unmapped.

## Weekly simulation

`npc.id` is the durable numeric identity. The cohort selects 100,000 existing mapped identities from the million-person SQLite population without renumbering them. `sim_member` stores life stage, synthetic occupation, shift pattern, interests, regular places, commute estimate, profile seed, and plan seed. `sim_relationship` keeps family and friend edges; neighbor and coworker edges were rebuilt after the place remap. There are 83,288 family, 98,573 neighbor, 68,175 coworker, and 50,000 friend edges.

Weeks start Monday in `America/New_York`. The weeks of 2026-11-09 and 2026-11-16 each have 100,000 plan headers and 49,510 planned shared cafe meetings. Both weeks passed `auditWeeklyPopulation`: assignment consistency, staff and meeting capacities, schedule conflicts, sample seven-day timelines, SQLite integrity, and foreign keys. There are no recorded interactions or completed meetings in this local database as of this update. New weekly interactions are stored in `sim_interaction` and linked to participants.

## Commands and read API

From the repository root:

```powershell
node scripts/fetch-manhattan-osm.mjs
node scripts/fetch-nyc-place-sources.mjs
node scripts/build-nyc-place-catalog.mjs
npm run population:backup
node scripts/apply-nyc-place-catalog.mjs
node scripts/export-npc-place-occupancy.mjs
npm run population:week:check -- --week=2026-11-09 --samples=500
npm run population:week:check -- --week=2026-11-16 --samples=500
```

Source fetches use the local cache unless `--refresh` is supplied. Applying the same catalog hash twice is a no-op. A changed catalog requires a reviewed remap from a backup because existing schedules or interactions may depend on old places. The SQLite file and public-source cache are local and Git ignored; the JSON catalog is the static map asset.

The Vite development server exposes bounded read endpoints:

| Endpoint | Result |
| --- | --- |
| `/api/npc-week/summary` | Cohort, active place counts, relation counts, weeks |
| `/api/npc-week/places?kind=cafe&limit=100&after=...` | Paged active place coordinates, provenance, source ID, and match method |
| `/api/npc-week/npc/:id` | Profile, current/next episode, and place or in-transit destination |
| `/api/npc-week/npc/:id/week?start=2026-11-16` | Seven-day timeline |
| `/api/npc-week/npc/:id/relationships` | Relationship edges |

The development API reads the local SQLite database. The deployed static site does not publish that database or expose this API.

## Browser-hosted 100,000 NPC simulation

`npm run population:browser:export` creates the static browser dataset in `public/assets/nju-jork/npc-data/` from the mapped SQLite cohort. The exporter checks that the local place assignments match the published place catalog. The output contains 100,000 synthetic NPC profiles, their assigned home/work/visit places, 99,020 planned meetings across the two seeded weeks, and 300,036 relationship edges. It is split into **33 spatial shards** by home location, plus place and relationship files. `manifest.json` records counts, SHA-256 checksums, and a dataset ID for cache invalidation. The local SQLite database stays private.

The current output is **94.85 MB of JSON** (90.45 MiB) or **11.1 MB with gzip** (10.59 MiB). Those are data sizes, excluding the existing 3D model and other site assets. Actual network transfer depends on the host's compression and browser cache. The first area near the camera loads before the rest; the loading scene then closes while the remaining shards download in the background. A progress bar and the NPC panel show how many profiles have loaded. The browser stores verified files in IndexedDB for later visits, keeping only three nearby shards decoded in worker memory.

The browser Web Worker uses the same deterministic weekly plan generator as the SQLite development API. It generates an NPC's current activity and seven-day plan when needed, using the visitor's selected Time Manager source, so the site does not download expanded tasks for all 100,000 people. **My local time** is the default: the visitor's local calendar date and clock time are applied to New York's daily schedule. A visitor in India at 8 AM therefore sees 8 AM NPC activity, even when it is evening in the real New York. **Real New York time** uses the actual instant and its New York date and clock time. Internet sync can supply that actual instant; the Time Manager can also preview the next Monday morning at 20× speed. The **NPCs** panel shows people near the camera and lets visitors inspect their assigned home, workplace or school, regular cafe, errand, and leisure place, plus their current task, next task, and today's schedule.

Up to 12 nearby NPC figures use the supplied `100-people.fbx` variants and animations. Their stable appearance seeds select variants, with Jose Campbell retaining his proof variant. Figures stand about 0.5 world blocks (1.5 m) tall. They walk or run along approximate routes on the mapped road graph between scheduled places. Work and home commutes fill their scheduled commute windows; other changes of place get a short travel window at the start of the activity. Selecting an NPC card or visible character follows that person with the camera and marks them with a gold ring; panning or changing view ends camera follow. The selected person's assignments and schedule remain available when the panel is reopened. The Worker computes nearby daily state from the active spatial shards and keeps the rest of the 100,000 cohort in downloaded, verified static data. The browser renders at most 12 bodies near the camera, rather than 100,000 bodies at once. Population progress and plans are independent for each visitor's computer; there is no shared world state or server-side persistence.
