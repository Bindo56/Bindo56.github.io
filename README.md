# System Zero

An interactive Three.js portfolio game, published at [bindo56.github.io](https://bindo56.github.io/).

## Develop locally

```sh
npm ci
npm run dev
```

Run `npm run build` to check the production build, then `npm run preview` to view it locally.

## Update the portfolio

- Edit projects in `src/data/projects.ts`.
- Edit career entries in `src/data/experience.ts`.
- Edit wave and weapon data in `src/data/waves.ts`.

Push changes to `main` to build and publish the site through `.github/workflows/deploy.yml`. The optional `VITE_SERVER_URL` enables the network indicator's server connection; the portfolio game also runs without it.
