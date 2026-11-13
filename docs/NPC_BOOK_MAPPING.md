# NPC book reference and identity design

Updated: 2026-10-22. This is planning memory for ClockWork City. It does not authorize adding book characters to the game or changing the existing population database.

## Source review

Source: `local NPC reference PDF`, *The Game Master's Book of Non-Player Characters* (Jeff Ashworth, 2021), 274 PDF pages. I inspected the page sequence, the introduction and usage explanation, examples of full profiles and random tables, the random-character lookup, and the legal section. PDF page numbers are one greater than the printed page numbers for the body (for example, printed page 49 is PDF page 50).

The cover and back cover advertise **500+ unique characters**, but the book does **not** give each character a printed unique ID or a machine-readable list of exactly 500 records. Do not assert an audited count of 500 from this PDF. Its structure is:

| Material | Printed pages | PDF pages | Data role |
| --- | --- | --- | --- |
| Three one-shot adventures | 10-47 | 11-48 | Story appearances; may reuse characters described later |
| Big City Denizens | 48-103 | 49-104 | Full profiles, then six random-table pages (printed 98-103) |
| Small Town Tenants | 104-153 | 105-154 | Full profiles, then six random-table pages (printed 148-153) |
| Outskirts & Outposts | 154-205 | 155-206 | Full profiles, then six random-table pages (printed 200-205) |
| Underdwellers | 206-261 | 207-262 | Full profiles, then six random-table pages (printed 256-261) |
| Side-quest and character selectors | 262-267 | 263-268 | Generators that reference existing NPCs, not additional canonical people |
| Legal and publication pages | 268-270 | 269-271 | Rights and provenance |

The four environments each divide profiles into Common Folk, Nobles & Leaders, Lawkeepers & Lawbreakers, and Oddballs & Outsiders. A full profile normally has a name and optional nickname, short phrase, appearance and introduction, backstory, wants/needs, a secret/obstacle, belongings, and sometimes an observation cue, special ability, item, or stat block. These are tabletop story hooks, not daily schedules, homes, routes, or persistent simulation state. The random-table pages use 1d20 rows with separate name, description, motivation, obstacle, and carried-item columns; mixing column rolls can produce many variants. A row or combination must not be mistaken for a pre-existing, separately identified person. The random character selector on printed page 267 points back to these spreads.

The legal page identifies proper names, characters, dialogue, stories, descriptions, and artwork as Product Identity and limits Open Content to rules/game mechanics and stated monster material. The source file can guide private analysis. Do not copy its character text or artwork into public assets, source control, an API payload, or a shipped NPC catalog without a separate rights decision. For a public Nju Jork game, author original city-appropriate character material.

## Existing implementation in this repository

`server/population/migrations/001_initial.sql` defines `npc.id INTEGER PRIMARY KEY`, so the SQLite database enforces a unique, positive numeric identity. `server/population/seed.mjs` assigns IDs sequentially from 1 to the target count; it checks that the existing maximum ID equals the row count before resuming and refuses different seed or version settings. The seed is deterministic (`synthetic-v1`) and is unrelated to this book. `data/population.sqlite` currently has **1,000,000** NPC rows, **333,334** household rows, and no `npc_state` or `npc_event` rows (checked 2026-10-22). The numeric IDs are already occupied; never renumber them to fit a 500-entry source.

`household` links NPCs to home anchors. `npc_assignment` stores work/school anchors, `npc_state` stores the latest meaningful state, and `npc_event` stores significant history. `PopulationDatabase.getNpc(id)` joins identity, household, assignments, and state. `listNpcByHomeArea` is a home-zone query, not a live-position query. The Nju Jork renderer still has no connected population simulation. The `AISystem` in the portfolio game drives hovering sentinels and is unrelated to these city residents.

## ID design for a future source catalog

Keep **source identity** separate from **world identity**:

- `source_ref_id`: immutable namespaced key for one editorial entry, such as `gmbnpc-2021:big-city:profile:printed-049:slot-01` or `gmbnpc-2021:underdwellers:table:printed-256:row-01`. These examples identify positions, not imported book text. Edition, section, kind, printed page, and slot/row are explicit. Store `pdf_page` separately for quick lookup. Freeze assigned keys in a manifest; if a corrected edition reflows pages, add new locators/aliases instead of changing keys.
- `npc.id`: the existing integer primary key for one persistent inhabitant or visitor. An NPC may have zero or one source reference; many original/adapted NPC instances could use one template, but each world person gets a distinct `npc.id`. For book-inspired characters shipped publicly, keep the authored record independent and clear any rights issue first.
- `appearance_id` or `instance_id`: short-lived renderer/entity handle. A visible mesh may be destroyed and recreated when a tile unloads. It always carries `npc.id` and never becomes the persistent identity.

Treat a full profile as one source entry even if it continues across pages. An adventure appearance of that same character is a second **occurrence**, not another source character. For random tables, each row is a source template. A combination is a generated **variant** identified by `table_id + roll tuple + generator_version`; it receives an `npc.id` only when instantiated as a persistent city person. Do not derive an ID from a name: names can repeat, change, have aliases, or be transcribed differently.

Proposed future relational shape (design only):

```text
source_catalog(source_ref_id PK, edition, section, kind, printed_page,
               pdf_page, slot_or_row, review_status, source_hash)
source_occurrence(source_ref_id FK, printed_page, context)
npc_source(npc_id PK/FK -> npc.id, source_ref_id FK, adaptation_version)
```

Keep copyrighted prose and illustrations out of these fields. `review_status` should distinguish a private reference from approved original/licensed game content. A private extraction manifest, if ever needed, belongs outside `public/` and outside Git unless rights allow committing it.

## Integration sequence when NPC implementation is requested

1. Decide whether to use this book only as private creative reference or obtain permission for specific content. Create an original Nju Jork character schema for public use.
2. Build and manually verify a source-entry manifest if exact book entry IDs are needed. Count full profiles and 1d20 rows separately; reconcile continuations, adventure repeats, and generator variants. Do not treat the marketing "500+" as the database row count.
3. Add a migration for optional source lineage, preserving every current `npc.id` and the seeded million rows. Never overwrite seed identities or mix book IDs into map anchor IDs.
4. Add city-specific fields or linked tables for personality, goals, relationships, dialogue state, and story hooks. Keep home, household, schedule, assignments, world state, and events in the current persistence model. A story hook should be a goal or event trigger, not a fixed weekly routine.
5. Connect a small selectable near-camera group to the database through a server API and a simulation service; use `npc.id` for selection, state writes, events, and reload. Keep visual entities disposable. Population and movement remain separate from rendering.
6. Test uniqueness, source-to-instance mapping, repeated appearances, restart persistence, and the absence of copyrighted book content in the public build.

The book's fantasy roles and 5th Edition mechanics do not imply real New York occupations, demographics, building uses, or schedules. Use the existing city research and verified map anchors for those decisions.
