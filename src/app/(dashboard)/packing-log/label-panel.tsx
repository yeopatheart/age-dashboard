'use client';
import { useEffect, useMemo, useState } from 'react';
import { useCan } from '@/components/permissions-context';
import { mergeGroupOf, mergeLabelText, mergeSelected, normalizeMergeGroups, unmergeGroup, type MergeGroups } from '@/lib/box-merge';
import Link from 'next/link';
import { Barcode, Printer } from 'lucide-react';
import { LabelPrinter, type LabelPrintJob } from '@/components/labels/label-printer';
import { LabelView } from '@/components/labels/label-view';
import { makeBoxBarcode } from '@/lib/labels/barcode';
import { FOLD_KEEP_OUT_MM, type LabelData } from '@/lib/labels/template';
import type { CardLabelInfo } from '@/lib/labels/server';
import { getCardLabels, prepareLabelPrint, saveMergeGroups, type CardLabelPreviewSource } from '../labels/actions';

const PREVIEW_UNIT = '3px'; // 미리보기에서 1mm를 그리는 크기

// 박스 할당 화면의 "송장 라벨 출력" 영역. 박스 번호마다 실제로 찍힐 라벨(상단 면 + 측면, 접히는 선 표시) 미리보기와 출력 버튼 하나를 보여준다.
//  - 라벨 한 장을 박스 뚜껑 모서리에 감아 붙인다: 위쪽은 뚜껑 위에, 아래쪽(측면)은 옆면으로 꺾어 내린다. 점선이 접는 위치다.
//  - 미리보기는 실제로 찍힐 값(고객명·터미널·바코드)으로 그려서, 이름이 길어 글자가 줄어드는 모습까지 출력 전에 본다.
//  - 박스가 늘어나면 새 번호의 카드가 "미출력"으로 나타난다. 훼손·분실된 라벨은 같은 버튼으로 다시 출력한다(같은 바코드).
//  - 박스 번호만 찍고 전체 박스 수는 찍지 않는다 — 박스가 늘어도 이미 붙인 라벨을 다시 붙이지 않게 하려는 규칙이다.
//  - 프린터·용지 설정은 라벨 설정 화면에서 한 번만 한다. 여기서는 출력 버튼만 누르면 된다.
export function LabelPanel({ dailyBusinessId, boxCount }: { dailyBusinessId: string; boxCount: number }) {
  const [infos, setInfos] = useState<CardLabelInfo[]>([]);
  const [source, setSource] = useState<Pick<CardLabelPreviewSource, 'template' | 'base'> | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [job, setJob] = useState<LabelPrintJob | null>(null);
  const [groups, setGroups] = useState<MergeGroups>([]);
  // 합포장 표시가 바뀐 박스 중 이미 라벨을 출력한 박스 — 다시 출력하기 전까지 알려 준다.
  const [staleSeqs, setStaleSeqs] = useState<number[]>([]);
  const canMerge = useCan()('packing:submit');

  // 업체가 바뀌면 이 컴포넌트가 새로 만들어진다(key). 처음 한 번 라벨 상태와 미리보기 재료를 읽는다.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const result = await getCardLabels(dailyBusinessId);
      if (cancelled) return;
      setInfos(result.infos);
      setSource({ template: result.template, base: result.base });
      setGroups(result.base?.mergeGroups ?? []);
      setLoaded(true);
    })();
    return () => {
      cancelled = true;
    };
  }, [dailyBusinessId]);

  const print = async (targetSeqs: number[], key: string) => {
    if (targetSeqs.length === 0 || busyKey) return;
    setBusyKey(key);
    setError(null);
    const payload = await prepareLabelPrint({ dailyBusinessId, seqs: targetSeqs });
    setBusyKey(null);
    if (payload.error || !payload.template) return setError(payload.error ?? '라벨을 준비하지 못했습니다.');
    setInfos(payload.infos);
    setStaleSeqs((prev) => prev.filter((n) => !targetSeqs.includes(n)));
    setJob({ template: payload.template, labels: payload.labels });
  };

  const changeGroups = async (next: MergeGroups) => {
    if (busyKey) return;
    setBusyKey('merge');
    setError(null);
    const result = await saveMergeGroups(dailyBusinessId, next);
    setBusyKey(null);
    if (result.error) return setError(result.error);
    // 합포장 표시가 달라진 박스(묶음이 생기거나 바뀌거나 없어진 박스) 중 이미 출력한 것
    const changed = new Set<number>();
    for (let seq = 1; seq <= 99; seq++) if (mergeLabelText(groups, seq) !== mergeLabelText(result.groups, seq)) changed.add(seq);
    setGroups(result.groups);
    setStaleSeqs((prev) => [...new Set([...prev, ...infos.filter((i) => changed.has(i.seq) && i.printCount > 0).map((i) => i.seq)])]);
  };

  return (
    <LabelPanelView boxCount={boxCount} groups={normalizeMergeGroups(groups, boxCount)} staleSeqs={staleSeqs} onGroupsChange={canMerge ? changeGroups : undefined} infos={infos} source={source} loaded={loaded} busyKey={busyKey} error={error} job={job} onPrint={print} onJobDone={() => setJob(null)} />
  );
}

