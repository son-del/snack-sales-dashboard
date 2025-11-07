const DATA_URL = './data.json';
const AUTO_REFRESH_MS = 60_000;
let chart;

const els = {
  windowSelect: document.getElementById('windowSelect'),
  modeSelect: document.getElementById('modeSelect'),
  searchInput: document.getElementById('searchInput'),
  kpiTotal: document.getElementById('kpiTotalValue'),
  kpiTop: document.getElementById('kpiTopValue'),
  kpiUpdated: document.getElementById('kpiUpdatedValue'),
  tableBody: document.getElementById('logTableBody')
};

function isoToDate(s) { return new Date(s); }
function nowUtc() { return new Date(); }

function windowToMs(key) {
  if (key === '1h') return 60 * 60 * 1000;
  if (key === '24h') return 24 * 60 * 60 * 1000;
  if (key === '7d') return 7 * 24 * 60 * 60 * 1000;
  return null;
}

async function fetchData() {
  const res = await fetch(`${DATA_URL}?_cb=${Date.now()}`, { cache: 'no-store' });
  if (!res.ok) throw new Error('fail load data.json');
  const data = await res.json();
  return data
    .map(d => ({ ...d, date: isoToDate(d.timestamp) }))
    .sort((a, b) => a.date - b.date);
}

function filterWindow(data, key) {
  const ms = windowToMs(key);
  if (!ms) return data;
  const cutoff = new Date(nowUtc().getTime() - ms);
  return data.filter(d => d.date >= cutoff);
}

function aggregateBySnack(data, mode) {
  const bySnack = new Map();
  if (mode === 'cumulative') {
    for (const d of data) {
      const prev = bySnack.get(d.snack);
      if (!prev || prev.date < d.date) bySnack.set(d.snack, d);
    }
    return [...bySnack.entries()].map(([snack, rec]) => ({
      snack,
      total: Number(rec.sales) || 0
    }));
  } else {
    for (const d of data) {
      const prev = bySnack.get(d.snack) || 0;
      bySnack.set(d.snack, prev + (Number(d.sales) || 0));
    }
    return [...bySnack.entries()].map(([snack, total]) => ({ snack, total }));
  }
}

function applySearch(rows, term) {
  if (!term) return rows;
  const q = term.toLowerCase();
  return rows.filter(r => r.snack.toLowerCase().includes(q));
}

function renderKPIs(rows, lastUpdated) {
  const total = rows.reduce((sum, r) => sum + r.total, 0);
  els.kpiTotal.textContent = total.toLocaleString();
  const top = rows.slice().sort((a, b) => b.total - a.total)[0];
  els.kpiTop.textContent = top
    ? `${top.snack} (${top.total.toLocaleString()})`
    : '—';
  els.kpiUpdated.textContent = lastUpdated
    ? lastUpdated.toISOString().replace('T', ' ').replace('Z', ' UTC')
    : '—';
}

function renderChart(rows) {
  const ctx = document.getElementById('salesChart');
  const labels = rows.map(r => r.snack);
  const values = rows.map(r => r.total);
  if (chart) chart.destroy();
  chart = new Chart(ctx, {
    type: 'bar',
    data: { labels, datasets: [{ label: '판매수량', data: values }] },
    options: {
      responsive: true,
      scales: { y: { beginAtZero: true } },
      plugins: { legend: { display: false } }
    }
  });
}

function renderTable(logs) {
  const recent = logs.slice(-100).reverse();
  els.tableBody.innerHTML = recent.map(r => `
    <tr>
      <td>${r.timestamp}</td>
      <td>${r.snack}</td>
      <td>${r.sales}</td>
    </tr>
  `).join('');
}

async function refresh() {
  try {
    const raw = await fetchData();
    const filtered = filterWindow(raw, els.windowSelect.value);
    const mode = els.modeSelect.value;
    const term = els.searchInput.value;
    const agg = aggregateBySnack(filtered, mode);
    const searched = applySearch(agg, term);
    renderKPIs(searched, raw.at(-1)?.date || null);
    renderChart(searched);
    renderTable(filtered);
  } catch (e) {
    console.error(e);
  }
}

function bind() {
  els.windowSelect.addEventListener('change', refresh);
  els.modeSelect.addEventListener('change', refresh);
  els.searchInput.addEventListener('input', () => {
    clearTimeout(window.__t);
    window.__t = setTimeout(refresh, 250);
  });
  setInterval(refresh, AUTO_REFRESH_MS);
}

bind();
refresh();
