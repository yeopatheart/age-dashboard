'use client';
import { useMemo, useRef } from 'react';
import { Toggle } from '@/components/admin/admin-kit';
import { SHARE_SAMPLE_CARDS, SHARE_SAMPLE_DATE, SHARE_SAMPLE_TERMINAL, buildLoadedListText } from '@/lib/scan-share-text';
import {
  SHARE_DATE_FORMATS,
  SHARE_SLOTS,
  SHARE_SLOT_LABEL,
  SHARE_VARIABLES,
  shareSlotError,
  type ScanShareTemplate,
  type ShareDateFormat,
  type ShareSlot,
} from '@/lib/scan-share-template';

// 시스템 설정의 "상차 완료 카카오톡 메시지" 카드: 상차 스캔에서 터미널별로 보내는 글의 형식을 문구 + {변수}로 정한다.
// 줄 네 개(첫 줄 / 업체별 줄 / 합계 줄 / 미상차 줄)를 따로 쓰고, 변수는 입력칸 아래 칩을 눌러 커서 위치에 넣는다.
export function ScanShareCard({ value, onChange, disabled }: { value: ScanShareTemplate; onChange: (next: ScanShareTemplate) => void; disabled: boolean }) {
  const inputs = useRef<Partial<Record<ShareSlot, HTMLInputElement | null>>>({});

  const preview = useMemo(() => buildLoadedListText(SHARE_SAMPLE_DATE, SHARE_SAMPLE_CARDS, SHARE_SAMPLE_TERMINAL, value) ?? '', [value]);
  const previewLines = preview ? preview.split('\n').length : 0;

  const setSlot = (slot: ShareSlot, text: string) => onChange({ ...value, [slot]: text });
  const insertVariable = (slot: ShareSlot, name: string) => {
    const el = inputs.current[slot];
    const token = `{${name}}`;
    const text = value[slot];
    const start = el?.selectionStart ?? text.length;
    const end = el?.selectionEnd ?? start;
    setSlot(slot, text.slice(0, start) + token + text.slice(end));
    // 값이 바뀐 뒤 칩 대신 입력칸으로 커서를 돌려 이어서 쓸 수 있게 한다.
    window.requestAnimationFrame(() => {
      el?.focus();
      el?.setSelectionRange(start + token.length, start + token.length);
    });
  };

  return (
    <section className="st-card">
      <h2 className="st-title">상차 완료 카카오톡 메시지</h2>
      <p className="st-desc">
        상차 스캔에서 터미널별로 보내는 글의 형식입니다. 문구 사이에 {'{변수}'}를 넣으면 보낼 때 실제 값(날짜·터미널·고객사·박스 수 등)으로 바뀝니다. 줄을 비우면 그 줄은 글에서 빠집니다. 모든 터미널이 같은 형식을 쓰고, {'{터미널명}'}으로 터미널마다 다르게 나옵니다.
      </p>

      {SHARE_SLOTS.map((slot) => {
        const error = shareSlotError(slot, value[slot]);
        return (
          <div key={slot} className="ak-field ss-slot">
            <span>{SHARE_SLOT_LABEL[slot]}</span>
            <input
              ref={(el) => {
                inputs.current[slot] = el;
              }}
              className="ak-input"
              value={value[slot]}
              onChange={(e) => setSlot(slot, e.target.value)}
              disabled={disabled}
              aria-invalid={!!error}
              spellCheck={false}
            />
            <div className="ss-vars" role="group" aria-label={`${SHARE_SLOT_LABEL[slot]}에 넣을 변수`}>
              {SHARE_VARIABLES[slot].map((v) => (
                <button key={v.name} type="button" className="ss-chip" disabled={disabled} title={v.hint} onClick={() => insertVariable(slot, v.name)}>
                  {`{${v.name}}`}
                </button>
              ))}
            </div>
            {error && <small className="ak-error">{error}</small>}
          </div>
        );
      })}

      <div className="st-grid">
        <label className="ak-field">
          <span>날짜 형식</span>
          <select className="ak-input" value={value.dateFormat} disabled={disabled} onChange={(e) => onChange({ ...value, dateFormat: e.target.value as ShareDateFormat })}>
            {SHARE_DATE_FORMATS.map((f) => (
              <option key={f.key} value={f.key}>{f.label}</option>
            ))}
          </select>
          <small>{'{날짜}'}가 이 모양으로 나옵니다.</small>
        </label>
        <div className="ak-field">
          <span>미상차 줄</span>
          <div className="st-row">
            <Toggle checked={value.showPending} onChange={(showPending) => onChange({ ...value, showPending })} label="미상차 줄 넣기" />
            <span>{value.showPending ? '미상차가 있으면 마지막 줄에 넣습니다' : '넣지 않습니다'}</span>
          </div>
        </div>
      </div>

      <div className="st-try">
        <span className="ak-field-label">미리보기 (예시 데이터: 대구 터미널)</span>
        <pre className="ss-preview">{preview}</pre>
        <small>
          {previewLines}줄 · 글 끝에 줄바꿈 없음 ✓ — 앱이 만드는 글에는 끝 줄바꿈이 없습니다. 카카오톡에서 끝에 빈 줄이 보이면 공유 화면을 거치며 붙는 것일 수 있습니다.
        </small>
      </div>

      <style>{`
        .ss-slot { gap: 0.4rem; }
        .ss-vars { display: flex; flex-wrap: wrap; gap: 0.35rem; }
        .ss-chip { height: var(--chip-h, 2rem); padding: 0 0.7rem; border-radius: 999px; border: 1px solid var(--primary); background: #fff; color: var(--primary); font-size: var(--fs-sm); font-weight: 700; cursor: pointer; }
        .ss-chip:hover:not(:disabled) { background: var(--primary-light); }
        .ss-chip:disabled { opacity: 0.5; cursor: not-allowed; }
        .ss-preview { margin: 0; padding: 0.7rem 0.85rem; background: #fff; border: 1px solid var(--border); border-radius: 10px; font-family: inherit; font-size: var(--fs-md); line-height: 1.5; white-space: pre-wrap; overflow-wrap: anywhere; }
      `}</style>
    </section>
  );
}
