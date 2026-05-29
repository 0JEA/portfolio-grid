/**
 * <portfolio-grid> — Custom Element
 *
 * A framework-agnostic masonry portfolio grid with:
 *   - Lightbox image viewer (arrow keys, swipe, close)
 *   - Hover effects (gold border, lift, gradient overlay)
 *   - Admin mode: checkbox toggles, drag-to-reorder, pin-to-lock
 *   - Persistent state: localStorage + optional server sync
 *
 * Attributes:
 *   id-prefix      — unique identifier for this grid instance (auto-generated if omitted)
 *   admin-param     — URL query param that enables admin mode (default: "admin")
 *   src             — URL to fetch images from (GET). Response must be JSON array of {src, alt[, id, width, height]}
 *   state-url       — URL for server-side state persistence (GET to load, POST to save)
 *   admin-key        — value for X-Admin-Key header on state writes (optional)
 *   columns         — comma-separated breakpoint grid: "2,3,4" = 2 at mobile, 3 tablet, 4 desktop
 *
 * Properties (JS):
 *   el.images       — get/set the image array directly (bypasses src fetch)
 *   el.state        — { hidden: {}, order: [], pinned: {} }
 *   el.reset()      — clear all state
 *
 * CSS: The element renders in the light DOM using the ':host' selector for
 * internal layout, but all styling tokens (colors, fonts, etc.) come from
 * the page's CSS custom properties. Style the grid by setting these vars:
 *   --portfolio-gold, --portfolio-bg, --portfolio-border,
 *   --portfolio-text, --portfolio-overlay, --portfolio-duration, --portfolio-ease
 *
 * @version 1.0.0
 */

class PortfolioGrid extends HTMLElement {
  static get observedAttributes() {
    return ['src', 'id-prefix', 'admin-param', 'state-url', 'admin-key', 'columns'];
  }

  constructor() {
    super();
    this._images = [];
    this._state = { hidden: {}, order: [], pinned: {} };
    this._admin = false;
    this._ready = false;
    this._lightboxIdx = 0;
    this._uid = '';
    // Avoid double-init if defined before DOM parse
    this._initCalled = false;
  }

  // ─── lifecycle ──────────────────────────────────────

  connectedCallback() {
    if (this._initCalled) return;
    this._initCalled = true;

    this._uid = this.getAttribute('id-prefix') || ('pg-' + Math.random().toString(36).slice(2, 8));
    this._admin = new URLSearchParams(window.location.search).has(
      this.getAttribute('admin-param') || 'admin'
    );
    // Also allow admin mode via sessionStorage (set by /admin login page)
    if (!this._admin) {
      try { this._admin = sessionStorage.getItem('pg-admin') === 'true'; } catch(e) {}
    }

    this._columns = (this.getAttribute('columns') || '2,3,4').split(',').map(Number);
    this._stateUrl = this.getAttribute('state-url') || '';
    this._adminKey = this.getAttribute('admin-key') || '';

    this._buildDOM();
    this._loadState().then(() => {
      this._loadImages().then(() => {
        this._renderGrid();
        this._applyState();
        this._initAdmin();
        this._initLightbox();
        this._ready = true;
      });
    });
  }

  attributeChangedCallback(name, oldVal, newVal) {
    if (!this._ready || oldVal === newVal) return;
    if (name === 'src') {
      this._loadImages().then(() => {
        this._renderGrid();
        this._applyState();
        this._initAdmin();
      });
    }
  }

  // ─── DOM scaffold ───────────────────────────────────

  _buildDOM() {
    // Clear any previous content
    this.innerHTML = '';

    // Grid container
    this._grid = document.createElement('div');
    this._grid.className = 'pg-grid';
    this._grid.setAttribute('role', 'list');

    // Admin bar (hidden by default)
    this._adminBar = document.createElement('div');
    this._adminBar.className = 'pg-admin-bar';
    this._adminBar.innerHTML = '<span class="pg-admin-title">Admin</span>' +
      '<button class="pg-admin-upload">Upload</button>' +
      '<button class="pg-admin-reset">Reset Order</button>' +
      '<button class="pg-admin-logout">Logout</button>' +
      '<span class="pg-admin-count"></span>';

    // Inject a <style> into the element for scoped defaults (overridable via custom properties)
    if (!document.getElementById('pg-inline-styles')) {
      const style = document.createElement('style');
      style.id = 'pg-inline-styles';
      style.textContent = this._getCSS();
      document.head.appendChild(style);
    }

    this.appendChild(this._grid);
  }

