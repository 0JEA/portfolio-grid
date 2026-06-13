# Plan: Extract portfolio-grid as a standalone custom element

## Status: Complete ✅

### Done
1. Create portfolio-grid repo (local: /home/john/websites/portfolio-grid)
2. Write portfolio-grid.mjs — 813-line custom element
3. Add README with full docs
4. Deploy element to VPS at /var/www/elements/portfolio-grid.mjs
5. Add nginx location /elements/ block (served, returns 200 with host header)
6. Update rosecityogs devin.astro: replace Astro component with `<portfolio-grid>` tag
7. Add `<script type="module" src="/elements/portfolio-grid.mjs">` to Base.astro
8. Build + deploy rosecityogs to VPS (running)
9. insta-bridge updated to support GET /api/fetch?user=...&limit=... (commits e16edbf, 5e37041)

## Outstanding

- No GitHub remote — `portfolio-grid` is local + VPS only. Should push to `0JEA/portfolio-grid` for backup.

## VPS layout
```
/var/www/
  elements/portfolio-grid.mjs     ← served at /elements/
  rosecityogs.com/repo/           ← source + build
  rosecityogs.com/current/        ← live symlink
  insta-bridge/repo/              ← source
  insta-bridge/current/server.mjs ← live
```
