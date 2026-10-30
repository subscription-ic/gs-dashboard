/* Minimal `dash` runtime for running the page outside claude.ai:
   datasets come from /api/data/<id>, calcs run in the browser, onData re-draws on data, filter or width change. */
(function () {
  const datasets = {};      // id -> {status, data, columns, message}
  const calcs = {};         // id -> {inputs, fn, result}
  const listeners = [];
  const DEFAULT_PARAMS = { brand: [], zone: [], state: [], city: [], outlet: [], period: 28, daytype: 'all', from: '', to: '' };
  let params = { ...DEFAULT_PARAMS };
  let notifyQueued = false;

  const css = getComputedStyle(document.documentElement);
  const token = (n) => css.getPropertyValue(n).trim();
  const colors = [1, 2, 3, 4, 5, 6, 7, 8].map((i) => `var(--cds-chart-${i})`);

  function notify() {
    if (notifyQueued) return;
    notifyQueued = true;
    requestAnimationFrame(() => { notifyQueued = false; showStatus(); listeners.forEach((fn) => { try { fn(); } catch (e) { console.error('onData', e); } }); });
  }

  // fresh: ask the server to re-query SQL. A stale (saved) answer is shown at once and followed by a fresh one.
  // Failures (app or database still waking up) are retried a few times before the page gives up.
  async function load(id, { fresh = false, attempt = 0 } = {}) {
    const prev = datasets[id];
    if (prev && prev.status === 'ok') prev.refreshing = true;
    else datasets[id] = { status: 'loading', data: [], columns: [], refreshing: false, waking: attempt > 0 };
    notify();
    try {
      const r = await fetch('/api/data/' + encodeURIComponent(id) + (fresh ? '?fresh=1' : ''), { cache: 'no-store' });
      const body = await r.json();
      if (!r.ok) throw new Error(body.error || r.statusText);
      const rows = Array.isArray(body) ? body : body.rows || body.data || [];
      const stale = r.headers.get('X-Data-Stale') === '1';
      datasets[id] = { status: 'ok', data: rows, columns: rows.length ? Object.keys(rows[0]) : [], refreshing: stale, asOf: r.headers.get('X-Data-As-Of') };
      if (stale) load(id, { fresh: true });
    } catch (e) {
      console.error(`dataset ${id}:`, e.message);
      if (prev && prev.status === 'ok') prev.refreshing = false;
      else if (attempt < 4) { setTimeout(() => load(id, { fresh, attempt: attempt + 1 }), 5000 * (attempt + 1)); datasets[id].waking = true; notify(); return; }
      else datasets[id] = { status: 'error', data: [], columns: [], message: e.message, refreshing: false };
    }
    recompute();
    notify();
  }

  const when = (iso) => new Date(iso).toLocaleString([], { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
  function showStatus() {
    const el = document.getElementById('shell-status');
    const all = Object.values(datasets);
    if (!el || !all.length) return;
    const ok = all.filter((d) => d.status === 'ok'), oldest = ok.map((d) => d.asOf).filter(Boolean).sort()[0];
    el.textContent = all.some((d) => d.status === 'loading' && d.waking) ? 'Waking up the database — this can take a minute…'
      : all.some((d) => d.status === 'loading') ? 'Loading data…'
      : all.some((d) => d.status === 'error') ? 'Some data could not be loaded — try ↻ Reload data'
      : all.some((d) => d.refreshing) ? `Showing data saved ${oldest ? when(oldest) : ''} · refreshing…`
      : `Live from Azure SQL${oldest ? ' · updated ' + when(oldest) : ''}`;
  }

  function recompute() {
    for (const [id, c] of Object.entries(calcs)) {
      const inputs = c.inputs.map((i) => (calcs[i] ? calcs[i].result : datasets[i]));
      if (inputs.every((d) => d && d.status === 'ok')) {
        try { const data = c.fn(...inputs.map((d) => d.data)); c.result = { status: 'ok', data, columns: Array.isArray(data) && data.length ? Object.keys(data[0]) : [], refreshing: false }; }
        catch (e) { c.result = { status: 'error', data: [], message: e.message }; console.error(`calc ${id}:`, e); }
      } else if (inputs.some((d) => d && d.status === 'error')) c.result = { status: 'error', data: [], message: 'an input failed' };
      else c.result = { status: 'loading', data: [] };
    }
  }

  window.dash = {
    colors,
    data(id) {
      if (calcs[id]) { calcs[id].inputs.forEach((i) => { if (!calcs[i] && !datasets[i]) load(i); }); return calcs[id].result || { status: 'loading', data: [] }; }
      if (!datasets[id]) load(id);
      return datasets[id];
    },
    onData(fn) { listeners.push(fn); fn(); },
    calc(id, { inputs, fn }) { calcs[id] = { inputs, fn, result: null }; recompute(); },
    loader() {},
    refresh(id) { if (id) load(id); else Object.keys(datasets).forEach(load); },
    params() { return { ...params }; },
    setParams(p) { Object.assign(params, p); notify(); },
    resetParams() { params = { ...DEFAULT_PARAMS }; notify(); },
    setLink(name) { if (name && history.replaceState) history.replaceState(null, '', '#' + name); },
    token,
  };

  let resizeTimer = null;
  window.addEventListener('resize', () => { clearTimeout(resizeTimer); resizeTimer = setTimeout(notify, 120); });
  if (window.matchMedia) window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', notify);

  // Toolbar: reload data from SQL (clears the server cache first)
  document.addEventListener('DOMContentLoaded', () => {
    const b = document.getElementById('reload-data');
    if (b) b.addEventListener('click', async () => { b.disabled = true; await Promise.all(Object.keys(datasets).map((id) => load(id, { fresh: true }))); b.disabled = false; });
  });
})();
