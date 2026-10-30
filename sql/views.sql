/* =====================================================================================
   Restaurant Ops Diagnostics — Azure SQL views for SWIGGY_Reports
   -------------------------------------------------------------------------------------
   The page reads exactly seven views. Their OUTPUT columns are fixed (public/app.js
   depends on them). This file maps them onto the SWIGGY_Reports star schema:

     dim_restaurant           restaurant_id, brand, city, area
     fact_orders              one row per order (delivered + RDC-cancelled), timestamps and derived minutes
     fact_concerns            one row per IGCC concern line (l1_issue, l2_issue, concern_category, critical_type, refund_order)
     fact_ratings             one row per rated order
     fact_availability_daily  outlet × day: ideal_open_hrs, actual_open_hrs
     fact_mfr_daily           outlet × day: correct_mfr_pct_swiggy (0–1)
     fact_cancellation_items  one row per item of a cancelled order

   Definitions:
     Orders         = every order in fact_orders (delivered + cancelled); time metrics use delivered orders only
     KPT            = fact_orders.kpt_min (OrderedTime → MFRTime); buckets <5 / 5–8 / 8–10 / 10–12 / ≥12 min (≥10 kept for the over-10 share)
     Peak hours     = fact_orders.is_peak_hour (12:00–14:59 and 19:00–21:59)
     Correct MFR    = fact_mfr_daily.correct_mfr_pct_swiggy; where Swiggy has no figure, share of orders marked
                      ready before rider arrival (also the hourly cut, which Swiggy doesn't report)
     Not marked     = fact_orders.mfr_not_marked
     Handover       = fact_orders.handover_min (rider arrival → pickup); rider waited = handover_over_3min
     Food waited    = fact_orders.mfr_before_arrival; minutes = food_wait_min on those orders
     TAT            = fact_orders.order_to_pickup_min
     Visibility     = actual_open_hrs ÷ ideal_open_hrs
     Rating         = average of fact_ratings.rating per outlet-day, with its count
     Concerns       = fact_concerns.concern_category (Product / Service), counted once per order;
                      refund = refund_order once per order (refund_line repeats the order refund on every line)
     Critical       = fact_concerns.critical_type (Veg/Non-veg, Foreign particle, Pests)
     Cancel groups  = fact_orders.cancel_l2: RDC_RCC, RDC_OOS, RDC_FXM → FXM, SDC_Tech* → Tech, rest → Other
     Outlet         = area · brand (areas repeat across brands); the page's "region" level is the brand
     Weekday        = 0 = Mon … 6 = Sun (DATEDIFF from 1900-01-01, a Monday — independent of @@DATEFIRST)
     Data end       = last day covered by both fact_orders and fact_availability_daily, so a stray
                      after-midnight order doesn't open a near-empty day
   ===================================================================================== */

SET ANSI_NULLS ON; SET QUOTED_IDENTIFIER ON;
GO

/* ---------- 0. helpers ---------- */
CREATE OR ALTER VIEW dbo.vw_ops_bounds AS
SELECT CASE WHEN o.max_day < a.max_day THEN o.max_day ELSE a.max_day END AS max_day
FROM (SELECT MAX(order_date) AS max_day FROM dbo.fact_orders) o
CROSS JOIN (SELECT MAX(avail_date) AS max_day FROM dbo.fact_availability_daily) a;
GO

CREATE OR ALTER VIEW dbo.vw_ops_order_measures AS
SELECT
  o.order_id, CAST(o.restaurant_id AS varchar(20))                               AS restaurant_id,
  o.order_date                                                                   AS [day],
  o.order_hour                                                                   AS [hour],
  DATEDIFF(DAY, '19000101', o.order_date) % 7                                    AS weekday,
  CAST(o.is_cancelled AS int)                                                    AS is_cancelled,
  o.cancelled_gmv,
  o.kpt_min,
  CAST(o.mfr_not_marked AS int)                                                  AS mfr_not_marked,
  CASE WHEN o.mfr_at IS NOT NULL AND o.rider_arrived_at IS NOT NULL
       THEN CAST(o.mfr_before_arrival AS int) END                                AS mfr_before_arrival,
  o.handover_min,
  CASE WHEN o.handover_min IS NOT NULL THEN CAST(o.handover_over_3min AS int) END AS handover_over3,
  CASE WHEN o.mfr_before_arrival = 1 THEN o.food_wait_min END                    AS food_wait_min,
  o.order_to_pickup_min                                                          AS tat_min,
  CAST(o.is_peak_hour AS int)                                                    AS is_peak
