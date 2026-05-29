# portfolio-grid

A framework-agnostic custom element for masonry portfolio image grids with admin controls. No dependencies. One file.

```html
<script type="module" src="portfolio-grid.mjs"></script>

<portfolio-grid
  src="/api/images?artist=devin"
  state-url="/api/portfolio-state"
  id-prefix="devin"
  admin-param="admin"
  columns="2,3,4"
></portfolio-grid>
```

## Features

- **Lightbox viewer** — click any image to open a full-size lightbox with keyboard nav (← → Esc) and touch swipe
- **Hover effects** — gold border, lift, image zoom, gradient overlay
- **Admin mode** — append `?admin=1` (or your chosen param) to the URL to unlock:
  - ☐ Checkbox toggles to hide/show images
  - ☰ Drag-and-drop reordering with FLIP animation
  - 📌 Pin button to lock images in position (new images skip past pinned slots)
- **Persistent state** — order, hidden, and pinned state saved to localStorage and optionally synced to a server endpoint
- **New image prepending** — when new images are fetched, they appear at the top of the grid (after pinned images)

## Attributes

| Attribute | Default | Description |
|-----------|---------|-------------|
| `src` | — | URL to fetch images from (GET). Response must be JSON: either a plain array of `{src, alt, id}` or insta-bridge format `{success: true, posts: [...]}` |
| `state-url` | — | URL for server-side state persistence. GET to load, POST to save. Payload: `{artist: id-prefix, state: {hidden, order, pinned}}` |
| `id-prefix` | auto-generated | Unique key for this grid instance. Used for localStorage keys and server state isolation |
| `admin-param` | `admin` | URL query parameter that enables admin mode (e.g. `admin`, `edit`, `dev`) |
| `admin-key` | — | Value for `X-Admin-Key` header on state writes (optional auth) |
| `columns` | `2,3,4` | Grid columns at breakpoints: mobile, tablet (640px+), desktop (1024px+) |

## JavaScript API

```js
const grid = document.querySelector('portfolio-grid');

// Get/set images directly (bypasses src attribute)
grid.images = [
  { src: '/img/1.webp', alt: 'Photo 1', id: 'abc123' },
  { src: '/img/2.webp', alt: 'Photo 2', id: 'def456' },
];

// Read current state
console.log(grid.state); // { hidden: {}, order: [], pinned: {} }

// Clear all admin state
grid.reset();
```

## Styling

The element renders in the light DOM. Style it with CSS custom properties:

```css
:root {
  --portfolio-gold: #c9a044;
  --portfolio-gold-accent: #c9a044;
  --portfolio-gold-dim: rgba(201, 160, 68, 0.3);
  --portfolio-bg: rgba(0, 0, 0, 0.05);
  --portfolio-border: rgba(255, 255, 255, 0.1);
  --portfolio-hidden-border: #663333;
  --portfolio-overlay: linear-gradient(to top, rgba(0,0,0,0.75) 0%, rgba(201,160,68,0.08) 100%);
  --portfolio-text-muted: rgba(255, 255, 255, 0.4);
  --portfolio-duration: 0.2s;
  --portfolio-ease: ease;
  --portfolio-space: 1.5rem;
}
```

Set these on your page's `:root` or on the element itself to theme the grid.

## Server state format

The `state-url` endpoint should accept:

**GET** → returns `{ success: true, state: { "devin": { hidden: {...}, order: [...], pinned: {...} } } }`

**POST** → receives `{ artist: "devin", state: { hidden: {...}, order: [...], pinned: {...} } }`

If no `state-url` is provided, state is stored in localStorage only.

## Example: full Astro page

```astro
---
---
<html>
<head>
  <script type="module" src="/elements/portfolio-grid.mjs"></script>
</head>
<body>
  <portfolio-grid
    src="/api/fetch?artist=devin"
    state-url="/api/portfolio-state"
    id-prefix="devin"
    admin-param="admin"
  ></portfolio-grid>
</body>
</html>
```

## Example: plain HTML

```html
<!DOCTYPE html>
<html>
<head>
  <script type="module" src="portfolio-grid.mjs"></script>
</head>
<body>
  <portfolio-grid id="my-grid" id-prefix="main-portfolio"></portfolio-grid>
  <script>
    const grid = document.getElementById('my-grid');
    grid.images = [
      { src: 'https://example.com/photo1.jpg', alt: 'Sunset', id: '1' },
      { src: 'https://example.com/photo2.jpg', alt: 'Mountains', id: '2' },
    ];
  </script>
</body>
</html>
```

## Deployment

Serve `portfolio-grid.mjs` from any static file server, CDN, or VPS:

```bash
# VPS
scp portfolio-grid.mjs root@your-vps:/var/www/elements/

# Any site can then use:
# <script type="module" src="/elements/portfolio-grid.mjs"></script>
```
