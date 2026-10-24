/* Runs every dataset query once and reports row counts, columns and any error. `npm run check` */
require('dotenv').config();
const sql = require('mssql');
const queries = require('../src/queries');

const EXPECTED = {
  restaurants: ['restaurant_id', 'name', 'city', 'region'],
  daily: ['restaurant_id', 'day', 'weekday', 'is_weekend', 'orders', 'cancelled', 'cancelled_value', 'kpt_avg', 'kpt_lt5', 'kpt_5_8', 'kpt_8_10', 'kpt_gt10', 'kpt_peak', 'kpt_offpeak', 'online_hours', 'budget_hours', 'correct_mfr_pct', 'mfr_not_marked_pct', 'handover_avg', 'handover_over3_pct', 'rider_wait_arrival_pct', 'food_wait_mfr_pct', 'food_wait_min', 'tat_avg', 'rating_avg', 'rating_count', 'refund_amt', 'complaint_orders', 'unique_concern', 'multi_concern', 'product_concern', 'service_concern', 'crit_veg', 'crit_foreign', 'crit_pests', 'l1_quality', 'l1_quantity', 'l1_packaging', 'l1_missing', 'l1_wrong'],
  hourly: ['restaurant_id', 'weekday', 'hour', 'orders', 'kpt_avg', 'correct_mfr_pct', 'handover_avg', 'mfr_not_marked_pct'],
  complaints: ['restaurant_id', 'week', 'l1', 'l2', 'orders', 'refund_amt', 'critical_type'],
  cancellations: ['restaurant_id', 'week', 'reason', 'cancel_group', 'orders', 'value'],
  item_issues: ['restaurant_id', 'item', 'menu_category', 'l1', 'orders', 'critical_orders', 'item_orders'],
  item_cancels: ['restaurant_id', 'item', 'menu_category', 'orders'],
};

(async () => {
  const cfg = {
    server: process.env.AZURE_SQL_SERVER, database: process.env.AZURE_SQL_DATABASE,
    options: { encrypt: true }, requestTimeout: 120000,
    ...((process.env.AZURE_SQL_AUTH || '').toLowerCase() === 'aad' ? { authentication: { type: 'azure-active-directory-default' } } : { user: process.env.AZURE_SQL_USER, password: process.env.AZURE_SQL_PASSWORD }),
  };
  let pool;
  try { pool = await sql.connect(cfg); console.log(`Connected to ${cfg.server}/${cfg.database}\n`); }
  catch (e) { console.error('Connection failed:', e.message); process.exit(1); }
  let bad = 0;
  for (const [id, q] of Object.entries(queries)) {
    const t = Date.now();
    try {
      const r = await pool.request().query(q.sql);
      const cols = r.recordset.columns ? Object.keys(r.recordset.columns) : Object.keys(r.recordset[0] || {});
      const missing = EXPECTED[id].filter((c) => !cols.includes(c));
      const flag = r.recordset.length === 0 ? 'EMPTY' : missing.length ? 'MISSING ' + missing.join(',') : 'ok';
      if (flag !== 'ok') bad++;
      console.log(`${id.padEnd(14)} ${String(r.recordset.length).padStart(7)} rows  ${String(Date.now() - t).padStart(6)} ms  ${flag}`);
    } catch (e) { bad++; console.log(`${id.padEnd(14)}   FAILED  ${e.message}`); }
  }
  await pool.close();
  console.log(bad ? `\n${bad} dataset(s) need attention — see sql/views.sql ##source_mapping.` : '\nAll datasets return rows with the expected columns.');
  process.exit(bad ? 1 : 0);
})();
