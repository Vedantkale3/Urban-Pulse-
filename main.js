// ============================================================
// main.js — UrbanPulse Frontend Logic
// Fetches data from Flask backend and renders charts/map
// ============================================================

// ── Chart.js global defaults ──────────────────────────────
Chart.defaults.color          = '#4a5878';
Chart.defaults.borderColor    = '#1e2736';
Chart.defaults.font.family    = 'DM Mono';
Chart.defaults.font.size      = 11;

// ── Color palette ─────────────────────────────────────────
const C = {
  red:    '#ef4444', orange: '#f97316', yellow: '#eab308',
  green:  '#22c55e', blue:   '#3b82f6', cyan:   '#06b6d4',
  purple: '#a855f7', muted:  '#4a5878', text:   '#e2e8f4',
  surface:'#161c28',
};

// ── Stored chart instances (to destroy before re-rendering) ─
const charts = {};


// ═══════════════════════════════════════════════════════════
// PAGE NAVIGATION
// ═══════════════════════════════════════════════════════════

const pageTitles = {
  dashboard:   'Dashboard',
  correlation: 'Correlation Analysis',
  map:         'Live Map',
  diversion:   'Diversion Strategy',
};

function showPage(name) {
  // Hide all pages
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));

  // Show selected
  document.getElementById('page-' + name).classList.add('active');
  document.querySelector(`[data-page="${name}"]`).classList.add('active');
  document.getElementById('pageTitle').textContent = pageTitles[name];

  // Load page data
  if (name === 'dashboard')   loadDashboard();
  if (name === 'correlation') loadCorrelation();
  if (name === 'map')         loadMap();
  if (name === 'diversion')   loadDiversions();
}


// ═══════════════════════════════════════════════════════════
// CLOCK
// ═══════════════════════════════════════════════════════════

function updateClock() {
  const now = new Date();
  document.getElementById('clockDisplay').textContent =
    now.toLocaleTimeString('en-IN', { hour12: false });
}
setInterval(updateClock, 1000);
updateClock();


// ═══════════════════════════════════════════════════════════
// DASHBOARD PAGE
// ═══════════════════════════════════════════════════════════

async function loadDashboard() {
  await loadSummaryCards();
  await loadHourlyChart();
  await loadScatterChart();
  await loadPieCharts();
}

async function loadSummaryCards() {
  const data = await fetch('/api/summary').then(r => r.json());

  document.getElementById('card-peak-aqi').textContent  = data.peak_aqi;
  document.getElementById('card-traffic').textContent   = (data.avg_traffic * 100).toFixed(0) + '%';
  document.getElementById('card-hotspots').textContent  = data.hotspots;
  document.getElementById('card-sensors').textContent   = data.locations;
  document.getElementById('topAqi').textContent         = 'AQI ' + data.avg_aqi;
}

async function loadHourlyChart() {
  const data  = await fetch('/api/hourly').then(r => r.json());
  const hours = data.map(d => d.hour + ':00');
  const traffic = data.map(d => (d.traffic_density * 100).toFixed(1));
  const aqi     = data.map(d => d.aqi.toFixed(1));

  if (charts.hourly) charts.hourly.destroy();

  const ctx = document.getElementById('hourlyChart').getContext('2d');
  charts.hourly = new Chart(ctx, {
    type: 'line',
    data: {
      labels: hours,
      datasets: [
        {
          label:           'Traffic Density (%)',
          data:            traffic,
          borderColor:     C.blue,
          backgroundColor: 'rgba(59,130,246,0.08)',
          borderWidth:     2,
          fill:            true,
          tension:         0.4,
          yAxisID:         'y',
          pointRadius:     2,
        },
        {
          label:           'AQI',
          data:            aqi,
          borderColor:     C.red,
          backgroundColor: 'rgba(239,68,68,0.08)',
          borderWidth:     2,
          fill:            true,
          tension:         0.4,
          yAxisID:         'y1',
          borderDash:      [4, 3],
          pointRadius:     2,
        },
      ],
    },
    options: {
      responsive: true,
      interaction: { mode: 'index', intersect: false },
      plugins: {
        legend: {
          labels: { color: C.text, boxWidth: 12, font: { size: 11 } },
        },
      },
      scales: {
        x:  { ticks: { maxTicksLimit: 12 } },
        y:  {
          position: 'left',
          title: { display: true, text: 'Traffic %', color: C.blue },
          ticks: { color: C.blue },
        },
        y1: {
          position: 'right',
          title: { display: true, text: 'AQI', color: C.red },
          ticks: { color: C.red },
          grid: { drawOnChartArea: false },
        },
      },
    },
  });
}

