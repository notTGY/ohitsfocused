# Oh it's focused

Browser tools built with Astro, React, Tailwind, and Bun. User media stays on the device.

```sh
bun install
bun dev
bun run build
bun preview
```

Routes live in `src/pages/`; interactive pages live in `src/components/`. Shared search and social metadata lives in `SeoHead.astro`. Add a tool and its article to the home page, and provide a 1200 × 630 JPEG in `public/social/`. The sitemap updates automatically on build and excludes the 404 page.

JakeLoud currently uses Python's default HTTP server. To serve the custom 404 page, use this build/start command for `oif`:

```sh
bun i && bun run build && cd dist && python3 ../scripts/serve.py "$PORT"
```

The Docker deployment uses `nginx.conf`, which also serves `404.html` with HTTP status 404. Unknown URLs must return 404, rather than the home page with status 200.

Google Search Console uses the domain property `ohitsfocused.com` and `https://ohitsfocused.com/sitemap-index.xml`. After publishing new pages, inspect their live URLs and request indexing. Keep error pages out of the sitemap.
