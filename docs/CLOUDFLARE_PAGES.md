# Cloudflare Pages deployment

This repository is already connected to GitHub:

- Repository: `backin98/3d-price`
- Production branch: `main`
- Framework: none (plain HTML, CSS, and JavaScript)
- Build command: leave blank
- Build output directory: `public`
- Root directory: leave blank

`wrangler.toml` records the same `public` output directory and enables Node.js compatibility for future Pages Functions.

## Connect GitHub in Cloudflare

1. Open the Cloudflare dashboard.
2. Go to **Workers & Pages**.
3. Select **Create application** and then **Pages**.
4. Select **Connect to Git**.
5. Connect GitHub if Cloudflare asks, then choose `backin98/3d-price`.
6. Use `3d-price` as the project name if it is available.
7. Set the production branch to `main`.
8. Under build settings, enter exactly:

   | Field | Value |
   |---|---|
   | Framework preset | `None` |
   | Build command | *(leave empty)* |
   | Build output directory | `public` |
   | Root directory | *(leave empty)* |

9. Select **Save and Deploy**.

Cloudflare will deploy every later push to `main`. Pull-request branches get preview deployments.

The first production URL will be:

```text
https://<project-name>.pages.dev
```

If the project name is accepted as `3d-price`, expect `https://3d-price.pages.dev`.

## Current API boundary

The static storefront and admin files deploy to Pages immediately. The current `/api/*` implementation in `netlify/functions/` uses Netlify Blobs and does not run on Cloudflare Pages unchanged. Until those routes are migrated to Pages Functions with Cloudflare KV/R2:

- `/api/hunt` will not load the live catalog on the Pages URL.
- Admin login, catalog writes, stock preview, and job controls will not work there.
- Keep the PC worker pointed at the current working API. Do not set `ONLINE_URL` to the Pages preview yet.

The next migration step is to move the shared JSON/blob store to Cloudflare KV/R2, expose the same `/api/*` routes as Pages Functions, copy the current catalog/baseline/jobs data, and only then change the PC worker's `ONLINE_URL`.