  _getCSS() {
    const cols = this._columns;
    // prettier-ignore
    return `
      :host { display: block; }

      .pg-grid {
        display: grid;
        grid-template-columns: repeat(${cols[0] || 2}, 1fr);
        gap: 12px;
        margin-top: var(--portfolio-space, 1.5rem);
      }
      @media (min-width: 640px) {
        .pg-grid { grid-template-columns: repeat(${cols[1] || 3}, 1fr); }
      }
      @media (min-width: 1024px) {
        .pg-grid { grid-template-columns: repeat(${cols[2] || 4}, 1fr); }
      }

      .pg-item {
        position: relative;
        aspect-ratio: 1;
        overflow: hidden;
        background: var(--portfolio-bg, rgba(0,0,0,0.05));
        cursor: pointer;
        border: 1px solid var(--portfolio-border, rgba(255,255,255,0.1));
        border-radius: 2px;
        transition: border-color var(--portfolio-duration, 0.2s) var(--portfolio-ease, ease),
                    transform 0.3s var(--portfolio-ease, ease);
      }
      .pg-item:hover {
        border-color: var(--portfolio-gold, #c9a044);
        transform: translateY(-4px);
      }
      .pg-item img {
        width: 100%;
        height: 100%;
        object-fit: cover;
        border-radius: 2px;
        transition: transform 0.4s var(--portfolio-ease, ease);
      }
      .pg-item:hover img,
      .pg-item:focus-visible img {
        transform: scale(1.04);
      }
      .pg-overlay {
        position: absolute;
        inset: 0;
        background: var(--portfolio-overlay,
          linear-gradient(to top, rgba(0,0,0,0.75) 0%, rgba(201,160,68,0.08) 100%));
        display: flex;
        align-items: center;
        justify-content: center;
        opacity: 0;
        transition: opacity var(--portfolio-duration, 0.2s) var(--portfolio-ease, ease);
        pointer-events: none;
      }
      .pg-item:hover .pg-overlay,
      .pg-item:focus-visible .pg-overlay {
        opacity: 1;
      }
      .pg-icon {
        font-size: 2rem;
        color: var(--portfolio-gold-accent, #c9a044);
        font-weight: 300;
        line-height: 1;
      }

      /* Admin */
      .pg-item.pg-hidden {
        opacity: 0.35;
        border-color: var(--portfolio-hidden-border, #663333);
      }
      .pg-item.pg-hidden:hover { opacity: 0.5; }

      .pg-checkbox {
        position: absolute;
        top: 0; left: 0;
        z-index: 10;
        width: 36px; height: 36px;
        background: rgba(0,0,0,0.75);
        cursor: pointer;
        display: flex;
        align-items: center;
        justify-content: center;
        font-size: 20px;
        color: #666;
        transition: all 0.15s;
      }
      .pg-checkbox:hover { background: rgba(0,0,0,0.9); }
      .pg-checkbox::before { content: "\\2610"; line-height: 1; }
      .pg-checkbox.pg-checked::before { content: "\\2611";
        color: var(--portfolio-gold-accent, #c9a044); }

      .pg-drag {
        position: absolute;
        top: 8px; right: 8px;
        z-index: 5;
        font-size: 16px;
        cursor: grab;
        color: rgba(255,255,255,0.5);
        background: rgba(0,0,0,0.4);
        border-radius: 4px;
        padding: 2px 6px;
        line-height: 1;
        user-select: none;
      }
      .pg-drag:active { cursor: grabbing; }

      .pg-pin {
        position: absolute;
        top: 8px; right: 42px;
        z-index: 5;
        font-size: 13px;
        cursor: pointer;
        color: rgba(255,255,255,0.35);
        background: rgba(0,0,0,0.4);
        border-radius: 4px;
        padding: 1px 5px;
        line-height: 1;
        user-select: none;
        transition: color 0.15s, background 0.15s;
      }
      .pg-pin.pg-pinned {
        color: var(--portfolio-gold-accent, #c9a044);
      }
      .pg-delete {
        position: absolute;
        top: 8px; right: 72px;
        z-index: 5;
        font-size: 13px;
        cursor: pointer;
        color: rgba(255,100,100,0.6);
        background: rgba(0,0,0,0.4);
        border-radius: 4px;
        padding: 1px 5px;
        line-height: 1;
        user-select: none;
        transition: color 0.15s, background 0.15s;
      }
      .pg-delete:hover {
        color: #ff4444;
        background: rgba(0,0,0,0.7);
      }

      .pg-item.pg-dragging {
        opacity: 0.3; transform: scale(0.95); z-index: 100;
      }
      .pg-item.pg-drop-before {
        box-shadow: 0 -4px 0 0 var(--portfolio-gold-accent, #c9a044);
      }
      .pg-item.pg-drop-after {
        box-shadow: 0 4px 0 0 var(--portfolio-gold-accent, #c9a044);
      }

      .pg-admin-bar {
        display: none;
        gap: 12px; align-items: center;
        padding: 12px 16px;
        margin-bottom: 16px;
        background: var(--portfolio-bg, rgba(0,0,0,0.05));
        border: 1px solid var(--portfolio-gold-dim, rgba(201,160,68,0.3));
        border-radius: 2px;
        font-size: 13px;
        color: var(--portfolio-gold-accent, #c9a044);
      }
      .pg-admin-bar.pg-visible { display: flex; }
      .pg-admin-upload { }
      .pg-admin-logout { background: transparent !important; color: var(--portfolio-text-muted, rgba(255,255,255,0.4)) !important; border: 1px solid var(--portfolio-border, rgba(255,255,255,0.1)) !important; }
      .pg-admin-bar button {
        background: var(--portfolio-gold-accent, #c9a044);
        color: #111009;
        border: none;
        padding: 8px 18px;
        border-radius: 2px;
        font-size: 12px;
        font-weight: 700;
        cursor: pointer;
        letter-spacing: 0.05em;
        text-transform: uppercase;
      }
      .pg-admin-bar .pg-admin-count {
        color: var(--portfolio-text-muted, rgba(255,255,255,0.4));
        margin-left: auto;
      }
    `;
  }

