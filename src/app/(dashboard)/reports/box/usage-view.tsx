'use client';
import { useMemo } from 'react';
import { ChartLegend, LegendKey, TableView, type LegendEntry } from '@/components/viz/parts';
import { CATEGORICAL, OTHER_COLOR, OTHER_NAME, colorOf } from '@/components/viz/palette';
import { StackedBars, type StackDatum } from '@/components/viz/stacked-bars';
import type { Granularity } from '@/lib/report';
import { WEEKDAY_LABEL, weekdayIndex, type BoxUsage } from '@/lib/reports/box-usage';

const OTHER_KEY = '__other__';
const fmt = (n: number) => n.toLocaleString('en-US');
const dateLabel = (date: string) => `${date.slice(5).replace('-', '.')}(${WEEKDAY_LABEL[weekdayIndex(date)]})`;

// 사용량 보기: 박스 종류별 추이(쌓은 막대), 종류별 현황(소진 속도·요일 패턴), 업체·터미널별 상위 사용량.
export function UsageView({ usage, granularity, boxOrder }: { usage: BoxUsage; granularity: Granularity; boxOrder: string[] }) {
  // 색은 박스 종류 이름의 고정 순서(boxOrder)로 정한다. 8색 밖이거나 박스 목록에 없는(지웠거나 이름을 바꾼) 종류는 "기타"로 묶는다.
  const { series, data } = useMemo(() => {
    const isNamed = (name: string) => boxOrder.indexOf(name) >= 0 && boxOrder.indexOf(name) < CATEGORICAL.length;
    const used = usage.byType.map((t) => t.boxName);
    const named = used.filter(isNamed).sort((a, b) => boxOrder.indexOf(a) - boxOrder.indexOf(b));
    const hasOther = used.some((n) => !isNamed(n));
    const entries: LegendEntry[] = [...named.map((n) => ({ key: n, name: n, color: colorOf(n, boxOrder) })), ...(hasOther ? [{ key: OTHER_KEY, name: OTHER_NAME, color: OTHER_COLOR }] : [])];
    const rows: StackDatum[] = usage.series.map(({ bucket, counts }) => {
      const row: StackDatum = {
        label: bucket.label,
        tipHead: granularity === 'year' ? `${bucket.key.slice(0, 4)}년 ${bucket.label}` : dateLabel(bucket.key),
      };
      let other = 0;
      for (const [name, n] of Object.entries(counts)) {
        if (isNamed(name)) row[name] = n;
        else other += n;
      }
      for (const n of named) row[n] ??= 0;
      if (hasOther) row[OTHER_KEY] = other;
      return row;
    });
    return { series: entries, data: rows };
  }, [usage, granularity, boxOrder]);

  if (usage.total === 0) return <div className="viz-empty">이 기간에 제출한 박스가 없습니다.</div>;

  const colorFor = (name: string) => (boxOrder.indexOf(name) >= 0 && boxOrder.indexOf(name) < CATEGORICAL.length ? colorOf(name, boxOrder) : OTHER_COLOR);
  const topType = usage.byType[0];
  const maxWeekday = Math.max(1, ...usage.byType.flatMap((t) => t.weekday.map((v) => v ?? 0)));
  const maxBusiness = Math.max(1, ...usage.topBusinesses.map((b) => b.count));
  const maxTerminal = Math.max(1, ...usage.topTerminals.map((b) => b.count));

  return (
    <>
      <div className="rb-tiles">
        <div className="viz-tile"><span className="viz-tile-label">제출한 박스</span><span className="viz-tile-value">{fmt(usage.total)}개</span></div>
        <div className="viz-tile"><span className="viz-tile-label">영업일 평균</span><span className="viz-tile-value">{usage.dailyAvg}개/일</span><span className="viz-sub">영업일 {usage.activeDays}일 기준</span></div>
        <div className="viz-tile">
          <span className="viz-tile-label">가장 많이 쓴 날</span>
          <span className="viz-tile-value">{usage.peak ? `${fmt(usage.peak.count)}개` : '-'}</span>
          {usage.peak && <span className="viz-sub">{dateLabel(usage.peak.date)}</span>}
        </div>
        <div className="viz-tile">
          <span className="viz-tile-label">가장 많이 쓴 박스</span>
          <span className="viz-tile-value">{topType.boxName}</span>
          <span className="viz-sub">{fmt(topType.count)}개 · {Math.round(topType.share * 100)}%</span>
        </div>
      </div>

      <section className="viz-card">
        <div className="viz-head">
          <h2 className="viz-title">박스 종류별 사용 추이</h2>
          <span className="viz-sub">{granularity === 'year' ? '월별' : '일별'} 제출 개수</span>
        </div>
        <ChartLegend entries={series} kind="box" />
        <StackedBars data={data} series={series} />
        <TableView
          head={['구간', ...series.map((s) => s.name), '합계']}
          rows={data.map((d) => [d.tipHead, ...series.map((s) => fmt(Number(d[s.key]) || 0)), fmt(series.reduce((sum, s) => sum + (Number(d[s.key]) || 0), 0))])}
        />
      </section>

      <section className="viz-card">
        <div className="viz-head">
          <h2 className="viz-title">박스 종류별 현황</h2>
          <span className="viz-sub">영업일 = 박스가 제출된 날</span>
        </div>
        <div className="viz-table-scroll">
          <table className="viz-table">
            <thead>
              <tr>
                <th>박스 종류</th>
                <th>개수</th>
                <th>비중</th>
                <th>영업일 평균</th>
                <th>최대(일)</th>
                {WEEKDAY_LABEL.map((w) => <th key={w} className="rb-heat">{w}</th>)}
              </tr>
            </thead>
            <tbody>
              {usage.byType.map((t) => (
                <tr key={t.boxName}>
                  <td><span className="rb-name"><LegendKey color={colorFor(t.boxName)} kind="box" />{t.boxName}</span></td>
                  <td>{fmt(t.count)}</td>
                  <td>{Math.round(t.share * 100)}%</td>
                  <td>{t.perDayAvg}</td>
                  <td>{t.peak.count} ({dateLabel(t.peak.date)})</td>
                  {t.weekday.map((v, i) => (
                    <td key={i} className="rb-heat" style={v === null ? undefined : { background: `rgba(42, 120, 214, ${Math.min(0.5, (v / maxWeekday) * 0.5)})` }}>{v === null ? '-' : v}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="rb-note">요일 칸은 그 요일 영업일 하루당 평균 개수입니다(색이 진할수록 많이 씁니다). 그 요일에 영업일이 없으면 -입니다.</p>
      </section>

      <div className="rb-two">
        <section className="viz-card">
          <h2 className="viz-title">업체별 사용량 (상위 {usage.topBusinesses.length})</h2>
          <ul className="rb-list">
            {usage.topBusinesses.map((b) => (
              <li key={b.name}><span className="rb-list-name" title={b.name}>{b.name}</span><span className="rb-list-track"><span className="rb-list-fill" style={{ width: `${(b.count / maxBusiness) * 100}%` }} /></span><span className="rb-list-val">{fmt(b.count)}개</span></li>
            ))}
          </ul>
        </section>
        <section className="viz-card">
          <h2 className="viz-title">터미널별 사용량 (상위 {usage.topTerminals.length})</h2>
          <ul className="rb-list">
            {usage.topTerminals.map((b) => (
              <li key={b.name}><span className="rb-list-name" title={b.name}>{b.name}</span><span className="rb-list-track"><span className="rb-list-fill" style={{ width: `${(b.count / maxTerminal) * 100}%` }} /></span><span className="rb-list-val">{fmt(b.count)}개</span></li>
            ))}
          </ul>
        </section>
      </div>

      <p className="rb-note">박스 할당 화면에서 제출한 박스 구성 기준입니다(합포장·택배 여부와 관계없이 제출된 박스를 모두 셉니다). 박스 종류는 제출 시점의 이름이라, 지웠거나 8가지를 넘는 종류는 &quot;기타&quot;로 묶어 그립니다.</p>
    </>
  );
}
