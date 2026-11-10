'use client';
import { CsvButton } from '@/components/viz/csv-button';
import { formatWon } from '@/lib/money';
import type { GroupPoint } from '@/lib/settlement/chart-groups';
import { quantityText, type ProductStat } from '@/lib/reports/sales-report';
import { GroupChart } from './group-chart';

const pct = (m: number | null) => (m === null ? '-' : `${(m * 100).toFixed(1)}%`);

// 품목별: 매출·매입·이익 막대(상위 N + 기타)와 판매수량·이익률까지 있는 전체 표. 이익은 매입이 (출고일 × 품목) 단위라 품목 단위로 정확하다.
export function ProductView({ groups, stats, periodLabel, filenameKey }: { groups: GroupPoint[]; stats: ProductStat[]; periodLabel: string; filenameKey: string }) {
  const totalSales = stats.reduce((s, p) => s + p.sales, 0);
  const note = (s: ProductStat) =>
    [s.unpricedLines > 0 ? `판매가 미입력 ${s.unpricedLines}줄` : '', s.missingPurchase > 0 ? `매입가 미입력 ${s.missingPurchase}건` : ''].filter(Boolean).join(' · ') || '-';
  return (
    <>
      <GroupChart groups={groups} kind="product" periodLabel={periodLabel} showTable={false} />
      <section className="viz-card">
        <div className="viz-head">
          <h2 className="viz-title">품목별 판매·수익 ({stats.length}개)</h2>
          <CsvButton
            filename={`판매수익_품목별_${filenameKey}.csv`}
            header={['품목', '판매수량', '매출(원)', '매입(원)', '이익(원)', '이익률(%)', '판매가 미입력 줄', '매입가 미입력 건']}
            rows={stats.map((s) => [s.product, quantityText(s.quantities), s.sales, s.purchase, s.profit, s.margin === null ? null : Math.round(s.margin * 1000) / 10, s.unpricedLines, s.missingPurchase])}
          />
        </div>
        {stats.length === 0 ? (
          <p className="viz-empty">이 기간에 판매내역이 없습니다.</p>
        ) : (
          <div className="viz-table-scroll">
            <table className="viz-table">
              <thead>
                <tr><th>품목</th><th>판매수량</th><th>매출</th><th>매입</th><th>이익</th><th>이익률</th><th>비고</th></tr>
              </thead>
              <tbody>
                {stats.map((s) => (
                  <tr key={s.product}>
                    <td>{s.product}</td>
                    <td>{quantityText(s.quantities)}</td>
                    <td>{formatWon(s.sales)}</td>
                    <td>{s.purchase === 0 && s.missingPurchase > 0 ? '-' : formatWon(s.purchase)}</td>
                    <td>{s.profitBase === 0 ? '-' : formatWon(s.profit)}</td>
                    <td>{pct(s.margin)}</td>
                    <td style={{ textAlign: 'left', color: 'var(--text-muted)' }}>{note(s)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr><td>합계</td><td /><td>{formatWon(totalSales)}</td><td>{formatWon(stats.reduce((s, p) => s + p.purchase, 0))}</td><td>{formatWon(stats.reduce((s, p) => s + p.profit, 0))}</td><td /><td /></tr>
              </tfoot>
            </table>
          </div>
        )}
        <p className="sr-note">이익은 매입가를 입력한 (출고일 × 품목)만 계산하고, 이익률은 그 품목들의 판매가 대비입니다. 수량은 단위가 달라 합치지 않고 단위별로 보여 줍니다.</p>
      </section>
    </>
  );
}
