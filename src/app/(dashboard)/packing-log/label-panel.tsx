'use client';
import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { Barcode, Printer } from 'lucide-react';
import { LabelPrinter, type LabelPrintJob } from '@/components/labels/label-printer';
import { LabelView } from '@/components/labels/label-view';
import { makeBoxBarcode } from '@/lib/labels/barcode';
import { LABEL_KIND_NAMES, type LabelData, type LabelKind } from '@/lib/labels/template';
import type { CardLabelInfo } from '@/lib/labels/server';
import { getCardLabels, prepareLabelPrint, type CardLabelPreviewSource } from '../labels/actions';

const KINDS: LabelKind[] = ['top', 'side'];
const PREVIEW_UNIT = '2.4px'; // 미리보기에서 1mm를 그리는 크기

// 박스 할당 화면의 "송장 라벨 출력" 영역. 박스 번호마다 상단·측면 라벨 미리보기를 나란히 보여주고, 각 라벨 아래의 버튼 하나로 출력한다.
//  - 미리보기는 실제로 찍힐 값(고객명·터미널·바코드)으로 그려서, 이름이 길어 글자가 줄어드는 모습까지 출력 전에 본다.
//  - 박스가 늘어나면 새 번호의 카드가 "미출력"으로 나타난다. 훼손·분실된 라벨은 같은 버튼으로 다시 출력한다(같은 바코드).
//  - 박스 번호만 찍고 전체 박스 수는 찍지 않는다 — 박스가 늘어도 이미 붙인 라벨을 다시 붙이지 않게 하려는 규칙이다.
//  - 프린터·용지 설정은 라벨 설정 화면에서 한 번만 한다. 여기서는 출력 버튼만 누르면 된다.
export function LabelPanel({ dailyBusinessId, boxCount }: { dailyBusinessId: string; boxCount: number }) {
  const [infos, setInfos] = useState<CardLabelInfo[]>([]);
  const [source, setSource] = useState<Pick<CardLabelPreviewSource, 'templates' | 'base'> | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [job, setJob] = useState<LabelPrintJob | null>(null);

  // 업체가 바뀌면 이 컴포넌트가 새로 만들어진다(key). 처음 한 번 라벨 상태와 미리보기 재료를 읽는다.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const result = await getCardLabels(dailyBusinessId);
      if (cancelled) return;
      setInfos(result.infos);
      setSource({ templates: result.templates, base: result.base });
      setLoaded(true);
    })();
    return () => {
      cancelled = true;
    };
  }, [dailyBusinessId]);

  const print = async (kind: LabelKind, targetSeqs: number[], key: string) => {
    if (targetSeqs.length === 0 || busyKey) return;
    setBusyKey(key);
    setError(null);
    const payload = await prepareLabelPrint({ dailyBusinessId, seqs: targetSeqs, kind });
    setBusyKey(null);
    if (payload.error || !payload.template) return setError(payload.error ?? '라벨을 준비하지 못했습니다.');
    setInfos(payload.infos);
    setJob({ template: payload.template, labels: payload.labels });
  };

  return (
    <LabelPanelView boxCount={boxCount} infos={infos} source={source} loaded={loaded} busyKey={busyKey} error={error} job={job} onPrint={print} onJobDone={() => setJob(null)} />
  );
}

