'use client';
import Link from 'next/link';
import { CATEGORICAL } from '@/components/viz/palette';
import { CsvButton } from '@/components/viz/csv-button';
import { ChartLegend, LegendKey, TableView } from '@/components/viz/parts';
import { SegmentedBar } from '@/components/viz/segmented-bar';
import { TrendChart, type TrendDatum } from '@/components/viz/trend-chart';
import { formatWon } from '@/lib/money';
import type { Granularity } from '@/lib/report';
import { WEEKDAY_LABEL, weekdayIndex } from '@/lib/reports/box-usage';
import { AGING_LABELS, LAG_LABELS, type InputLag } from '@/lib/reports/settle-close';
import type { SettleData } from './ops-report-client';

const TOP_CUSTOMERS = 15;
// 경과일 구간은 순서가 있는 값이라 한 색(파랑)의 연한 색에서 진한 색으로 간다(채도 100% 파랑 #2a78d6을 흰색과 30·50·75% 섞은 단계).
const AGING_COLORS = ['#bfd7f3', '#95bceb', '#5f9ae0', '#2a78d6'];
const SERIES = [
  { key: 'sales', name: '판매가 입력률', color: CATEGORICAL[0] },
  { key: 'purchase', name: '매입가 입력률', color: CATEGORICAL[1] },
];
const dateLabel = (date: string) => `${date.slice(5).replace('-', '.')}(${WEEKDAY_LABEL[weekdayIndex(date)]})`;
const pct = (n: number, d: number) => (d === 0 ? '-' : `${Math.round((n / d) * 100)}%`);
const won = (n: number) => `${formatWon(n)}원`;

function LagRow({ name, lag }: { name: string; lag: InputLag }) {
  return (
    <tr>
      <td>{name}</td>
      <td>{lag.n}</td>
      <td>{lag.median === null ? '-' : lag.median === 0 ? '당일' : `${lag.median}일`}</td>
      {lag.buckets.map((c, i) => <td key={LAG_LABELS[i]}>{lag.n === 0 ? '-' : c}</td>)}
    </tr>
  );
}

