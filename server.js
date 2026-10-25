/* Restaurant Ops Diagnostics — Express server: serves the page and seven read-only data endpoints backed by Azure SQL. */
require('dotenv').config();
const express = require('express');
const path = require('path');
const sql = require('mssql');
const zlib = require('zlib');
const queries = require('./src/queries');

const PORT = +(process.env.PORT || 3000);
const TTL = (+(process.env.CACHE_TTL_SECONDS || 300)) * 1000;

function sqlConfig() {
  const base = {
    server: process.env.AZURE_SQL_SERVER,
    database: process.env.AZURE_SQL_DATABASE,
    options: { encrypt: true, trustServerCertificate: false },
    pool: { max: 5, min: 0, idleTimeoutMillis: 30000 },
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
    poolPromise = sql.connect(sqlConfig()).catch((e) => { poolPromise = null; throw e; });
  }
  return poolPromise;
}

const cache = new Map();

// Cached as serialized JSON plus a gzip copy: the daily feed is ~20 MB of repetitive JSON, so compressing once per TTL
// keeps both the transfer and the Free tier's CPU quota small.
async function fetchDataset(id) {
  const q = queries[id];
  if (!q) throw Object.assign(new Error(`Unknown dataset "${id}"`), { status: 404 });
  const hit = cache.get(id);
  if (hit && Date.now() - hit.at < TTL) return hit;
  const pool = await getPool();
  const result = await pool.request().query(q.sql);
  const json = Buffer.from(JSON.stringify(result.recordset));
  const entry = { at: Date.now(), json, gz: zlib.gzipSync(json, { level: 6 }) };
  cache.set(id, entry);
  return entry;
}

const app = express();
app.disable('x-powered-by');

app.get('/api/health', async (req, res) => {
  try { const pool = await getPool(); await pool.request().query('SELECT 1 AS ok'); res.json({ ok: true, datasets: Object.keys(queries) }); }
  catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});

app.get('/api/data/:id', async (req, res) => {
  try {
    const { json, gz } = await fetchDataset(req.params.id);
    res.set({ 'Cache-Control': 'no-store', 'Content-Type': 'application/json; charset=utf-8', Vary: 'Accept-Encoding' });
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