async function loadScatterChart() {
  const data = await fetch('/api/scatter').then(r => r.json());

  // Color by AQI severity
  const points = data.map(d => ({
    x: d.traffic_density,
    y: d.aqi,
    r: 4,
  }));
  const colors = data.map(d =>
    d.aqi > 200 ? C.red :
    d.aqi > 150 ? C.orange :
    d.aqi > 100 ? C.yellow : C.green
  );

  if (charts.scatter) charts.scatter.destroy();

  const ctx = document.getElementById('scatterChart').getContext('2d');
  charts.scatter = new Chart(ctx, {
    type: 'bubble',
    data: {
      datasets: [{
        label:           'Traffic vs AQI',
        data:            points,
        backgroundColor: colors.map(c => c + '99'),
        borderColor:     colors,
        borderWidth:     1,
      }],
    },
    options: {
      responsive: true,
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            label: ctx => {
              const d = ctx.raw;
              return `Traffic: ${(d.x*100).toFixed(0)}% | AQI: ${d.y.toFixed(0)}`;
            },
          },
        },
      },
      scales: {
        x: { title: { display: true, text: 'Traffic Density (0–1)', color: C.muted } },
        y: { title: { display: true, text: 'AQI', color: C.muted } },
      },
    },
  });
}


// ═══════════════════════════════════════════════════════════
// CORRELATION PAGE
// ═══════════════════════════════════════════════════════════

async function loadCorrelation() {
  await loadCorrTable();
  await loadCorrBarChart();
  await loadHeatmapChart();
}

async function loadCorrTable() {
  const data = await fetch('/api/correlation').then(r => r.json());
  const tbody = document.getElementById('corrTableBody');
  tbody.innerHTML = '';

  data.forEach(row => {
    const color = row.pearson_r > 0.7 ? C.green :
                  row.pearson_r > 0.4 ? C.yellow : C.red;
    tbody.innerHTML += `
      <tr>
        <td>${row.label}</td>
        <td style="font-family:var(--font-mono);color:${color};font-weight:600">
          ${row.pearson_r.toFixed(3)}
        </td>
        <td style="font-family:var(--font-mono)">${row.spearman_r.toFixed(3)}</td>
        <td style="font-family:var(--font-mono);font-size:11px">${row.p_value.toExponential(2)}</td>
        <td>${row.strength}</td>
        <td class="${row.significant ? 'sig-yes' : 'sig-no'}">
          ${row.significant ? '✅ Yes' : '❌ No'}
        </td>
      </tr>`;
  });
}

async function loadCorrBarChart() {
  const data = await fetch('/api/correlation').then(r => r.json());

  if (charts.corrBar) charts.corrBar.destroy();

  const ctx = document.getElementById('corrBarChart').getContext('2d');
  charts.corrBar = new Chart(ctx, {
    type: 'bar',
    data: {
      labels: data.map(d => d.label.replace(' vs ', '\nvs ')),
      datasets: [{
        label:           'Pearson r',
        data:            data.map(d => d.pearson_r),
        backgroundColor: data.map(d =>
          d.pearson_r > 0.7 ? C.green + 'bb' :
          d.pearson_r > 0.4 ? C.yellow + 'bb' : C.orange + 'bb'
        ),
        borderColor: data.map(d =>
          d.pearson_r > 0.7 ? C.green :
          d.pearson_r > 0.4 ? C.yellow : C.orange
        ),
        borderWidth: 1,
        borderRadius: 4,
      }],
    },
    options: {
      indexAxis: 'y',
      responsive: true,
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: { label: ctx => ` r = ${ctx.raw.toFixed(3)}` },
        },
      },
      scales: {
        x: { min: 0, max: 1, title: { display: true, text: 'Pearson r', color: C.muted } },
        y: { ticks: { font: { size: 10 } } },
      },
    },
  });
}

