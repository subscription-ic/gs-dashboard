# Restaurant Ops Diagnostics — Azure SQL edition

The same dashboard you reviewed (Input → Output → Outcome, leaderboard with input → output → outcome drill, expandable metric groups), served from your own Azure SQL data.

```
ops-dashboard/
├─ server.js            Express: static page + /api/data/<dataset> (read-only, cached)
├─ src/queries.js       one SELECT per dataset — column names are fixed, FROM is yours
├─ sql/views.sql        the seven vw_ops_* views; edit the ##source_mapping block, run once
├─ scripts/check.js     `npm run check` — runs every query, confirms rows + columns
└─ public/
   ├─ index.html        page markup (identical to the reviewed dashboard)
   ├─ style.css         page styles (identical)
   ├─ app.js            calculations, filters, leaderboard, cards (identical)
   ├─ charts.js         d3 chart helpers (identical)
   ├─ tokens.css        theme tokens (colours, fonts, spacing) — light + dark
   └─ dash-shim.js      tiny runtime: fetches datasets, runs calcs, re-draws
```

## 1. Prerequisites
- Node.js 18+ (`node -v`)
- Access to the Azure SQL database (SQL login, or Entra ID via `az login`)
- Azure SQL firewall allows your IP (Portal → SQL server → Networking)

## 2. Install
```bash
npm install
cp .env.example .env     # then fill in server / database / credentials
```

## 3. Create the views
Open `sql/views.sql` in VS Code (SQL Server / mssql extension) or SSMS.

1. The views are mapped to the `SWIGGY_Reports` star schema (`dim_restaurant`, `fact_orders`, `fact_concerns`,
   `fact_ratings`, `fact_availability_daily`, `fact_mfr_daily`, `fact_cancellation_items`). Every metric definition
   is written in the header so you can verify each against the sheet (KPT buckets 5/8/10, peak = `is_peak_hour`,
   handover ideal 3 min, refund once per order, brand as the page's "region" level, …).
2. Run the whole file against the database. It creates `vw_ops_restaurants`, `vw_ops_daily`, `vw_ops_hourly`,
   `vw_ops_complaints`, `vw_ops_cancellations`, `vw_ops_item_issues`, `vw_ops_item_cancels`
   (plus the helpers `vw_ops_bounds`, `vw_ops_order_measures`, `vw_ops_complaint_lines`). Re-running is safe (`CREATE OR ALTER`).

If a feed is missing, create a stub view with the same columns returning no rows — the page shows the dash for that metric and keeps working.

## 4. Verify
```bash
npm run check
```
Prints each dataset with its row count and `ok`, `EMPTY`, `MISSING <columns>` or `FAILED <sql error>`.

## 5. Run
```bash
npm start            # or: npm run dev  (restarts on file change)
```
Open http://localhost:3000. "↻ Reload data" re-queries SQL (the server caches each dataset for `CACHE_TTL_SECONDS`, default 5 min).

## How it maps to the sheet
| Dataset | Feeds | Drives |
|---|---|---|
| `daily` | Swiggy timestamps, online hours, rating, IGCC, RDC | every tile, delta vs prior period, daily and weekly trends, KPT buckets, visibility, MFR/handover, TAT, concerns, critical, refunds |
| `hourly` | Swiggy timestamps | hour × weekday heatmap, day-part and peak/off-peak cuts for KPT, MFR, handover |
| `complaints` | IGCC | L2 drill-down, refund by reason, weekly concern mix |
| `cancellations` | RDC | reason %, cancelled-by, OOS proxy, weekly mix, top reason |
| `item_issues` | IGCC item column | item-wise lists (same item / menu category), critical items |
| `item_cancels` | RDC + order items | product-wise cancellation |
| `restaurants` | master | brand / city / outlet filters (multi-select), leaderboard |

Everything else (network comparison, prior-period change, percentiles, leaderboard flags) is computed in the browser from these rows, exactly as in the reviewed version — see `dash.calc('kpis' | 'hourly_cuts' | 'cancel_mix')` in `public/app.js`.

## Tuning
- **Thresholds** (green / amber / red): `TH` at the top of `public/app.js`.
- **KPT bucket edges, peak hours, ideal handover**: `sql/views.sql` header (SQL) — the labels on the page are in `index.html`.
- **Ideal TAT**: set it in the TAT card (default 18 min) or change `state.ideal` in `app.js`.
- **Colours / fonts**: `public/tokens.css` only.
- **History window**: the hourly and item views look back 84 days (`DATEADD(DAY, -84, …)`); the daily view returns everything, and the page's "12 weeks" period needs at least 168 days for a prior-period comparison.

## Deploying
Any Node host works (Azure App Service, Container Apps, a VM). Set the `.env` values as app settings; with a managed identity use `AZURE_SQL_AUTH=aad` and grant the identity `db_datareader` on the database. Put the app behind your SSO — it has no login of its own.