// 합포장 지정: 박스 번호 칩을 눌러 고른 뒤 "묶기". 포장이 끝난 뒤 묶음의 박스들을 함께 테이핑한다(라벨에 "합포장 1·2"가 찍힌다).
function MergeEditor({ boxCount, groups, disabled, onChange }: { boxCount: number; groups: MergeGroups; disabled: boolean; onChange?: (next: MergeGroups) => void }) {
  const [picked, setPicked] = useState<number[]>([]);
  const seqs = Array.from({ length: Math.min(boxCount, 99) }, (_, i) => i + 1);
  const toggle = (seq: number) => setPicked((p) => (p.includes(seq) ? p.filter((n) => n !== seq) : [...p, seq]));
  if (!onChange && groups.length === 0) return null;
  return (
    <div className="lp-merge">
      <span className="lp-merge-title">합포장</span>
      {groups.map((g) => (
        <span key={g[0]} className="lp-merge-group">
          {g.join('·')}번
          {onChange && (
            <button type="button" disabled={disabled} onClick={() => onChange(unmergeGroup(groups, g))} aria-label={`${g.join('·')}번 합포장 해제`}>×</button>
          )}
        </span>
      ))}
      {onChange && (
        <>
          <span className="lp-merge-pick" role="group" aria-label="합포장할 박스 고르기">
            {seqs.map((seq) => (
              <button key={seq} type="button" disabled={disabled} className={picked.includes(seq) ? 'lp-pick-on' : ''} aria-pressed={picked.includes(seq)} onClick={() => toggle(seq)}>
                {seq}
              </button>
            ))}
          </span>
          <button
            type="button"
            className="lp-merge-do"
            disabled={disabled || picked.length < 2}
            onClick={() => {
              onChange(mergeSelected(groups, picked));
              setPicked([]);
            }}
          >
            묶기
          </button>
        </>
      )}
      {groups.length === 0 && onChange && <span className="lp-merge-hint">같이 테이핑할 박스를 고르면 라벨에 합포장 번호가 찍힙니다</span>}
    </div>
  );
}