// 화면만 그리는 부분(데이터를 props로 받는다).
export function LabelPanelView({
  boxCount,
  infos,
  source,
  loaded,
  busyKey,
  error,
  job,
  onPrint: print,
  onJobDone,
}: {
  boxCount: number;
  infos: CardLabelInfo[];
  source: Pick<CardLabelPreviewSource, 'templates' | 'base'> | null;
  loaded: boolean;
  busyKey: string | null;
  error: string | null;
  job: LabelPrintJob | null;
  onPrint: (kind: LabelKind, seqs: number[], key: string) => void;
  onJobDone: () => void;
}) {
  const bySeq = useMemo(() => new Map(infos.map((i) => [i.seq, i])), [infos]);
  const seqs = Array.from({ length: Math.min(boxCount, 99) }, (_, i) => i + 1);
  const extra = infos.filter((i) => i.seq > boxCount); // 박스를 줄여서 번호가 남는 라벨

  // 미리보기에 찍을 라벨 값. 이미 발급된 바코드가 있으면 그것을, 없으면 같은 규칙으로 계산한 번호를 쓴다(DB에 쓰지 않는다).
  const previewData = (seq: number): LabelData | null => {
    if (!source?.base) return null;
    let barcode = bySeq.get(seq)?.barcode;
    if (!barcode) {
      try {
        barcode = makeBoxBarcode(source.base.orderDate, source.base.businessNumber, seq);
      } catch {
        return null;
      }
    }
    return { ...source.base.data, boxNo: seq, barcode };
  };

  const statusOf = (seq: number) => {
    const info = bySeq.get(seq);
    const counts = info?.printCounts ?? { top: 0, side: 0 };
    if (info?.loadedAt) return { text: '상차 완료', tone: 'done' as const };
    if (counts.top === 0 && counts.side === 0) return { text: '미출력', tone: 'new' as const };
    if (counts.top === 0 || counts.side === 0) return { text: `${counts.top === 0 ? '상단' : '측면'} 미출력`, tone: 'new' as const };
    return { text: '출력 완료', tone: 'printed' as const };
  };

  return (
    <section className="lp-root">
      <div className="lp-head">
        <Barcode size={18} />
        <h2>송장 라벨 출력</h2>
        <span className="lp-count">박스 {boxCount}개</span>
        <span className="lp-spacer" />
        {boxCount > 1 &&
          KINDS.map((kind) => (
            <button key={kind} className="lp-bulk" disabled={!!busyKey} onClick={() => print(kind, seqs, `all-${kind}`)}>
              <Printer size={14} /> {LABEL_KIND_NAMES[kind]} 전체 출력 ({boxCount}장)
            </button>
          ))}
      </div>

      {boxCount === 0 ? (
        <p className="lp-empty">박스를 먼저 할당하면 라벨을 출력할 수 있습니다.</p>
      ) : (
        <div className="lp-boxes">
          {seqs.map((seq) => {
            const st = statusOf(seq);
            const data = previewData(seq);
            const counts = bySeq.get(seq)?.printCounts ?? { top: 0, side: 0 };
            return (
              <article key={seq} className={`lp-box lp-${st.tone}`}>
                <div className="lp-box-head">
                  <strong>박스 {seq}번</strong>
                  <span className="lp-chip">{loaded ? st.text : '…'}</span>
                </div>
                <div className="lp-kinds">
                  {KINDS.map((kind) => {
                    const template = source?.templates[kind];
                    const key = `${seq}-${kind}`;
                    const printed = counts[kind];
                    return (
                      <div key={kind} className="lp-kind">
                        <div className="lp-kind-name">
                          {LABEL_KIND_NAMES[kind]}
                          {printed > 0 && <small>출력 {printed}회</small>}
                        </div>
                        <div className="lp-preview">
                          {data && template ? <LabelView template={template} data={data} unit={PREVIEW_UNIT} /> : <span className="lp-loading">불러오는 중…</span>}
                        </div>
                        <button className={`lp-print ${printed > 0 ? 'lp-print-again' : ''}`} disabled={!!busyKey || !data} onClick={() => print(kind, [seq], key)}>
                          <Printer size={16} /> {busyKey === key ? '준비 중…' : printed > 0 ? '다시 출력' : '출력'}
                        </button>
                      </div>
                    );
                  })}
                </div>
              </article>
            );
          })}
        </div>
      )}

      {extra.length > 0 && (
        <p className="lp-warn">박스를 줄여서 번호 {extra.map((e) => e.seq).join(', ')}번 라벨이 남아 있습니다. 해당 라벨은 붙이지 마세요.</p>
      )}
      {error && <p className="lp-error">{error}</p>}
      <p className="lp-note">
        출력 버튼을 누르면 라벨 프린터로 보냅니다. 인쇄 창이 뜬다면 <Link href="/labels">라벨 설정의 바로 출력 설정</Link>에서 받은 바로가기로 연 창에서 출력하세요(한 번만 설정).
      </p>

      <LabelPrinter job={job} onDone={onJobDone} />

      <style>{`
        .lp-root { border-top: 1px solid var(--border); padding: 1rem 1.1rem 1.1rem; display: flex; flex-direction: column; gap: 0.8rem; min-width: 0; }
        .lp-head { display: flex; align-items: center; gap: 0.55rem; flex-wrap: wrap; }
        .lp-head h2 { font-size: 1rem; font-weight: 800; }
        .lp-count { font-size: 0.8125rem; font-weight: 700; color: var(--muted-foreground); }
        .lp-spacer { flex: 1; }
        .lp-bulk { display: inline-flex; align-items: center; gap: 0.35rem; height: 2.25rem; padding: 0 0.9rem; border-radius: 999px; border: 1px solid var(--border); background: #fff; font-size: 0.8125rem; font-weight: 700; cursor: pointer; }
        .lp-bulk:disabled, .lp-print:disabled { opacity: 0.55; cursor: not-allowed; }
        .lp-empty { color: var(--muted-foreground); font-size: 0.875rem; }
        .lp-boxes { display: flex; flex-direction: column; gap: 0.8rem; }
        .lp-box { border: 2px solid var(--border); border-radius: 14px; padding: 0.75rem 0.85rem 0.9rem; background: #fff; display: flex; flex-direction: column; gap: 0.65rem; min-width: 0; }
        .lp-new { border-color: #fcd34d; background: #fffdf5; }
        .lp-done { border-color: #86efac; background: #f7fef9; }
        .lp-box-head { display: flex; align-items: center; gap: 0.6rem; }
        .lp-box-head strong { font-size: 1.1rem; font-weight: 900; }
        .lp-chip { font-size: 0.75rem; font-weight: 800; border-radius: 999px; padding: 0.15rem 0.6rem; background: #f1f5f9; color: #475569; }
        .lp-new .lp-chip { background: #fef3c7; color: #92400e; }
        .lp-printed .lp-chip { background: #dbeafe; color: #1d4ed8; }
        .lp-done .lp-chip { background: #dcfce7; color: #15803d; }
        .lp-kinds { display: grid; grid-template-columns: repeat(auto-fit, minmax(16rem, 1fr)); gap: 0.8rem; }
        .lp-kind { display: flex; flex-direction: column; gap: 0.45rem; min-width: 0; align-items: stretch; }
        .lp-kind-name { display: flex; align-items: baseline; gap: 0.5rem; font-size: 0.8125rem; font-weight: 800; color: #334155; }
        .lp-kind-name small { font-size: 0.72rem; font-weight: 700; color: #1d4ed8; }
        .lp-preview { flex: 1; display: flex; justify-content: center; align-items: center; background: #eef2f6; border-radius: 10px; padding: 0.5rem; overflow-x: auto; min-height: 6rem; }
        .lp-preview > div { box-shadow: 0 0 0 1px #cbd5e1, 0 1px 4px rgba(15, 23, 42, 0.15); flex: none; }
        .lp-loading { font-size: 0.8125rem; color: var(--muted-foreground); }
        .lp-print { display: inline-flex; align-items: center; justify-content: center; gap: 0.45rem; height: 3rem; border-radius: 12px; border: 0; background: var(--primary); color: #fff; font-size: 1rem; font-weight: 800; cursor: pointer; }
        .lp-print-again { background: #fff; color: var(--primary); border: 2px solid var(--primary); }
        .lp-warn { font-size: 0.8125rem; font-weight: 700; color: #92400e; background: #fffbeb; border-radius: 10px; padding: 0.45rem 0.7rem; }
        .lp-error { font-size: 0.875rem; font-weight: 700; color: var(--danger, #dc2626); }
        .lp-note { font-size: 0.75rem; color: var(--muted-foreground); }
        .lp-note a { color: var(--primary); text-decoration: underline; }
      `}</style>
    </section>
  );
}
