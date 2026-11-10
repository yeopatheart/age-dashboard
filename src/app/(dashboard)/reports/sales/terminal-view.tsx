'use client';
import { CsvButton } from '@/components/viz/csv-button';
import { formatWon } from '@/lib/money';
import { quantityText, weightText, type TerminalStat } from '@/lib/reports/sales-report';

// 터미널별: 그날 카드의 터미널 기준 매출·수량·업체 수. 이익은 낼 수 없다(매입이 터미널 단위가 아니다).
export function TerminalView({ stats, filenameKey }: { stats: TerminalStat[]; filenameKey: string }) {
  const total = stats.reduce((s, t) => s + t.sales, 0);
  const max = Math.max(1, ...stats.map((t) => t.sales));
  return (
    <>
      <section className="viz-card">
        <div className="viz-head">
          <h2 className="viz-title">터미널별 매출</h2>
          <span className="viz-sub">판매가를 입력한 줄 기준</span>
        </div>
        {stats.length === 0 ? (
          <p className="viz-empty">이 기간에 판매내역이 없습니다.</p>
        ) : (
          <ul className="sr-list">
            {stats.slice(0, 12).map((t) => (
              <li key={t.terminal}>
                <span className="sr-list-name" title={t.terminal}>{t.terminal}</span>
                <span className="sr-list-track"><span className="sr-list-fill" style={{ width: `${(t.sales / max) * 100}%` }} /></span>
                <span className="sr-list-val">{formatWon(t.sales)}원 <span className="sr-muted">{total === 0 ? '' : `${Math.round((t.sales / total) * 100)}%`}</span></span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="viz-card">
        <div className="viz-head">
          <h2 className="viz-title">터미널별 판매 ({stats.length}곳)</h2>
          <CsvButton
            filename={`판매수익_터미널별_${filenameKey}.csv`}
            header={['터미널', '매출(원)', '비중(%)', '판매수량', '부가중량(kg)', '업체 수', '주문 일수', '판매내역 줄 수', '판매가 미입력 줄']}
            rows={stats.map((t) => [t.terminal, t.sales, total === 0 ? null : Math.round((t.sales / total) * 1000) / 10, quantityText(t.quantities), t.weightKg, t.customers, t.days, t.lines, t.unpricedLines])}
          />
        </div>
        {stats.length > 0 && (
          <div className="viz-table-scroll">
            <table className="viz-table">
              <thead>
                <tr><th>터미널</th><th>매출</th><th>비중</th><th>판매수량</th><th>부가중량</th><th>업체 수</th><th>주문 일수</th><th>줄 수</th><th>비고</th></tr>
              </thead>
              <tbody>
                {stats.map((t) => (
                  <tr key={t.terminal}>
                    <td>{t.terminal}</td>
                    <td>{formatWon(t.sales)}</td>
                    <td>{total === 0 ? '-' : `${Math.round((t.sales / total) * 100)}%`}</td>
                    <td>{quantityText(t.quantities)}</td>
                    <td>{weightText(t.weightKg)}</td>
                    <td>{t.customers}곳</td>
                    <td>{t.days}</td>
                    <td>{t.lines}</td>
                    <td style={{ textAlign: 'left', color: 'var(--text-muted)' }}>{t.unpricedLines > 0 ? `판매가 미입력 ${t.unpricedLines}줄` : '-'}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr><td>합계</td><td>{formatWon(total)}</td><td /><td /><td /><td /><td /><td>{stats.reduce((s, t) => s + t.lines, 0)}</td><td /></tr>
              </tfoot>
            </table>
          </div>
        )}
        <p className="sr-note">터미널은 그날 주문 카드의 터미널입니다(업체의 기본 터미널이 아니라 그날 실제로 나간 터미널). 터미널별 이익은 매입이 터미널 단위가 아니라 계산할 수 없습니다.</p>
      </section>
    </>
  );
}
