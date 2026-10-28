import Link from 'next/link';
import '@/components/admin/admin.css';
import { BarChart3 } from 'lucide-react';
import { createClient } from '@/lib/supabase/server';
import { requireMenu } from '@/lib/permissions/access';
import { fetchAll } from '@/lib/supabase/fetch-all';


interface Stat {
  total: number;
  top1: number;
  top3: number;
  asIs: number;
}
const emptyStat = (): Stat => ({ total: 0, top1: 0, top3: 0, asIs: 0 });
const pct = (n: number, d: number) => (d === 0 ? '-' : `${Math.round((n / d) * 100)}%`);

// shadow test 정확도: 제출한 박스 기록을 제출 시점의 추천과 비교한다. 추천이 없던 기록(기능 도입 전)은 제외한다.
export default async function PackingAccuracyPage() {
  await requireMenu('packing');
  const supabase = await createClient();
  const ERR = '정확도 조회 실패(마이그레이션 0027 적용 필요): ';
  const [records, recs, boxes] = await Promise.all([
    fetchAll((from, to) =>
      supabase.from('packing_records').select('id, order_date, recommendation_id, recommended_rank, accepted_as_is').not('recommendation_id', 'is', null).order('id').range(from, to),
    ERR),
    fetchAll((from, to) => supabase.from('packing_recommendations').select('id, model_version, confidence').order('id').range(from, to), ERR),
    fetchAll((from, to) => supabase.from('packing_boxes').select('id, record_id').order('id').range(from, to), ERR),
  ]);
  const recById = new Map(recs.map((r) => [r.id, r]));
  const boxCount = new Map<string, number>();
  for (const b of boxes) boxCount.set(b.record_id, (boxCount.get(b.record_id) ?? 0) + 1);

  const groups = new Map<string, Map<string, Stat>>();
  const add = (section: string, label: string, rank: number | null, asIs: boolean | null) => {
    const bySection = groups.get(section) ?? new Map<string, Stat>();
    groups.set(section, bySection);
    const stat = bySection.get(label) ?? emptyStat();
    stat.total += 1;
    if (rank === 1) stat.top1 += 1;
    if (rank !== null) stat.top3 += 1;
    if (asIs) stat.asIs += 1;
    bySection.set(label, stat);
  };
  for (const r of records) {
    const rec = r.recommendation_id ? recById.get(r.recommendation_id) : undefined;
    if (!rec) continue;
    add('전체', '전체', r.recommended_rank, r.accepted_as_is);
    add('신뢰도별', { high: '높음', medium: '보통', low: '낮음' }[rec.confidence], r.recommended_rank, r.accepted_as_is);
    add('박스 수별', (boxCount.get(r.id) ?? 0) <= 1 ? '1박스' : '2박스 이상', r.recommended_rank, r.accepted_as_is);
    add('날짜별', r.order_date, r.recommended_rank, r.accepted_as_is);
    add('모델 버전별', rec.model_version, r.recommended_rank, r.accepted_as_is);
  }
  const sections = ['전체', '신뢰도별', '박스 수별', '날짜별', '모델 버전별'];

  return (
    <div className="ak-page">
      <div className="page-header">
        <div className="page-header-icon"><BarChart3 size={20} /></div>
        <div>
          <h1 className="page-title">박스 추천 정확도</h1>
          <p className="page-sub">
            제출한 박스 할당을 제출 시점의 추천과 비교합니다. 1순위 일치 = 박스 종류·개수가 1순위 추천과 같음, 후보 3 안 = 세 후보 중 하나와 같음, 그대로 제출 = 상품 배치까지 1순위 그대로.
          </p>
        </div>
      </div>
      <div className="ak-toolbar">
        <Link href="/packing-log" className="ak-btn">← 박스 할당</Link>
      </div>
      {groups.size === 0 ? (
        <p className="ak-empty">아직 추천과 비교할 제출 기록이 없습니다. 박스 할당에서 추천을 확인하고 제출하면 여기에 쌓입니다.</p>
      ) : (
        sections.map((section) => {
          const rows = [...(groups.get(section)?.entries() ?? [])].sort((a, b) => (section === '날짜별' || section === '모델 버전별' ? b[0].localeCompare(a[0]) : 0));
          if (rows.length === 0) return null;
          return (
            <div key={section} style={{ marginBottom: '1rem' }}>
              <h2 className="ak-name" style={{ margin: '0.5rem 0' }}>{section}</h2>
              <div className="ak-table-wrap">
                <table className="ak-table">
                  <thead>
                    <tr>
                      <th>구분</th>
                      <th className="ak-right">제출 건수</th>
                      <th className="ak-right">1순위 일치</th>
                      <th className="ak-right">후보 3 안</th>
                      <th className="ak-right">그대로 제출</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map(([label, s]) => (
                      <tr key={label}>
                        <td className="ak-name">{label}</td>
                        <td className="ak-right">{s.total}</td>
                        <td className="ak-right">{pct(s.top1, s.total)} ({s.top1})</td>
                        <td className="ak-right">{pct(s.top3, s.total)} ({s.top3})</td>
                        <td className="ak-right">{pct(s.asIs, s.total)} ({s.asIs})</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          );
        })
      )}
    </div>
  );
}