// 화면만 그리는 부분(데이터를 props로 받는다).
export function LabelPanelView({
  boxCount,
  groups,
  staleSeqs,
  onGroupsChange,
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
  groups: MergeGroups;
  staleSeqs: number[];
  onGroupsChange?: (next: MergeGroups) => void; // 없으면 합포장은 보기만 한다(권한 없음)
  infos: CardLabelInfo[];
  source: Pick<CardLabelPreviewSource, 'template' | 'base'> | null;
  loaded: boolean;
  busyKey: string | null;
  error: string | null;
  job: LabelPrintJob | null;
  onPrint: (seqs: number[], key: string) => void;
  onJobDone: () => void;
}) {
  const bySeq = useMemo(() => new Map(infos.map((i) => [i.seq, i])), [infos]);
  const seqs = Array.from({ length: Math.min(boxCount, 99) }, (_, i) => i + 1);
  const extra = infos.filter((i) => i.seq > boxCount); // 박스를 줄여서 번호가 남는 라벨
  const template = source?.template;

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
    return { ...source.base.data, boxNo: seq, barcode, merge: mergeLabelText(groups, seq) };
  };

  const statusOf = (seq: number) => {
    const info = bySeq.get(seq);
    if (info?.loadedAt) return { text: '상차 완료', tone: 'done' as const };
    if (!info || info.printCount === 0) return { text: '미출력', tone: 'new' as const };
    return { text: `출력 ${info.printCount}회`, tone: 'printed' as const };
  };

  return (
    <section className="lp-root">
      <div className="lp-head">
        <Barcode size={18} />
        <h2>송장 라벨 출력</h2>
        <span className="lp-count">박스 {boxCount}개</span>
        <span className="lp-spacer" />
        {boxCount > 1 && (
          <button className="lp-bulk" disabled={!!busyKey} onClick={() => print(seqs, 'all')}>
            <Printer size={14} /> 전체 출력 ({boxCount}장)
          </button>
        )}
      </div>

      {boxCount >= 2 && <MergeEditor boxCount={boxCount} groups={groups} disabled={!!busyKey} onChange={onGroupsChange} />}

      {boxCount === 0 ? (
        <p className="lp-empty">박스를 먼저 할당하면 라벨을 출력할 수 있습니다.</p>
      ) : (
        <div className="lp-boxes">
          {seqs.map((seq) => {
            const st = statusOf(seq);
            const data = previewData(seq);
            const printed = bySeq.get(seq)?.printCount ?? 0;
            return (
              <article key={seq} className={`lp-box lp-${st.tone}`}>
                <div className="lp-box-head">
                  <strong>박스 {seq}번</strong>
                  <span className="lp-chip">{loaded ? st.text : '…'}</span>
                  {mergeGroupOf(groups, seq) && <span className="lp-chip lp-chip-merge">{mergeLabelText(groups, seq)}</span>}
                </div>
                <div className="lp-preview">
                  {data && template ? (
                    <div className="lp-label">
                      <LabelView template={template} data={data} unit={PREVIEW_UNIT} />
                      {/* 접히는 선: 이 위는 뚜껑 위에, 아래는 옆면으로 꺾어 붙인다 */}
                      <div className="lp-fold" style={{ top: `calc(${template.topHeightMm} * ${PREVIEW_UNIT})` }} aria-hidden>
                        <span>접는 선</span>
                      </div>
                      <div className="lp-keepout" style={{ top: `calc(${template.topHeightMm - FOLD_KEEP_OUT_MM} * ${PREVIEW_UNIT})`, height: `calc(${FOLD_KEEP_OUT_MM * 2} * ${PREVIEW_UNIT})` }} aria-hidden />
                    </div>
                  ) : (
                    <span className="lp-loading">불러오는 중…</span>
                  )}
                </div>
                <button className={`lp-print ${printed > 0 ? 'lp-print-again' : ''}`} disabled={!!busyKey || !data} onClick={() => print([seq], String(seq))}>
                  <Printer size={18} /> {busyKey === String(seq) ? '준비 중…' : printed > 0 ? '다시 출력' : '출력'}
                </button>
              </article>
            );
          })}
        </div>
      )}

      {staleSeqs.length > 0 && (
        <p className="lp-warn">합포장 표시가 바뀌었습니다. 이미 붙인 {staleSeqs.join(', ')}번 라벨은 옛 표시이니 다시 출력해서 바꿔 붙이세요.</p>
      )}
      {extra.length > 0 && (
        <p className="lp-warn">박스를 줄여서 번호 {extra.map((e) => e.seq).join(', ')}번 라벨이 남아 있습니다. 해당 라벨은 붙이지 마세요.</p>
      )}
      {error && <p className="lp-error">{error}</p>}
      <p className="lp-note">
        라벨은 점선(접는 선)을 박스 뚜껑 모서리에 맞춰 위쪽은 뚜껑 위에, 아래쪽은 옆면으로 꺾어 붙입니다. 인쇄 창이 뜬다면 <Link href="/labels">라벨 설정의 바로 출력 설정</Link>에서 받은 바로가기로 연 창에서 출력하세요(한 번만 설정).
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
        .lp-merge { display: flex; align-items: center; gap: 0.5rem; flex-wrap: wrap; font-size: 0.8125rem; }
        .lp-merge-title { font-weight: 800; }
        .lp-merge-group { display: inline-flex; align-items: center; gap: 0.3rem; padding: 0.1rem 0.35rem 0.1rem 0.65rem; border-radius: 999px; background: #ecfdf5; border: 1px solid #6ee7b7; color: #047857; font-weight: 800; }
        .lp-merge-group button { width: 1.25rem; height: 1.25rem; border-radius: 999px; border: 0; background: transparent; color: #047857; font-weight: 800; cursor: pointer; line-height: 1; }
        .lp-merge-pick { display: inline-flex; gap: 0.3rem; flex-wrap: wrap; }
        .lp-merge-pick button { min-width: 2rem; height: 2rem; padding: 0 0.4rem; border-radius: 999px; border: 1px solid var(--border); background: #fff; font-size: 0.8125rem; font-weight: 800; cursor: pointer; }
        .lp-merge-pick .lp-pick-on { background: var(--primary); border-color: var(--primary); color: #fff; }
        .lp-merge-do { height: 2rem; padding: 0 0.9rem; border-radius: 999px; border: 1px solid var(--primary); background: #fff; color: var(--primary); font-size: 0.8125rem; font-weight: 800; cursor: pointer; }
        .lp-merge button:disabled { opacity: 0.5; cursor: not-allowed; }
        .lp-merge-hint { color: var(--muted-foreground); font-size: 0.75rem; }
        .lp-box .lp-chip-merge { background: #ecfdf5; color: #047857; }
        .lp-empty { color: var(--muted-foreground); font-size: 0.875rem; }
        .lp-boxes { display: grid; grid-template-columns: repeat(auto-fill, minmax(21rem, 1fr)); gap: 0.8rem; }
        .lp-box { border: 2px solid var(--border); border-radius: 14px; padding: 0.75rem 0.85rem 0.9rem; background: #fff; display: flex; flex-direction: column; gap: 0.65rem; min-width: 0; }
        .lp-new { border-color: #fcd34d; background: #fffdf5; }
        .lp-done { border-color: #86efac; background: #f7fef9; }
        .lp-box-head { display: flex; align-items: center; gap: 0.6rem; }
        .lp-box-head strong { font-size: 1.1rem; font-weight: 900; }
        .lp-chip { font-size: 0.75rem; font-weight: 800; border-radius: 999px; padding: 0.15rem 0.6rem; background: #f1f5f9; color: #475569; }
        .lp-new .lp-chip { background: #fef3c7; color: #92400e; }
        .lp-printed .lp-chip { background: #dbeafe; color: #1d4ed8; }
        .lp-done .lp-chip { background: #dcfce7; color: #15803d; }
        .lp-preview { display: flex; justify-content: center; align-items: center; background: #eef2f6; border-radius: 10px; padding: 0.6rem; overflow-x: auto; min-height: 6rem; }
        .lp-label { position: relative; flex: none; box-shadow: 0 0 0 1px #cbd5e1, 0 1px 4px rgba(15, 23, 42, 0.15); }
        .lp-fold { position: absolute; left: 0; right: 0; border-top: 1.5px dashed #2563eb; pointer-events: none; }
        .lp-fold span { position: absolute; right: 3px; top: 1px; font-size: 0.625rem; font-weight: 800; color: #2563eb; background: rgba(255, 255, 255, 0.85); padding: 0 3px; border-radius: 3px; }
        .lp-keepout { position: absolute; left: 0; right: 0; background: rgba(37, 99, 235, 0.06); pointer-events: none; }
        .lp-loading { font-size: 0.8125rem; color: var(--muted-foreground); }
        .lp-print { display: inline-flex; align-items: center; justify-content: center; gap: 0.45rem; height: 3.25rem; border-radius: 12px; border: 0; background: var(--primary); color: #fff; font-size: 1.05rem; font-weight: 800; cursor: pointer; }
        .lp-print-again { background: #fff; color: var(--primary); border: 2px solid var(--primary); }
        .lp-warn { font-size: 0.8125rem; font-weight: 700; color: #92400e; background: #fffbeb; border-radius: 10px; padding: 0.45rem 0.7rem; }
        .lp-error { font-size: 0.875rem; font-weight: 700; color: var(--danger, #dc2626); }
        .lp-note { font-size: 0.75rem; color: var(--muted-foreground); }
        .lp-note a { color: var(--primary); text-decoration: underline; }
      `}</style>
    </section>
  );
}