  // ─── image loading ──────────────────────────────────

  async _loadImages() {
    // If images were set directly via property, use those
    if (this._imagesByProp && this._imagesByProp.length) {
      this._images = this._imagesByProp;
      this._imagesByProp = null;
      return;
    }

    const src = this.getAttribute('src');
    if (!src) return;

    try {
      const resp = await fetch(src, { signal: AbortSignal.timeout(10000) });
      if (!resp.ok) {
        console.warn('[portfolio-grid] Image fetch returned ' + resp.status);
        return;
      }
      const data = await resp.json();

      // Support both {success: true, posts: [...]} (insta-bridge) and plain arrays
      const raw = data.success && data.posts ? data.posts : (Array.isArray(data) ? data : []);

      this._images = raw.map((item, i) => ({
        id: item.id || item.id?.replace(/^\d+_/, '').slice(0, 20) || String(i),
        src: item.src || item.images?.['1200'] || item.thumbnail || '',
        alt: (item.alt || item.caption || '').replace(/\n/g, ' ').slice(0, 120),
        width: item.width || 1200,
        height: item.height || 1200,
      }));
    } catch (e) {
      console.warn('[portfolio-grid] Image fetch failed:', e.message);
    }
  }

  // ─── state management ────────────────────────────────

  async _loadState() {
    var key = 'pg-state-' + this._uid;

    // 1. Load from localStorage first (instant — works for all visitors)
    try {
      const raw = localStorage.getItem(key);
      if (raw) {
        const saved = JSON.parse(raw);
        this._state = {
          hidden: saved.hidden || {},
          order: saved.order || [],
          pinned: saved.pinned || {},
        };
      }
    } catch (e) { /* ignore */ }

    // 2. Also sync from server so state works in incognito / cross-browser
    if (this._stateUrl) {
      try {
        const resp = await fetch(this._stateUrl, {
          headers: this._adminKey ? { 'X-Admin-Key': this._adminKey } : {},
          signal: AbortSignal.timeout(5000),
        });
        if (!resp.ok) {
          console.warn('[portfolio-grid] State fetch returned ' + resp.status);
          return;
        }
        const data = await resp.json();
        const serverState = data.success && data.state ? (data.state[this._uid] || data.state) : data;
        if (serverState && (serverState.hidden || serverState.order)) {
          this._state = {
            hidden: { ...(serverState.hidden || {}) },
            order: [...(serverState.order || [])],
            pinned: { ...(serverState.pinned || {}) },
          };
          this._saveLocal();
        }
      } catch (e) {
        console.warn('[portfolio-grid] Server state load failed:', e.message);
      }
    }
  }