FROM dbo.fact_orders o
WHERE o.order_date <= (SELECT max_day FROM dbo.vw_ops_bounds);
GO

/* ---------- 1. restaurants ---------- */
CREATE OR ALTER VIEW dbo.vw_ops_restaurants AS
SELECT CAST(d.restaurant_id AS varchar(20))              AS restaurant_id,
       d.area + N' · ' + REPLACE(d.brand, '_', ' ')      AS name,
       d.city,
       REPLACE(d.brand, '_', ' ')                        AS region
FROM dbo.dim_restaurant d
WHERE EXISTS (SELECT 1 FROM dbo.fact_orders o WHERE o.restaurant_id = d.restaurant_id)
   OR EXISTS (SELECT 1 FROM dbo.fact_availability_daily a WHERE a.restaurant_id = d.restaurant_id);
GO

/* ---------- 2. complaint lines with the order's line count (for splitting the order refund) ---------- */
CREATE OR ALTER VIEW dbo.vw_ops_complaint_lines AS
SELECT
  c.order_id, CAST(c.restaurant_id AS varchar(20)) AS restaurant_id, c.concern_date,
  c.l1_issue AS l1,
  CASE WHEN c.l2_issue IS NULL OR c.l2_issue IN ('', '-1') THEN 'Not specified' ELSE c.l2_issue END AS l2,
  c.impacted_item_clean AS item,
  c.concern_category,
  ISNULL(c.critical_type, '') AS critical_type,
  c.refund_order,
  c.refund_order / NULLIF(COUNT(*) OVER (PARTITION BY c.order_id), 0) AS refund_share
FROM dbo.fact_concerns c
WHERE c.concern_date <= (SELECT max_day FROM dbo.vw_ops_bounds);
GO

