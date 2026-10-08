'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { ClipboardList, Plus, X } from 'lucide-react';
import { setItemWeight, setBoxUsage, removeBoxUsage } from './actions';

interface Item { id: string; name: string; quantity: number; unit: string; weightKg: number | null }
interface Usage { id: string; boxId: string; quantity: number }
interface Row { id: string; number: number; businessName: string; items: Item[]; usages: Usage[] }
interface Box { id: string; name: string; is_active: boolean }

// 박스 추천 학습/shadow 모드용 실사용 기록 화면 — TV 대시보드와 분리해둔 입력 전용 화면이다.
// 한 달 정도 데이터를 쌓은 뒤 추천 정확도를 점검하고, 더 쓸 일이 없으면 메뉴에서 빼면 된다.
export function PackingLogClient({ orderDate, rows, boxes }: { orderDate: string; rows: Row[]; boxes: Box[] }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const boxName = (id: string) => boxes.find((b) => b.id === id)?.name ?? '?';
  const activeBoxes = boxes.filter((b) => b.is_active);

  const run = async (fn: () => Promise<{ error: string | null }>) => {
    setError(null);
    const result = await fn();
    if (result.error) setError(result.error);
    else router.refresh();
  };

  return (
    <div className="plog-root">
      <div className="page-header">
        <div className="page-header-icon"><ClipboardList size={20} /></div>
        <div>
          <h1 className="page-title">박스 기록</h1>
          <p className="page-sub">업체별로 실제 사용한 박스와 상품 실측 중량을 기록합니다. 박스 추천 정확도를 점검하는 데 쓰입니다.</p>
        </div>
        <input
          type="date"
          className="input-field date-input"
          value={orderDate}
          onChange={(e) => e.target.value && router.push(`/packing-log?date=${e.target.value}`)}
        />
      </div>

      {error && <p className="error-text">{error}</p>}
      {rows.length === 0 && <p className="empty-text">이 날짜의 주문이 없습니다.</p>}

      <div className="plog-list">
        {rows.map((row) => (
          <AddableRow key={row.id} row={row} activeBoxes={activeBoxes} boxName={boxName} run={run} />
        ))}
      </div>

      <style>{`
        .plog-root { display: flex; flex-direction: column; gap: 1.25rem; }
        .date-input { width: auto; margin-left: auto; }
        .error-text { color: var(--danger); font-size: 0.8125rem; font-weight: 500; }
        .empty-text { color: var(--muted-foreground); font-size: 0.875rem; padding: 1.5rem 0; text-align: center; }
        .plog-list { display: grid; grid-template-columns: repeat(auto-fill, minmax(420px, 1fr)); gap: 0.75rem; }
        .plog-card { background: #fff; border: 1px solid var(--border); border-radius: var(--radius-lg); box-shadow: var(--shadow-sm); padding: 0.875rem 1rem; display: flex; flex-direction: column; gap: 0.625rem; }
        .plog-title { font-size: 0.9rem; font-weight: 700; color: var(--foreground); }
        .plog-title span { color: var(--muted-foreground); font-weight: 600; margin-right: 0.4rem; }
        .plog-section { display: flex; flex-direction: column; gap: 0.375rem; }
        .plog-label { font-size: 0.7rem; font-weight: 700; color: var(--muted-foreground); }
        .plog-item { display: flex; align-items: center; gap: 0.5rem; font-size: 0.8125rem; }
        .plog-item-name { flex: 1; font-weight: 600; }
        .plog-item-qty { color: var(--muted-foreground); }
        .plog-weight { width: 5rem; height: 2rem; font-size: 0.8125rem; padding: 0 0.5rem; }
        .plog-usage-list { display: flex; flex-wrap: wrap; gap: 0.375rem; }
        .plog-usage { display: inline-flex; align-items: center; gap: 0.375rem; padding: 0.25rem 0.5rem 0.25rem 0.625rem; border-radius: 999px; background: var(--primary-light); color: var(--primary); font-size: 0.8125rem; font-weight: 700; }
        .plog-usage button { display: flex; border: none; background: none; color: inherit; cursor: pointer; padding: 0; }
        .plog-add { display: flex; gap: 0.5rem; }
        .plog-add select { flex: 1; }
        .plog-add .input-field { height: 2.25rem; font-size: 0.8125rem; }
        .plog-qty { width: 4.5rem !important; flex: none; }
        .plog-add-btn { display: flex; align-items: center; justify-content: center; gap: 0.25rem; height: 2.25rem; padding: 0 0.875rem; white-space: nowrap; }
      `}</style>
    </div>
  );
}

function AddableRow({
  row,
  activeBoxes,
  boxName,
  run,
}: {
  row: Row;
  activeBoxes: Box[];
  boxName: (id: string) => string;
  run: (fn: () => Promise<{ error: string | null }>) => Promise<void>;
}) {
  const [boxId, setBoxId] = useState('');
  const [qty, setQty] = useState('1');

  return (
    <div className="plog-card">
      <div className="plog-title"><span>{row.number}</span>{row.businessName}</div>

      <div className="plog-section">
        <span className="plog-label">상품 실측 중량(kg, 선택)</span>
        {row.items.length === 0 && <span className="plog-item-qty">상품 없음</span>}
        {row.items.map((item) => (
          <div key={item.id} className="plog-item">
            <span className="plog-item-name">{item.name}</span>
            <span className="plog-item-qty">{item.quantity}{item.unit}</span>
            <input
              type="number" min="0" step="any"
              className="input-field plog-weight"
              placeholder="kg"
              defaultValue={item.weightKg ?? ''}
              onBlur={(e) => {
                const v = e.target.value.trim() ? parseFloat(e.target.value) : null;
                if (v !== item.weightKg) run(() => setItemWeight(item.id, v));
              }}
            />
          </div>
        ))}
      </div>

      <div className="plog-section">
        <span className="plog-label">사용한 박스</span>
        <div className="plog-usage-list">
          {row.usages.length === 0 && <span className="plog-item-qty">기록 없음</span>}
          {row.usages.map((u) => (
            <span key={u.id} className="plog-usage">
              {boxName(u.boxId)} × {u.quantity}
              <button onClick={() => run(() => removeBoxUsage(u.id))} title="삭제"><X size={13} /></button>
            </span>
          ))}
        </div>
        <div className="plog-add">
          <select className="input-field select-field" value={boxId} onChange={(e) => setBoxId(e.target.value)}>
            <option value="">박스 선택</option>
            {activeBoxes.map((b) => (
              <option key={b.id} value={b.id}>{b.name}</option>
            ))}
          </select>
          <input type="number" min="1" className="input-field plog-qty" value={qty} onChange={(e) => setQty(e.target.value)} />
          <button
            className="btn-primary plog-add-btn"
            disabled={!boxId || !(parseInt(qty) > 0)}
            onClick={async () => {
              await run(() => setBoxUsage(row.id, boxId, parseInt(qty)));
              setBoxId('');
              setQty('1');
            }}
          >
            <Plus size={14} /> 기록
          </button>
        </div>
      </div>
    </div>
  );
}
