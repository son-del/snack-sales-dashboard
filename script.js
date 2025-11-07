/**
 * Snack Sales Dashboard client
 * - data.json(누적 or 증분)을 불러와 기간/검색 조건에 맞게 집계 후 시각화
 * - 60초마다 자동 새로고침
 */
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
  tableBody: document.getElementById('logTableBody'),
  bundleList: document.getElementById('bundleList')   // 추천 박스 영역
};

// 기본 유틸
function isoToDate(s) { return new Date(s); }
function nowUtc() { return new Date(); }

function windowToMs(key) {
  if (key === '1h') return 60 * 60 * 1000;
  if (key === '24h') return 24 * 60 * 60 * 1000;
  if (key === '7d') return 7 * 24 * 60 * 60 * 1000;
  return null; // all
}

// KST 새벽 판별
function toKst(dateUtc) {
  return new Date(dateUtc.getTime() + 9 * 60 * 60 * 1000);
}

function isDawnKst(dateUtc) {
  const kst = toKst(dateUtc);
  const h = kst.getHours();
  return h >= 0 && h < 6; // 00:00~05:59
}

// 데이터 fetch
async function fetchData() {
  const res = await fetch(`${DATA_URL}?_cb=${Date.now()}`, { cache: 'no-store' });
  if (!res.ok) throw new Error(`Failed to fetch data.json: ${res.status}`);
  const data = await res.json();
  // [{ snack, sales, timestamp }]
  return data
    .map(d => ({ ...d, date: isoToDate(d.timestamp) }))
    .sort((a, b) => a.date - b.date);
}

// 기간 필터
function filterWindow(data, key) {
  const ms = windowToMs(key);
  if (!ms) return data;
  const cutoff = new Date(nowUtc().getTime() - ms);
  return data.filter(d => d.date >= cutoff);
}

// 스낵별 집계
function aggregateBySnack(data, mode) {
  const bySnack = new Map();

  if (mode === 'cumulative') {
    // 각 스낵의 최신 sales 값 사용
    for (const d of data) {
      const prev = bySnack.get(d.snack);
      if (!prev || prev.date < d.date) bySnack.set(d.snack, d);
    }
    return [...bySnack.entries()].map(([snack, rec]) => ({
      snack,
      total: Number(rec.sales) || 0
    }));
  } else {
    // delta 합산 모드: sales를 증분으로 보고 합산
    for (const d of data) {
      const prev = bySnack.get(d.snack) || 0;
      bySnack.set(d.snack, prev + (Number(d.sales) || 0));
    }
    return [...bySnack.entries()].map(([snack, total]) => ({ snack, total }));
  }
}

// 이름 검색 필터
function applySearch(rows, term) {
  if (!term) return rows;
  const q = term.toLowerCase();
  return rows.filter(r => r.snack.toLowerCase().includes(q));
}

// KPI 렌더
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

// 차트 렌더
function renderChart(rows) {
  const ctx = document.getElementById('salesChart');
  const labels = rows.map(r => r.snack);
  const values = rows.map(r => r.total);

  if (chart) chart.destroy();
  chart = new Chart(ctx, {
    type: 'bar',
    data: {
      labels,
      datasets: [{ label: '판매수량', data: values }]
    },
    options: {
      responsive: true,
      scales: { y: { beginAtZero: true } },
      plugins: { legend: { display: false } }
    }
  });
}

// 로그 테이블 렌더
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

// --- 추천 박스 로직 ---

function buildBundles(aggTotals, logs) {
  const bundles = [];

  // 1) Top Seller Box: 전체 기준 상위 3개
  const top3 = aggTotals
    .slice()
    .sort((a, b) => b.total - a.total)
    .slice(0, 3);

  if (top3.length) {
    bundles.push({
      name: 'Top Seller Box',
      desc: '최근 판매량 상위 스낵 3종',
      items: top3.map(i => `${i.snack} (${i.total})`)
    });
  }

  // 2) Night Owl Box: 새벽(KST 0~6시)에 잘 팔린 상위 3개
  const nightCount = new Map();
  for (const log of logs) {
    if (isDawnKst(log.date)) {
      const prev = nightCount.get(log.snack) || 0;
      nightCount.set(log.snack, prev + (Number(log.sales) || 0));
    }
  }

  const nightTop = [...nightCount.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3);

  if (nightTop.length) {
    bundles.push({
      name: 'Night Owl Box',
      desc: '새벽 시간에 특히 잘 나가는 스낵 조합',
      items: nightTop.map(([snack, qty]) => `${snack} (${qty})`)
    });
  }

  // 3) Balanced Box: 중상위권 스낵들
  const mid = aggTotals
    .slice()
    .sort((a, b) => b.total - a.total)
    .slice(2, 6);

  if (mid.length) {
    bundles.push({
      name: 'Balanced Box',
      desc: '골고루 인기 있는 스낵 묶음',
      items: mid.map(i => `${i.snack} (${i.total})`)
    });
  }

  return bundles;
}

function renderBundles(aggTotals, logs) {
  if (!els.bundleList) return;

  const bundles = buildBundles(aggTotals, logs);

  if (!bundles.length) {
    els.bundleList.innerHTML =
      '<div class="bundle-card">추천 만들 수 있을 만큼 데이터가 아직 부족합니다.</div>';
    return;
  }

  els.bundleList.innerHTML = bundles.map(b => `
    <div class="bundle-card">
      <div class="bundle-title">${b.name}</div>
      <div class="bundle-items">${b.desc}</div>
      <div class="bundle-items">구성: ${b.items.join(', ')}</div>
    </div>
  `).join('');
}

// 메인 refresh
async function refresh() {
  try {
    const raw = await fetchData();
    const windowKey = els.windowSelect.value;
    const mode = els.modeSelect.value;
    const term = els.searchInput.value;

    const filtered = filterWindow(raw, windowKey);
    const agg = aggregateBySnack(filtered, mode);
    const searched = applySearch(agg, term);

    renderKPIs(searched, raw.at(-1)?.date || null);
    renderChart(searched);
    renderTable(filtered);
    renderBundles(searched, filtered);
  } catch (e) {
    console.error(e);
  }
}

// 이벤트 바인딩
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