async function loadHeatmapChart() {
  const { matrix, labels } = await fetch('/api/heatmap_data').then(r => r.json());

  // Build a matrix dataset for Chart.js using a custom renderer
  // We'll use a custom "matrix" approach with a scatter chart
  const n = labels.length;

  const datasets = [];
  // Use one dataset per row for heatmap cells
  for (let i = 0; i < n; i++) {
    const rowData = matrix.filter(d => d.y === labels[i]);
    datasets.push({
      label: labels[i],
      data: rowData.map((d, j) => ({ x: j, y: i, v: d.value })),
      backgroundColor: rowData.map(d => correlationColor(d.value)),
      borderColor: 'rgba(0,0,0,0.15)',
      borderWidth: 1,
      pointStyle: 'rect',
      pointRadius: 26,
      pointHoverRadius: 28,
    });
  }

  if (charts.heatmap) charts.heatmap.destroy();

  const ctx = document.getElementById('heatmapChart').getContext('2d');
  charts.heatmap = new Chart(ctx, {
    type: 'scatter',
    data: { datasets },
    options: {
      responsive: true,
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            label: ctx => {
              const v = ctx.raw.v;
              return `r = ${v.toFixed(2)}`;
            },
          },
        },
      },
      scales: {
        x: {
          min: -0.5, max: n - 0.5,
          ticks: {
            stepSize: 1,
            callback: (val) => labels[val] || '',
          },
          grid: { color: '#1e2736' },
        },
        y: {
          min: -0.5, max: n - 0.5,
          ticks: {
            stepSize: 1,
            callback: (val) => labels[val] || '',
          },
          grid: { color: '#1e2736' },
        },
      },
    },
    plugins: [{
      // Draw the correlation value text inside each cell
      id: 'cellLabels',
      afterDatasetsDraw(chart) {
        const { ctx } = chart;
        chart.data.datasets.forEach(ds => {
          ds.data.forEach(pt => {
            const meta = chart.getDatasetMeta(chart.data.datasets.indexOf(ds));
            const el   = meta.data[ds.data.indexOf(pt)];
            if (!el) return;
            ctx.save();
            ctx.fillStyle = Math.abs(pt.v) > 0.5 ? '#fff' : '#e2e8f4';
            ctx.font      = 'bold 11px DM Mono';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText(pt.v.toFixed(2), el.x, el.y);
            ctx.restore();
          });
        });
      },
    }],
  });
}

// Returns a color for a correlation value (-1 to 1)
function correlationColor(r) {
  if (r >= 0.7)  return 'rgba(34,197,94,0.85)';
  if (r >= 0.4)  return 'rgba(34,197,94,0.45)';
  if (r >= 0.1)  return 'rgba(234,179,8,0.35)';
  if (r >= -0.1) return 'rgba(74,88,120,0.4)';
  if (r >= -0.4) return 'rgba(239,68,68,0.35)';
  return 'rgba(239,68,68,0.8)';
}


// ═══════════════════════════════════════════════════════════
// MAP PAGE
// ═══════════════════════════════════════════════════════════

let leafletMap = null;

async function loadMap() {
  const locations = await fetch('/api/locations').then(r => r.json());

  // Init map only once
  if (!leafletMap) {
    leafletMap = L.map('leafletMap').setView([18.520, 73.856], 13);
    L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
      attribution: '© OpenStreetMap © Carto',
      maxZoom: 18,
    }).addTo(leafletMap);
  } else {
    leafletMap.eachLayer(layer => {
      if (layer instanceof L.CircleMarker) leafletMap.removeLayer(layer);
    });
  }

  const riskColor = { CRITICAL: '#ef4444', HIGH: '#f97316', MODERATE: '#eab308', LOW: '#22c55e' };

  locations.forEach(loc => {
    const color  = riskColor[loc.risk] || '#22c55e';
    const radius = loc.risk === 'CRITICAL' ? 22 : loc.risk === 'HIGH' ? 18 : 14;

    L.circleMarker([loc.lat, loc.lon], {
      radius,
      fillColor:   color,
      color:       '#fff',
      weight:      1.5,
      opacity:     0.9,
      fillOpacity: 0.75,
    })
    .bindPopup(`
      <div style="font-family:'DM Mono',monospace;font-size:12px;min-width:180px">
        <b style="font-size:14px">${loc.location}</b><hr style="border-color:#333;margin:6px 0">
        🚦 Traffic: <b>${(loc.avg_traffic*100).toFixed(0)}%</b><br>
        🌫️ AQI: <b>${loc.avg_aqi}</b><br>
        💨 PM2.5: <b>${loc.avg_pm25} μg/m³</b><br>
        <span style="
          display:inline-block;margin-top:8px;padding:2px 10px;
          background:${color}33;color:${color};
          border:1px solid ${color}66;border-radius:4px;
          font-size:10px;letter-spacing:1px
        ">${loc.risk}</span>
      </div>
    `, { maxWidth: 240 })
    .addTo(leafletMap);
  });

  // Location table
  const tbody = document.getElementById('locationTableBody');
  tbody.innerHTML = '';
  locations.forEach(loc => {
    tbody.innerHTML += `
      <tr>
        <td>${loc.location}</td>
        <td style="font-family:var(--font-mono)">${(loc.avg_traffic*100).toFixed(0)}%</td>
        <td style="font-family:var(--font-mono)">${loc.avg_aqi}</td>
        <td style="font-family:var(--font-mono)">${loc.avg_pm25}</td>
        <td><span class="risk-badge risk-${loc.risk}">${loc.risk}</span></td>
      </tr>`;
  });
}


