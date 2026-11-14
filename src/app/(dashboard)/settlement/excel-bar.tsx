'use client';
import { useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Download, Upload } from 'lucide-react';
import { useCan } from '@/components/permissions-context';
import { applySettlementImport, previewSettlementImport } from './import-actions';
import { buildSettlementDayWorkbook, parseSettlementDayWorkbook, type DayWorkbookInput } from '@/lib/export/settlement-day';
import { planChangeCount, type Diff, type ImportPlan, type ParsedWorkbook } from '@/lib/settlement/excel-import';
import { settlementUrl } from '@/lib/settlement/url';

const MAX_FILE_BYTES = 5 * 1024 * 1024;
const MAX_LINES = 200; // 미리보기 목록에 보여 주는 변경 줄 수(나머지는 "외 N건")
const MAX_ISSUES = 50;

type Line = { sheet: string; label: string; diffs: Diff[] };
const linesOf = (plan: ImportPlan): Line[] => [
  ...plan.sales.map((c) => ({ sheet: '판매', label: c.label, diffs: c.diffs })),
  ...plan.shipping.map((c) => ({ sheet: '배송비', label: c.label, diffs: c.diffs })),
  ...plan.purchases.map((c) => ({ sheet: '매입', label: c.label, diffs: c.diffs })),
];

