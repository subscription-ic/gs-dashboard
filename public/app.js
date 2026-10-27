/* Restaurant Ops Diagnostics — page logic. Data via dash.*; charts via window.C. */
(function () {
  const $ = (id) => document.getElementById(id);
  const N = (x) => (x === '' || x == null ? null : +x);
  const enc = (s) => String(s).replace(/%/g, '%25').replace(/&/g, '%26').replace(/=/g, '%3D');
  const where = (o) => Object.entries(o).map(([k, v]) => enc(k) + '=' + enc(v)).join('&');
  const attr = (s) => s.replace(/&/g, '&amp;');
  const inr = new Intl.NumberFormat('en-IN', { maximumFractionDigits: 0 });
  const F = {
    pct: (v) => (v == null ? '—' : v.toFixed(1) + '%'),
    min: (v) => (v == null ? '—' : v.toFixed(1) + ' min'),
    inr: (v) => (v == null ? '—' : '₹' + inr.format(Math.round(v))),
    int: (v) => (v == null ? '—' : d3.format(',')(Math.round(v))),
    rating: (v) => (v == null ? '—' : v.toFixed(2)),
    hours: (v) => (v == null ? '—' : v.toFixed(1) + ' h'),
    days: (v) => (v == null ? '—' : (Number.isInteger(v) ? d3.format(',')(v) : v.toFixed(1)) + (v === 1 ? ' day' : ' days')),
    num1: (v) => (v == null ? '—' : v.toFixed(1)),
  };
  const PERIOD_LABEL = { 7: 'last 7 days', 28: 'last 4 weeks', 84: 'last 12 weeks' };
  const WD = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

  /* ---------- status thresholds: [good direction, warn at, bad at] ---------- */
  const TH = {
    rating: ['high', 4.3, 4.1], kpt: ['low', 8, 10], kpt_peak: ['low', 9.5, 12], kpt_offpeak: ['low', 7.5, 9.5], kpt_gt10_pct: ['low', 15, 30],
    vis_pct: ['high', 95, 90], nonop_days: ['low', 0.5, 1.5], mfr_correct_pct: ['high', 92, 85], mfr_incorrect_pct: ['low', 8, 15], mfr_not_marked_pct: ['low', 2, 4],
    handover: ['low', 3, 4], handover_dev: ['low', 0, 1], over3_pct: ['low', 40, 60], wait_arr_pct: ['low', 35, 50], food_wait_pct: ['low', 12, 20], food_wait_min: ['low', 5, 7],
    cancel_pct: ['low', 3, 5], completion_pct: ['high', 97, 95], product_pct: ['low', 2, 3.5], service_pct: ['low', 1.5, 2.5], complaint_pct: ['low', 3.5, 6],
    multi_pct: ['low', 0.6, 1.2], tat: ['low', 18, 22], crit_total: ['low', 0.5, 2.5],
  };
  const GOOD = Object.fromEntries(Object.entries(TH).map(([k, v]) => [k, v[0]]));
  Object.assign(GOOD, { sale_loss: 'low', refund: 'low', guest_value: 'low', est_lost_orders: 'low', est_lost_value: 'low', offline_hours: 'low', unique_pct: 'low', rating_n: 'high', orders: 'high' });
  const status = (k, v) => { const t = TH[k]; if (!t || v == null) return ''; const [dir, warn, bad] = t; if (dir === 'low') return v > bad ? 'bad' : v > warn ? 'warn' : 'ok'; return v < bad ? 'bad' : v < warn ? 'warn' : 'ok'; };
  const deltaClass = (k, d) => { if (d == null || d === 0) return ''; const g = GOOD[k] || 'low'; return (g === 'low') === d < 0 ? 'good' : 'poor'; };
  const SIGNED = { pct: (d) => (d > 0 ? '+' : '') + d.toFixed(1) + ' pt', min: (d) => (d > 0 ? '+' : '') + d.toFixed(1) + ' min', inr: (d) => (d > 0 ? '+' : '−') + '₹' + inr.format(Math.abs(Math.round(d))), int: (d) => (d > 0 ? '+' : '') + d3.format(',')(Math.round(d)), rating: (d) => (d > 0 ? '+' : '') + d.toFixed(2), hours: (d) => (d > 0 ? '+' : '') + d.toFixed(1) + ' h', days: (d) => (d > 0 ? '+' : '') + (Number.isInteger(d) ? d : d.toFixed(1)) + ' days', num1: (d) => (d > 0 ? '+' : '') + d.toFixed(1) };

  /* ---------- calculations (readers can open these in Sources) ---------- */

  const dayNum = (s) => Date.UTC(+s.slice(0, 4), +s.slice(5, 7) - 1, +s.slice(8, 10)) / 864e5;
  const KPI_SUMS = ['orders', 'cancelled', 'cancelled_value', 'kpt_lt5', 'kpt_5_8', 'kpt_8_10', 'kpt_gt10', 'online_hours', 'budget_hours', 'rating_count', 'refund_amt', 'complaint_orders', 'unique_concern', 'multi_concern', 'product_concern', 'service_concern', 'crit_veg', 'crit_foreign', 'crit_pests', 'l1_quality', 'l1_quantity', 'l1_packaging', 'l1_missing', 'l1_wrong'];
  const KPI_WAVG = ['kpt_avg', 'kpt_peak', 'kpt_offpeak', 'correct_mfr_pct', 'mfr_not_marked_pct', 'handover_avg', 'handover_over3_pct', 'rider_wait_arrival_pct', 'food_wait_mfr_pct', 'food_wait_min', 'tat_avg'];
  let NET_AOV = 0;   // network average cancelled-order value, set when `kpis` is computed
  const KPI_DELTAS = ['rating', 'rating_n', 'sale_loss', 'refund', 'guest_value', 'cancel_pct', 'completion_pct', 'product_pct', 'service_pct', 'complaint_pct', 'unique_pct', 'multi_pct', 'crit_total', 'kpt', 'kpt_peak', 'kpt_offpeak', 'kpt_gt10_pct', 'vis_pct', 'nonop_days', 'offline_hours', 'est_lost_orders', 'est_lost_value', 'mfr_correct_pct', 'mfr_incorrect_pct', 'mfr_not_marked_pct', 'handover', 'handover_dev', 'over3_pct', 'wait_arr_pct', 'food_wait_pct', 'food_wait_min', 'tat', 'orders'];

  /* Every headline figure for one set of daily rows. Shares are percent of orders; time cuts are orders-weighted. */
  function kpiAgg(rows) {
    const N = (x) => +x || 0, r1 = (v) => Math.round(v * 10) / 10, r2 = (v) => Math.round(v * 100) / 100;
    // non-operational = a day the outlet was planned to open (ideal hours > 0) but was online 0 hours; counted per outlet
    const s = {}; let nonop = 0, ratingW = 0; const ids = new Set(), planned = new Set(), offline = new Set();
    for (const r of rows) {
      const o = N(r.orders); ids.add(r.restaurant_id);
      for (const k of KPI_SUMS) s[k] = (s[k] || 0) + N(r[k]);
      for (const k of KPI_WAVG) s[k] = (s[k] || 0) + N(r[k]) * o;
      ratingW += N(r.rating_avg) * N(r.rating_count);
      if (N(r.budget_hours) > 0) { planned.add(r.restaurant_id); if (N(r.online_hours) === 0) { nonop++; offline.add(r.restaurant_id); } }
    }
    const o = s.orders || 0, pc = (v) => (o ? r1((100 * v) / o) : null), w = (k) => (o ? r1(s[k] / o) : null), ps = (k) => (o ? r1((100 * s[k]) / o) : null);
    const comp = s.complaint_orders || 0, pcomp = (v) => (comp ? r1((100 * v) / comp) : null);
    const offHours = (s.budget_hours || 0) - (s.online_hours || 0), perHr = s.online_hours ? o / s.online_hours : 0;
    // order value for lost orders: the cancelled-order average (no GMV feed); too few cancellations → the network's
    const aov = (s.cancelled || 0) >= 20 ? s.cancelled_value / s.cancelled : NET_AOV;
    const crit = (s.crit_veg || 0) + (s.crit_foreign || 0) + (s.crit_pests || 0), pcrit = (v) => (crit ? r1((100 * v) / crit) : null), pc2 = (v) => (o ? r2((100 * v) / o) : null);
    return {
      outlets: ids.size, days: rows.length, orders: o,
      rating: s.rating_count ? r2(ratingW / s.rating_count) : null, rating_n: s.rating_count || 0,
      sale_loss: s.cancelled_value || 0, refund: s.refund_amt || 0, guest_value: (s.refund_amt || 0) + (s.cancelled_value || 0),
      cancelled: s.cancelled || 0, cancel_pct: pc(s.cancelled || 0), completion_pct: o ? r1(100 - (100 * (s.cancelled || 0)) / o) : null,
      complaints: comp, complaint_pct: pc(comp), product_pct: pc(s.product_concern || 0), service_pct: pc(s.service_concern || 0),
      product_share: pcomp(s.product_concern || 0), service_share: pcomp(s.service_concern || 0),
      unique: s.unique_concern || 0, multi: s.multi_concern || 0, unique_pct: pc(s.unique_concern || 0), multi_pct: pc(s.multi_concern || 0),
      l1_quality_pct: pc(s.l1_quality || 0), l1_quantity_pct: pc(s.l1_quantity || 0), l1_packaging_pct: pc(s.l1_packaging || 0), l1_missing_pct: pc(s.l1_missing || 0), l1_wrong_pct: pc(s.l1_wrong || 0),
      crit_total: crit, crit_veg: s.crit_veg || 0, crit_foreign: s.crit_foreign || 0, crit_pests: s.crit_pests || 0,
      crit_veg_pct: pc2(s.crit_veg || 0), crit_foreign_pct: pc2(s.crit_foreign || 0), crit_pests_pct: pc2(s.crit_pests || 0),
      crit_veg_share: pcrit(s.crit_veg || 0), crit_foreign_share: pcrit(s.crit_foreign || 0), crit_pests_share: pcrit(s.crit_pests || 0),
      kpt: w('kpt_avg'), kpt_peak: w('kpt_peak'), kpt_offpeak: w('kpt_offpeak'),
      kpt_lt5_pct: pc(s.kpt_lt5 || 0), kpt_5_8_pct: pc(s.kpt_5_8 || 0), kpt_8_10_pct: pc(s.kpt_8_10 || 0), kpt_gt10_pct: pc(s.kpt_gt10 || 0),
      vis_pct: s.budget_hours ? r1((100 * s.online_hours) / s.budget_hours) : null, offline_hours: r1(offHours),
      nonop_days: planned.size ? r1(nonop / planned.size) : null, nonop_outlet_days: nonop, nonop_outlets: offline.size, outlets_planned: planned.size,
      est_lost_orders: Math.round(offHours * perHr), est_lost_value: Math.round(offHours * perHr * aov),
      mfr_correct_pct: ps('correct_mfr_pct'), mfr_incorrect_pct: o ? r1(100 - (100 * s.correct_mfr_pct) / o) : null, mfr_not_marked_pct: ps('mfr_not_marked_pct'),
      handover: w('handover_avg'), handover_dev: o ? r1(s.handover_avg / o - 3) : null, over3_pct: ps('handover_over3_pct'), wait_arr_pct: ps('rider_wait_arrival_pct'), food_wait_pct: ps('food_wait_mfr_pct'), food_wait_min: w('food_wait_min'),
      tat: w('tat_avg'),
    };
  }

  /* Headline KPIs for one scope's daily rows over the `period` days ending `end`, for one day type, with the prior period
     (the same number of days just before) and its change. */
  function kpiFor(rows, end, period, daytype) {
    const N = (x) => +x || 0, r2 = (v) => Math.round(v * 100) / 100;
    const dt = (r) => daytype === 'all' || (daytype === 'weekend') === (N(r.is_weekend) === 1);
    const cur = kpiAgg(rows.filter((r) => dt(r) && dayNum(r.day) > end - period && dayNum(r.day) <= end));
    const prevRows = rows.filter((r) => dt(r) && dayNum(r.day) > end - 2 * period && dayNum(r.day) <= end - period);
    const prev = prevRows.length ? kpiAgg(prevRows) : null;
    const row = Object.assign({ period, daytype }, cur);
    for (const k of KPI_DELTAS) { row[k + '_prev'] = prev ? prev[k] : null; row[k + '_d'] = prev && cur[k] != null && prev[k] != null ? r2(cur[k] - prev[k]) : null; }
    return row;
  }

  dash.calc('kpis', {
    title: 'Headline KPIs per outlet and for the network',
    description: 'kpiFor() for the network and every outlet × period (last 7 / 28 / 84 days) × day type. A multi-outlet brand / city / outlet selection is computed on demand with the same function.',
    inputs: ['daily', 'restaurants'],
    fn: (daily, restaurants) => {
      const cv = d3.sum(daily, (r) => +r.cancelled_value || 0), cn = d3.sum(daily, (r) => +r.cancelled || 0);
      NET_AOV = cn ? cv / cn : 0;
      const known = new Set(restaurants.map((r) => r.restaurant_id)), byOutlet = d3.group(daily, (r) => r.restaurant_id);
      const end = d3.max(daily, (r) => dayNum(r.day));
      const scopes = [['all', daily.filter((r) => known.has(r.restaurant_id))], ...restaurants.map((r) => [r.restaurant_id, byOutlet.get(r.restaurant_id) || []])];
      const out = [];
      for (const [scope, rows] of scopes) for (const period of [7, 28, 84]) for (const daytype of ['all', 'weekday', 'weekend']) out.push(Object.assign({ scope }, kpiFor(rows, end, period, daytype)));
      return out;
    },
  });

  /* KPT, correct-MFR %, not-marked % and handover minutes by day type × day part for one scope's hourly rows,
     orders-weighted over the full period (the hourly feed is aggregated by weekday and hour). */
  const PEAK = [12, 13, 14, 19, 20, 21];   // = fact_orders.is_peak_hour, which drives the daily peak KPT
  const PARTS = { all: () => true, breakfast: (h) => h >= 7 && h < 11, lunch: (h) => h >= 11 && h < 15, snacks: (h) => h >= 15 && h < 19, dinner: (h) => h >= 19 && h < 23, late: (h) => h >= 23 || h < 4, peak: (h) => PEAK.includes(h), offpeak: (h) => !PEAK.includes(h) };
  function hourlyCuts(rows) {
    const N = (x) => +x || 0, r1 = (v) => Math.round(v * 10) / 10;
    const out = [];
    for (const daytype of ['all', 'weekday', 'weekend']) for (const part of Object.keys(PARTS)) {
      let o = 0, k = 0, m = 0, nm = 0, h = 0;
      for (const r of rows) {
        if (daytype !== 'all' && (daytype === 'weekend') !== (N(r.weekday) >= 5)) continue;
        if (!PARTS[part](N(r.hour))) continue;
        const n = N(r.orders); o += n; k += N(r.kpt_avg) * n; m += N(r.correct_mfr_pct) * n; nm += N(r.mfr_not_marked_pct) * n; h += N(r.handover_avg) * n;
      }
      out.push({ daytype, part, orders: o, kpt: o ? r1(k / o) : null, mfr_correct_pct: o ? r1((100 * m) / o) : null, mfr_not_marked_pct: o ? r1((100 * nm) / o) : null, handover: o ? r1(h / o) : null });
    }
    return out;
  }

  /* Cancellations per reason and per cancel group (RDC_RCC, RDC_OOS, Tech, FXM, Other) for one scope's rows in the weeks
     `inWeeks` keeps, with each one’s share of all cancellations in that cut. Weekly feed, so a period takes whole weeks. */
  function cancelMix(rows, inWeeks, period) {
    const N = (x) => +x || 0, r1 = (v) => Math.round(v * 10) / 10;
    const inPeriod = rows.filter((r) => inWeeks(dayNum(r.week)));
    const total = inPeriod.reduce((a, r) => a + N(r.orders), 0);
    const out = [];
    for (const level of ['reason', 'cancel_group']) {
      const m = {};
      for (const r of inPeriod) { const e = (m[r[level]] = m[r[level]] || { orders: 0, value: 0 }); e.orders += N(r.orders); e.value += N(r.value); }
      for (const [name, e] of Object.entries(m)) out.push({ period, level: level === 'reason' ? 'reason' : 'group', name, orders: e.orders, value: e.value, pct: total ? r1((100 * e.orders) / total) : null });
    }
    return out;
  }

  /* one cached result per key; recomputed when any dependency changes (data arrays by reference, filters by value) */
  const memo = new Map();
  const cached = (key, deps, fn) => { const m = memo.get(key); if (m && m.deps.every((d, i) => d === deps[i])) return m.val; const val = fn(); memo.set(key, { deps, val }); return val; };

  /* ---------- state ---------- */
  const TABS = ['overview', 'leaderboard', 'input', 'output', 'outcome'];
  const state = { l1: null, itemsMode: 'same', lbSort: 'rating', lbOrder: 'worst', open: new Set(), ideal: 18, lbLimit: 50, tab: TABS.includes(location.hash.slice(1)) ? location.hash.slice(1) : 'overview' };
  let restaurants = [], byId = {};
  const params = () => { const p = dash.params(); return { brand: p.brand || [], state: p.state || [], city: p.city || [], outlet: p.outlet || [], period: +(p.period || 28), daytype: p.daytype || 'all', from: p.from || '', to: p.to || '' }; };
  const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');

  /* State of each city in the outlet master (the master has no state column). Delhi and Chandigarh are union territories;
     Aurangabad is the Maharashtra one. A city missing here shows under "Other" — add it to this list. */
  const STATE = {
    'Andhra Pradesh': ['Guntur', 'Vijayawada', 'Vizag'], Bihar: ['Muzaffarpur', 'Patna'], Chandigarh: ['Chandigarh'], Delhi: ['Delhi'],
    Gujarat: ['Ahmedabad', 'Anand', 'Surat', 'Vadodara'], Haryana: ['Faridabad', 'Gurgaon'], Jharkhand: ['Bokaro', 'Dhanbad', 'Ranchi'],
    Karnataka: ['Bangalore', 'Belgaum', 'Hubli', 'Manipal', 'Mysore'], Kerala: ['Kochi', 'Kozhikode', 'Thiruvananthapuram', 'Thrissur'],
    'Madhya Pradesh': ['Bhopal', 'Indore'], Maharashtra: ['Aurangabad', 'Mumbai', 'Nagpur', 'Nashik', 'Pune'], Odisha: ['Bhubaneswar'],
    Punjab: ['Amritsar', 'Jalandhar', 'Ludhiana'], Rajasthan: ['Jaipur', 'Jodhpur', 'Kota', 'Udaipur'],
    'Tamil Nadu': ['Chennai', 'Coimbatore', 'Hosur', 'Madurai', 'Trichy'], Telangana: ['Hyderabad'],
    'Uttar Pradesh': ['Agra', 'Kanpur', 'Lucknow', 'Noida', 'Noida 1'], Uttarakhand: ['Dehradun'], 'West Bengal': ['Kolkata'],
  };
  const STATE_OF = Object.fromEntries(Object.entries(STATE).flatMap(([s, cities]) => cities.map((c) => [c, s])));

  /* Brand / state / city / outlet filters: any picked value within a filter, every filter together; nothing picked = no limit.
     Brand narrows the state list, brand + state the city list, all three the outlet list ("pool"). One outlet left = outlet view. */
  const pick = (vals, v) => !vals.length || vals.includes(v);
  const listLabel = (vals, noun) => (vals.length <= 2 ? vals.join(' + ') : `${vals.length} ${noun}`);
  function scopeInfo(p) {
    const byBrand = restaurants.filter((r) => pick(p.brand, r.region)), byState = byBrand.filter((r) => pick(p.state, r.state)), poolRows = byState.filter((r) => pick(p.city, r.city));
    const ids = new Set(poolRows.filter((r) => pick(p.outlet, r.restaurant_id)).map((r) => r.restaurant_id));
    const any = p.brand.length + p.state.length + p.city.length + p.outlet.length > 0, single = ids.size === 1 ? [...ids][0] : null, o = single && byId[single];
    const parts = [];   // picked outlets already imply their brand, state and city, so they name the selection alone
    if (p.outlet.length) parts.push(listLabel(p.outlet.map((id) => (byId[id] ? byId[id].name : id)), 'outlets'));
    else {
      if (p.brand.length) parts.push(listLabel(p.brand, 'brands'));
      if (p.state.length && !p.city.length) parts.push(listLabel(p.state, 'states'));   // picked cities already imply their state
      if (p.city.length) parts.push(listLabel(p.city, 'cities'));
    }
    return {
      byBrand, byState, poolRows, pool: new Set(poolRows.map((r) => r.restaurant_id)), ids, any, single,
      name: !any ? 'Network' : o ? o.name : parts.join(', '),
      label: !any ? 'All outlets' : o ? `${o.name} · ${o.city}` : p.outlet.length ? parts[0] : `${parts.join(' · ')} · ${ids.size} outlets`,
      key: !any ? 'all' : single || 'selection',
      selKey: JSON.stringify([p.brand, p.state, p.city, p.outlet]),
    };
  }
  /* set one filter, then drop picks the narrower filters no longer offer */
  function setSel(key, vals) {
    const p = Object.assign(params(), { [key]: vals });
    const byBrand = restaurants.filter((r) => pick(p.brand, r.region));
    p.state = p.state.filter((s) => byBrand.some((r) => r.state === s));
    const byState = byBrand.filter((r) => pick(p.state, r.state));
    p.city = p.city.filter((c) => byState.some((r) => r.city === c));
    const pool = new Set(byState.filter((r) => pick(p.city, r.city)).map((r) => r.restaurant_id));
    p.outlet = p.outlet.filter((id) => pool.has(id));
    dash.setParams({ brand: p.brand, state: p.state, city: p.city, outlet: p.outlet });
  }

  /* ---------- tiles ---------- */
  function mkTile(container, spec) {
    const el = document.createElement('div'); el.className = 'ops-kpi' + (spec.small ? ' small' : '');
    el.innerHTML = `<span class="l"></span><span class="v${spec.big ? '' : ' sm'}" data-source="${spec.source || 'kpis'}" data-field="${spec.field}">—</span>` + (spec.delta === false ? '' : `<span class="d"><span class="dv" data-source="kpis" data-field="${spec.field}_d">—</span><span class="dl"></span></span>`);
    el.querySelector('.l').textContent = spec.label;
    el.dataset.field = spec.field; el._spec = spec;
    container.appendChild(el);
    return el;
  }
  const TILES = [];
  function tiles(containerId, specs, opts = {}) { const c = $(containerId); specs.forEach((s) => TILES.push(mkTile(c, Object.assign({}, opts, s)))); }

  function fillTile(el, row, p, netRow) {
    const s = el._spec, v = row ? row[s.field] : null, fmt = F[s.fmt] || F.num1;
    const vEl = el.querySelector('.v');
    vEl.dataset.where = where(s.source === 'hourly_cuts' ? { scope: p.scope, daytype: p.daytype, part: s.part } : s.source === 'cancel_mix' ? { scope: p.scope, period: p.period, level: s.level, name: s.name } : { scope: p.scope, period: p.period, daytype: p.daytype });
    vEl.textContent = fmt(v);
    vEl.className = 'v' + (s.big ? '' : ' sm') + ' ' + (s.nostatus ? 'none' : status(s.statusAs || s.field, v) || 'none');
    el.classList.toggle('lowconf', s.field === 'rating' && row && row.rating_n < 30);
    if (s.field === 'rating' && s.stars) { let st = el.querySelector('.ops-stars'); if (!st) { st = document.createElement('span'); st.className = 'ops-stars'; vEl.after(st); } st.textContent = v == null ? '' : '★'.repeat(Math.round(v)) + '☆'.repeat(5 - Math.round(v)); }
    const dv = el.querySelector('.dv');
    if (dv) {
      const d = row ? row[s.field + '_d'] : null;
      dv.dataset.where = vEl.dataset.where;
      dv.textContent = d == null ? '—' : (SIGNED[s.fmt] || SIGNED.num1)(d);
      dv.className = 'dv ' + deltaClass(s.field, d);
      el.querySelector('.dl').textContent = d == null ? ' no prior period' : ` vs ${priorLabel(p)}`;
    }
  }

  // Causal chain
  tiles('chain-input-kpis', [
    { label: 'KPT', field: 'kpt', fmt: 'min', big: true }, { label: 'Orders over 10 min', field: 'kpt_gt10_pct', fmt: 'pct' },
    { label: 'Visibility', field: 'vis_pct', fmt: 'pct' }, { label: 'Correct MFR', field: 'mfr_correct_pct', fmt: 'pct' }, { label: 'Handover', field: 'handover', fmt: 'min' },
  ]);
  tiles('chain-output-kpis', [
    { label: 'Product concern', field: 'product_pct', fmt: 'pct', big: true }, { label: 'Service concern', field: 'service_pct', fmt: 'pct' },
    { label: 'Critical incidents', field: 'crit_total', fmt: 'int' }, { label: 'Cancelled', field: 'cancel_pct', fmt: 'pct' }, { label: 'TAT', field: 'tat', fmt: 'min' },
  ]);
  tiles('chain-outcome-kpis', [
    { label: 'Rating', field: 'rating', fmt: 'rating', big: true, stars: true }, { label: 'Ratings', field: 'rating_n', fmt: 'int', nostatus: true },
    { label: 'Sale loss', field: 'sale_loss', fmt: 'inr', nostatus: true }, { label: 'Refunds', field: 'refund', fmt: 'inr', nostatus: true },
  ]);
  // Group summaries (compact, no delta)
  const SUM = { rating: [{ label: 'Rating', field: 'rating', fmt: 'rating' }, { label: 'Ratings', field: 'rating_n', fmt: 'int', nostatus: true }],
    saleloss: [{ label: 'Cancelled ₹', field: 'sale_loss', fmt: 'inr', nostatus: true }, { label: 'Cancelled', field: 'cancel_pct', fmt: 'pct' }],
    guestvalue: [{ label: 'To guest ₹', field: 'guest_value', fmt: 'inr', nostatus: true }],
    concerns: [{ label: 'Product', field: 'product_pct', fmt: 'pct' }, { label: 'Service', field: 'service_pct', fmt: 'pct' }, { label: 'Complaint orders', field: 'complaints', fmt: 'int', nostatus: true }],
    critical: [{ label: 'Incidents', field: 'crit_total', fmt: 'int' }],
    cancel: [{ label: 'Cancelled', field: 'cancel_pct', fmt: 'pct' }, { label: 'Completion', field: 'completion_pct', fmt: 'pct' }],
    refund: [{ label: 'Refunded ₹', field: 'refund', fmt: 'inr', nostatus: true }],
    tat: [{ label: 'Actual TAT', field: 'tat', fmt: 'min' }],
    kpt: [{ label: 'KPT', field: 'kpt', fmt: 'min' }, { label: 'Peak', field: 'kpt_peak', fmt: 'min' }, { label: '> 10 min', field: 'kpt_gt10_pct', fmt: 'pct' }],
    vis: [{ label: 'Visibility', field: 'vis_pct', fmt: 'pct' }, { label: 'Non-op days / outlet', field: 'nonop_days', fmt: 'days' }],
    mfr: [{ label: 'Correct MFR', field: 'mfr_correct_pct', fmt: 'pct' }, { label: 'Handover', field: 'handover', fmt: 'min' }, { label: 'Food waited', field: 'food_wait_pct', fmt: 'pct' }],
    oos: [{ label: 'OOS cancels', field: 'pct', fmt: 'pct', source: 'cancel_mix', level: 'group', name: 'RDC_OOS', nostatus: true }],
  };
  Object.entries(SUM).forEach(([g, specs]) => tiles('sum-' + g, specs, { delta: false }));

  // Section tiles
  tiles('t-rating', [{ label: 'Average rating', field: 'rating', fmt: 'rating', big: true, stars: true }, { label: 'Number of ratings', field: 'rating_n', fmt: 'int', nostatus: true }, { label: 'Orders', field: 'orders', fmt: 'int', nostatus: true }]);
  tiles('t-saleloss', [{ label: 'Cancelled order value', field: 'sale_loss', fmt: 'inr', big: true, nostatus: true }, { label: 'Cancelled orders', field: 'cancelled', fmt: 'int', nostatus: true, delta: false }, { label: 'Cancelled %', field: 'cancel_pct', fmt: 'pct' }]);
  tiles('t-guestvalue', [{ label: 'Refunds + cancelled value', field: 'guest_value', fmt: 'inr', big: true, nostatus: true }, { label: 'IGCC refunds', field: 'refund', fmt: 'inr', nostatus: true }, { label: 'Cancelled value', field: 'sale_loss', fmt: 'inr', nostatus: true }]);
  tiles('t-concerns', [{ label: 'Product concern (quality, quantity)', field: 'product_pct', fmt: 'pct', big: true }, { label: 'Service concern (packaging, missing, wrong)', field: 'service_pct', fmt: 'pct', big: true }, { label: 'Any concern', field: 'complaint_pct', fmt: 'pct' }]);
  tiles('t-concern-count', [{ label: 'Unique concern orders', field: 'unique', fmt: 'int', nostatus: true, delta: false }, { label: 'Unique %', field: 'unique_pct', fmt: 'pct', nostatus: true }, { label: 'Multiple concern orders', field: 'multi', fmt: 'int', nostatus: true, delta: false }, { label: 'Multiple %', field: 'multi_pct', fmt: 'pct' }]);
  tiles('t-cancel', [{ label: 'Cancelled %', field: 'cancel_pct', fmt: 'pct', big: true }, { label: 'Order completion', field: 'completion_pct', fmt: 'pct' }, { label: 'Cancelled orders', field: 'cancelled', fmt: 'int', nostatus: true, delta: false }, { label: 'Top reason', field: 'pct', fmt: 'pct', source: 'cancel_mix', level: 'reason', name: '', nostatus: true, delta: false, top: true }]);
  tiles('t-refund', [{ label: 'Total refunded (IGCC)', field: 'refund', fmt: 'inr', big: true, nostatus: true }, { label: 'Complaint orders', field: 'complaints', fmt: 'int', nostatus: true, delta: false }]);
  tiles('t-tat', [{ label: 'Actual average TAT', field: 'tat', fmt: 'min', big: true }]);
  tiles('t-kpt', [{ label: 'Average KPT', field: 'kpt', fmt: 'min', big: true }, { label: 'Peak hours', field: 'kpt_peak', fmt: 'min' }, { label: 'Off-peak', field: 'kpt_offpeak', fmt: 'min' }, { label: 'Orders over 10 min', field: 'kpt_gt10_pct', fmt: 'pct' }]);
  tiles('t-vis', [{ label: 'Visibility (online ÷ planned hours)', field: 'vis_pct', fmt: 'pct', big: true }, { label: 'Non-op days per outlet', field: 'nonop_days', fmt: 'days' }, { label: 'Outlets with a non-op day', field: 'nonop_outlets', fmt: 'int', nostatus: true, delta: false }, { label: 'Offline hours (total)', field: 'offline_hours', fmt: 'hours', nostatus: true }, { label: 'Est. orders lost', field: 'est_lost_orders', fmt: 'int', nostatus: true }, { label: 'Est. value lost', field: 'est_lost_value', fmt: 'inr', nostatus: true }]);
  tiles('t-mfr', [{ label: 'Correct MFR', field: 'mfr_correct_pct', fmt: 'pct', big: true }, { label: 'Incorrect MFR', field: 'mfr_incorrect_pct', fmt: 'pct' }, { label: 'MFR not marked', field: 'mfr_not_marked_pct', fmt: 'pct' }]);
  tiles('t-handover', [{ label: 'Average handover', field: 'handover', fmt: 'min', big: true }, { label: 'Deviation from 3 min', field: 'handover_dev', fmt: 'min' }, { label: 'Orders over 3 min', field: 'over3_pct', fmt: 'pct' }, { label: 'Rider waited after arrival', field: 'wait_arr_pct', fmt: 'pct' }, { label: 'Food waited after MFR', field: 'food_wait_pct', fmt: 'pct' }, { label: 'Food wait minutes', field: 'food_wait_min', fmt: 'min' }]);
  tiles('t-oos', [{ label: "'Item unavailable' share of cancellations", field: 'pct', fmt: 'pct', source: 'cancel_mix', level: 'group', name: 'RDC_OOS', nostatus: true, big: true, delta: false }, { label: 'OOS-tagged cancellations', field: 'orders', fmt: 'int', source: 'cancel_mix', level: 'group', name: 'RDC_OOS', nostatus: true, delta: false }]);

  // Critical badges
  const CRIT = [['veg', 'Veg / non-veg'], ['foreign', 'Foreign particle'], ['pests', 'Pests']];
  $('t-critical').innerHTML = CRIT.map(([k, l]) => `<div class="c"><span class="l">${l}</span><div class="row"><span class="ops-badge" data-source="kpis" data-field="crit_${k}">—</span><span class="p"><span data-source="kpis" data-field="crit_${k}_pct">—</span> of orders</span></div></div>`).join('') + `<div class="c"><span class="l">All critical</span><div class="row"><span class="ops-badge" data-source="kpis" data-field="crit_total">—</span><span class="p"><span data-source="kpis" data-field="crit_total_d">—</span> vs prior</span></div></div>`;

  // Not-available chips
  const NA = {
    rating: [['Product-wise rating', 'Swiggy rating feed has no item column']],
    saleloss: [['Sale loss %', 'Total GMV not in DB (payout file)']],
    guestvalue: [['Value to guest % of sales', 'Needs GMV from the payout file']],
    concerns: [['Top items by menu category', 'Partial: needs item → menu-category master; rows without a category show as Uncategorised']],
    critical: [['Multiple critical per order', 'Needs order-level complaint rows'], ['Items by menu category', 'Needs item master']],
    cancel: [['Cancelled before / after MFR', 'Cancelled orders have no timestamp row'], ['Avg cancellation time per reason', 'RDC has date only, no cancellation timestamp']],
    refund: [['Refund greater than bill', 'IGCC has no order / bill value'], ['Net refund', 'Depends on the row above']],
    tat: [['Open / Close / No response', 'No complaint-resolution timestamps in IGCC'], ['Order → delivered', 'Delivered time exists only for complaint orders']],
    kpt: [['Items sold by KPT bucket', 'No item lines for completed orders'], ['Items per order', 'No item lines for completed orders']],
    vis: [['Live status of offline restaurant', 'Feed is daily, not real-time'], ['Hourly / peak / day-part visibility', 'Daily feed']],
    mfr: [['Order type (Instant, Std, Train, Bulk…)', 'No order-type column in the Swiggy feeds']],
    oos: [['Product type stock-up %', 'Swiggy OOS report TBD'], ['Stock-out duration', 'OOS report not loaded'], ['Source closure %', 'OOS report not loaded'], ['Status type %', 'OOS report not loaded'], ['Discounted product OOS %', 'OOS report not loaded'], ['OOS vs minimum closing balance', 'OOS report not loaded']],
  };
  const AVAIL = { rating: [1, 2], saleloss: [1, 2], guestvalue: [1, 2], concerns: [14, 15], critical: [9, 11], cancel: [6, 8], refund: [2, 4], tat: [3, 5], kpt: [7, 9], vis: [3, 5], mfr: [8, 9], oos: [0, 6] };
  Object.entries(NA).forEach(([g, list]) => { $('na-' + g).innerHTML = '<b>Not yet available</b>' + list.map(([l, note]) => `<span title="${note}">${l}<i> · ${note}</i></span>`).join(''); });
  Object.entries(AVAIL).forEach(([g, [a, b]]) => { $('avail-' + g).textContent = `${a} of ${b} sub-metrics`; });

  /* ---------- controls ---------- */
  const setDefaults = () => dash.setParams({ brand: [], state: [], city: [], outlet: [], period: 28, daytype: 'all', from: '', to: '' });

  /* checkbox drop-down for one filter; returns update(options [{v, l, sub}], selected) */
  const CHEV = '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3 6l5 5 5-5" fill="none" stroke="currentColor" stroke-width="1.5"/></svg>';
  const closeMenus = (except) => document.querySelectorAll('.ops-ms').forEach((m) => { if (m === except) return; m.querySelector('.ops-ms-pop').hidden = true; m.querySelector('.ops-ms-btn').setAttribute('aria-expanded', 'false'); });
  function multiSelect(id, key, { title, noun, search }) {
    const root = $(id);
    root.innerHTML = `<button type="button" class="ops-ms-btn" aria-haspopup="true" aria-expanded="false"><span>All</span>${CHEV}</button>
      <div class="ops-ms-pop" hidden>${search ? `<input type="search" placeholder="Search ${noun}" aria-label="Search ${noun}">` : ''}
        <div class="ops-ms-acts"><button type="button" data-act="all">Select all${search ? ' shown' : ''}</button><button type="button" data-act="none">Clear</button></div>
        <div class="ops-ms-list" role="group" aria-label="${title}"></div></div>`;
    const btn = root.querySelector('.ops-ms-btn'), pop = root.querySelector('.ops-ms-pop'), list = root.querySelector('.ops-ms-list'), q = root.querySelector('input');
    let sig = null;
    const filterList = () => { const t = q ? q.value.trim().toLowerCase() : ''; list.querySelectorAll('label').forEach((l) => { l.hidden = !!t && !l.textContent.toLowerCase().includes(t); }); };
    btn.addEventListener('click', () => { const open = pop.hidden; closeMenus(root); pop.hidden = !open; btn.setAttribute('aria-expanded', String(open)); if (open && q) q.focus(); });
    if (q) q.addEventListener('input', filterList);
    list.addEventListener('change', () => setSel(key, [...list.querySelectorAll('input:checked')].map((c) => c.value)));
    root.querySelector('.ops-ms-acts').addEventListener('click', (e) => {
      const b = e.target.closest('[data-act]'); if (!b) return;
      const shown = [...list.querySelectorAll('label:not([hidden]) input')].map((c) => c.value);
      setSel(key, b.dataset.act === 'none' ? [] : [...new Set([...params()[key], ...shown])]);
    });
    root.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !pop.hidden) { closeMenus(); btn.focus(); } });
    return (options, selected) => {
      const s = options.map((o) => o.v).join('\n');
      if (s !== sig) { sig = s; list.innerHTML = options.map((o) => `<label><input type="checkbox" value="${esc(o.v)}"><span>${esc(o.l)}</span>${o.sub ? `<small>${esc(o.sub)}</small>` : ''}</label>`).join('') || '<span class="ops-note">Nothing to pick in the current filter</span>'; filterList(); }
      const on = new Set(selected);
      list.querySelectorAll('input').forEach((c) => { c.checked = on.has(c.value); });
      const text = !selected.length ? 'All' : selected.length === 1 ? (options.find((o) => o.v === selected[0]) || { l: selected[0] }).l : `${selected.length} ${noun}`;
      btn.querySelector('span').textContent = text; btn.setAttribute('aria-label', `${title}: ${text}`); btn.dataset.active = String(selected.length > 0);
    };
  }
  const msBrand = multiSelect('f-brand', 'brand', { title: 'Brand', noun: 'brands' });
  const msState = multiSelect('f-state', 'state', { title: 'State', noun: 'states', search: true });
  const msCity = multiSelect('f-city', 'city', { title: 'City', noun: 'cities', search: true });
  const msOutlet = multiSelect('f-outlet', 'outlet', { title: 'Outlet', noun: 'outlets', search: true });
  document.addEventListener('click', (e) => { if (!e.target.closest('.ops-ms')) closeMenus(); });
  const seg = (id, name, onPick) => $(id).addEventListener('click', (e) => { const b = e.target.closest('button'); if (!b) return; onPick ? onPick(b.dataset.v) : dash.setParams({ [name]: name === 'period' ? +b.dataset.v : b.dataset.v }); });
  seg('f-period', 'period', (v) => dash.setParams({ period: +v, from: '', to: '' })); seg('f-daytype', 'daytype');
  // custom date range: both ends needed; picking one end keeps the other from the window on screen
  const onDate = () => { let f = $('f-from').value, t = $('f-to').value; if (!f || !t) return; if (f > t) [f, t] = [t, f]; dash.setParams({ from: f, to: t }); };
  $('f-from').addEventListener('change', onDate); $('f-to').addEventListener('change', onDate);
  seg('lb-order', 'order', (v) => { state.lbOrder = v; state.lbLimit = 50; redraw(); });
  $('f-reset').addEventListener('click', () => { dash.resetParams(); setDefaults(); state.l1 = null; });
  $('ideal-tat').addEventListener('change', (e) => { const v = +e.target.value; if (v > 0) { state.ideal = v; redraw(); } });
  document.querySelectorAll('[data-items]').forEach((c) => c.addEventListener('click', () => { state.itemsMode = c.dataset.items; redraw(); }));
  document.querySelectorAll('.grp-head').forEach((b) => b.addEventListener('click', () => { const g = b.closest('.grp'); const open = g.dataset.open !== '1'; g.dataset.open = open ? '1' : '0'; b.setAttribute('aria-expanded', open); if (open) redraw(); }));
  /* tabs: one panel on screen at a time; the URL hash keeps the tab across reloads. Charts in hidden panels are skipped
     by vis() in draw(), so switching redraws the panel that just appeared. */
  function setTab(t) {
    state.tab = t; state.lbLimit = 50; dash.setLink(t);
    const below = $('top').getBoundingClientRect().bottom + window.scrollY;   // a new tab starts at its top
    if (window.scrollY > below) window.scrollTo({ top: below });
    redraw();
  }
  $('tabs').addEventListener('click', (e) => { const b = e.target.closest('[data-tab]'); if (b) setTab(b.dataset.tab); });
  document.querySelectorAll('.ops-chain-col').forEach((c) => c.addEventListener('click', () => setTab(c.dataset.go)));
  $('lb').addEventListener('click', (e) => {
    const h = e.target.closest('[data-sort]'); if (h) { state.lbSort = h.dataset.sort; state.lbLimit = 50; redraw(); return; }
    if (e.target.closest('[data-more]')) { state.lbLimit += 50; redraw(); return; }
    const focus = e.target.closest('[data-focus]'); if (focus) { dash.setParams({ outlet: [focus.dataset.focus] }); return; }
    const clear = e.target.closest('[data-clearfocus]'); if (clear) { dash.setParams({ outlet: [] }); return; }
    const row = e.target.closest('.lb-row'); if (!row) return;
    const id = row.dataset.id; if (state.open.has(id)) state.open.delete(id); else state.open.add(id); redraw();
  });
  setDefaults();

  /* ---------- data helpers ---------- */
  const ok = (id) => dash.data(id).status === 'ok';
  const rows = (id) => (ok(id) ? dash.data(id).data : []);
  const toDate = (n) => new Date(n * 864e5);
  const inDaytype = (r, dt) => dt === 'all' || (dt === 'weekend') === (N(r.is_weekend) === 1);

  /* ---------- the date window: a preset (last 7 / 28 / 84 days to the last day of data) or a custom from–to ---------- */
  let dataStart = 0, dataEnd = 0;   // first / last day in the daily feed, set by draw()
  function resolve(p) {
    const custom = !!(p.from && p.to), end = custom ? dayNum(p.to) : dataEnd;
    const period = custom ? Math.max(1, end - dayNum(p.from) + 1) : p.period;
    return Object.assign(p, { custom, end, period, start: end - period + 1 });
  }
  const isoDay = (n) => toDate(n).toISOString().slice(0, 10);
  const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const fmtDay = (n, year) => { const d = toDate(n); return `${d.getUTCDate()} ${MON[d.getUTCMonth()]}${year ? ' ' + d.getUTCFullYear() : ''}`; };
  const winRange = (p) => `${fmtDay(p.start)} – ${fmtDay(p.end, true)}`;
  const winLabel = (p) => (p.custom ? `${winRange(p)} (${p.period} days)` : PERIOD_LABEL[p.period]);
  const priorLabel = (p) => (p.custom ? `prior ${p.period} days` : 'prior ' + PERIOD_LABEL[p.period].replace('last ', ''));
  // weekly feeds (complaints, cancellations) can only be cut by whole weeks: a preset takes the last weeks before
  // `presetEnd`, a custom range every week it touches
  const inWeeks = (p, presetEnd) => (w) => (p.custom ? w <= p.end && w + 6 >= p.start : w > presetEnd - p.period);

  /* headline KPIs for the network and every outlet over a custom window (presets are precomputed in `kpis`) */
  function customKpis(daily, p) {
    const known = new Set(restaurants.map((r) => r.restaurant_id)), byOutlet = d3.group(daily, (r) => r.restaurant_id);
    const scopes = [['all', daily.filter((r) => known.has(r.restaurant_id))], ...restaurants.map((r) => [r.restaurant_id, byOutlet.get(r.restaurant_id) || []])];
    return scopes.map(([scope, rs]) => Object.assign({ scope }, kpiFor(rs, p.end, p.period, p.daytype)));
  }


  /* daily aggregate per day for a set of ids, with 7-day rolling for weighted metrics */
  function dailySeries(daily, ids, p, end, rolling = 7) {
    const start = end - p.period + 1;
    const byDay = new Map();
    for (const r of daily) {
      if (!ids.has(r.restaurant_id) || !inDaytype(r, p.daytype)) continue;
      const d = dayNum(r.day); if (d < start - rolling + 1 || d > end) continue;
      const e = byDay.get(d) || { d, o: 0, s: {} };
      const o = N(r.orders); e.o += o;
      for (const k of ['kpt_avg', 'kpt_peak', 'kpt_offpeak', 'correct_mfr_pct', 'handover_avg', 'handover_over3_pct', 'food_wait_mfr_pct', 'tat_avg']) e.s[k] = (e.s[k] || 0) + N(r[k]) * o;
      for (const k of ['cancelled', 'cancelled_value', 'refund_amt', 'product_concern', 'service_concern', 'online_hours', 'budget_hours', 'crit_veg', 'crit_foreign', 'crit_pests', 'kpt_lt5', 'kpt_5_8', 'kpt_8_10', 'kpt_gt10', 'rating_count']) e.s[k] = (e.s[k] || 0) + N(r[k]);
      e.s.rating_w = (e.s.rating_w || 0) + N(r.rating_avg) * N(r.rating_count);
      e.s.planned = (e.s.planned || 0) + (N(r.budget_hours) > 0 ? 1 : 0);   // outlets due to open that day
      byDay.set(d, e);
    }
    const list = [...byDay.values()].sort((a, b) => a.d - b.d);
    // rolling window sums
    const out = [];
    for (let i = 0; i < list.length; i++) {
      const e = list[i]; if (e.d < start) continue;
      const win = list.filter((x) => x.d > e.d - rolling && x.d <= e.d);
      const o = d3.sum(win, (x) => x.o), S = (k) => d3.sum(win, (x) => x.s[k] || 0);
      out.push({ d: toDate(e.d), o: e.o, day: e, w: (k) => (o ? S(k) / o : null), pct: (k) => (o ? (100 * S(k)) / o : null), rating: S('rating_count') ? S('rating_w') / S('rating_count') : null });
    }
    return out;
  }
  function weekly(daily, ids, p, end) {
    const start = end - p.period + 1, m = new Map();
    for (const r of daily) { if (!ids.has(r.restaurant_id) || !inDaytype(r, p.daytype)) continue; const d = dayNum(r.day); if (d < start || d > end) continue; const wk = +d3.utcMonday(toDate(d)); const e = m.get(wk) || { d: new Date(wk), s: {} }; for (const k of Object.keys(r)) if (k !== 'day' && k !== 'restaurant_id') e.s[k] = (e.s[k] || 0) + N(r[k]); e.s.rows = (e.s.rows || 0) + 1; m.set(wk, e); }
    return [...m.values()].sort((a, b) => a.d - b.d);
  }

  /* ---------- draw ---------- */
  function redraw() { draw(); }

  function draw() {
    const p = params(), daily = rows('daily');
    [dataStart, dataEnd] = daily.length ? cached('bounds', [daily], () => d3.extent(daily, (r) => dayNum(r.day))) : [0, 0];
    resolve(p);
    const ready = ['daily', 'restaurants', 'kpis'].every(ok);
    document.querySelectorAll('.ops-kpi .v, .ops-badge').forEach((el) => el.classList.toggle('dash-skeleton', !ready && dash.data('daily').status === 'loading'));
    // controls reflect params; the date inputs always show the window on screen
    $('f-period').querySelectorAll('button').forEach((b) => b.setAttribute('aria-pressed', !p.custom && +b.dataset.v === p.period));
    $('f-dates').dataset.active = String(p.custom);
    if (daily.length) [['f-from', p.start], ['f-to', p.end]].forEach(([id, n]) => { const i = $(id); i.min = isoDay(dataStart); i.max = isoDay(dataEnd); if (document.activeElement !== i) i.value = isoDay(n); });
    $('f-daytype').querySelectorAll('button').forEach((b) => b.setAttribute('aria-pressed', b.dataset.v === p.daytype));
    $('lb-order').querySelectorAll('button').forEach((b) => b.setAttribute('aria-pressed', b.dataset.v === state.lbOrder));
    document.querySelectorAll('[data-items]').forEach((c) => c.setAttribute('aria-pressed', c.dataset.items === state.itemsMode));
    $('ideal-tat').value = state.ideal;
    ['chain-input', 'chain-output', 'chain-outcome', 'input', 'output', 'outcome'].forEach((id, i) => $(id).style.setProperty('--tier', dash.colors[[2, 1, 0][i % 3]]));
    document.querySelectorAll('.ops-tab-dot').forEach((d) => d.style.background = dash.colors[{ input: 2, output: 1, outcome: 0 }[d.dataset.tier]]);
    $('tabs').querySelectorAll('[data-tab]').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.tab === state.tab)));
    document.querySelectorAll('[role=tabpanel][data-tab]').forEach((s) => { s.hidden = s.dataset.tab !== state.tab; });

    restaurants = rows('restaurants'); byId = Object.fromEntries(restaurants.map((r) => [r.restaurant_id, r]));
    restaurants.forEach((r) => { if (!r.state) r.state = STATE_OF[r.city] || 'Other'; });
    const info = scopeInfo(p);
    p.scope = info.key;   // 'all' | outlet id | 'selection' — labels the data-where links
    // brand / city / outlet filters
    if (restaurants.length) {
      msBrand([...new Set(restaurants.map((r) => r.region))].sort().map((v) => ({ v, l: v })), p.brand);
      msState([...new Set(info.byBrand.map((r) => r.state))].sort().map((v) => ({ v, l: v })), p.state);
      msCity([...new Set(info.byState.map((r) => r.city))].sort().map((v) => ({ v, l: v, sub: p.state.length === 1 ? '' : STATE_OF[v] })), p.city);
      msOutlet([...info.poolRows].sort((a, b) => a.city.localeCompare(b.city) || a.name.localeCompare(b.name)).map((r) => ({ v: r.restaurant_id, l: r.name, sub: r.city })), p.outlet);
    }
    $('scope-sub').textContent = `${info.label} · ${winLabel(p)}${p.daytype === 'all' ? '' : ' · ' + p.daytype + 's'}`;
    $('rating-window').textContent = winLabel(p);

    const cancAll = rows('cancellations'), hourlyAll = rows('hourly'), end = p.end;
    // network and single outlets: precomputed in `kpis` for the presets, computed here for a custom range
    const kp = !p.custom ? rows('kpis') : daily.length && restaurants.length ? cached('kpc', [daily, restaurants, p.end, p.period, p.daytype], () => customKpis(daily, p)) : [];
    const inSel = (r) => info.ids.has(r.restaurant_id);
    const K = (scope) => kp.find((r) => r.scope === scope && +r.period === p.period && r.daytype === p.daytype) || null;
    const net = K('all');
    // any other selection is aggregated here
    const row = !info.any ? net : info.single ? K(info.single)
      : daily.length ? cached('row', [daily, restaurants, info.selKey, p.end, p.period, p.daytype], () => Object.assign({ scope: 'selection' }, kpiFor(daily.filter(inSel), end, p.period, p.daytype))) : null;
    const cm = cancAll.length ? cached('cm', [cancAll, restaurants, info.selKey, p.custom, p.end, p.period], () => cancelMix(cancAll.filter(inSel), inWeeks(p, d3.max(cancAll, (r) => dayNum(r.week)) + 6), p.period)) : [];
    const hc = cached('hc', [hourlyAll, restaurants, info.selKey], () => hourlyCuts(hourlyAll.filter(inSel)));
    const topReason = cm.filter((r) => r.level === 'reason').sort((a, b) => b.pct - a.pct)[0];
    const cmRow = (level, name) => cm.find((r) => r.level === level && r.name === name) || null;

    // tiles
    TILES.forEach((el) => {
      const s = el._spec;
      if (s.source === 'cancel_mix') { if (s.top) { s.name = topReason ? topReason.name : ''; el.querySelector('.l').textContent = topReason ? 'Top reason · ' + topReason.name : 'Top reason'; } fillTile(el, cmRow(s.level, s.name), p); }
      else fillTile(el, row, p);
    });
    // critical badges
    $('t-critical').querySelectorAll('[data-source]').forEach((el) => { el.dataset.where = where({ scope: p.scope, period: p.period, daytype: p.daytype }); const f = el.dataset.field; const v = row ? row[f] : null; el.textContent = v == null ? '—' : f.endsWith('_pct') ? v.toFixed(2) + '%' : f.endsWith('_d') ? SIGNED.int(v) : F.int(v); if (el.classList.contains('ops-badge')) el.classList.toggle('hot', v > 0); });

    // takeaway
    drawTakeaway(p, info, row, net, kp);
    // leaderboard
    $('tab-n-lb').textContent = restaurants.length ? (info.single ? info.pool : info.ids).size : '';
    if (state.tab === 'leaderboard') drawLeaderboard(p, info, kp, net);   // hundreds of rows: only built when on screen

    if (!daily.length) return;
    const ids = info.ids, allIds = new Set(restaurants.map((r) => r.restaurant_id));
    const S = dailySeries(daily, ids, p, end), SN = dailySeries(daily, allIds, p, end), isNet = !info.any;
    const name = info.name;
    const W = weekly(daily, ids, p, end);
    const vis = (id) => { const el = $(id); if (!el) return false; const g = el.closest('.grp'); if (g && g.dataset.open !== '1') return false; return el.clientWidth > 0; };
    const pair = (key, kind) => { const ser = [{ name, color: dash.colors[0], points: S.map((x) => ({ d: x.d, v: kind === 'w' ? x.w(key) : kind === 'pct' ? x.pct(key) : x.rating })) }]; if (!isNet) ser.push({ name: 'Network', muted: true, points: SN.map((x) => ({ d: x.d, v: kind === 'w' ? x.w(key) : kind === 'pct' ? x.pct(key) : x.rating })) }); return ser; };
    const weekendDays = S.filter((x) => x.d.getUTCDay() === 0 || x.d.getUTCDay() === 6).map((x) => x.d);

    // ---- Outcome
    if (vis('c-rating-line')) C.line($('c-rating-line'), pair('rating', 'rating'), { fmt: F.rating, h: 200, ref: { v: 4.3, label: 'target 4.30' } });
    if (vis('c-saleloss-line')) C.line($('c-saleloss-line'), [{ name: 'Cancelled ₹', color: dash.colors[0], points: S.map((x) => ({ d: x.d, v: x.day.s.cancelled_value || 0 })) }], { fmt: F.inr, y0: true, area: true, endLabels: false });
    if (vis('c-guestvalue-weekly')) C.stackedWeekly($('c-guestvalue-weekly'), W.map((w) => ({ d: w.d, parts: { refund: w.s.refund_amt, cancelled: w.s.cancelled_value } })), [{ key: 'refund', label: 'Refunds ₹', color: dash.colors[0] }, { key: 'cancelled', label: 'Cancelled value ₹', color: dash.colors[1] }]);

    // ---- Output: concerns
    if (vis('c-concern-donut') && row) C.donut($('c-concern-donut'), [{ label: 'Product', value: row.product_share || 0, color: dash.colors[0] }, { label: 'Service', value: row.service_share || 0, color: dash.colors[1] }]);
    if (vis('c-concern-split') && row) C.split($('c-concern-split'), { label: 'Unique concern', value: row.unique, color: dash.colors[0] }, { label: 'Multiple concerns', value: row.multi, color: dash.colors[3] });
    if (vis('c-concern-line')) { const ser = [{ name: 'Product', color: dash.colors[0], points: S.map((x) => ({ d: x.d, v: x.pct('product_concern') })) }, { name: 'Service', color: dash.colors[1], points: S.map((x) => ({ d: x.d, v: x.pct('service_concern') })) }]; if (!isNet) ser.push({ name: 'Net product', muted: true, points: SN.map((x) => ({ d: x.d, v: x.pct('product_concern') })) }, { name: 'Net service', muted: true, dashed: true, points: SN.map((x) => ({ d: x.d, v: x.pct('service_concern') })) }); C.line($('c-concern-line'), ser, { fmt: F.pct, y0: true }); }
    const L1 = [['QUALITY_ISSUES', 'Quality', 'l1_quality'], ['QUANTITY_ISSUES', 'Quantity', 'l1_quantity'], ['Packaging_issues', 'Packaging', 'l1_packaging'], ['MISSING_ITEMS', 'Missing', 'l1_missing'], ['WRONG_ITEMS', 'Wrong', 'l1_wrong']];
    const orders = row ? row.orders : 0;
    const l1rows = L1.map(([k, l, f]) => { const c = d3.sum(W, (w) => w.s[f] || 0); return { label: l, key: k, value: orders ? (100 * c) / orders : 0, sub: `${F.int(c)} orders`, color: state.l1 === k ? dash.colors[0] : state.l1 ? 'var(--cds-chart-muted)' : dash.colors[0] }; }).sort((a, b) => b.value - a.value);
    if (vis('c-l1')) C.ranked($('c-l1'), l1rows, { fmt: F.pct, active: state.l1 ? L1.find((x) => x[0] === state.l1)[1] : null, onClick: (d) => { state.l1 = state.l1 === d.key ? null : d.key; redraw(); } });
    const l1Label = state.l1 ? L1.find((x) => x[0] === state.l1)[1] : null;
    $('l2-sub').textContent = (l1Label ? 'within ' + l1Label : 'all L1') + ' · weekly feed, all days';
    $('items-sub').textContent = l1Label ? 'within ' + l1Label : 'all L1';
    const wk = inWeeks(p, end);
    const comp = rows('complaints').filter((r) => ids.has(r.restaurant_id) && wk(dayNum(r.week)) && (!state.l1 || r.l1 === state.l1));
    if (vis('c-l2')) { const m = d3.rollups(comp, (v) => d3.sum(v, (r) => N(r.orders)), (r) => r.l2).sort((a, b) => b[1] - a[1]).slice(0, 12); C.ranked($('c-l2'), m.map(([l, c]) => ({ label: l, value: orders ? (100 * c) / orders : 0, sub: `${F.int(c)}` })), { fmt: F.pct }); }
    const items = rows('item_issues').filter((r) => ids.has(r.restaurant_id));
    if (vis('c-items')) {
      const keyF = state.itemsMode === 'category' ? (r) => r.menu_category : (r) => r.item;
      const tot = d3.rollup(items, (v) => d3.sum(v, (r) => N(r.orders)), keyF);
      const selI = items.filter((r) => !state.l1 || r.l1 === state.l1);
      const m = d3.rollups(selI, (v) => d3.sum(v, (r) => N(r.orders)), keyF).sort((a, b) => b[1] - a[1]).slice(0, 10);
      const all = d3.sum(selI, (r) => N(r.orders));
      C.ranked($('c-items'), m.map(([l, c]) => ({ label: l, value: c, sub: state.l1 ? `${d3.format('.0%')(c / (tot.get(l) || 1))} of its complaints` : `${d3.format('.1%')(c / (all || 1))} of all` })), { fmt: F.int });
      $('items-note').textContent = state.itemsMode === 'category' ? 'menu category from a placeholder column — needs the item master' : state.l1 ? 'share = complaints in this L1 ÷ all complaints on the item' : 'share = complaints on item ÷ all complaints · full period';
    }
    if (vis('c-concern-weekly')) C.stackedWeekly($('c-concern-weekly'), W.map((w) => ({ d: w.d, parts: { product: w.s.product_concern, service: w.s.service_concern } })), [{ key: 'product', label: 'Product', color: dash.colors[0] }, { key: 'service', label: 'Service', color: dash.colors[1] }]);

    // ---- Output: critical
    if (vis('c-crit-donut') && row) C.donut($('c-crit-donut'), [{ label: 'Veg / non-veg', value: row.crit_veg, color: dash.colors[3] }, { label: 'Foreign particle', value: row.crit_foreign, color: dash.colors[4] }, { label: 'Pests', value: row.crit_pests, color: dash.colors[5] }]);
    if (vis('c-crit-weekly')) C.stackedWeekly($('c-crit-weekly'), W.map((w) => ({ d: w.d, parts: { veg: w.s.crit_veg, fp: w.s.crit_foreign, pest: w.s.crit_pests } })), [{ key: 'veg', label: 'Veg / non-veg', color: dash.colors[3] }, { key: 'fp', label: 'Foreign particle', color: dash.colors[4] }, { key: 'pest', label: 'Pests', color: dash.colors[5] }], { h: 150 });
    if (vis('c-crit-items')) { const m = d3.rollups(items.filter((r) => N(r.critical_orders) > 0), (v) => d3.sum(v, (r) => N(r.critical_orders)), (r) => r.item).sort((a, b) => b[1] - a[1]).slice(0, 8); C.ranked($('c-crit-items'), m.map(([l, c]) => ({ label: l, value: c, color: 'var(--cds-chart-status-critical)' })), { fmt: F.int }); }

    // ---- Output: cancellation
    const canc = rows('cancellations').filter((r) => ids.has(r.restaurant_id) && wk(dayNum(r.week)));
    const cancTot = d3.sum(canc, (r) => N(r.orders));
    if (vis('c-cancel-reasons')) { const m = d3.rollups(canc, (v) => d3.sum(v, (r) => N(r.orders)), (r) => r.reason).sort((a, b) => b[1] - a[1]); C.ranked($('c-cancel-reasons'), m.map(([l, c]) => ({ label: l, value: cancTot ? (100 * c) / cancTot : 0, sub: F.int(c), color: l === 'Item unavailable' ? dash.colors[3] : dash.colors[0] })), { fmt: F.pct }); }
    const GC = { RDC_RCC: dash.colors[0], RDC_OOS: dash.colors[3], Tech: dash.colors[2], FXM: dash.colors[4], Other: dash.colors[6] };
    if (vis('c-cancel-donut')) { const m = d3.rollups(canc, (v) => d3.sum(v, (r) => N(r.orders)), (r) => r.cancel_group).sort((a, b) => b[1] - a[1]); C.donut($('c-cancel-donut'), m.map(([l, c]) => ({ label: l, value: c, color: GC[l] || dash.colors[7] }))); }
    if (vis('c-cancel-line')) C.line($('c-cancel-line'), pair('cancelled', 'pct'), { fmt: F.pct, y0: true });
    if (vis('c-cancel-weekly')) { const wk = d3.rollups(canc, (v) => Object.fromEntries(d3.rollups(v, (x) => d3.sum(x, (r) => N(r.orders)), (r) => r.cancel_group)), (r) => r.week).sort((a, b) => a[0].localeCompare(b[0])); C.stackedWeekly($('c-cancel-weekly'), wk.map(([w, parts]) => ({ d: toDate(dayNum(w)), parts })), Object.keys(GC).map((k) => ({ key: k, label: k, color: GC[k] })), { h: 150 }); }
    if (vis('c-cancel-items')) { const ic = rows('item_cancels').filter((r) => ids.has(r.restaurant_id)); const all = d3.sum(ic, (r) => N(r.orders)); const m = d3.rollups(ic, (v) => d3.sum(v, (r) => N(r.orders)), (r) => r.item).sort((a, b) => b[1] - a[1]).slice(0, 10); C.ranked($('c-cancel-items'), m.map(([l, c]) => ({ label: l, value: c, sub: `${d3.format('.1%')(c / (all || 1))} · full period` })), { fmt: F.int }); }

    // ---- Output: refund
    if (vis('c-refund-reasons')) { const L1C = Object.fromEntries(L1.map(([k], i) => [k, dash.colors[i]])); const m = d3.rollups(comp, (v) => d3.sum(v, (r) => N(r.refund_amt)), (r) => r.l1 + '|' + r.l2).sort((a, b) => b[1] - a[1]).slice(0, 10); C.ranked($('c-refund-reasons'), m.map(([k, v]) => { const [l1, l2] = k.split('|'); return { label: l2, value: v, sub: L1.find((x) => x[0] === l1)[1], color: L1C[l1] }; }), { fmt: F.inr }); }
    if (vis('c-refund-line')) C.line($('c-refund-line'), [{ name: 'Refund ₹', color: dash.colors[0], points: S.map((x) => ({ d: x.d, v: x.day.s.refund_amt || 0 })) }], { fmt: F.inr, y0: true, area: true, endLabels: false });

    // ---- Output: TAT
    if (vis('c-tat-line')) C.line($('c-tat-line'), pair('tat_avg', 'w'), { fmt: F.min, ref: { v: state.ideal, label: `ideal ${state.ideal} min` } });
    const varEl = $('ideal-tat').parentElement.querySelector('span'); if (row && row.tat != null) varEl.textContent = `— variance ${(row.tat - state.ideal > 0 ? '+' : '') + (row.tat - state.ideal).toFixed(1)} min vs ideal (ideal not defined in the sheet; set it here).`;

    // ---- Input: KPT
    const parts = (f) => [['breakfast', 'Breakfast'], ['lunch', 'Lunch'], ['snacks', 'Snacks'], ['dinner', 'Dinner'], ['late', 'Late night'], ['peak', 'Peak hrs'], ['offpeak', 'Off-peak']].map(([k, l]) => { const r = hc.find((x) => x.daytype === p.daytype && x.part === k); return { label: l, v: r ? r[f] : null, n: r ? r.orders : 0, key: k }; });
    if (vis('c-kpt-parts')) C.parts($('c-kpt-parts'), parts('kpt').filter((x) => x.key !== 'breakfast'), { fmt: F.num1, color: (x) => (x.key === 'peak' ? dash.colors[3] : x.key === 'offpeak' ? dash.colors[2] : dash.colors[0]) });
    if (vis('c-kpt-line')) C.line($('c-kpt-line'), pair('kpt_avg', 'w'), { fmt: F.min, ref: { v: 8, label: 'target 8 min' } });
    if (vis('c-kpt-peak')) C.line($('c-kpt-peak'), [{ name: 'Peak', color: dash.colors[3], points: S.map((x) => ({ d: x.d, v: x.w('kpt_peak') })) }, { name: 'Off-peak', color: dash.colors[2], points: S.map((x) => ({ d: x.d, v: x.w('kpt_offpeak') })) }], { fmt: F.min });
    const BK = [{ key: 'b0', label: '< 5', color: dash.colors[2] }, { key: 'b1', label: '5–8', color: dash.colors[0] }, { key: 'b2', label: '8–10', color: dash.colors[1] }, { key: 'b3', label: '> 10', color: dash.colors[3] }];
    if (vis('c-kpt-bucket') && row) { const g = [{ label: name, parts: [{ key: 'b0', value: row.kpt_lt5_pct || 0 }, { key: 'b1', value: row.kpt_5_8_pct || 0 }, { key: 'b2', value: row.kpt_8_10_pct || 0 }, { key: 'b3', value: row.kpt_gt10_pct || 0 }] }]; if (!isNet && net) g.push({ label: 'Network', parts: [{ key: 'b0', value: net.kpt_lt5_pct || 0 }, { key: 'b1', value: net.kpt_5_8_pct || 0 }, { key: 'b2', value: net.kpt_8_10_pct || 0 }, { key: 'b3', value: net.kpt_gt10_pct || 0 }] }); C.stackedH($('c-kpt-bucket'), g, BK); }
    if (vis('c-kpt-weekly')) C.stackedWeekly($('c-kpt-weekly'), W.map((w) => ({ d: w.d, parts: { b0: w.s.kpt_lt5, b1: w.s.kpt_5_8, b2: w.s.kpt_8_10, b3: w.s.kpt_gt10 } })), BK, { share: true, h: 150 });

    // ---- Input: visibility
    // hours per outlet that was due to open that day (not per outlet in the selection, which dilutes it)
    const perOutlet = (x, k) => (x.day.s.planned ? (x.day.s[k] || 0) / x.day.s.planned : null);
    if (vis('c-vis-line')) C.line($('c-vis-line'), [{ name: 'Online', color: dash.colors[2], points: S.map((x) => ({ d: x.d, v: perOutlet(x, 'online_hours') })) }, { name: 'Planned', muted: true, dashed: true, points: S.map((x) => ({ d: x.d, v: perOutlet(x, 'budget_hours') })) }], { fmt: F.hours, y0: true, shade: weekendDays });
    if (vis('c-vis-cal')) C.calendar($('c-vis-cal'), S.map((x) => ({ d: x.d, hours: perOutlet(x, 'online_hours') || 0, budget: perOutlet(x, 'budget_hours') || 0, v: x.day.s.budget_hours ? (x.day.s.online_hours || 0) / x.day.s.budget_hours : 0 })));
    if (vis('c-vis-weekly')) C.bars($('c-vis-weekly'), W.map((w) => ({ d: w.d, v: w.s.online_hours ? Math.round(((w.s.budget_hours - w.s.online_hours) * w.s.orders) / w.s.online_hours) : 0 })), { fmt: F.int, color: () => dash.colors[2] });

    // ---- Input: MFR
    if (vis('c-mfr-parts')) C.parts($('c-mfr-parts'), parts('mfr_correct_pct'), { fmt: F.pct, color: (x) => (x.key === 'peak' ? dash.colors[3] : x.key === 'offpeak' ? dash.colors[2] : dash.colors[0]) });
    if (vis('c-ho-parts')) C.parts($('c-ho-parts'), parts('handover'), { fmt: F.num1, color: (x) => (x.v > 3 ? dash.colors[3] : dash.colors[2]) });
    if (vis('c-mfr-line')) C.line($('c-mfr-line'), pair('correct_mfr_pct', 'pct'), { fmt: F.pct, ref: { v: 92, label: 'target 92%' } });
    if (vis('c-ho-line')) C.line($('c-ho-line'), pair('handover_avg', 'w'), { fmt: F.min, ref: { v: 3, label: 'ideal 3 min' } });
    if (vis('c-wait-line')) C.line($('c-wait-line'), [{ name: 'Rider waited > 3 min', color: dash.colors[3], points: S.map((x) => ({ d: x.d, v: x.pct('handover_over3_pct') })) }, { name: 'Food waited after MFR', color: dash.colors[1], points: S.map((x) => ({ d: x.d, v: x.pct('food_wait_mfr_pct') })) }], { fmt: F.pct, y0: true });

  }

  /* ---------- takeaway ---------- */
  function drawTakeaway(p, info, row, net, kp) {
    const el = $('takeaway');
    if (!row) { el.textContent = '—'; return; }
    const W = (scope) => where({ scope, period: p.period, daytype: p.daytype });
    const mark = (scope, field, text, cls) => `<b class="${cls || ''}" data-source="kpis" data-field="${field}" data-where="${attr(W(scope))}">${text}</b>`;
    const d = row.rating_d;
    const subject = info.single || !info.any ? `${esc(info.name)} rates` : p.outlet.length ? `${esc(info.name)} rate` : `The ${info.ids.size} outlets in ${esc(info.name)} rate`;
    let html = `${subject} ${mark(p.scope, 'rating', F.rating(row.rating), status('rating', row.rating))}`;
    html += d == null ? ` over ${p.custom ? winRange(p) : 'the ' + PERIOD_LABEL[p.period]}` : ` (${mark(p.scope, 'rating_d', SIGNED.rating(d), deltaClass('rating', d))} vs the ${priorLabel(p)})`;
    const DRIVERS = [['kpt', 'KPT', 'min'], ['vis_pct', 'visibility', 'pct'], ['mfr_correct_pct', 'correct MFR', 'pct'], ['handover', 'handover', 'min'], ['food_wait_pct', 'food waiting for a rider', 'pct']];
    const gap = (r, k) => { if (!net || r[k] == null || net[k] == null) return 0; const g = (r[k] - net[k]) / (Math.abs(net[k]) || 1); return GOOD[k] === 'low' ? g : -g; };
    if (!info.single) {
      const outlets = kp.filter((r) => info.ids.has(r.scope) && +r.period === p.period && r.daytype === p.daytype && r.rating != null).sort((a, b) => a.rating - b.rating).slice(0, 2);
      if (outlets.length) {
        html += '. Weakest: ' + outlets.map((o) => { const dr = DRIVERS.map((x) => [x, gap(o, x[0])]).sort((a, b) => b[1] - a[1])[0][0]; return `${byId[o.scope] ? byId[o.scope].name : o.scope} ${mark(o.scope, 'rating', F.rating(o.rating), 'bad')} with ${dr[1]} at ${mark(o.scope, dr[0], F[dr[2]](o[dr[0]]))}`; }).join(' and ');
        const drs = outlets.map((o) => DRIVERS.map((x) => [x, gap(o, x[0])]).sort((a, b) => b[1] - a[1])[0][0]);
        html += ` against a network ${drs[0][1]} of ${mark('all', drs[0][0], F[drs[0][2]](net[drs[0][0]]))}.`;
      } else html += '.';
    } else {
      const drs = DRIVERS.map((x) => [x, gap(row, x[0])]).sort((a, b) => b[1] - a[1]).slice(0, 2);
      html += `. Biggest gaps to the network: ${drs.map(([x]) => `${x[1]} ${mark(p.scope, x[0], F[x[2]](row[x[0]]), status(x[0], row[x[0]]))} vs ${mark('all', x[0], F[x[2]](net[x[0]]))}`).join(', ')}; product concerns run ${mark(p.scope, 'product_pct', F.pct(row.product_pct), status('product_pct', row.product_pct))} against ${mark('all', 'product_pct', F.pct(net.product_pct))}.`;
    }
    el.innerHTML = html;
  }

  /* ---------- leaderboard ---------- */
  const LBT = {
    outcome: [['rating', 'Rating', 'rating'], ['rating_n', '# ratings', 'int'], ['sale_loss', 'Cancelled ₹', 'inr'], ['refund', 'Refunds ₹', 'inr']],
    output: [['product_pct', 'Product concern', 'pct'], ['service_pct', 'Service concern', 'pct'], ['crit_total', 'Critical incidents', 'int'], ['cancel_pct', 'Cancelled', 'pct'], ['tat', 'TAT', 'min']],
    input: [['kpt', 'KPT', 'min'], ['kpt_gt10_pct', 'Orders > 10 min', 'pct'], ['vis_pct', 'Visibility', 'pct'], ['mfr_correct_pct', 'Correct MFR', 'pct'], ['handover', 'Handover', 'min'], ['food_wait_pct', 'Food waited after MFR', 'pct']],
  };
  const FLAGS = [['kpt', 'KPT'], ['vis_pct', 'Visibility'], ['mfr_correct_pct', 'MFR'], ['handover', 'Handover'], ['product_pct', 'Product'], ['service_pct', 'Service'], ['cancel_pct', 'Cancels'], ['crit_total', 'Critical']];
  function drawLeaderboard(p, info, kp, net) {
    const box = $('lb-rows');
    // one outlet picked: list its brand / city peers so the row stays in context
    const ids = info.single ? info.pool : info.ids, brandCity = p.brand.length + p.state.length + p.city.length > 0;
    let list = kp.filter((r) => ids.has(r.scope) && +r.period === p.period && r.daytype === p.daytype);
    const k = state.lbSort, dir = (GOOD[k] === 'low' ? 1 : -1) * (state.lbOrder === 'worst' ? -1 : 1);
    list.sort((a, b) => ((a[k] == null) - (b[k] == null)) || dir * (a[k] - b[k]));
    $('lb').querySelectorAll('[data-sort]').forEach((h) => h.setAttribute('aria-sort', h.dataset.sort === k ? (dir > 0 ? 'ascending' : 'descending') : 'none'));
    $('lb-note').textContent = `${list.length} outlets${(info.single ? brandCity : info.any) ? ' in the current filter' : ''} · ${winLabel(p)}. Open a row to see why: input → output → outcome, each against the network.`;
    const ext = {}; Object.values(LBT).flat().forEach(([f]) => { const vs = list.map((r) => r[f]).concat(net ? [net[f]] : []).filter((v) => v != null); ext[f] = [d3.min(vs), d3.max(vs)]; });
    const Wh = (scope) => where({ scope, period: p.period, daytype: p.daytype });
    const m = (scope, f, text, cls) => `<span class="${cls || ''}" data-source="kpis" data-field="${f}" data-where="${attr(Wh(scope))}">${text}</span>`;
    // long lists come in pages of 50; a focused outlet further down is added after a gap, with its real rank
    const LB_STEP = 50, limit = Math.min(state.lbLimit, list.length), more = list.length - limit;
    const fi = info.single ? list.findIndex((r) => r.scope === info.single) : -1;
    const shown = list.slice(0, limit).map((r, i) => [r, i]).concat(fi >= limit ? [[list[fi], fi]] : []);
    box.innerHTML = shown.map(([r, i]) => {
      const rr = byId[r.scope] || { name: r.scope, city: '' };
      const open = state.open.has(r.scope);
      const flags = FLAGS.map(([f, l]) => [l, status(f, r[f])]).filter(([, s]) => s === 'bad' || s === 'warn').sort((a) => (a[1] === 'bad' ? -1 : 1)).slice(0, 3);
      const stars = r.rating == null ? '' : '★'.repeat(Math.round(r.rating)) + '☆'.repeat(5 - Math.round(r.rating));
      let html = (i === fi && fi >= limit ? '<div class="lb-gap">⋯</div>' : '') + `<div class="lb-row${info.single === r.scope ? ' focus' : ''}" data-id="${r.scope}" role="button" aria-expanded="${open}">
        <span class="lb-rank">${i + 1}</span>
        <span class="lb-name">${rr.name}<small>${rr.city}</small></span>
        <span class="lb-rating"><span class="lb-stars">${stars}</span>${m(r.scope, 'rating', F.rating(r.rating), 'v')}<span class="lb-d">${m(r.scope, 'rating_d', r.rating_d == null ? '' : SIGNED.rating(r.rating_d), deltaClass('rating', r.rating_d))}</span></span>
        <span class="hide-sm">${m(r.scope, 'rating_n', F.int(r.rating_n))}</span>
        <span class="hide-sm">${m(r.scope, 'sale_loss', F.inr(r.sale_loss))}</span>
        <span class="hide-sm">${m(r.scope, 'refund', F.inr(r.refund))}</span>
        <span class="lb-drivers hide-sm">${flags.map(([l, s]) => `<span class="${s}">${l}</span>`).join('') || '<span>no flags</span>'}</span>
        <svg class="lb-chev" viewBox="0 0 16 16"><path d="M3 6l5 5 5-5" fill="none" stroke="currentColor" stroke-width="1.5"/></svg></div>`;
      if (open) {
        const tier = (key, title, sub, color) => `<div class="lb-tier" style="--tier:${color}"><h4>${title}<small>${sub}</small></h4>` + LBT[key].map(([f, l, fmt]) => `<div class="lb-m"><span class="n">${l}</span>${m(r.scope, f, F[fmt](r[f]), 'v ' + status(f, r[f]))}<span class="net">${net ? m('all', f, F[fmt](net[f])) : '—'} net</span><div class="db" data-f="${f}"></div></div>`).join('') + '</div>';
        html += `<div class="lb-diag open" data-id="${r.scope}">${tier('input', 'Input', 'operational causes', dash.colors[2])}${tier('output', 'Output', '→ what went wrong', dash.colors[1])}${tier('outcome', 'Outcome', '→ what the customer sees', dash.colors[0])}
          <div class="lb-actions">${info.single === r.scope ? `${p.outlet.length ? `<button type="button" data-clearfocus="1">Back to ${brandCity ? 'all outlets in the filter' : 'network view'}</button>` : ''}<span>Every chart on the page is showing this outlet.</span>` : `<button type="button" data-focus="${r.scope}">Focus every chart on ${rr.name}</button><span>Dot = outlet, grey dot = network; red when worse.</span>`}</div></div>`;
      }
      return html;
    }).join('') + (more > 0 ? `<div class="lb-more"><button type="button" data-more="1">Show ${Math.min(LB_STEP, more)} more</button><span>${limit} of ${list.length} outlets shown</span></div>` : '');
    // dumbbells
    box.querySelectorAll('.lb-diag').forEach((d) => { const r = list.find((x) => x.scope === d.dataset.id); d.querySelectorAll('.db').forEach((db) => { const f = db.dataset.f; const [lo, hi] = ext[f]; C.dumbbell(db, r[f], net ? net[f] : null, lo, hi, GOOD[f] || 'low'); }); });
  }

  dash.onData(draw);
})();