// ═══════════════════════════════════════════════════════════
// DIVERSION PAGE
// ═══════════════════════════════════════════════════════════

async function loadDiversions() {
  const data = await fetch('/api/diversions').then(r => r.json());
  const container = document.getElementById('diversionCards');

  if (!data.length) {
    container.innerHTML = '<div class="loading">✅ No critical hotspots — all zones within safe limits.</div>';
    return;
  }

  container.innerHTML = data.map(rec => `
    <div class="diversion-card ${rec.risk.toLowerCase()}">

      <div>
        <div class="dcard-section-label">⚠ Hotspot Zone</div>
        <div class="dcard-location">${rec.from}</div>
        <div class="dcard-stats">
          <div class="dcard-stat">AQI <span>${rec.current_aqi}</span></div>
          <div class="dcard-stat">Traffic <span>${rec.traffic_pct}</span></div>
        </div>
        <div style="margin-top:8px">
          <span class="risk-badge risk-${rec.risk}">${rec.risk}</span>
        </div>
      </div>

      <div class="dcard-arrow">⟶</div>

      <div>
        <div class="dcard-section-label">✓ Suggested Diversion</div>
        <div class="dcard-location" style="color:var(--cyan)">${rec.divert_to}</div>
        <div class="dcard-stats">
          <div class="dcard-stat">Detour <span>${rec.detour_km} km</span></div>
          <div class="dcard-stat">35% vehicles rerouted</div>
        </div>
      </div>

      <div style="text-align:center">
        <div class="dcard-improvement">-${rec.est_improvement}</div>
        <div class="dcard-improvement-label">EST. AQI<br>REDUCTION</div>
      </div>

    </div>
  `).join('');
}


// ═══════════════════════════════════════════════════════════
// INIT — Load dashboard on start
// ═══════════════════════════════════════════════════════════
loadDashboard();


// ═══════════════════════════════════════════════════════════
// PIE CHARTS — AQI Risk Distribution
// ═══════════════════════════════════════════════════════════

async function loadPieCharts() {
  const data = await fetch('/api/piechart').then(r => r.json());

  const labels = data.labels;
  const values = data.values;
  const total  = values.reduce((a, b) => a + b, 0);

  // Colors matching each AQI category
  const colorMap = {
    "Good":           "#22c55e",
    "Moderate":       "#eab308",
    "Sensitive":      "#f97316",
    "Unhealthy":      "#ef4444",
    "Very Unhealthy": "#a855f7",
    "Hazardous":      "#7f1d1d",
  };

  const bgColors     = labels.map(l => colorMap[l] || "#4a5878");
  const borderColors = labels.map(l => (colorMap[l] || "#4a5878") + "cc");

  // ── Donut / Pie Chart ────────────────────────────────────
  if (charts.pie) charts.pie.destroy();

  const ctx1 = document.getElementById("pieChart").getContext("2d");
  charts.pie = new Chart(ctx1, {
    type: "doughnut",
    data: {
      labels: labels,
      datasets: [{
        data:            values,
        backgroundColor: bgColors,
        borderColor:     "#0b0e14",
        borderWidth:     3,
        hoverOffset:     10,
      }],
    },
    options: {
      responsive:          true,
      maintainAspectRatio: true,
      cutout:              "65%",    // makes it a donut
      plugins: {
        legend: {
          position: "bottom",
          labels: {
            color:     C.text,
            boxWidth:  12,
            padding:   12,
            font: { size: 11, family: "DM Mono" },
          },
        },
        tooltip: {
          callbacks: {
            label: ctx => {
              const pct = ((ctx.raw / total) * 100).toFixed(1);
              return ` ${ctx.label}: ${ctx.raw} readings (${pct}%)`;
            },
          },
        },
      },
    },
    // Draw total count in center of donut
    plugins: [{
      id: "centerText",
      beforeDraw(chart) {
        const { width, height, ctx } = chart;
        ctx.save();
        ctx.font         = "bold 22px Bebas Neue";
        ctx.fillStyle    = "#e2e8f4";
        ctx.textAlign    = "center";
        ctx.textBaseline = "middle";
        const cx = (chart.chartArea.left + chart.chartArea.right)  / 2;
        const cy = (chart.chartArea.top  + chart.chartArea.bottom) / 2;
        ctx.fillText(total, cx, cy - 10);
        ctx.font      = "11px DM Mono";
        ctx.fillStyle = "#4a5878";
        ctx.fillText("readings", cx, cy + 12);
        ctx.restore();
      },
    }],
  });

  // ── Horizontal Bar Chart (breakdown) ────────────────────
  if (charts.pieBar) charts.pieBar.destroy();

  const percentages = values.map(v => +((v / total) * 100).toFixed(1));

  const ctx2 = document.getElementById("pieBarChart").getContext("2d");
  charts.pieBar = new Chart(ctx2, {
    type: "bar",
    data: {
      labels: labels,
      datasets: [{
        label:           "% of Readings",
        data:            percentages,
        backgroundColor: bgColors.map(c => c + "bb"),
        borderColor:     bgColors,
        borderWidth:     1,
        borderRadius:    6,
      }],
    },
    options: {
      indexAxis:   "y",
      responsive:  true,
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            label: ctx => {
              const idx = ctx.dataIndex;
              return ` ${values[idx]} readings  (${ctx.raw}%)`;
            },
          },
        },
      },
      scales: {
        x: {
          max:   100,
          title: { display: true, text: "% of Total Readings", color: C.muted },
          ticks: {
            callback: val => val + "%",
          },
        },
        y: {
          ticks: { font: { size: 11 } },
        },
      },
    },
  });
}