/* ---------- 3. daily: one row per outlet per day ---------- */
CREATE OR ALTER VIEW dbo.vw_ops_daily AS
WITH bounds AS (SELECT max_day FROM dbo.vw_ops_bounds),
days AS (
  SELECT restaurant_id, [day] FROM dbo.vw_ops_order_measures
  UNION SELECT CAST(restaurant_id AS varchar(20)), avail_date FROM dbo.fact_availability_daily WHERE avail_date <= (SELECT max_day FROM bounds)
  UNION SELECT restaurant_id, concern_date FROM dbo.vw_ops_complaint_lines
  UNION SELECT CAST(restaurant_id AS varchar(20)), rating_date FROM dbo.fact_ratings WHERE rating_date <= (SELECT max_day FROM bounds)
),
ord AS (
  SELECT restaurant_id, [day],
    COUNT(*)                                                                     AS orders,
    SUM(is_cancelled)                                                            AS cancelled,
    SUM(ISNULL(cancelled_gmv, 0))                                                AS cancelled_value,
    AVG(CASE WHEN is_cancelled = 0 THEN kpt_min END)                             AS kpt_avg,
    SUM(CASE WHEN is_cancelled = 0 AND kpt_min <  5 THEN 1 ELSE 0 END)           AS kpt_lt5,
    SUM(CASE WHEN is_cancelled = 0 AND kpt_min >= 5 AND kpt_min < 8 THEN 1 ELSE 0 END)  AS kpt_5_8,
    SUM(CASE WHEN is_cancelled = 0 AND kpt_min >= 8 AND kpt_min < 10 THEN 1 ELSE 0 END) AS kpt_8_10,
    SUM(CASE WHEN is_cancelled = 0 AND kpt_min >= 10 AND kpt_min < 12 THEN 1 ELSE 0 END) AS kpt_10_12,
    SUM(CASE WHEN is_cancelled = 0 AND kpt_min >= 12 THEN 1 ELSE 0 END)          AS kpt_gt12,
    SUM(CASE WHEN is_cancelled = 0 AND kpt_min >= 10 THEN 1 ELSE 0 END)          AS kpt_gt10,
    AVG(CASE WHEN is_cancelled = 0 AND is_peak = 1 THEN kpt_min END)             AS kpt_peak,
    AVG(CASE WHEN is_cancelled = 0 AND is_peak = 0 THEN kpt_min END)             AS kpt_offpeak,
    AVG(CASE WHEN is_cancelled = 0 THEN CAST(mfr_before_arrival AS float) END)   AS correct_mfr_proxy,
    AVG(CASE WHEN is_cancelled = 0 THEN CAST(mfr_not_marked AS float) END)       AS mfr_not_marked_pct,
    AVG(CASE WHEN is_cancelled = 0 THEN handover_min END)                        AS handover_avg,
    AVG(CASE WHEN is_cancelled = 0 THEN CAST(handover_over3 AS float) END)       AS handover_over3_pct,
    AVG(CASE WHEN is_cancelled = 0 THEN CAST(mfr_before_arrival AS float) END)   AS food_wait_mfr_pct,
    AVG(CASE WHEN is_cancelled = 0 THEN food_wait_min END)                       AS food_wait_min,
    AVG(CASE WHEN is_cancelled = 0 THEN tat_min END)                             AS tat_avg
  FROM dbo.vw_ops_order_measures GROUP BY restaurant_id, [day]
),
comp_orders AS (            -- one row per complaint order with its L1 set
  SELECT restaurant_id, concern_date AS [day], order_id,
    MAX(refund_order)                                                       AS refund_amt,   -- one value per order
    COUNT(DISTINCT l1)                                                      AS l1_count,
    MAX(CASE WHEN concern_category = 'Product' THEN 1 ELSE 0 END)           AS has_product,
    MAX(CASE WHEN concern_category = 'Service' THEN 1 ELSE 0 END)           AS has_service,
    MAX(CASE WHEN l1 = 'QUALITY_ISSUES'   THEN 1 ELSE 0 END)                AS l1_quality,
    MAX(CASE WHEN l1 = 'QUANTITY_ISSUES'  THEN 1 ELSE 0 END)                AS l1_quantity,
    MAX(CASE WHEN l1 = 'Packaging_issues' THEN 1 ELSE 0 END)                AS l1_packaging,
    MAX(CASE WHEN l1 = 'MISSING_ITEMS'    THEN 1 ELSE 0 END)                AS l1_missing,
    MAX(CASE WHEN l1 = 'WRONG_ITEMS'      THEN 1 ELSE 0 END)                AS l1_wrong,
    MAX(CASE WHEN critical_type = 'Veg/Non-veg'      THEN 1 ELSE 0 END)     AS crit_veg,
    MAX(CASE WHEN critical_type = 'Foreign particle' THEN 1 ELSE 0 END)     AS crit_foreign,
    MAX(CASE WHEN critical_type = 'Pests'            THEN 1 ELSE 0 END)     AS crit_pests
  FROM dbo.vw_ops_complaint_lines GROUP BY restaurant_id, concern_date, order_id
),
comp AS (
  SELECT restaurant_id, [day],
    COUNT(*) AS complaint_orders, SUM(refund_amt) AS refund_amt,
    SUM(CASE WHEN l1_count = 1 THEN 1 ELSE 0 END) AS unique_concern,
    SUM(CASE WHEN l1_count > 1 THEN 1 ELSE 0 END) AS multi_concern,
    SUM(has_product) AS product_concern, SUM(has_service) AS service_concern,
    SUM(l1_quality) AS l1_quality, SUM(l1_quantity) AS l1_quantity, SUM(l1_packaging) AS l1_packaging, SUM(l1_missing) AS l1_missing, SUM(l1_wrong) AS l1_wrong,
    SUM(crit_veg) AS crit_veg, SUM(crit_foreign) AS crit_foreign, SUM(crit_pests) AS crit_pests
  FROM comp_orders GROUP BY restaurant_id, [day]
),
rat AS (
  SELECT CAST(restaurant_id AS varchar(20)) AS restaurant_id, rating_date AS [day], AVG(CAST(rating AS float)) AS rating_avg, COUNT(*) AS rating_count
  FROM dbo.fact_ratings GROUP BY restaurant_id, rating_date
)
SELECT
  d.restaurant_id, d.[day],
  DATEDIFF(DAY, '19000101', d.[day]) % 7                                                 AS weekday,
  CASE WHEN DATEDIFF(DAY, '19000101', d.[day]) % 7 >= 5 THEN 1 ELSE 0 END                AS is_weekend,
  ISNULL(o.orders, 0) AS orders, ISNULL(o.cancelled, 0) AS cancelled, ISNULL(o.cancelled_value, 0) AS cancelled_value,
  o.kpt_avg, ISNULL(o.kpt_lt5, 0) AS kpt_lt5, ISNULL(o.kpt_5_8, 0) AS kpt_5_8, ISNULL(o.kpt_8_10, 0) AS kpt_8_10, ISNULL(o.kpt_10_12, 0) AS kpt_10_12, ISNULL(o.kpt_gt12, 0) AS kpt_gt12, ISNULL(o.kpt_gt10, 0) AS kpt_gt10,
  o.kpt_peak, o.kpt_offpeak,
  ISNULL(a.actual_open_hrs, 0) AS online_hours, ISNULL(a.ideal_open_hrs, 0) AS budget_hours,
  COALESCE(m.correct_mfr_pct_swiggy, o.correct_mfr_proxy)                                AS correct_mfr_pct,   -- 0–1
  o.mfr_not_marked_pct, o.handover_avg, o.handover_over3_pct, o.handover_over3_pct AS rider_wait_arrival_pct,
  o.food_wait_mfr_pct, o.food_wait_min, o.tat_avg,
  r.rating_avg, ISNULL(r.rating_count, 0) AS rating_count,
  ISNULL(p.refund_amt, 0) AS refund_amt, ISNULL(p.complaint_orders, 0) AS complaint_orders,
  ISNULL(p.unique_concern, 0) AS unique_concern, ISNULL(p.multi_concern, 0) AS multi_concern,
  ISNULL(p.product_concern, 0) AS product_concern, ISNULL(p.service_concern, 0) AS service_concern,
  ISNULL(p.crit_veg, 0) AS crit_veg, ISNULL(p.crit_foreign, 0) AS crit_foreign, ISNULL(p.crit_pests, 0) AS crit_pests,
  ISNULL(p.l1_quality, 0) AS l1_quality, ISNULL(p.l1_quantity, 0) AS l1_quantity, ISNULL(p.l1_packaging, 0) AS l1_packaging,
  ISNULL(p.l1_missing, 0) AS l1_missing, ISNULL(p.l1_wrong, 0) AS l1_wrong
