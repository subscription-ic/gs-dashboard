/* Minimal `dash` runtime for running the page outside claude.ai:
   datasets come from /api/data/<id>, calcs run in the browser, onData re-draws on data, filter or width change. */
(function () {
  const datasets = {};      // id -> {status, data, columns, message}
  const calcs = {};         // id -> {inputs, fn, result}
  const listeners = [];
  const DEFAULT_PARAMS = { brand: [], city: [], outlet: [], period: 28, daytype: 'all' };
  let params = { ...DEFAULT_PARAMS };
  let notifyQueued = false;

  const css = getComputedStyle(document.documentElement);
  const token = (n) => css.getPropertyValue(n).trim();
  const colors = [1, 2, 3, 4, 5, 6, 7, 8].map((i) => `var(--cds-chart-${i})`);

  function notify() {
    if (notifyQueued) return;
    notifyQueued = true;
    requestAnimationFrame(() => { notifyQueued = false; listeners.forEach((fn) => { try { fn(); } catch (e) { console.error('onData', e); } }); });
  }

  async function load(id) {
    datasets[id] = { status: 'loading', data: [], columns: [], refreshing: false };
    notify();
    try {
      const r = await fetch('/api/data/' + encodeURIComponent(id), { cache: 'no-store' });
      const body = await r.json();
      if (!r.ok) throw new Error(body.error || r.statusText);
      const rows = Array.isArray(body) ? body : body.rows || body.data || [];
      datasets[id] = { status: 'ok', data: rows, columns: rows.length ? Object.keys(rows[0]) : [], refreshing: false };
    } catch (e) {
      datasets[id] = { status: 'error', data: [], columns: [], message: e.message, refreshing: false };
      console.error(`dataset ${id}:`, e.message);
    }
    recompute();
    notify();
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
    if (b) b.addEventListener('click', async () => { b.disabled = true; try { await fetch('/api/refresh', { method: 'POST' }); } catch (e) {} Object.keys(datasets).forEach(load); b.disabled = false; });
  });
})();