// ═══════════════════════════════════════════════════════════
// REAL-TIME AQI WIDGET
// Polls /api/realtime_aqi every 5 minutes
// ═══════════════════════════════════════════════════════════

const AQI_COLORS = {
  "Good":           "#22c55e",
  "Moderate":       "#eab308",
  "Sensitive":      "#f97316",
  "Unhealthy":      "#ef4444",
  "Very Unhealthy": "#a855f7",
  "Hazardous":      "#7f1d1d",
};

async function loadRealtimeAQI() {
  try {
    const data = await fetch('/api/realtime_aqi').then(r => r.json());

    // Update AQI number + color
    const aqiEl   = document.getElementById('rt-aqi');
    const catEl   = document.getElementById('rt-category');
    const widget  = document.getElementById('realtimeWidget');
    const badge   = document.getElementById('rt-badge');
    const badgeTxt= document.getElementById('rt-badge-text');

    const color   = AQI_COLORS[data.category] || C.muted2;

    aqiEl.textContent   = data.aqi;
    aqiEl.style.color   = color;
    catEl.textContent   = data.category;
    catEl.style.color   = color;

    // Update pollutants
    document.getElementById('rt-pm25').textContent = data.pm25 || '--';
    document.getElementById('rt-no2').textContent  = data.no2  || '--';
    document.getElementById('rt-co').textContent   = data.co   || '--';
    document.getElementById('rt-o3').textContent   = data.o3   || '--';

    // Station info
    document.getElementById('rt-station').textContent = data.station || 'Unknown';
    document.getElementById('rt-updated').textContent =
      data.updated ? 'Updated: ' + data.updated.substring(0, 16) : '';

    // Live or Synthetic badge
    if (data.success) {
      widget.style.borderLeftColor = color;
      badge.classList.add('live');
      badgeTxt.textContent = 'Live Data';
    } else {
      badge.classList.remove('live');
      badgeTxt.textContent = 'Synthetic';
      document.getElementById('rt-station').textContent = 'Add WAQI_TOKEN for live data';
    }

    // Also update topbar AQI badge
    const topAqi = document.getElementById('topAqi');
    if (topAqi) {
      topAqi.textContent = 'AQI ' + data.aqi;
      topAqi.style.color = color;
    }

  } catch (err) {
    console.error('Realtime AQI error:', err);
  }
}

// Poll every 5 minutes
loadRealtimeAQI();
setInterval(loadRealtimeAQI, 5 * 60 * 1000);

async function loadRealtimeAQI() {

  const data = await fetch('/api/realtime_aqi')
      .then(r => r.json());

  document.getElementById('rt-aqi').textContent =
      data.aqi;

  document.getElementById('rt-pm25').textContent =
      data.pm25;

  document.getElementById('rt-no2').textContent =
      data.no2;

  document.getElementById('rt-co').textContent =
      data.co;

  document.getElementById('rt-o3').textContent =
      data.o3;

  document.getElementById('rt-station').textContent =
      data.station;

  document.getElementById('rt-updated').textContent =
      data.updated;
}

// Refresh every 5 minutes
setInterval(loadRealtimeAQI, 300000);

// Load first time
loadRealtimeAQI();