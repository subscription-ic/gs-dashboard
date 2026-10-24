/* One SQL statement per dataset the page reads. Column names here are what public/app.js expects —
   keep them; change only the FROM if your views live under another schema (AZURE_SQL_SCHEMA). */
const S = process.env.AZURE_SQL_SCHEMA || 'dbo';

module.exports = {
  restaurants: {
    title: 'Outlet master',
    sql: `SELECT restaurant_id, name, city, region FROM ${S}.vw_ops_restaurants ORDER BY city, name`,
  },
  daily: {
    title: 'Daily outlet metrics',
    sql: `SELECT restaurant_id, CONVERT(varchar(10), [day], 23) AS [day], weekday, is_weekend, orders, cancelled, cancelled_value,
            kpt_avg, kpt_lt5, kpt_5_8, kpt_8_10, kpt_gt10, kpt_peak, kpt_offpeak,
            online_hours, budget_hours, correct_mfr_pct, mfr_not_marked_pct, handover_avg,
            handover_over3_pct, rider_wait_arrival_pct, food_wait_mfr_pct, food_wait_min, tat_avg,
            rating_avg, rating_count, refund_amt, complaint_orders, unique_concern, multi_concern, product_concern, service_concern,
            crit_veg, crit_foreign, crit_pests, l1_quality, l1_quantity, l1_packaging, l1_missing, l1_wrong
          FROM ${S}.vw_ops_daily ORDER BY restaurant_id, [day]`,
  },
  hourly: {
    title: 'KPT & MFR by weekday and hour',
    sql: `SELECT restaurant_id, weekday, [hour], orders, kpt_avg, correct_mfr_pct, handover_avg, mfr_not_marked_pct
          FROM ${S}.vw_ops_hourly ORDER BY restaurant_id, weekday, [hour]`,
  },
  complaints: {
    title: 'IGCC complaints by L1/L2 per week',
    sql: `SELECT restaurant_id, CONVERT(varchar(10), [week], 23) AS [week], l1, l2, orders, refund_amt, critical_type
          FROM ${S}.vw_ops_complaints ORDER BY restaurant_id, [week], l1, l2`,
  },
  cancellations: {
    title: 'RDC cancellations by reason per week',
    sql: `SELECT restaurant_id, CONVERT(varchar(10), [week], 23) AS [week], reason, cancel_group, orders, value
          FROM ${S}.vw_ops_cancellations ORDER BY restaurant_id, [week], reason`,
  },
  item_issues: {
    title: 'Item-wise complaints',
    sql: `SELECT restaurant_id, item, menu_category, l1, orders, critical_orders, item_orders
          FROM ${S}.vw_ops_item_issues ORDER BY restaurant_id, item, l1`,
  },
  item_cancels: {
    title: 'Items in cancelled orders',
    sql: `SELECT restaurant_id, item, menu_category, orders FROM ${S}.vw_ops_item_cancels ORDER BY restaurant_id, item`,
  },
};
