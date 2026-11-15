# System Zero setup

## Requirements

- Node.js 22 or newer and npm.
- Git. A modern browser with WebGL is recommended for the 3D experience.

## Run locally

1. Clone the repository: `git clone https://github.com/Bindo56/Bindo56.github.io.git`.
2. Change into the project directory: `cd Bindo56.github.io`.
3. Install the locked dependencies: `npm ci`.
4. Start the Vite development server: `npm run dev`, then open the local URL printed by Vite.

The main site is at `/`. Other pages include `/classic/` and the routes under `/worlds/`. The base site runs without optional live-posts API keys.

## Optional server integrations

Copy `.env.example` to `.env.local` only when you need an optional API-backed feature. Fill in your own values for the sources you intend to use. The example documents YouTube, Flickr, X, Instagram, and Google Maps variables. Keys without values leave those sources off. The variables are server-side and do not use the `VITE_` prefix.

Keep `.env.local` and real API tokens out of Git. Some external services require separate accounts, API enablement, or paid access; see the comments in `.env.example` before enabling them.

## Check and build

- `npm run test:unit` runs the Vitest unit tests.
- `npm run build` runs unit tests, TypeScript checking, and the production Vite build.
- `npm run preview` serves the built site locally.
- For browser tests, run `npx playwright install chromium` once, then `npm run test:e2e`.

Population and place-data scripts in `package.json` are optional data maintenance commands. They are not needed for the first local run and may create large local datasets.

## Publish

GitHub Pages is deployed by `.github/workflows/deploy.yml` from the `main` branch. Run `npm run build` before pushing site changes, and check the GitHub Actions run after the push.
