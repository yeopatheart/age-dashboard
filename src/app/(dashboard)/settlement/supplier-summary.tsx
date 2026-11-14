'use client';
import { formatWon } from '@/lib/money';
import type { SupplierGroup } from '@/lib/settlement/purchases';

// 매입내역: 입력 화면이 아니라 정산표의 줄에서 모은 매입처별·품목별 합계다. 매입처마다 그날 돈을 지급했는지 체크한다.
export function SupplierSummary({
  groups,
  supplierName,
  canEdit,
  saving,
  onPaid,
}: {
  groups: SupplierGroup[];
  supplierName: (id: string | null) => string;
  canEdit: boolean;
  saving: boolean;
  onPaid: (supplierId: string, paid: boolean) => void;
}) {
  const purchase = groups.reduce((s, g) => s + g.purchase, 0);
  const unpaid = groups.filter((g) => g.supplierId !== null && !g.paid && g.purchase > 0);
  const unpaidTotal = unpaid.reduce((s, g) => s + g.purchase, 0);
  if (groups.length === 0) return null;
  return (
    <div className="st-suppliers">
      <div className="ak-toolbar" style={{ boxShadow: 'none' }}>
        <strong>매입내역</strong>
        <span>총 매입 <strong>{formatWon(purchase)}원</strong></span>
        <span className="ak-sub">매입처 {groups.filter((g) => g.supplierId !== null).length}곳</span>
        {unpaidTotal > 0 && <span style={{ color: '#b45309' }}>미지급 <strong>{formatWon(unpaidTotal)}원</strong> ({unpaid.length}곳)</span>}
        <span className="ak-spacer" />
        {canEdit && unpaid.length > 0 && <button className="ak-btn" disabled={saving} onClick={() => unpaid.forEach((g) => onPaid(g.supplierId as string, true))}>미지급 모두 지급 체크</button>}
      </div>
      <div className="ak-table-wrap" style={{ maxHeight: '24rem' }}>
        <table className="ak-table st-supplier-table">
          <thead>
            <tr>
              <th scope="col" className="ak-check">지급</th>
              <th scope="col">매입처 / 품목</th>
              <th scope="col" className="ak-right">수량</th>
              <th scope="col" className="ak-right">매입가</th>
              <th scope="col" className="ak-right">판매가</th>
              <th scope="col" className="ak-right">수익</th>
            </tr>
          </thead>
          <tbody>
            {groups.flatMap((g) => [
              <tr key={`${g.supplierId ?? 'none'}-head`} className="st-group">
                <td className="ak-check">
                  {g.supplierId !== null && (
                    <input type="checkbox" checked={g.paid} disabled={!canEdit || saving} onChange={(e) => onPaid(g.supplierId as string, e.target.checked)} aria-label={`${supplierName(g.supplierId)} 지급 완료`} />
                  )}
                </td>
                <td>
                  <strong>{g.supplierId === null ? '매입처 미지정' : supplierName(g.supplierId)}</strong>
                  {g.missing > 0 && <span className="ak-sub" style={{ color: '#b45309' }}> · 매입가 없는 줄 {g.missing}</span>}
                  {g.supplierId === null && <span className="ak-sub"> · 단가표나 줄에서 매입처를 정하면 지급 체크를 할 수 있습니다</span>}
                </td>
                <td />
                <td className="ak-right"><strong>{formatWon(g.purchase)}</strong></td>
                <td className="ak-right">{formatWon(g.sales)}</td>
                <td className="ak-right" style={{ color: g.sales - g.purchase < 0 ? '#b91c1c' : undefined }}>{g.missing > 0 ? '' : formatWon(g.sales - g.purchase)}</td>
              </tr>,
              ...g.products.map((p) => (
                <tr key={`${g.supplierId ?? 'none'}-${p.product}`}>
                  <td />
                  <td style={{ paddingLeft: '1.2rem' }}>{p.product} <span className="ak-sub">{p.lines}줄</span></td>
                  <td className="ak-right">{Number(p.quantity.toFixed(2))}</td>
                  <td className="ak-right">{formatWon(p.purchase)}</td>
                  <td className="ak-right">{formatWon(p.sales)}</td>
                  <td className="ak-right" style={{ color: p.sales - p.purchase < 0 ? '#b91c1c' : undefined }}>{p.missing > 0 ? '' : formatWon(p.sales - p.purchase)}</td>
                </tr>
              )),
            ])}
          </tbody>
        </table>
      </div>
      <p className="ak-meta">수익은 매입가가 모두 있는 매입처·품목만 보여 줍니다. 합계에 판매가가 없는 줄은 0원으로 셉니다.</p>
    </div>
  );
}
