// 박스 추천 모델 백테스트. 사용법: node scripts/packing-backtest.ts [csv 경로]
// 기본 입력은 .local-data/packing_export.csv (Supabase SQL Editor 내보내기, 업체명이 들어 있어 커밋하지 않는다).
// 두 방식으로 측정한다:
//   leave-one-day-out : 그날만 빼고 나머지 날로 학습 → 그날을 맞힌다 (데이터를 최대한 쓴 측정)
//   forward           : 그날 이전 데이터로만 학습 → 그날을 맞힌다 (실제 운영과 같은 조건)
import { readFileSync } from 'node:fs';
import { recommend, trainModel, type Confidence, type TrainingRecord } from '../src/lib/packing/model.ts';

// 내보내기 CSV에는 박스의 is_mulbong_box 컬럼이 없어서 박스 이름으로 판별한다.
const MULBONG_BOX_NAME = '물봉';

function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (ch === '"') quoted = false;
      else cell += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ',') {
      row.push(cell);
      cell = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(cell);
      cell = '';
      if (row.some((c) => c !== '')) rows.push(row);
      row = [];
    } else cell += ch;
  }
  if (cell !== '' || row.length) {
    row.push(cell);
    rows.push(row);
  }
  return rows;
}

function loadRecords(path: string): TrainingRecord[] {
  const [header, ...rows] = parseCsv(readFileSync(path, 'utf8'));
  const col = (name: string) => {
    const idx = header.indexOf(name);
    if (idx < 0) throw new Error(`CSV에 '${name}' 컬럼이 없습니다.`);
    return idx;
  };
  const c = Object.fromEntries(['order_date', 'business_name', 'position', 'box_name', 'product_name', 'unit', 'quantity', 'is_mulbong', 'needs_mulbong'].map((n) => [n, col(n)]));
  const records = new Map<string, TrainingRecord>();
  for (const r of rows) {
    const key = `${r[c.order_date]}|${r[c.business_name]}`;
    const record = records.get(key) ?? { orderDate: r[c.order_date], businessName: r[c.business_name], boxes: [] };
    records.set(key, record);
    const position = Number(r[c.position]);
    const box = (record.boxes[position] ??= { boxName: r[c.box_name], isMulbongBox: r[c.box_name] === MULBONG_BOX_NAME, items: [] });
    box.items.push({
      name: r[c.product_name],
      unit: r[c.unit],
      quantity: Number(r[c.quantity]),
      mulbongFlag: r[c.is_mulbong] === 'true' || r[c.needs_mulbong] === 'true',
    });
  }
  return [...records.values()].map((rec) => ({ ...rec, boxes: rec.boxes.filter(Boolean) }));
}

const multisetKey = (names: string[]) => [...names].sort().join('+');

interface Outcome {
  single: boolean;
  confidence: Confidence;
  top1: boolean;
  top3: boolean;
  typesTop1: boolean; // 박스 종류 집합(개수 무시)이 같은가
  countTop1: boolean; // 박스 개수가 같은가
}

function evaluate(records: TrainingRecord[], mode: 'loo' | 'forward'): Outcome[] {
  const dates = [...new Set(records.map((r) => r.orderDate))].sort();
  const outcomes: Outcome[] = [];
  dates.forEach((date, di) => {
    const train = records.filter((r) => (mode === 'loo' ? r.orderDate !== date : r.orderDate < date));
    const test = records.filter((r) => r.orderDate === date);
    if (train.length === 0) return;
    const model = trainModel(train, { version: `${mode}-${date}`, trainedAt: date });
    void di;
    for (const r of test) {
      const items = r.boxes.flatMap((b) => b.items);
      const rec = recommend(model, items);
      const actual = multisetKey(r.boxes.map((b) => b.boxName));
      const actualTypes = [...new Set(r.boxes.map((b) => b.boxName))].sort().join('+');
      const keys = rec.candidates.map((p) => multisetKey(p.boxes.map((b) => b.boxName)));
      const first = rec.candidates[0]?.boxes ?? [];
      outcomes.push({
        single: r.boxes.length === 1,
        confidence: rec.confidence,
        top1: keys[0] === actual,
        top3: keys.includes(actual),
        typesTop1: [...new Set(first.map((b) => b.boxName))].sort().join('+') === actualTypes,
        countTop1: first.length === r.boxes.length,
      });
    }
  });
  return outcomes;
}

const pct = (n: number, d: number) => (d === 0 ? '  -  ' : `${((n / d) * 100).toFixed(0).padStart(3)}%`) + ` (${n}/${d})`;

function report(title: string, outcomes: Outcome[]) {
  console.log(`\n■ ${title}`);
  const groups: [string, Outcome[]][] = [
    ['전체', outcomes],
    ['1박스 기록', outcomes.filter((o) => o.single)],
    ['2박스 이상 기록', outcomes.filter((o) => !o.single)],
  ];
  for (const [name, list] of groups) {
    console.log(
      `${name.padEnd(10)} 1순위 정확 ${pct(list.filter((o) => o.top1).length, list.length)} | 후보3 안에 정답 ${pct(list.filter((o) => o.top3).length, list.length)} | 박스 종류 일치 ${pct(list.filter((o) => o.typesTop1).length, list.length)} | 박스 개수 일치 ${pct(list.filter((o) => o.countTop1).length, list.length)}`,
    );
  }
  for (const level of ['high', 'medium', 'low'] as Confidence[]) {
    const list = outcomes.filter((o) => o.confidence === level);
    console.log(`  신뢰도 ${level.padEnd(6)} ${String(list.length).padStart(3)}건 → 1순위 ${pct(list.filter((o) => o.top1).length, list.length)}, 후보3 ${pct(list.filter((o) => o.top3).length, list.length)}`);
  }
}

const path = process.argv[2] ?? '.local-data/packing_export.csv';
const records = loadRecords(path);
console.log(`기록 ${records.length}건 (1박스 ${records.filter((r) => r.boxes.length === 1).length}건), ${new Set(records.map((r) => r.orderDate)).size}일치`);
report('leave-one-day-out', evaluate(records, 'loo'));
report('forward (과거 데이터만으로 다음 날 예측)', evaluate(records, 'forward'));

const full = trainModel(records, { version: 'full', trainedAt: 'full' });
console.log('\n■ 전체 데이터로 학습한 파라미터');
console.log(JSON.stringify({ params: full.params, boxCapacity: full.boxCapacity, fallbackCapacity: full.fallbackCapacity, mulbongBoxName: full.mulbongBoxName }, null, 2));
