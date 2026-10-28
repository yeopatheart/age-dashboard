'use client';
import { useEffect, useMemo, useState } from 'react';
import { Barcode, Printer } from 'lucide-react';
import { LabelPrinter, type LabelPrintJob } from '@/components/labels/label-printer';
import { LabelView } from '@/components/labels/label-view';
import { makeBoxBarcode } from '@/lib/labels/barcode';
import { LABEL_KIND_NAMES, type LabelData, type LabelKind } from '@/lib/labels/template';
import type { CardLabelInfo } from '@/lib/labels/server';
import { getCardLabels, prepareLabelPrint, type CardLabelPreviewSource } from '../labels/actions';

// 박스 할당 화면의 "송장 라벨" 영역. 한 업체의 박스 번호마다 실제 라벨 미리보기와 출력 상태를 보여주고, 고르거나 아직 안 뽑은 박스만 출력한다.
//  - 라벨 디자인은 대표값으로 정해 두지만 고객명·터미널명 길이는 업체마다 달라서, 이 미리보기로 글자가 칸에 맞게 찍히는지 보고 출력한다.
//  - 박스가 늘어나면 새 번호는 "미출력"으로 나타나므로 "미출력 박스 선택"으로 추가분만 뽑을 수 있다.
//  - 라벨이 훼손·분실되면 그 번호를 골라 다시 출력한다(같은 바코드로 나온다).
//  - 박스 번호만 찍고 전체 박스 수는 찍지 않는다 — 박스가 늘어도 이미 붙인 라벨을 다시 붙이지 않게 하려는 규칙이다.
export function LabelPanel({ dailyBusinessId, boxCount }: { dailyBusinessId: string; boxCount: number }) {
  const [infos, setInfos] = useState<CardLabelInfo[]>([]);
  const [source, setSource] = useState<Pick<CardLabelPreviewSource, 'templates' | 'base'> | null>(null);
  const [previewKind, setPreviewKind] = useState<LabelKind>('top');
  const [loaded, setLoaded] = useState(false);
  const [picked, setPicked] = useState<Set<number>>(new Set());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [job, setJob] = useState<LabelPrintJob | null>(null);

  // 업체가 바뀌면 이 컴포넌트가 새로 만들어진다(key). 처음 한 번 라벨 상태를 읽는다.
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

  const bySeq = useMemo(() => new Map(infos.map((i) => [i.seq, i])), [infos]);
  const seqs = Array.from({ length: Math.min(boxCount, 99) }, (_, i) => i + 1);
  const extra = infos.filter((i) => i.seq > boxCount); // 박스를 줄여서 번호가 남는 라벨
  const unprinted = seqs.filter((s) => !bySeq.get(s) || bySeq.get(s)!.printCount === 0);
  const toggle = (seq: number) =>
    setPicked((prev) => {
      const next = new Set(prev);
      if (next.has(seq)) next.delete(seq);
      else next.add(seq);
      return next;
    });
  const selectedSeqs = seqs.filter((s) => picked.has(s));

  const print = async (kind: LabelKind) => {
    if (selectedSeqs.length === 0 || busy) return;
    setBusy(true);
    setError(null);
    const payload = await prepareLabelPrint({ dailyBusinessId, seqs: selectedSeqs, kind });
    setBusy(false);
    if (payload.error || !payload.template) return setError(payload.error ?? '라벨을 준비하지 못했습니다.');
    setInfos(payload.infos);
    setJob({ template: payload.template, labels: payload.labels });
  };

  // 미리보기에 찍을 라벨 값. 이미 발급된 바코드가 있으면 그것을, 없으면 같은 규칙으로 계산한 번호를 쓴다.
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
    if (!info || info.printCount === 0) return { text: '미출력', tone: 'new' as const };
    if (info.loadedAt) return { text: '상차 완료', tone: 'done' as const };
    return { text: `출력 ${info.printCount}회`, tone: 'printed' as const };
  };

  return (
    <div className="pk-labels">
      <div className="pk-labels-head">
        <Barcode size={16} />
        <strong>송장 라벨</strong>
        <span className="ak-muted">박스 {boxCount}개 — 미리보기를 보고 출력할 박스를 고르세요</span>
        <span className="ak-spacer" />
        <span className="pk-label-kinds" role="tablist" aria-label="미리보기 종류">
          {(['top', 'side'] as const).map((kind) => (
            <button key={kind} role="tab" aria-selected={previewKind === kind} className={`ak-btn ${previewKind === kind ? 'pk-label-kind-on' : ''}`} onClick={() => setPreviewKind(kind)}>{LABEL_KIND_NAMES[kind]}</button>
          ))}
        </span>
        <button className="ak-btn" onClick={() => setPicked(new Set(unprinted))} disabled={unprinted.length === 0} title="아직 출력하지 않은 박스(추가된 박스 포함)만 고릅니다">미출력 박스 선택{unprinted.length ? ` (${unprinted.length})` : ''}</button>
        <button className="ak-btn" onClick={() => setPicked(new Set(seqs))} disabled={seqs.length === 0}>전체 선택</button>
        <button className="ak-btn" onClick={() => setPicked(new Set())} disabled={picked.size === 0}>선택 해제</button>
      </div>

      {boxCount === 0 ? (
        <p className="ak-muted">박스를 먼저 할당하면 라벨을 출력할 수 있습니다.</p>
      ) : (
        <div className="pk-label-boxes">
          {seqs.map((seq) => {
            const st = statusOf(seq);
            const data = previewData(seq);
            const template = source?.templates[previewKind];
            return (
              <label key={seq} className={`pk-label-box pk-label-${st.tone} ${picked.has(seq) ? 'pk-label-on' : ''}`}>
                <span className="pk-label-top">
                  <input type="checkbox" checked={picked.has(seq)} onChange={() => toggle(seq)} />
                  <span className="pk-label-no">{seq}번</span>
                  <span className="pk-label-st">{loaded ? st.text : '…'}</span>
                </span>
                <span className="pk-label-preview">
                  {data && template ? <LabelView template={template} data={data} unit="2.4px" /> : <span className="ak-muted">미리보기를 불러오는 중…</span>}
                </span>
              </label>
            );
          })}
        </div>
      )}
      {extra.length > 0 && (
        <p className="pk-label-warn">박스를 줄여서 번호 {extra.map((e) => e.seq).join(', ')}번 라벨이 남아 있습니다. 해당 라벨은 붙이지 마세요(상차 스캔에서도 쓰이지 않게 두면 됩니다).</p>
      )}

      <div className="pk-label-actions">
        {(['top', 'side'] as const).map((kind) => (
          <button key={kind} className="pk-big pk-big-primary" disabled={busy || selectedSeqs.length === 0} onClick={() => print(kind)}>
            <Printer size={18} /> {LABEL_KIND_NAMES[kind]} 출력{selectedSeqs.length ? ` (${selectedSeqs.length}장)` : ''}
          </button>
        ))}
        {error && <span className="ak-error">{error}</span>}
      </div>
      <p className="ak-muted pk-label-note">상단·측면 라벨은 용지 크기가 달라서 따로 출력합니다. 인쇄 창에서 프린터와 용지 크기(라벨 설정에서 정한 크기)를 확인하세요. 같은 번호를 다시 출력하면 같은 바코드의 재출력입니다.</p>

      <LabelPrinter job={job} onDone={() => setJob(null)} />
    </div>
  );
}
