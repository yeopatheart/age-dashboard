'use client';
import '@/components/admin/admin.css';
import { useMemo, useState } from 'react';
import { RotateCcw, Settings as SettingsIcon } from 'lucide-react';
import { AdminHeader, Toggle } from '@/components/admin/admin-kit';
import { DEFAULT_SETTINGS, type AppSettings } from '@/lib/app-settings';
import { describeSizeSpec, parseSizeSpec } from '@/lib/size-spec';
import { reapplySizeSpecs, saveSettings } from './actions';
import { useCan } from '@/components/permissions-context';

const toList = (text: string) => text.split(',').map((s) => s.trim()).filter(Boolean);

export function SettingsClient({ initial }: { initial: AppSettings }) {
  const canEdit = useCan()('settings:edit');
  const [form, setForm] = useState({
    sizeTolerancePct: String(initial.sizeTolerancePct),
    earlyRangeKg: String(initial.earlyRangeKg),
    perKgTolerancePct: String(initial.perKgTolerancePct),
    pendingKeywords: initial.pendingKeywords.join(', '),
    optionalKeywords: initial.optionalKeywords.join(', '),
    unshippedReasons: initial.unshippedReasons.join(', '),
    companyName: initial.companyName,
    contactPhone: initial.contactPhone,
  });
  const [allowPast, setAllowPast] = useState(initial.allowPastOrderEdit);
  const [sample, setSample] = useState('2.5kg내외, 피빼기');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const draft: AppSettings = useMemo(
    () => ({
      sizeTolerancePct: parseFloat(form.sizeTolerancePct),
      earlyRangeKg: parseFloat(form.earlyRangeKg),
      perKgTolerancePct: parseFloat(form.perKgTolerancePct),
      pendingKeywords: toList(form.pendingKeywords),
      optionalKeywords: toList(form.optionalKeywords),
      unshippedReasons: toList(form.unshippedReasons),
      allowPastOrderEdit: allowPast,
      companyName: form.companyName.trim(),
      contactPhone: form.contactPhone.trim(),
    }),
    [form, allowPast],
  );
  // 입력한 값이 숫자가 아니면 미리보기에는 기본값을 쓴다(저장할 때는 서버가 같은 규칙으로 걸러낸다).
  const previewCfg: AppSettings = {
    ...draft,
    sizeTolerancePct: Number.isFinite(draft.sizeTolerancePct) ? draft.sizeTolerancePct : DEFAULT_SETTINGS.sizeTolerancePct,
    earlyRangeKg: Number.isFinite(draft.earlyRangeKg) ? draft.earlyRangeKg : DEFAULT_SETTINGS.earlyRangeKg,
    perKgTolerancePct: Number.isFinite(draft.perKgTolerancePct) ? draft.perKgTolerancePct : DEFAULT_SETTINGS.perKgTolerancePct,
  };
  const spec = parseSizeSpec(sample, previewCfg);
  const described = describeSizeSpec(spec);

  const set = (key: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) => setForm((f) => ({ ...f, [key]: e.target.value }));
  const numbersValid = [draft.sizeTolerancePct, draft.earlyRangeKg, draft.perKgTolerancePct].every((n) => Number.isFinite(n) && n >= 0);

  const save = async () => {
    setBusy(true);
    setError(null);
    setNotice(null);
    const result = await saveSettings(draft);
    setBusy(false);
    if (result.error) return setError(result.error);
    setNotice('설정을 저장했습니다. 새로 입력하는 주문부터 적용됩니다.');
  };
  const reset = () => {
    setForm({
      sizeTolerancePct: String(DEFAULT_SETTINGS.sizeTolerancePct),
      earlyRangeKg: String(DEFAULT_SETTINGS.earlyRangeKg),
      perKgTolerancePct: String(DEFAULT_SETTINGS.perKgTolerancePct),
      pendingKeywords: DEFAULT_SETTINGS.pendingKeywords.join(', '),
      optionalKeywords: DEFAULT_SETTINGS.optionalKeywords.join(', '),
      unshippedReasons: DEFAULT_SETTINGS.unshippedReasons.join(', '),
      companyName: DEFAULT_SETTINGS.companyName,
      contactPhone: DEFAULT_SETTINGS.contactPhone,
    });
    setAllowPast(DEFAULT_SETTINGS.allowPastOrderEdit);
  };
  const reapply = async () => {
    setBusy(true);
    setError(null);
    setNotice(null);
    const result = await reapplySizeSpecs();
    setBusy(false);
    if (result.error) return setError(result.error);
    setNotice(`저장된 주문 ${result.updated}건의 요구사항 해석을 현재 설정으로 다시 계산했습니다.`);
  };

  return (
    <div className="ak-page">
      <AdminHeader icon={<SettingsIcon size={20} />} title="시스템 설정" sub="시스템이 쓰는 기준값입니다. 값을 바꾸고 저장하면 새로 입력하는 주문부터 적용됩니다." />

      <section className="st-card">
        <h2 className="st-title">요구사항 해석 기준</h2>
        <p className="st-desc">주문의 사이즈 표기(예: 2.5kg내외, 키로 3미)를 배분 계산에 쓸 중량 범위로 바꿀 때 쓰는 값입니다.</p>
        <div className="st-grid">
          <label className="ak-field">
            <span>&quot;내외&quot; 허용 오차 (±%)</span>
            <input className="ak-input" type="number" min="0" max="100" step="1" value={form.sizeTolerancePct} onChange={set('sizeTolerancePct')} />
            <small>2.5kg내외 → 2.5kg ± 이 비율</small>
          </label>
          <label className="ak-field">
            <span>&quot;초반&quot; 범위 폭 (kg)</span>
            <input className="ak-input" type="number" min="0" max="5" step="0.1" value={form.earlyRangeKg} onChange={set('earlyRangeKg')} />
            <small>3kg초반 → 3.0kg ~ 3.0kg + 이 값</small>
          </label>
          <label className="ak-field">
            <span>&quot;키로 N미&quot; 허용 오차 (±%)</span>
            <input className="ak-input" type="number" min="0" max="100" step="1" value={form.perKgTolerancePct} onChange={set('perKgTolerancePct')} />
            <small>키로 3미 → 마리당 333g ± 이 비율</small>
          </label>
        </div>
        <div className="st-try">
          <span className="ak-field-label">해석 시험</span>
          <input className="ak-input" value={sample} onChange={(e) => setSample(e.target.value)} placeholder="예: 4-600, 피빼기" />
          <div className="st-result">
            {described.map((d) => <span key={d} className="ak-tag ak-tag-order">{d}</span>)}
            {spec.grade && <span className="ak-tag ak-tag-manual">등급 {spec.grade}</span>}
            {spec.handling.map((h) => <span key={h} className="ak-tag ak-tag-manual">{h}</span>)}
            {spec.unparsed.map((u) => <span key={u} className="ak-tag ak-tag-off">해석 못 함: {u}</span>)}
            {described.length === 0 && !spec.grade && spec.handling.length === 0 && spec.unparsed.length === 0 && <span className="ak-muted">표기를 입력하면 해석 결과가 보입니다</span>}
          </div>
        </div>
      </section>

      <section className="st-card">
        <h2 className="st-title">주문 표기 키워드</h2>
        <p className="st-desc">쉼표(,)로 구분해서 입력합니다. 이 키워드는 사이즈 요구사항이 아니라 주문 상태로 해석됩니다.</p>
        <div className="st-grid">
          <label className="ak-field">
            <span>고객 확인 전(임시 주문)</span>
            <input className="ak-input" value={form.pendingKeywords} onChange={set('pendingKeywords')} />
            <small>예: 확인중 — 고객 확인 후 취소될 수 있는 주문. 형의 확정은 필요 없음</small>
          </label>
          <label className="ak-field">
            <span>확보되면 준비</span>
            <input className="ak-input" value={form.optionalKeywords} onChange={set('optionalKeywords')} />
            <small>예: 가능하면 — 상품이 확보되면 준비하는 주문</small>
          </label>
        </div>
      </section>

      <section className="st-card">
        <h2 className="st-title">미출고 사유</h2>
        <p className="st-desc">대시보드의 미출고 처리 팝업에 나오는 사유 선택지입니다(&quot;기타&quot;는 항상 추가됩니다).</p>
        <label className="ak-field">
          <input className="ak-input" value={form.unshippedReasons} onChange={set('unshippedReasons')} />
          <small>쉼표로 구분 — 예: 재고없음, 폐사, 품질불량</small>
        </label>
      </section>

      <section className="st-card">
        <h2 className="st-title">송장 라벨 정보</h2>
        <p className="st-desc">박스 라벨에 찍히는 상호와 연락처입니다. 라벨 설정 메뉴에서 라벨에 넣을 위치를 정합니다.</p>
        <div className="st-grid">
          <label className="ak-field">
            <span>상호</span>
            <input className="ak-input" value={form.companyName} onChange={set('companyName')} maxLength={60} />
          </label>
          <label className="ak-field">
            <span>연락처</span>
            <input className="ak-input" value={form.contactPhone} onChange={set('contactPhone')} maxLength={60} placeholder="예: 055-000-0000" inputMode="tel" />
          </label>
        </div>
      </section>

      <section className="st-card">
        <h2 className="st-title">과거 날짜 편집</h2>
        <p className="st-desc">켜면 오늘 이전 날짜의 주문도 오늘과 똑같이 입력·수정·취소·삭제할 수 있고, 박스 할당도 고칠 수 있습니다. 주문 입력 화면에는 날짜 선택칸이 생깁니다. 미래 날짜는 항상 막힙니다.</p>
        <div className="st-row">
          <Toggle checked={allowPast} onChange={setAllowPast} label="과거 날짜 편집 허용" />
          <span>{allowPast ? '허용 중 — 과거 날짜도 오늘처럼 편집할 수 있습니다' : '꺼짐 — 과거 날짜는 조회만 할 수 있습니다'}</span>
        </div>
      </section>

      <div className="st-actions">
        <button className="ak-btn" onClick={reset} disabled={busy}><RotateCcw size={14} /> 기본값으로</button>
        <button className="ak-btn" onClick={reapply} disabled={!canEdit || busy} title="이미 저장된 주문의 요구사항 해석을 현재 저장된 설정으로 다시 계산합니다">저장된 주문에 다시 적용</button>
        <span className="ak-spacer" />
        {error && <span className="ak-error">{error}</span>}
        {notice && <span className="ak-notice">{notice}</span>}
        <button className="ak-btn ak-btn-primary" onClick={save} disabled={!canEdit || busy || !numbersValid}>저장</button>
      </div>

      <style>{`
        .st-card { background: #fff; border: 1px solid var(--border); border-radius: var(--radius-lg); box-shadow: var(--shadow-sm); padding: 1.1rem 1.25rem; display: flex; flex-direction: column; gap: 0.75rem; }
        .st-title { font-size: 1rem; font-weight: 800; color: var(--primary); }
        .st-desc { font-size: 0.8125rem; color: var(--muted-foreground); }
        .st-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(14rem, 1fr)); gap: 0.9rem; }
        .st-card small { font-size: 0.75rem; color: var(--muted-foreground); }
        .st-try { display: flex; flex-direction: column; gap: 0.4rem; background: var(--muted); border-radius: 12px; padding: 0.75rem; }
        .st-result { display: flex; flex-wrap: wrap; gap: 0.4rem; min-height: 1.6rem; align-items: center; }
        .st-row { display: flex; align-items: center; gap: 0.75rem; font-size: 0.875rem; font-weight: 600; }
        .st-actions { display: flex; align-items: center; gap: 0.6rem; flex-wrap: wrap; }
      `}</style>
    </div>
  );
}