FROM days d
LEFT JOIN ord  o ON o.restaurant_id = d.restaurant_id AND o.[day] = d.[day]
LEFT JOIN comp p ON p.restaurant_id = d.restaurant_id AND p.[day] = d.[day]
LEFT JOIN rat  r ON r.restaurant_id = d.restaurant_id AND r.[day] = d.[day]
LEFT JOIN dbo.fact_availability_daily a ON CAST(a.restaurant_id AS varchar(20)) = d.restaurant_id AND a.avail_date = d.[day]
LEFT JOIN dbo.fact_mfr_daily          m ON CAST(m.restaurant_id AS varchar(20)) = d.restaurant_id AND m.mfr_date   = d.[day];
GO

/* ---------- 4. hourly: outlet × weekday × hour over the trailing 84 days of data ---------- */
CREATE OR ALTER VIEW dbo.vw_ops_hourly AS
SELECT restaurant_id, weekday, [hour],
  COUNT(*) AS orders,
  AVG(kpt_min) AS kpt_avg,
  AVG(CAST(mfr_before_arrival AS float)) AS correct_mfr_pct,        -- 0–1 (order-level proxy; Swiggy's daily figure has no hour)
  AVG(handover_min) AS handover_avg,
  AVG(CAST(mfr_not_marked AS float)) AS mfr_not_marked_pct
FROM dbo.vw_ops_order_measures
WHERE is_cancelled = 0 AND [hour] IS NOT NULL
  AND [day] > DATEADD(DAY, -84, (SELECT max_day FROM dbo.vw_ops_bounds))
GROUP BY restaurant_id, weekday, [hour];
GO

/* ---------- 5. complaints by week × L1 × L2 ---------- */
CREATE OR ALTER VIEW dbo.vw_ops_complaints AS
SELECT restaurant_id,
  DATEADD(DAY, -(DATEDIFF(DAY, '19000101', concern_date) % 7), concern_date) AS [week],   -- Monday
  l1, l2,
  COUNT(DISTINCT order_id) AS orders,
  SUM(refund_share)        AS refund_amt,
  MAX(critical_type)       AS critical_type
FROM dbo.vw_ops_complaint_lines
GROUP BY restaurant_id, DATEADD(DAY, -(DATEDIFF(DAY, '19000101', concern_date) % 7), concern_date), l1, l2;
GO

/* ---------- 6. cancellations by week × reason ---------- */
CREATE OR ALTER VIEW dbo.vw_ops_cancellations AS
WITH c AS (
  SELECT CAST(restaurant_id AS varchar(20)) AS restaurant_id, order_date, cancelled_gmv,
    ISNULL(cancel_reason, 'Unknown') AS reason,
    CASE WHEN cancel_l2 IN ('RDC_RCC', 'RDC_OOS') THEN cancel_l2
         WHEN cancel_l2 = 'RDC_FXM' THEN 'FXM'
         WHEN cancel_l2 LIKE '%Tech%' THEN 'Tech'
         ELSE 'Other' END AS cancel_group
  FROM dbo.fact_orders
  WHERE is_cancelled = 1 AND order_date <= (SELECT max_day FROM dbo.vw_ops_bounds)
)
SELECT restaurant_id,
  DATEADD(DAY, -(DATEDIFF(DAY, '19000101', order_date) % 7), order_date) AS [week],
  reason, cancel_group,
  COUNT(*) AS orders, SUM(ISNULL(cancelled_gmv, 0)) AS value
FROM c
GROUP BY restaurant_id, DATEADD(DAY, -(DATEDIFF(DAY, '19000101', order_date) % 7), order_date), reason, cancel_group;
GO

/* ---------- 7. item-wise complaints (trailing 84 days of data) ---------- */
CREATE OR ALTER VIEW dbo.vw_ops_item_issues AS
WITH lines AS (
  SELECT * FROM dbo.vw_ops_complaint_lines
  WHERE item IS NOT NULL AND item <> '' AND concern_date > DATEADD(DAY, -84, (SELECT max_day FROM dbo.vw_ops_bounds))
),
per_item AS (SELECT restaurant_id, item, COUNT(DISTINCT order_id) AS item_orders FROM lines GROUP BY restaurant_id, item)
SELECT l.restaurant_id, l.item,
  'Uncategorised' AS menu_category,                                -- SWIGGY_Reports has no item → menu-category master yet
  l.l1,
  COUNT(DISTINCT l.order_id) AS orders,
  COUNT(DISTINCT CASE WHEN l.critical_type <> '' THEN l.order_id END) AS critical_orders,
  MAX(pi.item_orders) AS item_orders                               -- = all complaints on that item (denominator for "same item %")
FROM lines l
JOIN per_item pi ON pi.restaurant_id = l.restaurant_id AND pi.item = l.item
GROUP BY l.restaurant_id, l.item, l.l1;
GO

/* ---------- 8. items in cancelled orders (trailing 84 days of data) ---------- */
CREATE OR ALTER VIEW dbo.vw_ops_item_cancels AS
SELECT CAST(restaurant_id AS varchar(20)) AS restaurant_id, item, 'Uncategorised' AS menu_category, COUNT(DISTINCT order_id) AS orders
FROM dbo.fact_cancellation_items
WHERE item IS NOT NULL AND cancel_date > DATEADD(DAY, -84, (SELECT max_day FROM dbo.vw_ops_bounds))
  AND cancel_date <= (SELECT max_day FROM dbo.vw_ops_bounds)
GROUP BY restaurant_id, item;
GO
