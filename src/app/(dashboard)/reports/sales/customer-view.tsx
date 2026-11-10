'use client';
import { CsvButton } from '@/components/viz/csv-button';
import { formatWon } from '@/lib/money';
import { quantityText, weightText, type CustomerStat } from '@/lib/reports/sales-report';

const TOP_N = 10;

// 업체별: 매출 상위 업체 막대와 전체 표. 이익은 보여 주지 않는다(매입이 (출고일 × 품목) 단위라 고객사별 이익은 계산할 수 없다).
export function CustomerView({ stats, filenameKey }: { stats: CustomerStat[]; filenameKey: string }) {
  const total = stats.reduce((s, c) => s + c.sales, 0);
  const top = stats.slice(0, TOP_N);
  const max = Math.max(1, ...top.map((c) => c.sales));
  return (
    <>
      <section className="viz-card">
        <div className="viz-head">
          <h2 className="viz-title">업체별 매출 상위 {top.length}곳</h2>
          <span className="viz-sub">판매가를 입력한 줄 기준</span>
        </div>
        {top.length === 0 ? (
          <p className="viz-empty">이 기간에 판매내역이 없습니다.</p>
        ) : (
          <ul className="sr-list">
            {top.map((c) => (
              <li key={c.customer}>
                <span className="sr-list-name" title={c.customer}>{c.customer}</span>
                <span className="sr-list-track"><span className="sr-list-fill" style={{ width: `${(c.sales / max) * 100}%` }} /></span>
                <span className="sr-list-val">{formatWon(c.sales)}원 <span className="sr-muted">{total === 0 ? '' : `${Math.round((c.sales / total) * 100)}%`}</span></span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="viz-card">
        <div className="viz-head">
          <h2 className="viz-title">업체별 판매 ({stats.length}곳)</h2>
          <CsvButton
            filename={`판매수익_업체별_${filenameKey}.csv`}
            header={['업체', '매출(원)', '비중(%)', '판매수량', '부가중량(kg)', '주문 일수', '일평균 매출(원)', '판매내역 줄 수', '판매가 미입력 줄']}
            rows={stats.map((c) => [c.customer, c.sales, total === 0 ? null : Math.round((c.sales / total) * 1000) / 10, quantityText(c.quantities), c.weightKg, c.days, c.dailyAvg, c.lines, c.unpricedLines])}
          />
        </div>
        {stats.length > 0 && (
          <div className="viz-table-scroll">
            <table className="viz-table">
              <thead>
                <tr><th>업체</th><th>매출</th><th>비중</th><th>판매수량</th><th>부가중량</th><th>주문 일수</th><th>일평균 매출</th><th>줄 수</th><th>비고</th></tr>
              </thead>
              <tbody>
                {stats.map((c) => (
                  <tr key={c.customer}>
                    <td>{c.customer}</td>
                    <td>{formatWon(c.sales)}</td>
                    <td>{total === 0 ? '-' : `${Math.round((c.sales / total) * 100)}%`}</td>
                    <td>{quantityText(c.quantities)}</td>
                    <td>{weightText(c.weightKg)}</td>
                    <td>{c.days}</td>
                    <td>{formatWon(c.dailyAvg)}</td>
                    <td>{c.lines}</td>
                    <td style={{ textAlign: 'left', color: 'var(--text-muted)' }}>{c.unpricedLines > 0 ? `판매가 미입력 ${c.unpricedLines}줄` : '-'}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr><td>합계</td><td>{formatWon(total)}</td><td /><td /><td /><td /><td /><td>{stats.reduce((s, c) => s + c.lines, 0)}</td><td /></tr>
              </tfoot>
            </table>
          </div>
        )}
        <p className="sr-note">같은 날 1·2차 주문은 한 업체로 합쳤습니다. 일평균 매출은 그 업체가 주문한 날 수로 나눈 값입니다. 고객사별 이익은 매입이 품목 단위라 계산할 수 없어 품목별 보기에서 봅니다.</p>
      </section>
    </>
  );
}
