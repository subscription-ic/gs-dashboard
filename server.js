/* Restaurant Ops Diagnostics — Express server: serves the page and seven read-only data endpoints backed by Azure SQL. */
require('dotenv').config();
const express = require('express');
const path = require('path');
const sql = require('mssql');
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

async function fetchDataset(id) {
  const q = queries[id];
  if (!q) throw Object.assign(new Error(`Unknown dataset "${id}"`), { status: 404 });
  const hit = cache.get(id);
  if (hit && Date.now() - hit.at < TTL) return hit.rows;
  const pool = await getPool();
  const result = await pool.request().query(q.sql);
  const rows = result.recordset;
  cache.set(id, { at: Date.now(), rows });
  return rows;
}

const app = express();
app.disable('x-powered-by');

app.get('/api/health', async (req, res) => {
  try { const pool = await getPool(); await pool.request().query('SELECT 1 AS ok'); res.json({ ok: true, datasets: Object.keys(queries) }); }
  catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});

app.get('/api/data/:id', async (req, res) => {
  try {
    const rows = await fetchDataset(req.params.id);
    res.set('Cache-Control', 'no-store');
    res.json(rows);
  } catch (e) {
    console.error(`[${req.params.id}]`, e.message);
    res.status(e.status || 500).json({ error: e.message });
  }
});

app.post('/api/refresh', (req, res) => { cache.clear(); res.json({ ok: true }); });

app.use('/vendor', express.static(path.join(__dirname, 'node_modules', 'd3', 'dist')));
app.use(express.static(path.join(__dirname, 'public')));

app.listen(PORT, () => console.log(`Restaurant Ops Diagnostics → http://localhost:${PORT}`));
