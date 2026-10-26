/* Chart helpers for the Ops dashboard. Shared on window.C. All drawings size from the container's clientWidth. */
(function () {
  const C = {};
  const fmtDate = d3.utcFormat('%b %-d');
  const parseDay = (s) => new Date(Date.UTC(+s.slice(0, 4), +s.slice(5, 7) - 1, +s.slice(8, 10)));
  C.parseDay = parseDay;
  C.fmtDate = fmtDate;

  function svgIn(el, h) {
    el.replaceChildren();
    const w = el.clientWidth || 320;
    const svg = d3.select(el).append('svg').attr('width', '100%').attr('viewBox', `0 0 ${w} ${h}`).attr('preserveAspectRatio', 'none');
    return { svg, w, h };
  }
  function tip(el) {
    let t = el.querySelector('.ops-tip');
    if (!t) { t = document.createElement('div'); t.className = 'ops-tip'; t.hidden = true; el.appendChild(t); }
    return t;
  }
  function placeTip(el, t, x, y) {
    const r = el.getBoundingClientRect();
    t.hidden = false;
    const tw = t.offsetWidth, th = t.offsetHeight;
    let lx = x + 12, ly = y - th - 8;
    if (lx + tw > r.width) lx = x - tw - 12;
    if (ly < 0) ly = y + 12;
    t.style.left = Math.max(0, lx) + 'px'; t.style.top = Math.max(0, ly) + 'px';
  }
  function textW(svg, s, size) {
    const t = svg.append('text').attr('font-size', size).text(s);
    const w = t.node().getComputedTextLength(); t.remove(); return w;
  }
  const measure = (svg, labels, size) => Math.max(0, ...labels.map((l) => textW(svg, l, size)));

  /* Line chart: series [{name, color, points:[{d: Date, v: number|null}], muted?, dashed?}], opts {fmt, ref:{v,label}, shade: [Date...] weekend days, h, status(v)} */
  C.line = function (el, series, opts = {}) {
    const h = opts.h || 180;
    const { svg, w } = svgIn(el, h);
    const fmt = opts.fmt || ((v) => d3.format('.1f')(v));
    const all = series.flatMap((s) => s.points.filter((p) => p.v != null));
    if (!all.length) return;
    const yl = 11;
    const yMinRaw = d3.min(all, (p) => p.v), yMaxRaw = d3.max(all, (p) => p.v);
    let yMin = opts.y0 ? 0 : yMinRaw, yMax = yMaxRaw;
    if (opts.ref) { yMin = Math.min(yMin, opts.ref.v); yMax = Math.max(yMax, opts.ref.v); }
    if (yMax === yMin) { yMax += 1; yMin = Math.max(0, yMin - 1); }
    const pad = (yMax - yMin) * 0.12; yMax += pad; if (!opts.y0) yMin -= pad;
    const ticks = d3.scaleLinear([yMin, yMax], [0, 1]).ticks(4);
    const leftW = measure(svg, ticks.map(fmt), yl) + 8;
    const endLabels = series.map((s) => { const last = [...s.points].reverse().find((p) => p.v != null); return last ? `${s.name} ${fmt(last.v)}` : ''; });
    const rightW = opts.endLabels === false ? 8 : Math.min(w * 0.4, measure(svg, endLabels, yl) + 10);
    const m = { t: 10, r: rightW, b: 22, l: leftW };
    const x = d3.scaleUtc(d3.extent(series[0].points, (p) => p.d), [m.l, w - m.r]);
    const y = d3.scaleLinear([yMin, yMax], [h - m.b, m.t]);
    if (opts.shade && opts.shade.length) {
      const dayW = Math.max(1, x(d3.utcDay.offset(opts.shade[0], 1)) - x(opts.shade[0]));
      svg.append('g').selectAll('rect').data(opts.shade).join('rect')
        .attr('x', (d) => x(d) - dayW / 2).attr('y', m.t).attr('width', dayW).attr('height', h - m.b - m.t)
        .attr('fill', 'var(--cds-chart-grid)').attr('opacity', 0.6);
    }
    svg.append('g').selectAll('line').data(ticks).join('line').attr('x1', m.l).attr('x2', w - m.r).attr('y1', (d) => y(d)).attr('y2', (d) => y(d)).attr('stroke', 'var(--cds-chart-grid)');
    svg.append('g').selectAll('text').data(ticks).join('text').attr('x', m.l - 6).attr('y', (d) => y(d) + 4).attr('text-anchor', 'end').attr('font-size', yl).attr('fill', 'var(--color-fg-muted)').text(fmt);
    const xt = x.ticks(Math.max(2, Math.min(6, Math.floor((w - m.l - m.r) / 70))));
    svg.append('g').selectAll('text').data(xt).join('text').attr('x', (d) => x(d)).attr('y', h - 6).attr('text-anchor', 'middle').attr('font-size', yl).attr('fill', 'var(--color-fg-muted)').text(fmtDate);
    if (opts.ref) {
      svg.append('line').attr('x1', m.l).attr('x2', w - m.r).attr('y1', y(opts.ref.v)).attr('y2', y(opts.ref.v)).attr('stroke', 'var(--cds-chart-reference)').attr('stroke-dasharray', '4 4');
      svg.append('text').attr('x', m.l + 4).attr('y', y(opts.ref.v) - 4).attr('font-size', yl).attr('fill', 'var(--color-fg-muted)').text(opts.ref.label);
    }
    const line = d3.line().defined((p) => p.v != null).x((p) => x(p.d)).y((p) => y(p.v));
    if (opts.area) {
      const gid = 'g' + Math.random().toString(36).slice(2, 8);
      const g = svg.append('defs').append('linearGradient').attr('id', gid).attr('x1', 0).attr('x2', 0).attr('y1', 0).attr('y2', 1);
      [[0, .26], [.25, .16], [.5, .08], [.75, .03], [1, 0]].forEach(([o, a]) => g.append('stop').attr('offset', o).attr('stop-opacity', a).attr('style', `stop-color:${series[0].color}`));
      const area = d3.area().defined((p) => p.v != null).x((p) => x(p.d)).y0(h - m.b).y1((p) => y(p.v));
      svg.append('path').datum(series[0].points).attr('d', area).attr('fill', `url(#${gid})`);
    }
    series.forEach((s) => {
      svg.append('path').datum(s.points).attr('d', line).attr('fill', 'none')
        .attr('stroke', s.muted ? 'var(--cds-chart-muted)' : s.color).attr('stroke-width', s.muted ? 1.5 : 2)
        .attr('stroke-linecap', 'round').attr('stroke-linejoin', 'round').attr('stroke-dasharray', s.dashed ? '3 4' : null);
    });
    // end labels, pushed apart
    if (opts.endLabels !== false) {
      const lab = series.map((s, i) => { const last = [...s.points].reverse().find((p) => p.v != null); return last ? { s, i, yy: y(last.v), text: endLabels[i] } : null; }).filter(Boolean).sort((a, b) => a.yy - b.yy);
      for (let i = 1; i < lab.length; i++) if (lab[i].yy - lab[i - 1].yy < 12) lab[i].yy = lab[i - 1].yy + 12;
      lab.forEach((l) => svg.append('text').attr('x', w - m.r + 6).attr('y', l.yy + 4).attr('font-size', yl).attr('fill', l.s.muted ? 'var(--color-fg-muted)' : l.s.color).text(l.text));
    }
    // hover
    const t = tip(el);
    const hover = svg.append('g').style('display', 'none');
    const rule = hover.append('line').attr('y1', m.t).attr('y2', h - m.b).attr('stroke', 'var(--cds-chart-axis)');
    const dots = series.map((s) => hover.append('circle').attr('r', 3.5).attr('fill', s.muted ? 'var(--cds-chart-muted)' : s.color));
    const bisect = d3.bisector((p) => p.d).center;
    svg.append('rect').attr('x', m.l).attr('y', m.t).attr('width', Math.max(0, w - m.l - m.r)).attr('height', h - m.t - m.b).attr('fill', 'transparent')
      .on('mousemove', (ev) => {
        const [mx, my] = d3.pointer(ev, svg.node());
        const dx = x.invert(mx); const i = bisect(series[0].points, dx);
        const p0 = series[0].points[i]; if (!p0) return;
        hover.style('display', null); rule.attr('x1', x(p0.d)).attr('x2', x(p0.d));
        let html = `<div class="ops-tip-h">${fmtDate(p0.d)}</div>`;
        series.forEach((s, k) => { const p = s.points[i]; if (p && p.v != null) { dots[k].attr('cx', x(p.d)).attr('cy', y(p.v)).style('display', null); html += `<div><i style="background:${s.muted ? 'var(--cds-chart-muted)' : s.color}"></i>${s.name} <b>${fmt(p.v)}</b></div>`; } else dots[k].style('display', 'none'); });
        t.innerHTML = html; placeTip(el, t, mx, my);
      }).on('mouseleave', () => { hover.style('display', 'none'); t.hidden = true; });
  };

  /* Horizontal ranked bars: rows [{label, value, sub?, color?}], opts {fmt, h?, onClick, active} */
  C.ranked = function (el, rows, opts = {}) {
    const rowH = opts.rowH || 26, n = rows.length;
    const h = Math.max(40, n * rowH + 6);
    const { svg, w } = svgIn(el, h);
    if (!n) { el.classList.add('ops-empty'); return; } el.classList.remove('ops-empty');
    const fmt = opts.fmt || d3.format(',');
    const labW = Math.min(w * 0.45, measure(svg, rows.map((r) => r.label), 12) + 10);
    const valW = measure(svg, rows.map((r) => fmt(r.value) + (r.sub ? '  ' + r.sub : '')), 11) + 10;
    const x = d3.scaleLinear([0, d3.max(rows, (r) => r.value) || 1], [0, Math.max(10, w - labW - valW)]);
    const g = svg.selectAll('g').data(rows).join('g').attr('transform', (d, i) => `translate(0,${i * rowH + 3})`)
      .style('cursor', opts.onClick ? 'pointer' : null).on('click', (ev, d) => opts.onClick && opts.onClick(d));
    g.append('rect').attr('x', 0).attr('y', 0).attr('width', w).attr('height', rowH).attr('fill', (d) => opts.active && opts.active === d.label ? 'var(--cds-chart-grid)' : 'transparent').attr('rx', 4);
    g.append('text').attr('x', 4).attr('y', rowH / 2 + 4).attr('font-size', 12).attr('fill', (d) => opts.active && opts.active === d.label ? 'var(--color-fg)' : 'var(--color-fg)').text((d) => d.label);
    g.append('rect').attr('x', labW).attr('y', rowH / 2 - 7).attr('height', 14).attr('rx', 4).attr('width', (d) => Math.max(2, x(d.value))).attr('fill', (d) => d.color || dash.colors[0]);
    g.append('text').attr('x', (d) => labW + Math.max(2, x(d.value)) + 6).attr('y', rowH / 2 + 4).attr('font-size', 11).attr('fill', 'var(--color-fg)').text((d) => fmt(d.value));
    g.append('text').attr('x', (d) => labW + Math.max(2, x(d.value)) + 6 + textW(svg, fmt(d.value), 11) + 6).attr('y', rowH / 2 + 4).attr('font-size', 11).attr('fill', 'var(--color-fg-muted)').text((d) => d.sub || '');
  };

  /* Donut: parts [{label, value, color}] */
  C.donut = function (el, parts, opts = {}) {
    const h = opts.h || 150;
    const { svg, w } = svgIn(el, h);
    const total = d3.sum(parts, (p) => p.value);
    if (!total) { el.classList.add('ops-empty'); return; } el.classList.remove('ops-empty');
    const r = Math.min(h / 2 - 6, 70), cx = r + 8, cy = h / 2;
    const arc = d3.arc().innerRadius(r * 0.62).outerRadius(r).padAngle(0.02).cornerRadius(3);
    const pie = d3.pie().value((p) => p.value).sort(null)(parts);
    const t = tip(el);
    svg.append('g').attr('transform', `translate(${cx},${cy})`).selectAll('path').data(pie).join('path').attr('d', arc).attr('fill', (d) => d.data.color)
      .on('mousemove', (ev, d) => { const [mx, my] = d3.pointer(ev, svg.node()); t.innerHTML = `<div class="ops-tip-h">${d.data.label}</div><div><b>${d3.format(',')(d.data.value)}</b> · ${d3.format('.1%')(d.data.value / total)}</div>`; placeTip(el, t, mx, my); })
      .on('mouseleave', () => { t.hidden = true; });
    svg.append('text').attr('x', cx).attr('y', cy + 5).attr('text-anchor', 'middle').attr('font-size', 15).attr('font-family', 'var(--font-figures)').attr('font-weight', 600).attr('fill', 'var(--color-fg)').text(d3.format(',')(total));
    const lg = svg.append('g').attr('transform', `translate(${cx + r + 16},${cy - parts.length * 9 + 4})`);
    parts.forEach((p, i) => {
      const row = lg.append('g').attr('transform', `translate(0,${i * 18})`);
      row.append('rect').attr('width', 10).attr('height', 10).attr('rx', 2).attr('y', -9).attr('fill', p.color);
      row.append('text').attr('x', 15).attr('font-size', 11).attr('fill', 'var(--color-fg)').text(`${p.label}`);
      row.append('text').attr('x', 15 + textW(svg, p.label, 11) + 6).attr('font-size', 11).attr('fill', 'var(--color-fg-muted)').text(d3.format('.1%')(p.value / total));
    });
  };

  /* Stacked horizontal bars: groups [{label, parts:[{key,value}]}], keys [{key,label,color}] */
  C.stackedH = function (el, groups, keys, opts = {}) {
    const rowH = 34, h = groups.length * rowH + 22;
    const { svg, w } = svgIn(el, h);
    const labW = measure(svg, groups.map((g) => g.label), 12) + 10;
    const x = d3.scaleLinear([0, 1], [labW, w - 4]);
    const t = tip(el);
    groups.forEach((g, gi) => {
      const total = d3.sum(g.parts, (p) => p.value) || 1;
      let acc = 0;
      const row = svg.append('g').attr('transform', `translate(0,${gi * rowH})`);
      row.append('text').attr('x', 2).attr('y', 20).attr('font-size', 12).attr('fill', 'var(--color-fg)').text(g.label);
      g.parts.forEach((p) => {
        const k = keys.find((kk) => kk.key === p.key); const x0 = x(acc / total), x1 = x((acc + p.value) / total);
        row.append('rect').attr('x', x0).attr('y', 8).attr('width', Math.max(0, x1 - x0 - 1)).attr('height', 18).attr('rx', 3).attr('fill', k.color)
          .on('mousemove', (ev) => { const [mx, my] = d3.pointer(ev, svg.node()); t.innerHTML = `<div class="ops-tip-h">${g.label} · ${k.label}</div><div><b>${d3.format('.1%')(p.value / total)}</b> · ${d3.format(',')(p.value)} orders</div>`; placeTip(el, t, mx, my + gi * rowH); }).on('mouseleave', () => { t.hidden = true; });
        if (x1 - x0 > 34) row.append('text').attr('x', (x0 + x1) / 2).attr('y', 21).attr('text-anchor', 'middle').attr('font-size', 11).attr('fill', 'var(--color-bg)').text(d3.format('.0%')(p.value / total));
        acc += p.value;
      });
    });
    const lg = svg.append('g').attr('transform', `translate(${labW},${groups.length * rowH + 14})`);
    let lx = 0;
    keys.forEach((k) => { lg.append('rect').attr('x', lx).attr('y', -8).attr('width', 10).attr('height', 10).attr('rx', 2).attr('fill', k.color); lg.append('text').attr('x', lx + 14).attr('font-size', 11).attr('fill', 'var(--color-fg-muted)').text(k.label); lx += 14 + textW(svg, k.label, 11) + 14; });
  };

  /* Stacked area/bars by week: points [{d, parts:{key:value}}], keys */
  C.stackedWeekly = function (el, points, keys, opts = {}) {
    const h = opts.h || 170;
    const { svg, w } = svgIn(el, h);
    if (!points.length) { el.classList.add('ops-empty'); return; } el.classList.remove('ops-empty');
    const share = opts.share;
    const data = points.map((p) => { const tot = d3.sum(keys, (k) => p.parts[k.key] || 0) || 1; const o = { d: p.d }; keys.forEach((k) => (o[k.key] = share ? (p.parts[k.key] || 0) / tot : p.parts[k.key] || 0)); return o; });
    const stack = d3.stack().keys(keys.map((k) => k.key))(data);
    const fmt = share ? d3.format('.0%') : d3.format(',');
    const yMax = d3.max(stack[stack.length - 1], (d) => d[1]) || 1;
    const ticks = d3.scaleLinear([0, yMax], [0, 1]).ticks(4);
    const m = { t: 8, r: 8, b: 22, l: measure(svg, ticks.map(fmt), 11) + 8 };
    const x = d3.scaleBand(data.map((d) => d.d), [m.l, w - m.r]).paddingInner(0.25);
    const y = d3.scaleLinear([0, yMax], [h - m.b, m.t]);
    svg.append('g').selectAll('line').data(ticks).join('line').attr('x1', m.l).attr('x2', w - m.r).attr('y1', (d) => y(d)).attr('y2', (d) => y(d)).attr('stroke', 'var(--cds-chart-grid)');
    svg.append('g').selectAll('text').data(ticks).join('text').attr('x', m.l - 6).attr('y', (d) => y(d) + 4).attr('text-anchor', 'end').attr('font-size', 11).attr('fill', 'var(--color-fg-muted)').text(fmt);
    const t = tip(el);
    stack.forEach((s, si) => {
      svg.append('g').selectAll('rect').data(s).join('rect').attr('x', (d) => x(d.data.d)).attr('y', (d) => y(d[1])).attr('height', (d) => Math.max(0, y(d[0]) - y(d[1]))).attr('width', x.bandwidth()).attr('fill', keys[si].color)
        .on('mousemove', (ev, d) => { const [mx, my] = d3.pointer(ev, svg.node()); t.innerHTML = `<div class="ops-tip-h">Week of ${fmtDate(d.data.d)}</div>` + keys.map((k) => `<div><i style="background:${k.color}"></i>${k.label} <b>${share ? d3.format('.1%')(d.data[k.key]) : d3.format(',')(d.data[k.key])}</b></div>`).join(''); placeTip(el, t, mx, my); })
        .on('mouseleave', () => { t.hidden = true; });
    });
    const step = Math.ceil(data.length / Math.max(1, Math.floor((w - m.l - m.r) / 56)));
    svg.append('g').selectAll('text').data(data.filter((d, i) => i % step === 0)).join('text').attr('x', (d) => x(d.d) + x.bandwidth() / 2).attr('y', h - 6).attr('text-anchor', 'middle').attr('font-size', 11).attr('fill', 'var(--color-fg-muted)').text((d) => fmtDate(d.d));
  };

  /* Weekly bars: points [{d, v}] */
  C.bars = function (el, points, opts = {}) {
    const h = opts.h || 150;
    const { svg, w } = svgIn(el, h);
    if (!points.length) { el.classList.add('ops-empty'); return; } el.classList.remove('ops-empty');
    const fmt = opts.fmt || d3.format(',');
    const yMax = d3.max(points, (p) => p.v) || 1;
    const ticks = d3.scaleLinear([0, yMax], [0, 1]).ticks(3);
    const m = { t: 8, r: 8, b: 22, l: measure(svg, ticks.map(fmt), 11) + 8 };
    const x = d3.scaleBand(points.map((p) => p.d), [m.l, w - m.r]).paddingInner(0.3);
    const y = d3.scaleLinear([0, yMax], [h - m.b, m.t]);
    svg.append('g').selectAll('line').data(ticks).join('line').attr('x1', m.l).attr('x2', w - m.r).attr('y1', (d) => y(d)).attr('y2', (d) => y(d)).attr('stroke', 'var(--cds-chart-grid)');
    svg.append('g').selectAll('text').data(ticks).join('text').attr('x', m.l - 6).attr('y', (d) => y(d) + 4).attr('text-anchor', 'end').attr('font-size', 11).attr('fill', 'var(--color-fg-muted)').text(fmt);
    const t = tip(el);
    svg.append('g').selectAll('rect').data(points).join('rect').attr('x', (p) => x(p.d)).attr('y', (p) => y(p.v)).attr('width', Math.min(32, x.bandwidth())).attr('height', (p) => Math.max(0, y(0) - y(p.v))).attr('rx', 4)
      .attr('fill', (p) => (opts.color ? opts.color(p) : dash.colors[0]))
      .on('mousemove', (ev, p) => { const [mx, my] = d3.pointer(ev, svg.node()); t.innerHTML = `<div class="ops-tip-h">${opts.label ? opts.label(p) : 'Week of ' + fmtDate(p.d)}</div><div><b>${fmt(p.v)}</b></div>`; placeTip(el, t, mx, my); }).on('mouseleave', () => { t.hidden = true; });
    const step = Math.ceil(points.length / Math.max(1, Math.floor((w - m.l - m.r) / 56)));
    svg.append('g').selectAll('text').data(points.filter((d, i) => i % step === 0)).join('text').attr('x', (p) => x(p.d) + Math.min(32, x.bandwidth()) / 2).attr('y', h - 6).attr('text-anchor', 'middle').attr('font-size', 11).attr('fill', 'var(--color-fg-muted)').text((p) => (opts.xlabel ? opts.xlabel(p) : fmtDate(p.d)));
  };

  /* Heatmap: cells [{row, col, v, n}], rows labels, cols labels; opts {fmt, good: 'low'|'high'} */
  C.heatmap = function (el, cells, rows, cols, opts = {}) {
    const labW = 34, cellH = 20, h = rows.length * cellH + 28;
    const { svg, w } = svgIn(el, h);
    const cw = (w - labW - 4) / cols.length;
    const vals = cells.map((c) => c.v).filter((v) => v != null);
    if (!vals.length) return;
    const lo = d3.quantile(vals.sort(d3.ascending), 0.05), hi = d3.quantile(vals, 0.95);
    const c1 = opts.color || dash.colors[0];
    const scale = d3.scaleLinear([lo, hi], [0.08, 1]).clamp(true);
    const fmt = opts.fmt || d3.format('.1f');
    const t = tip(el);
    svg.append('g').selectAll('text').data(rows).join('text').attr('x', labW - 6).attr('y', (r, i) => i * cellH + 14).attr('text-anchor', 'end').attr('font-size', 11).attr('fill', 'var(--color-fg-muted)').text((r) => r);
    svg.append('g').selectAll('text').data(cols).join('text').attr('x', (c, i) => labW + i * cw + cw / 2).attr('y', h - 6).attr('text-anchor', 'middle').attr('font-size', 10).attr('fill', 'var(--color-fg-muted)').text((c, i) => (i % (cw < 22 ? 2 : 1) === 0 ? c : ''));
    svg.append('g').selectAll('rect').data(cells).join('rect').attr('x', (c) => labW + c.col * cw + 1).attr('y', (c) => c.row * cellH + 1).attr('width', Math.max(1, cw - 2)).attr('height', cellH - 2).attr('rx', 3)
      .attr('fill', c1).attr('fill-opacity', (c) => (c.v == null ? 0 : scale(c.v)))
      .on('mousemove', (ev, c) => { const [mx, my] = d3.pointer(ev, svg.node()); t.innerHTML = `<div class="ops-tip-h">${rows[c.row]} · ${cols[c.col]}:00</div><div><b>${fmt(c.v)}</b> · ${d3.format(',')(c.n)} orders</div>`; placeTip(el, t, mx, my); }).on('mouseleave', () => { t.hidden = true; });
  };

  /* Calendar strip: days [{d, v}] with v 0..1 (online share), opts {weeksPerRow} */
  C.calendar = function (el, days, opts = {}) {
    if (!days.length) { el.replaceChildren(); return; }
    const first = d3.utcMonday(days[0].d);
    const weeks = d3.utcMonday.count(first, days[days.length - 1].d) + 1;
    const cell = 16, gap = 3;
    const w0 = el.clientWidth || 320; const h = 7 * (cell + gap) + 16;
    const { svg } = svgIn(el, h);
    const cw = Math.min(cell, (w0 - 30) / weeks - gap);
    const t = tip(el);
    const byDay = new Map(days.map((x) => [+x.d, x]));
    const fill = (x) => (x.v === 0 ? 'var(--color-bad)' : x.v < 0.9 ? 'var(--color-warn)' : dash.colors[2]);
    ['M', 'T', 'W', 'T', 'F', 'S', 'S'].forEach((l, i) => svg.append('text').attr('x', 0).attr('y', 12 + i * (cell + gap)).attr('font-size', 10).attr('fill', 'var(--color-fg-muted)').text(l));
    for (let wk = 0; wk < weeks; wk++) for (let dow = 0; dow < 7; dow++) {
      const d = d3.utcDay.offset(first, wk * 7 + dow); const x = byDay.get(+d);
      const r = svg.append('rect').attr('x', 14 + wk * (cw + gap)).attr('y', 2 + dow * (cell + gap)).attr('width', cw).attr('height', cell).attr('rx', 3).attr('fill', x ? fill(x) : 'transparent').attr('opacity', x && x.v > 0 ? 0.35 + 0.65 * x.v : 1);
      if (x) r.on('mousemove', (ev) => { const [mx, my] = d3.pointer(ev, svg.node()); t.innerHTML = `<div class="ops-tip-h">${fmtDate(d)}</div><div>Online <b>${d3.format('.1f')(x.hours)} h</b> of ${d3.format('.0f')(x.budget)} h</div>`; placeTip(el, t, mx, my); }).on('mouseleave', () => { t.hidden = true; });
    }
  };

  /* Dumbbell: outlet vs network for diagnostics. values {v, net}, domain [lo, hi], good: 'low'|'high' */
  C.dumbbell = function (el, v, net, lo, hi, good) {
    const h = 14; const { svg, w } = svgIn(el, h);
    if (v == null || net == null) return;
    const x = d3.scaleLinear([lo, hi], [6, w - 6]).clamp(true);
    svg.append('line').attr('x1', 6).attr('x2', w - 6).attr('y1', 7).attr('y2', 7).attr('stroke', 'var(--cds-chart-grid)').attr('stroke-width', 3).attr('stroke-linecap', 'round');
    const worse = good === 'low' ? v > net : v < net;
    svg.append('line').attr('x1', x(net)).attr('x2', x(v)).attr('y1', 7).attr('y2', 7).attr('stroke', worse ? 'var(--cds-chart-status-critical)' : 'var(--color-ok)').attr('stroke-width', 3).attr('stroke-linecap', 'round').attr('opacity', 0.6);
    svg.append('circle').attr('cx', x(net)).attr('cy', 7).attr('r', 3.5).attr('fill', 'var(--cds-chart-muted)');
    svg.append('circle').attr('cx', x(v)).attr('cy', 7).attr('r', 4.5).attr('fill', worse ? 'var(--cds-chart-status-critical)' : 'var(--color-ok)');
  };

  /* Day-part strip: parts [{label, v, n}] small columns with value labels */
  C.parts = function (el, parts, opts = {}) {
    const h = 86; const { svg, w } = svgIn(el, h);
    const fmt = opts.fmt || d3.format('.1f');
    const x = d3.scaleBand(parts.map((p) => p.label), [0, w]).paddingInner(0.3).paddingOuter(0.1);
    const vals = parts.map((p) => p.v).filter((v) => v != null);
    if (!vals.length) return;
    const y = d3.scaleLinear([0, d3.max(vals) * 1.15], [h - 18, 16]);
    const t = tip(el);
    const g = svg.selectAll('g').data(parts).join('g');
    g.append('rect').attr('x', (p) => x(p.label)).attr('y', (p) => (p.v == null ? y(0) : y(p.v))).attr('width', x.bandwidth()).attr('height', (p) => (p.v == null ? 0 : Math.max(0, y(0) - y(p.v)))).attr('rx', 4).attr('fill', (p) => (opts.color ? opts.color(p) : dash.colors[0]))
      .on('mousemove', (ev, p) => { const [mx, my] = d3.pointer(ev, svg.node()); t.innerHTML = `<div class="ops-tip-h">${p.label}</div><div><b>${fmt(p.v)}</b> · ${d3.format(',')(p.n)} orders</div>`; placeTip(el, t, mx, my); }).on('mouseleave', () => { t.hidden = true; });
    g.append('text').attr('x', (p) => x(p.label) + x.bandwidth() / 2).attr('y', (p) => (p.v == null ? y(0) : y(p.v)) - 4).attr('text-anchor', 'middle').attr('font-size', 11).attr('fill', 'var(--color-fg)').text((p) => (p.v == null ? '—' : fmt(p.v)));
    g.append('text').attr('x', (p) => x(p.label) + x.bandwidth() / 2).attr('y', h - 5).attr('text-anchor', 'middle').attr('font-size', 10).attr('fill', 'var(--color-fg-muted)').text((p) => p.label);
  };

  /* Split bar: two parts side by side with labels */
  C.split = function (el, a, b, opts = {}) {
    const h = 44; const { svg, w } = svgIn(el, h);
    const tot = (a.value || 0) + (b.value || 0); if (!tot) return;
    const xa = (w - 2) * (a.value / tot);
    svg.append('rect').attr('x', 0).attr('y', 6).attr('width', Math.max(0, xa)).attr('height', 16).attr('rx', 4).attr('fill', a.color);
    svg.append('rect').attr('x', xa + 2).attr('y', 6).attr('width', Math.max(0, w - xa - 2)).attr('height', 16).attr('rx', 4).attr('fill', b.color);
    svg.append('text').attr('x', 0).attr('y', 38).attr('font-size', 11).attr('fill', 'var(--color-fg-muted)').text(`${a.label} · ${d3.format('.1%')(a.value / tot)}`);
    svg.append('text').attr('x', w).attr('y', 38).attr('text-anchor', 'end').attr('font-size', 11).attr('fill', 'var(--color-fg-muted)').text(`${b.label} · ${d3.format('.1%')(b.value / tot)}`);
  };

  window.C = C;
})();