  _saveState() {
    if (!this._admin) return;
    this._saveLocal();

    // Push to server if configured
    if (this._stateUrl) {
      const payload = {
        artist: this._uid,
        state: this._state,
      };
      fetch(this._stateUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(this._adminKey ? { 'X-Admin-Key': this._adminKey } : {}),
        },
        body: JSON.stringify(payload),
      }).catch(() => {}); // fire-and-forget
    }
  }

  _saveLocal() {
    try {
      localStorage.setItem('pg-state-' + this._uid, JSON.stringify(this._state));
    } catch (e) { /* ignore */ }
  }

  reset() {
    this._state.order = [];
    this._state.pinned = {};
    this._saveState();
    this._renderGrid();
    this._updateCount();
  }

  // ─── rendering ──────────────────────────────────────

  _renderGrid() {
    this._grid.innerHTML = '';
    if (!this._images.length) return;

    const order = this._state.order;
    // For non-admin: remove hidden images entirely so grid reflows
    let filtered = this._admin ? this._images : this._images.filter(function(img) {
      return !this._state.hidden[img.id];
    }.bind(this));
    let sorted = filtered.slice();

    if (order && order.length) {
      // Detect new images not yet in the order
      const currentIds = this._images.map(img => img.id);
      const newIds = currentIds.filter(id => order.indexOf(id) === -1);

      if (newIds.length) {
        // Prepend at first non-pinned position
        let insertAt = 0;
        while (insertAt < order.length && this._state.pinned[order[insertAt]]) {
          insertAt++;
        }
        order.splice(insertAt, 0, ...newIds);
      }

      // Sort by order
      sorted = sorted.slice().sort((a, b) => {
        const ia = order.indexOf(a.id);
        const ib = order.indexOf(b.id);
        return (ia === -1 ? 999 : ia) - (ib === -1 ? 999 : ib);
      });
    }

    sorted.forEach((img, i) => {
      const el = this._buildItem(img, i);
      this._grid.appendChild(el);
    });
  }

  _buildItem(img, index) {
    const el = document.createElement('button');
    el.className = 'pg-item';
    el.dataset.index = index;
    el.dataset.id = img.id || '';
    el.setAttribute('aria-label', img.alt ? 'View ' + img.alt : 'View image');
    el.draggable = false;

    el.innerHTML =
      '<img src="' + this._esc(img.src) + '" ' +
        'loading="' + (index < 4 ? 'eager' : 'lazy') + '" ' +
        'decoding="async" alt="' + this._esc(img.alt) + '" ' +
        'width="800" height="800" draggable="false">';

    // Apply visibility state (greyed out for admin, removed for non-admin)
    if (this._state.hidden[img.id]) {
      el.classList.add('pg-hidden');
    }

    return el;
  }

  _applyState() {
    if (!this._ready) return;
    if (this._admin) {
      // Admin: just toggle the hidden class
      const items = Array.from(this._grid.querySelectorAll('.pg-item'));
      items.forEach(el => {
        const id = el.dataset.id;
        if (this._state.hidden[id]) {
          el.classList.add('pg-hidden');
        } else {
          el.classList.remove('pg-hidden');
        }
      });
    } else {
      // Non-admin: re-render to remove hidden images
      this._renderGrid();
    }
    this._updateCount();
    this._refreshLightbox();
  }

  // ─── admin UI ───────────────────────────────────────

  _initAdmin() {
    if (!this._admin || !this._images.length) return;

    // Show admin bar
    this.insertBefore(this._adminBar, this._grid);
    this._adminBar.classList.add('pg-visible');

    const resetBtn = this._adminBar.querySelector('.pg-admin-reset');
    resetBtn.addEventListener('click', function() {
      if (!confirm('Reset portfolio order and pins?\n\nHidden images will stay hidden. The current order and pinned positions will be cleared, and images will return to their default order.')) return;
      if (!this._state) return;
      this._state.order = [];
      this._state.pinned = {};
      this._saveState();
      this._renderGrid();
      this._updateCount();
      this._refreshLightbox();
    }.bind(this));

    var uploadBtn = this._adminBar.querySelector('.pg-admin-upload');
    if (uploadBtn) {
      uploadBtn.addEventListener('click', function() {
        window.location.href = '/admin/upload/';
      });
    }

    var logoutBtn = this._adminBar.querySelector('.pg-admin-logout');
    if (logoutBtn) {
      logoutBtn.addEventListener('click', function() {
        try { sessionStorage.removeItem('pg-admin'); } catch(e) {}
        window.location.href = '/';
      });
    }

    this._updateCount();

    // Add controls to each item
    const items = Array.from(this._grid.querySelectorAll('.pg-item'));
    items.forEach(el => {
      const id = el.dataset.id;

      // Checkbox
      const cb = document.createElement('div');
      cb.className = 'pg-checkbox' + (this._state.hidden[id] ? '' : ' pg-checked');
      cb.addEventListener('click', e => {
        e.stopPropagation();
        e.preventDefault();
        this._state.hidden[id] = !this._state.hidden[id];
        if (this._state.hidden[id]) {
          cb.classList.remove('pg-checked');
          el.classList.add('pg-hidden');
        } else {
          cb.classList.add('pg-checked');
          el.classList.remove('pg-hidden');
        }
        this._saveState();
        this._updateCount();
      });
      el.appendChild(cb);

      // Drag handle
      const dh = document.createElement('div');
      dh.className = 'pg-drag';
      dh.textContent = '\u2630';
      el.appendChild(dh);

      // Pin button
      const pin = document.createElement('div');
      pin.className = 'pg-pin' + (this._state.pinned[id] ? ' pg-pinned' : '');
      pin.textContent = '\u{1F4CC}';
      pin.title = this._state.pinned[id] ? 'Unpin' : 'Pin to lock position';
      pin.addEventListener('click', e => {
        e.stopPropagation();
        e.preventDefault();
        this._state.pinned[id] = !this._state.pinned[id];
        if (this._state.pinned[id]) {
          pin.classList.add('pg-pinned');
          pin.title = 'Unpin';
        } else {
          pin.classList.remove('pg-pinned');
          pin.title = 'Pin to lock position';
        }
        this._saveState();
      });
      el.appendChild(pin);

      // Delete button (only for uploaded images, not Instagram)
      var pgDelete = document.createElement('div');
      pgDelete.className = 'pg-delete';
      pgDelete.textContent = '\u2716';
      pgDelete.title = 'Delete this image';
      pgDelete.addEventListener('click', function(e) {
        e.stopPropagation();
        e.preventDefault();
        if (!confirm('Delete this image permanently?')) return;
        var pw = '';
        try { pw = sessionStorage.getItem('pg-admin-pw') || ''; } catch(e) {}
        if (!pw) { pw = prompt('Enter admin password to delete'); if (!pw) return; }
        pgDelete.textContent = '...';
        fetch('/api/delete-upload', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ artist: this._uid, id: id, password: pw })
        })
        .then(function(r) { return r.json(); })
        .then(function(data) {
          if (data.success) {
            el.style.transition = 'transform 0.3s, opacity 0.3s';
            el.style.transform = 'scale(0.5)';
            el.style.opacity = '0';
            setTimeout(function() {
              el.remove();
              this._refreshLightbox();
            }.bind(this), 300);
          } else {
            pgDelete.textContent = '\u2716';
            alert('Delete failed: ' + (data.error || 'unknown error'));
          }
        }.bind(this))
        .catch(function() {
          pgDelete.textContent = '\u2716';
          alert('Delete failed. Check your connection.');
        });
      }.bind(this));
      el.appendChild(pgDelete);

      // Drag-and-drop
      this._makeDraggable(el, id);
    });

    // Update order for any new images
    this._ensureOrderInitialized();
  }

  _makeDraggable(el, id) {
    el.draggable = true;

    // ─── Desktop drag ──────────────────────────────
    el.addEventListener('dragstart', e => {
      e.dataTransfer.setData('text/plain', id);
      el.classList.add('pg-dragging');
      this._allItems().forEach(i => i.classList.remove('pg-drop-before', 'pg-drop-after'));
    });

    el.addEventListener('dragend', () => {
      el.classList.remove('pg-dragging');
      this._allItems().forEach(i => i.classList.remove('pg-drop-before', 'pg-drop-after'));
    });

    el.addEventListener('dragover', e => {
      e.preventDefault();
      this._showDropIndicator(el, e.clientX, e.clientY);
    });

    el.addEventListener('dragleave', () => {
      el.classList.remove('pg-drop-before', 'pg-drop-after');
    });

    el.addEventListener('drop', e => {
      e.preventDefault();
      this._completeDrop(el, id, e.dataTransfer.getData('text/plain'), e.clientX, e.clientY);
    });

    // ─── Mobile touch drag ──────────────────────────
    var touchData = null;

    el.addEventListener('touchstart', e => {
      // Only start drag from the drag handle or after a long press
      var target = e.target;
      if (!target.closest('.pg-drag')) return;
      e.preventDefault();
      var touch = e.changedTouches[0];
      touchData = { fromId: id, startX: touch.screenX, startY: touch.screenY };
      el.classList.add('pg-dragging');
      this._allItems().forEach(i => i.classList.remove('pg-drop-before', 'pg-drop-after'));
    }, { passive: false });

    el.addEventListener('touchmove', e => {
      if (!touchData) return;
      e.preventDefault();
      var touch = e.changedTouches[0];

      // Temporarily suppress pointer events on dragged element so elementFromPoint
      // returns the element underneath, not the dragged one
      var prevPointer = el.style.pointerEvents;
      el.style.pointerEvents = 'none';

      var elem = document.elementFromPoint(touch.clientX, touch.clientY);
      el.style.pointerEvents = prevPointer;

      var dropEl = elem ? elem.closest('.pg-item') : null;
      if (dropEl && dropEl !== el) {
        this._showDropIndicator(dropEl, touch.clientX, touch.clientY);
      }
    }, { passive: false });

    el.addEventListener('touchend', e => {
      if (!touchData) return;
      e.preventDefault();
      var touch = e.changedTouches[0];
      el.classList.remove('pg-dragging');

      // Temporarily suppress pointer events to find the actual drop target
      var prevPointer = el.style.pointerEvents;
      el.style.pointerEvents = 'none';
      var elem = document.elementFromPoint(touch.clientX, touch.clientY);
      el.style.pointerEvents = prevPointer;

      var dropEl = elem ? elem.closest('.pg-item') : null;
      if (dropEl && dropEl !== el) {
        this._completeDrop(dropEl, id, touchData.fromId, touch.clientX, touch.clientY);
      } else {
        this._allItems().forEach(i => i.classList.remove('pg-drop-before', 'pg-drop-after'));
      }
      touchData = null;
    });
  }

  _showDropIndicator(el, clientX, clientY) {
    var rect = el.getBoundingClientRect();
    var midY = rect.top + rect.height / 2;
    var midX = rect.left + rect.width / 2;
    var before = clientY < midY || (Math.abs(clientY - midY) < 10 && clientX < midX);
    this._allItems().forEach(i => i.classList.remove('pg-drop-before', 'pg-drop-after'));
    el.classList.add(before ? 'pg-drop-before' : 'pg-drop-after');
  }

  _completeDrop(dropEl, targetId, fromId, clientX, clientY) {
    dropEl.classList.remove('pg-drop-before', 'pg-drop-after');
    if (fromId === targetId) return;

    var rect = dropEl.getBoundingClientRect();
    var midY = rect.top + rect.height / 2;
    var dropBefore = clientY < midY || (Math.abs(clientY - midY) < 10 && clientX < rect.left + rect.width / 2);

    var ids = this._allItems().map(function(i) { return i.dataset.id; });
    var order = this._state.order.length ? [].concat(this._state.order) : [].concat(ids);

    var fromIdx = order.indexOf(fromId);
    var toIdx = order.indexOf(targetId);
    if (fromIdx === -1 || toIdx === -1) return;

    order.splice(fromIdx, 1);
    toIdx = order.indexOf(targetId);
    if (toIdx === -1) toIdx = order.indexOf(targetId);
    if (!dropBefore && toIdx < order.length - 1) toIdx++;
    order.splice(toIdx, 0, fromId);

    this._state.order = order;
    this._saveState();

    this._flipReorder(function() {
      this._renderGrid();
      this._initAdmin();
    }.bind(this));
  }

  _flipReorder(callback) {
    const rects = {};
    this._allItems().forEach(el => {
      rects[el.dataset.id] = el.getBoundingClientRect();
    });

    callback();

    requestAnimationFrame(() => {
      this._allItems().forEach(el => {
        const id = el.dataset.id;
        const newRect = el.getBoundingClientRect();
        const dx = (rects[id]?.left || 0) - newRect.left;
        const dy = (rects[id]?.top || 0) - newRect.top;
        if (dx || dy) {
          el.style.transition = 'none';
          el.style.transform = 'translate(' + dx + 'px, ' + dy + 'px)';
          requestAnimationFrame(() => {
            el.style.transition = 'transform 0.4s cubic-bezier(0.25, 0.46, 0.45, 0.94)';
            el.style.transform = '';
          });
        }
      });
    });
  }

  _ensureOrderInitialized() {
    const ids = this._allItems().map(el => el.dataset.id);
    if (!this._state.order.length) {
      this._state.order = ids.slice();
    } else {
      // Add any IDs not yet in order
      ids.forEach(id => {
        if (this._state.order.indexOf(id) === -1) {
          this._state.order.unshift(id);
        }
      });
    }
    this._saveState();
  }

  _allItems() {
    return Array.from(this._grid.querySelectorAll('.pg-item'));
  }

  _updateCount() {
    const visible = this._allItems().filter(el => !el.classList.contains('pg-hidden')).length;
    const count = this._adminBar.querySelector('.pg-admin-count');
    if (count) count.textContent = visible + ' / ' + this._images.length + ' visible';
  }

  // ─── lightbox ───────────────────────────────────────

  _initLightbox() {
    const items = this._allItems();
    if (!items.length) return;

    // Build lightbox DOM once
    if (!this._lb) {
      this._lb = document.createElement('div');
      this._lb.id = 'pg-lb-' + this._uid;
      this._lb.style.cssText = 'position:fixed;inset:0;z-index:9999;background:rgba(0,0,0,0.95);display:none;align-items:center;justify-content:center;padding:40px 32px;';
      this._lb.setAttribute('role', 'dialog');
      this._lb.setAttribute('aria-modal', 'true');

      this._lb.innerHTML =
        '<button id="pg-lb-close-' + this._uid + '" class="pg-lb-close" aria-label="Close">&times;</button>' +
        '<button id="pg-lb-prev-' + this._uid + '" class="pg-lb-nav" style="left:8px" aria-label="Previous image">&lang;</button>' +
        '<button id="pg-lb-next-' + this._uid + '" class="pg-lb-nav" style="right:8px" aria-label="Next image">&rang;</button>' +
        '<div class="pg-lb-inner">' +
          '<img id="pg-lb-img-' + this._uid + '" class="pg-lb-img" src="" alt="">' +
        '</div>' +
        '<div class="pg-lb-footer">' +
          '<span id="pg-lb-cap-' + this._uid + '" class="pg-lb-cap"></span>' +
          '<span id="pg-lb-count-' + this._uid + '" class="pg-lb-count"></span>' +
        '</div>';

      document.body.appendChild(this._lb);

      // Inject lightbox CSS once
      if (!document.getElementById('pg-lb-styles')) {
        const s = document.createElement('style');
        s.id = 'pg-lb-styles';
        s.textContent = `
          .pg-lb-close { position:fixed;top:16px;right:24px;font-size:28px;color:rgba(255,255,255,0.6);background:none;border:none;cursor:pointer;z-index:10;line-height:1; }
          .pg-lb-nav { position:fixed;top:50%;transform:translateY(-50%);font-size:40px;color:rgba(255,255,255,0.6);background:none;border:none;cursor:pointer;z-index:10;padding:16px; }
          .pg-lb-inner { display:flex;align-items:center;justify-content:center;max-width:100%;max-height:100%; }
          .pg-lb-img { display:block;max-width:min(88vw,1200px);max-height:88vh;border-radius:4px;box-shadow:0 4px 48px rgba(0,0,0,0.5); }
          .pg-lb-footer { position:fixed;bottom:12px;left:50%;transform:translateX(-50%);display:flex;align-items:center;gap:12px;background:rgba(0,0,0,0.4);padding:6px 16px;border-radius:8px;z-index:10; }
          .pg-lb-cap { font-size:13px;color:rgba(255,255,255,0.5);font-style:italic;max-width:60vw;overflow:hidden;text-overflow:ellipsis;white-space:nowrap; }
          .pg-lb-count { font-size:11px;font-weight:600;letter-spacing:0.1em;color:rgba(255,255,255,0.35);flex-shrink:0; }
        `;
        document.head.appendChild(s);
      }

      this._lbImg = this._lb.querySelector('.pg-lb-img');
      this._lbCap = this._lb.querySelector('.pg-lb-cap');
      this._lbCnt = this._lb.querySelector('.pg-lb-count');

      // Event binding
      this._lb.querySelector('.pg-lb-close').addEventListener('click', () => this._closeLightbox());
      this._lb.querySelector('#pg-lb-prev-' + this._uid).addEventListener('click', () => this._navLightbox(-1));
      this._lb.querySelector('#pg-lb-next-' + this._uid).addEventListener('click', () => this._navLightbox(1));
      this._lb.addEventListener('click', e => { if (e.target === this._lb) this._closeLightbox(); });

      this._lbKeyHandler = e => {
        if (this._lb.style.display === 'none') return;
        if (e.key === 'Escape') this._closeLightbox();
        if (e.key === 'ArrowLeft') this._navLightbox(-1);
        if (e.key === 'ArrowRight') this._navLightbox(1);
      };
      document.addEventListener('keydown', this._lbKeyHandler);

      // Touch swipe
      let touchX = 0;
      this._lb.addEventListener('touchstart', e => { touchX = e.changedTouches[0].screenX; });
      this._lb.addEventListener('touchend', e => {
        if (this._lb.style.display === 'none') return;
        const dx = e.changedTouches[0].screenX - touchX;
        if (Math.abs(dx) > 50) this._navLightbox(dx < 0 ? 1 : -1);
      });
    }

    // Bind click handlers
    this._refreshLightbox();
  }

  _refreshLightbox() {
    const visible = this._allItems().filter(el => !el.classList.contains('pg-hidden'));
    visible.forEach((el, i) => {
      el.onclick = e => {
        e.preventDefault();
        this._openLightbox(i);
      };
    });
  }

  _visibleItems() {
    return this._allItems()
      .filter(el => el.style.display !== 'none' && !el.classList.contains('pg-hidden'))
      .map(el => this._images.find(function(img) { return img.id === el.dataset.id; }))
      .filter(Boolean);
  }

  _openLightbox(idx) {
    this._lightboxIdx = idx;
    this._showLightbox();
    this._lb.style.display = 'flex';
    document.body.style.overflow = 'hidden';
  }

  _closeLightbox() {
    this._lb.style.display = 'none';
    document.body.style.overflow = '';
  }

  _navLightbox(dir) {
    const vis = this._visibleItems();
    if (!vis.length) return;
    this._lightboxIdx = (this._lightboxIdx + dir + vis.length) % vis.length;
    this._showLightbox();
  }

  _showLightbox() {
    const vis = this._visibleItems();
    const item = vis[this._lightboxIdx];
    if (!item) return;
    this._lbImg.src = item.src;
    this._lbImg.alt = item.alt;
    this._lbCap.textContent = item.alt;
    this._lbCnt.textContent = (this._lightboxIdx + 1) + ' / ' + vis.length;
  }

  // ─── helpers ────────────────────────────────────────

  _esc(str) {
    return String(str).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  // ─── public API ─────────────────────────────────────

  /** Get/set the image array (bypasses src attribute) */
  get images() {
    return this._images;
  }
  set images(arr) {
    this._imagesByProp = arr;
    if (this._ready) {
      this._loadImages().then(() => {
        this._renderGrid();
        this._applyState();
        this._initAdmin();
      });
    }
  }

  /** Get current state (hidden, order, pinned) */
  get state() {
    return { ...this._state };
  }

  disconnectedCallback() {
    if (this._lbKeyHandler) {
      document.removeEventListener('keydown', this._lbKeyHandler);
    }
    if (this._lb && this._lb.parentNode) {
      this._lb.parentNode.removeChild(this._lb);
    }
  }
}

// Register
if (!customElements.get('portfolio-grid')) {
  customElements.define('portfolio-grid', PortfolioGrid);
}