// 정산 마감 보기: 입력 완결률 추이, 수금(미수금)·지급 현황, 아직 비어 있는 것, 입력 지연. 금액이 나오므로 정산 보기 권한이 있을 때만 열린다.
export function SettleView({ data, granularity, periodKey }: { data: SettleData; granularity: Granularity; periodKey: string }) {
  const { receivables: rec, payables: pay } = data;
  const salesTotal = data.trend.reduce((s, p) => s + p.salesLines, 0);
  const salesPriced = data.trend.reduce((s, p) => s + p.salesPriced, 0);
  const purchaseRows = data.trend.reduce((s, p) => s + p.purchaseRows, 0);
  const purchasePriced = data.trend.reduce((s, p) => s + p.purchasePriced, 0);
  if (salesTotal === 0 && pay.rows === 0) return <div className="viz-empty">이 기간에 정산 판매내역이 없습니다(출고가 끝난 주문이 있어야 올라옵니다).</div>;

  const trend: TrendDatum[] = data.trend.map((p) => ({
    label: p.bucket.label,
    tipHead: granularity === 'year' ? p.bucket.label : dateLabel(p.bucket.key),
    count: p.salesLines,
    sales: p.salesRate,
    purchase: p.purchaseRate,
  }));
  const agingParts = AGING_LABELS.map((name, i) => ({ key: name, name, value: rec.buckets[i], color: AGING_COLORS[i] }));
  const topCustomers = rec.customers.slice(0, TOP_CUSTOMERS);
  const customerRow = (c: (typeof rec.customers)[number]) => (
    <tr key={c.customer}>
      <td>{c.customer}</td>
      <td>{formatWon(c.amount)}</td>
      <td>{c.lines}</td>
      <td>{dateLabel(c.oldestDate)}</td>
      <td>{c.maxDays}일</td>
      {c.buckets.map((b, i) => <td key={AGING_LABELS[i]}>{b === 0 ? '-' : formatWon(b)}</td>)}
    </tr>
  );
  const customerHead = (
    <thead>
      <tr><th>고객</th><th>미수금</th><th>줄</th><th>가장 오래된 출고일</th><th>경과</th>{AGING_LABELS.map((l) => <th key={l}>{l}</th>)}</tr>
    </thead>
  );

  return (
    <>
      <div className="op-tiles">
        <div className="viz-tile"><span className="viz-tile-label">미수금</span><span className="viz-tile-value">{won(rec.total)}</span><span className="viz-sub">{rec.lines}줄 · 고객 {rec.customers.length}곳</span></div>
        <div className="viz-tile"><span className="viz-tile-label">15일 이상 미수금</span><span className="viz-tile-value">{won(rec.buckets[3])}</span><span className="viz-sub">출고 후 15일 넘게 입금 확인 안 됨</span></div>
        <div className="viz-tile"><span className="viz-tile-label">미지급 매입</span><span className="viz-tile-value">{won(pay.total)}</span><span className="viz-sub">{pay.rows}건 · 지급 표시 안 된 매입</span></div>
        <div className="viz-tile"><span className="viz-tile-label">판매가 입력률</span><span className="viz-tile-value">{pct(salesPriced, salesTotal)}</span><span className="viz-sub">{salesPriced} / {salesTotal}줄</span></div>
        <div className="viz-tile"><span className="viz-tile-label">매입가 입력률</span><span className="viz-tile-value">{pct(purchasePriced, purchaseRows)}</span><span className="viz-sub">{purchasePriced} / {purchaseRows}건(출고일 × 품목)</span></div>
      </div>

      <section className="viz-card">
        <div className="viz-head">
          <h2 className="viz-title">수금 현황 (미수금)</h2>
          <CsvButton
            filename={`정산마감_미수금_${periodKey}.csv`}
            header={['고객', '미수금(원)', '줄', '가장 오래된 출고일', '경과(일)', ...AGING_LABELS.map((l) => `${l}(원)`)]}
            rows={rec.customers.map((c) => [c.customer, c.amount, c.lines, c.oldestDate, c.maxDays, ...c.buckets])}
          />
        </div>
        {rec.total === 0 ? (
          <p className="op-note">이 기간 출고분 중 입금 확인이 안 된 판매가 없습니다.</p>
        ) : (
          <>
            <SegmentedBar parts={agingParts} total={rec.total} ariaLabel="미수금 경과일 구간" />
            <ul className="op-list">
              {agingParts.map((p) => (
                <li key={p.key}><LegendKey color={p.color} kind="box" /><span>출고 후 {p.name}</span><strong>{won(p.value)}</strong><span className="viz-sub">{pct(p.value, rec.total)}</span></li>
              ))}
            </ul>
            <div className="viz-table-scroll">
              <table className="viz-table">
                {customerHead}
                <tbody>{topCustomers.map(customerRow)}</tbody>
              </table>
            </div>
            {rec.customers.length > TOP_CUSTOMERS && (
              <details className="viz-table-wrap">
                <summary>나머지 {rec.customers.length - TOP_CUSTOMERS}곳 보기</summary>
                <div className="viz-table-scroll">
                  <table className="viz-table">
                    {customerHead}
                    <tbody>{rec.customers.slice(TOP_CUSTOMERS).map(customerRow)}</tbody>
                  </table>
                </div>
              </details>
            )}
          </>
        )}
        <p className="op-note">
          판매내역의 &quot;입금 여부&quot;를 고객 입금 확인으로 보고, 판매가를 입력한 줄 중 입금 표시가 없는 것을 미수금으로 셉니다. 경과일은 오늘 − 출고일입니다.
          {rec.excludedUnpriced > 0 && <> 입금 표시가 없지만 판매가가 비어 금액을 알 수 없는 {rec.excludedUnpriced}줄은 뺐습니다.</>}
        </p>
      </section>

      {data.trend.length > 1 && (
        <section className="viz-card">
          <div className="viz-head">
            <h2 className="viz-title">입력 완결률 추이</h2>
            <span className="viz-sub">그날 판매내역 줄·매입내역 행 중 가격을 입력한 비율</span>
          </div>
          <ChartLegend entries={SERIES} kind="line" />
          <TrendChart data={trend} series={SERIES} countLabel="판매내역 줄 수" />
          <TableView
            head={['구간', '판매내역 줄', '판매가 입력', '매입내역 행', '매입가 입력']}
            rows={data.trend.map((p, i) => [trend[i].tipHead, p.salesLines, pct(p.salesPriced, p.salesLines), p.purchaseRows, pct(p.purchasePriced, p.purchaseRows)])}
          />
        </section>
      )}

      <div className="op-two">
        <section className="viz-card">
          <h2 className="viz-title">판매가가 비어 있는 날</h2>
          {data.openSales.length === 0 ? (
            <p className="op-note">판매가를 모두 입력했습니다.</p>
          ) : (
            <div className="viz-table-scroll">
              <table className="viz-table">
                <thead><tr><th>출고일</th><th>미입력 줄</th><th>전체 줄</th><th /></tr></thead>
                <tbody>
                  {data.openSales.map((d) => (
                    <tr key={d.date}><td>{dateLabel(d.date)}</td><td>{d.lines}</td><td>{d.total}</td><td><Link href={`/settlement?g=day&d=${d.date}`} className="op-muted" style={{ textDecoration: 'underline' }}>정산에서 열기</Link></td></tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
        <section className="viz-card">
          <h2 className="viz-title">매입가가 비어 있는 품목 ({data.openPurchaseTotal}건)</h2>
          {data.openPurchases.length === 0 ? (
            <p className="op-note">매입가를 모두 입력했습니다.</p>
          ) : (
            <>
              <div className="viz-table-scroll">
                <table className="viz-table">
                  <thead><tr><th>출고일</th><th>품목</th><th /></tr></thead>
                  <tbody>
                    {data.openPurchases.map((p) => (
                      <tr key={`${p.date}|${p.product}`}><td>{dateLabel(p.date)}</td><td>{p.product}</td><td><Link href={`/settlement?g=day&d=${p.date}`} className="op-muted" style={{ textDecoration: 'underline' }}>정산에서 열기</Link></td></tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {data.openPurchaseTotal > data.openPurchases.length && <p className="op-note">오래된 {data.openPurchases.length}건만 보입니다(전체 {data.openPurchaseTotal}건).</p>}
            </>
          )}
        </section>
      </div>

      <section className="viz-card">
        <div className="viz-head">
          <h2 className="viz-title">입력 지연</h2>
          <span className="viz-sub">출고일에서 가격을 입력한 날까지</span>
        </div>
        <div className="viz-table-scroll">
          <table className="viz-table">
            <thead><tr><th>구분</th><th>건수</th><th>중앙값</th>{LAG_LABELS.map((l) => <th key={l}>{l}</th>)}</tr></thead>
            <tbody>
              <LagRow name="판매가" lag={data.salesLag} />
              <LagRow name="매입가" lag={data.purchaseLag} />
            </tbody>
          </table>
        </div>
        <p className="op-note">입력한 날은 마지막 수정 시각(한국 날짜) 기준이라, 나중에 값을 고친 입력은 지연이 길게 보일 수 있습니다.</p>
      </section>
    </>
  );
}