// 정산 하루치 엑셀 내보내기·가져오기. 내보낸 파일의 노란 칸을 고쳐 다시 가져오면 변경 목록을 미리 보여 주고, 확인하면 일괄 저장한다.
export function ExcelBar({ date, data }: { date: string; data: DayWorkbookInput }) {
  const canEdit = useCan()('settlement:edit');
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState<null | 'export' | 'read' | 'apply'>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [preview, setPreview] = useState<{ plan: ImportPlan; workbook: ParsedWorkbook; fileName: string } | null>(null);

  const exportFile = async () => {
    setBusy('export');
    setError(null);
    setNotice(null);
    try {
      const blob = await buildSettlementDayWorkbook(data);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `정산_${date}.xlsx`;
      a.click();
      URL.revokeObjectURL(url);
    } catch {
      setError('엑셀 파일을 만들지 못했습니다. 다시 시도해주세요.');
    } finally {
      setBusy(null);
    }
  };

  const readFile = async (file: File) => {
    setError(null);
    setNotice(null);
    setPreview(null);
    if (file.size > MAX_FILE_BYTES) return setError('파일이 너무 큽니다(5MB 이하). 이 화면에서 내보낸 파일을 쓰세요.');
    setBusy('read');
    try {
      const workbook = await parseSettlementDayWorkbook(await file.arrayBuffer());
      const result = await previewSettlementImport(date, workbook);
      if (result.error !== null) setError(result.error);
      else setPreview({ plan: result.plan, workbook, fileName: file.name });
    } catch {
      setError('파일을 읽지 못했습니다. .xlsx 파일인지, 이 화면에서 내보낸 파일인지 확인해주세요.');
    } finally {
      setBusy(null);
    }
  };

  const apply = async () => {
    if (!preview) return;
    setBusy('apply');
    setError(null);
    const result = await applySettlementImport(date, preview.workbook).catch(() => ({ error: '저장하지 못했습니다. 권한이나 연결을 확인한 뒤 다시 시도해주세요.', applied: { sales: 0, shipping: 0, purchases: 0 } }));
    setBusy(null);
    const { sales, shipping, purchases } = result.applied;
    if (result.error) {
      setError(result.error);
      if (sales + shipping + purchases > 0) setPreview(null); // 일부 저장됨: 다시 가져와 남은 것만 저장하게 한다
      return;
    }
    setPreview(null);
    setNotice(sales + shipping + purchases === 0 ? '변경할 내용이 없었습니다.' : `저장했습니다: 판매 ${sales}건 · 배송비 ${shipping}건 · 매입 ${purchases}건`);
    // 화면에 남아 있던 입력 중 값이 새 값을 가리지 않게 구역들을 새로 그린다(key가 바뀐다).
    router.replace(`${settlementUrl(date)}&v=${Date.now()}`);
  };

  const lines = preview ? linesOf(preview.plan) : [];
  const issues = preview?.plan.errors ?? [];
  const changes = preview ? planChangeCount(preview.plan) : 0;

  return (
    <>
      <div className="ak-toolbar">
        <button className="ak-btn" onClick={() => void exportFile()} disabled={busy !== null} title="이 날짜의 판매·배송비·매입을 한 파일(엑셀)로 내려받습니다. 노란 칸을 고쳐 다시 가져오면 일괄 수정됩니다.">
          <Download size={14} /> 엑셀 내보내기
        </button>
        {canEdit && (
          <>
            <button className="ak-btn" onClick={() => fileRef.current?.click()} disabled={busy !== null} title="내보낸 엑셀을 고쳐서 올리면 변경 목록을 먼저 보여 드립니다.">
              <Upload size={14} /> 엑셀 가져오기
            </button>
            <input
              ref={fileRef}
              type="file"
              accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
              hidden
              onChange={(e) => {
                const file = e.target.files?.[0];
                e.target.value = ''; // 같은 파일을 다시 골라도 읽도록
                if (file) void readFile(file);
              }}
            />
          </>
        )}
        {busy === 'read' && <span className="ak-sub">파일 확인 중…</span>}
        {busy === 'export' && <span className="ak-sub">파일 만드는 중…</span>}
      </div>
      {error && <p className="ak-error" role="alert">{error}</p>}
      {notice && <p className="ak-notice" role="status">{notice}</p>}

      {preview && (
        <div className="ak-bulk" role="region" aria-label="엑셀 가져오기 미리보기">
          <div className="ak-bulk-head" style={{ flexWrap: 'wrap' }}>
            <strong>{preview.fileName}</strong>
            <span>
              판매 {preview.plan.sales.length}건 · 배송비 {preview.plan.shipping.length}건 · 매입 {preview.plan.purchases.length}건 변경
              {preview.plan.skippedSheets.length > 0 && <span className="ak-sub"> (파일에 없는 시트: {preview.plan.skippedSheets.join(', ')})</span>}
            </span>
            <span className="ak-spacer" />
            <button className="ak-btn" onClick={() => setPreview(null)} disabled={busy === 'apply'}>취소</button>
            <button className="ak-btn ak-btn-primary" onClick={() => void apply()} disabled={busy === 'apply' || issues.length > 0 || changes === 0}>
              {busy === 'apply' ? '저장 중…' : `${changes}건 적용`}
            </button>
          </div>
          {issues.length > 0 && (
            <div role="alert" style={{ width: '100%' }}>
              <p className="ak-error" style={{ margin: 0 }}>오류 {issues.length}건 — 고친 뒤 다시 가져오세요. 오류가 있으면 아무것도 저장하지 않습니다.</p>
              <ul style={{ margin: '0.25rem 0 0', paddingLeft: '1.2rem', fontSize: 'var(--fs-sm)' }}>
                {issues.slice(0, MAX_ISSUES).map((i, n) => (
                  <li key={n}>{i.sheet ? `${i.sheet} 시트${i.row ? ` ${i.row}행` : ''}: ` : ''}{i.message}</li>
                ))}
                {issues.length > MAX_ISSUES && <li>…외 {issues.length - MAX_ISSUES}건</li>}
              </ul>
            </div>
          )}
          {changes === 0 && issues.length === 0 && <p className="ak-sub" style={{ margin: 0 }}>바뀐 내용이 없습니다. 노란 칸을 고친 파일을 올려주세요.</p>}
          {lines.length > 0 && (
            <ul style={{ margin: 0, paddingLeft: '1.2rem', width: '100%', maxHeight: '20rem', overflowY: 'auto', fontSize: 'var(--fs-sm)' }}>
              {lines.slice(0, MAX_LINES).map((l, n) => (
                <li key={n}>
                  <span className="ak-sub">[{l.sheet}]</span> <strong>{l.label}</strong> — {l.diffs.map((d) => `${d.field} ${d.before} → ${d.after}`).join(', ')}
                </li>
              ))}
              {lines.length > MAX_LINES && <li>…외 {lines.length - MAX_LINES}건</li>}
            </ul>
          )}
        </div>
      )}
    </>
  );
}
