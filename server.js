/* Restaurant Ops Diagnostics — Express server: serves the page and seven read-only data endpoints backed by Azure SQL. */
require('dotenv').config();
const express = require('express');
const fs = require('fs');
const path = require('path');
const sql = require('mssql');
const zlib = require('zlib');
const queries = require('./src/queries');

const PORT = +(process.env.PORT || 3000);
const TTL = (+(process.env.CACHE_TTL_SECONDS || 300)) * 1000;
// Last good copy of each dataset, so the page has data while a paused (serverless) database resumes.
// On App Service /home survives restarts and redeploys.
const CACHE_DIR = process.env.CACHE_DIR || (process.env.WEBSITE_SITE_NAME ? '/home/ops-cache' : path.join(__dirname, '.cache'));
fs.mkdirSync(CACHE_DIR, { recursive: true });

function sqlConfig() {
  const base = {
    server: process.env.AZURE_SQL_SERVER,
    database: process.env.AZURE_SQL_DATABASE,
    options: { encrypt: true, trustServerCertificate: false },
    pool: { max: 5, min: 0, idleTimeoutMillis: 30000 },
    connectionTimeout: 30000,
    requestTimeout: 120000,
  };
  if ((process.env.AZURE_SQL_AUTH || '').toLowerCase() === 'aad') {
    return { ...base, authentication: { type: 'azure-active-directory-default' } };
  }
  return { ...base, user: process.env.AZURE_SQL_USER, password: process.env.AZURE_SQL_PASSWORD };
}

let poolPromise = null;
function getPool() {
  if (!poolPromise) {
    poolPromise = sql.connect(sqlConfig())
      .then((pool) => { pool.on('error', (e) => console.error('SQL pool error:', e.message)); return pool; })
      .catch((e) => { poolPromise = null; throw e; });
  }
  return poolPromise;
}

// A paused serverless database refuses logins ("not currently available") for up to a minute while it resumes:
// keep retrying transient errors for ~2.5 min instead of failing the request.
const TRANSIENT = /not currently available|timeout|ETIMEOUT|ESOCKET|ECONNRESET|ECONNCLOSED|40613|40197|40501|4922[01]|4991[89]/i;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function runQuery(text) {
  const until = Date.now() + 150000;
  for (let wait = 5000; ; wait = Math.min(wait * 2, 20000)) {
    try { const pool = await getPool(); return await pool.request().query(text); }
    catch (e) {
      if (!TRANSIENT.test(`${e.code || ''} ${e.number || ''} ${e.message}`) || Date.now() + wait > until) throw e;
      console.warn(`SQL not ready (${e.message}) — retrying in ${wait / 1000}s`);
      await sleep(wait);
    }
  }
}

// Cached as serialized JSON plus a gzip copy: the daily feed is ~20 MB of repetitive JSON, so compressing once per TTL
// keeps both the transfer and the Free tier's CPU quota small. The gzip copy is also written to CACHE_DIR.
const cache = new Map();
const inflight = new Map();
const diskFile = (id) => path.join(CACHE_DIR, `${id}.json.gz`);

function refresh(id) {
  if (!inflight.has(id)) {
    inflight.set(id, (async () => {
      const result = await runQuery(queries[id].sql);
      const json = Buffer.from(JSON.stringify(result.recordset));
      const entry = { at: Date.now(), json, gz: zlib.gzipSync(json, { level: 6 }) };
      cache.set(id, entry);
      fs.promises.writeFile(diskFile(id), entry.gz).catch((e) => console.warn(`[${id}] cache write:`, e.message));
      return entry;
    })().finally(() => inflight.delete(id)));
  }
  return inflight.get(id);
}

function fromDisk(id) {
  try { const gz = fs.readFileSync(diskFile(id)); return { at: fs.statSync(diskFile(id)).mtimeMs, gz, json: zlib.gunzipSync(gz) }; }
  catch { return null; }
}

// Fresh cache → serve it. Stale or saved copy → serve it now and refresh behind it. Nothing at all → wait for SQL.
async function fetchDataset(id, { fresh = false } = {}) {
  if (!queries[id]) throw Object.assign(new Error(`Unknown dataset "${id}"`), { status: 404 });
  if (fresh) return refresh(id);
  let hit = cache.get(id);
  if (!hit && (hit = fromDisk(id))) cache.set(id, hit);
  if (hit && Date.now() - hit.at < TTL) return hit;
  if (hit) { refresh(id).catch((e) => console.error(`[${id}] background refresh:`, e.message)); return { ...hit, stale: true }; }
  return refresh(id);
}

const app = express();
app.disable('x-powered-by');

app.get('/api/health', async (req, res) => {
  try { const pool = await getPool(); await pool.request().query('SELECT 1 AS ok'); res.json({ ok: true, datasets: Object.keys(queries) }); }
  catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});

app.get('/api/data/:id', async (req, res) => {
  try {
    const { json, gz, at, stale } = await fetchDataset(req.params.id, { fresh: req.query.fresh === '1' });
    res.set({ 'Cache-Control': 'no-store', 'Content-Type': 'application/json; charset=utf-8', Vary: 'Accept-Encoding', 'X-Data-As-Of': new Date(at).toISOString() });
    if (stale) res.set('X-Data-Stale', '1');
    if (/\bgzip\b/.test(req.headers['accept-encoding'] || '')) res.set('Content-Encoding', 'gzip').send(gz);
    else res.send(json);
  } catch (e) {
    console.error(`[${req.params.id}]`, e.message);
    res.status(e.status || 500).json({ error: e.message });
  }
});

app.post('/api/refresh', (req, res) => { cache.clear(); res.json({ ok: true }); });

app.use('/vendor', express.static(path.join(__dirname, 'node_modules', 'd3', 'dist')));
app.use(express.static(path.join(__dirname, 'public')));

app.listen(PORT, () => console.log(`Restaurant Ops Diagnostics → http://localhost:${PORT}`));
