const fs = require('fs');
const path = require('path');

const DATA_JSON = path.join(process.cwd(), 'data.json');
const SALES_CSV = path.join(process.cwd(), 'sales_data.csv');

function readJSONSafely(p, fallback) {
  try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return fallback; }
}

function writeJSON(p, obj) {
  fs.writeFileSync(p, JSON.stringify(obj, null, 2) + '\n');
}

function parseCSV(text) {
  return text.split(/\r?\n/)
    .map(l => l.trim())
    .filter(l => l && !l.startsWith('#'))
    .map(l => {
      const [timestamp, snack, qtyStr] = l.split(',');
      return { timestamp, snack, qty: Number(qtyStr) || 0 };
    });
}

function asISO(d = new Date()) { return d.toISOString(); }

function updateFromCSV(logRows, base) {
  // base: [{ snack, sales, timestamp }] 이미 있는 누적 데이터
  const latestBySnack = new Map();

  // 기존 데이터에서 스낵별 최신값 저장
  for (const r of base) {
    const k = r.snack;
    const prev = latestBySnack.get(k);
    if (!prev || new Date(prev.timestamp) < new Date(r.timestamp)) {
      latestBySnack.set(k, {
        snack: k,
        sales: Number(r.sales) || 0,
        timestamp: r.timestamp
      });
    }
  }

  // CSV 로그(증분)를 누적
  for (const row of logRows) {
    const prev = latestBySnack.get(row.snack) || {
      snack: row.snack,
      sales: 0,
      timestamp: '1970-01-01T00:00:00Z'
    };
    const next = {
      snack: row.snack,
      sales: prev.sales + row.qty,
      timestamp: row.timestamp
    };
    latestBySnack.set(row.snack, next);
  }

  // 시간순으로 정렬해서 배열로 반환
  return [...latestBySnack.values()]
    .sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
}

function randomDemo(base) {
  // sales_data.csv 없을 때 데모용으로 랜덤 증가
  const snacks = ['초코파이', '새우깡', '포카칩', '허니버터칩', '오징어땅콩'];
  const now = asISO(new Date());
  const latest = new Map();

  for (const r of base) {
    const prev = latest.get(r.snack);
    if (!prev || new Date(prev.timestamp) < new Date(r.timestamp)) {
      latest.set(r.snack, r);
    }
  }

  const pick = snacks[Math.floor(Math.random() * snacks.length)];
  const prev = latest.get(pick) || {
    snack: pick,
    sales: 0,
    timestamp: '1970-01-01T00:00:00Z'
  };

  const inc = Math.ceil(Math.random() * 5);
  const next = {
    snack: pick,
    sales: prev.sales + inc,
    timestamp: now
  };

  latest.set(pick, next);

  return [...latest.values()]
    .sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
}

(function main () {
  const base = readJSONSafely(DATA_JSON, []);

  if (fs.existsSync(SALES_CSV)) {
    const csv = fs.readFileSync(SALES_CSV, 'utf8');
    const rows = parseCSV(csv);
    const updated = updateFromCSV(rows, base);
    writeJSON(DATA_JSON, updated);
    console.log(`[ok] data.json updated from sales_data.csv (${rows.length} rows).`);
  } else {
    const updated = randomDemo(base);
    writeJSON(DATA_JSON, updated);
    console.log('[ok] data.json updated with demo increment.');
  }
})();
