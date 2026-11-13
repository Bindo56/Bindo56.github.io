# Live posts API

Collects public social posts from the **last hour** around a location and serves them from the Vite
dev server (`npm run dev`) and `vite preview`. There is no API on the GitHub Pages build.

Keys go in `.env.local` (see `.env.example`). Sources without keys stay off; Bluesky and Mastodon need none.

## Endpoints

### `GET /api/live-posts`

| Param | Default | Meaning |
|---|---|---|
| `lat`, `lon` | 40.7128, -74.006 | Area center |
| `radius` | `25km` | `300m`, `2km`, `1mi`… (10 m – 1000 km) |
| `q` | NYC terms | Comma-separated keywords for posts without coordinates, e.g. `Empire State Building,ESB` |
| `name` | first `q` term | Place name used to look up Instagram location IDs |
| `ig` | — | Instagram location IDs, comma-separated (skips the name lookup) |
| `minutes` | 60 | Look-back, up to the window |
| `sources` | all | `bluesky,mastodon,youtube,flickr,x,instagram,instagram-location` |
| `geoOnly` | off | `1` = only posts with coordinates inside the radius |
| `limit` | 500 | Max posts returned (newest first) |
| `wait` | 8000 | ms to wait for the first location searches of a new area |

```
/api/live-posts?lat=40.7484&lon=-73.9857&radius=300m&q=Empire State Building,ESB
```

Each post has `source`, `text`, `author`, `createdAt` (epoch ms), `url`, `media`, optional `geo`
(`precision: exact | place`) and `match`: `{ by: 'geo', distanceM }` or `{ by: 'keyword', terms }`.

### `GET /api/live-posts/status`

Stored post counts, watched areas and each source's state / last error.

## How it collects

| Source | Key | How it finds posts | Location |
|---|---|---|---|
| Bluesky | none | Jetstream firehose (WebSocket), keyword match | none → keyword |
| Mastodon | none | Hashtag timelines (`MASTODON_TAGS`) every 2 min | none → keyword |
| YouTube | `YOUTUBE_API_KEY` | `search.list` with `location` + `locationRadius` | exact / area |
| Flickr | `FLICKR_API_KEY` | `photos.search` with `lat`/`lon`/`radius` | exact / approx |
| X | `X_BEARER_TOKEN` | recent search with `point_radius` (paid) | exact / place box |
| Instagram (official) | `INSTAGRAM_GRAPH_TOKEN`, `INSTAGRAM_USER_ID` | Graph API hashtag recent media | none → keyword |
| Instagram location | `INSTAGRAM_SESSIONID` cookie | Place page "Recent" feed (unofficial) | tagged place |

- Every area you request is watched for 20 minutes after its last request; New York City is always watched.
- Keyword sources only see a new area's `q` terms from the first request onward; NYC terms are collected from startup.
- Posts older than the window are dropped every 30 s. The store is saved to `.cache/live-posts.json`
  and Bluesky resumes from its saved cursor after a restart (a cold start replays the last hour, ~120 MB).
- The Instagram location feed uses a logged-in browser session, which breaks Instagram's terms and can get
  the account flagged; it polls every 10 minutes.
