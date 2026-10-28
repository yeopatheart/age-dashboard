'use client';
import '@/components/admin/admin.css';
import { useRef, useState } from 'react';
import { Barcode, Plus, Printer, RotateCcw, Trash2 } from 'lucide-react';
import { AdminHeader } from '@/components/admin/admin-kit';
import { LabelView } from '@/components/labels/label-view';
import { LabelPrinter, type LabelPrintJob } from '@/components/labels/label-printer';
import {
  DEFAULT_TEMPLATE,
  ELEMENT_TYPE_NAMES,
  FOLD_KEEP_OUT_MM,
  LABEL_FIELDS,
  SAMPLE_LABEL_DATA,
  elementProblem,
  sideHeightMm,
  type LabelElement,
  type LabelElementType,
  type LabelField,
  type LabelTemplate,
} from '@/lib/labels/template';
import { saveLabelMargin, saveLabelTemplate } from './actions';
import { SilentPrintSetup } from './silent-print-setup';
import { useCan } from '@/components/permissions-context';

const SCALE = 4; // 화면에서 1mm를 4px로 그린다
const SNAP_MM = 0.5;
const MIN_SIZE_MM = 2;
const snap = (v: number) => Math.round(v / SNAP_MM) * SNAP_MM;
const clamp = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v));
type HandleDir = 'n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw';
const HANDLES: { dir: HandleDir; style: React.CSSProperties; cursor: string }[] = [
  { dir: 'nw', style: { left: -5, top: -5 }, cursor: 'nwse-resize' },
  { dir: 'n', style: { left: '50%', top: -5, marginLeft: -5 }, cursor: 'ns-resize' },
  { dir: 'ne', style: { right: -5, top: -5 }, cursor: 'nesw-resize' },
  { dir: 'e', style: { right: -5, top: '50%', marginTop: -5 }, cursor: 'ew-resize' },
  { dir: 'se', style: { right: -5, bottom: -5 }, cursor: 'nwse-resize' },
  { dir: 's', style: { left: '50%', bottom: -5, marginLeft: -5 }, cursor: 'ns-resize' },
  { dir: 'sw', style: { left: -5, bottom: -5 }, cursor: 'nesw-resize' },
  { dir: 'w', style: { left: -5, top: '50%', marginTop: -5 }, cursor: 'ew-resize' },
];

interface DragState {
  mode: 'move' | HandleDir;
  id: string;
  startX: number;
  startY: number;
  orig: LabelElement;
}

const newElement = (type: LabelElementType): LabelElement => {
  const id = `e-${Date.now().toString(36)}${Math.floor(Math.random() * 1000)}`;
  if (type === 'barcode') return { id, type, x: 5, y: 5, w: 60, h: 18, showText: true };
  if (type === 'line') return { id, type, x: 5, y: 5, w: 50, h: 0.4 };
  if (type === 'field') return { id, type, field: 'businessBox', x: 5, y: 5, w: 50, h: 10, fontSize: 18, bold: true, align: 'left' };
  return { id, type: 'text', text: '문구', x: 5, y: 5, w: 40, h: 8, fontSize: 14, bold: false, align: 'left' };
};

export function LabelsClient({ initial, company, contact, initialMarginMm }: { initial: LabelTemplate; company: string; contact: string; initialMarginMm: number }) {
  const canEdit = useCan()('labels:edit');
  const [template, setTemplate] = useState(initial);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [printJob, setPrintJob] = useState<LabelPrintJob | null>(null);
  // 프린터가 찍지 못하는 가장자리(mm). 빗금으로 보여주고, 여백에 걸친 항목에는 경고한다.
  const [marginMm, setMarginMm] = useState(initialMarginMm);
  const [marginDirty, setMarginDirty] = useState(false);
  const drag = useRef<DragState | null>(null);

  const selected = template.elements.find((e) => e.id === selectedId) ?? null;
  const sample = { ...SAMPLE_LABEL_DATA, company: company || SAMPLE_LABEL_DATA.company, contact: contact || SAMPLE_LABEL_DATA.contact };

  const updateTemplate = (fn: (t: LabelTemplate) => LabelTemplate) => {
    setTemplate((prev) => fn(prev));
    setDirty(true);
    setNotice(null);
  };
  const updateElement = (id: string, patch: Partial<LabelElement>) =>
    updateTemplate((t) => ({ ...t, elements: t.elements.map((e) => (e.id === id ? { ...e, ...patch } : e)) }));
  const removeElement = (id: string) => {
    updateTemplate((t) => ({ ...t, elements: t.elements.filter((e) => e.id !== id) }));
    setSelectedId(null);
  };
  const addElement = (type: LabelElementType) => {
    const el = newElement(type);
    updateTemplate((t) => ({ ...t, elements: [...t.elements, el] }));
    setSelectedId(el.id);
  };

  // ─── 끌어서 이동·크기 조절 ───────────────────────────────────────────────
  const startDrag = (e: React.PointerEvent<HTMLElement>, el: LabelElement, mode: DragState['mode']) => {
    e.preventDefault();
    e.stopPropagation();
    try {
      e.currentTarget.setPointerCapture(e.pointerId); // 포인터가 항목 밖으로 나가도 끌기를 이어간다
    } catch {
      // 캡처를 못 하는 환경이면 항목 위에서만 끌린다
    }
    setSelectedId(el.id);
    drag.current = { mode, id: el.id, startX: e.clientX, startY: e.clientY, orig: el };
  };
  const onDragMove = (e: React.PointerEvent<HTMLElement>) => {
    const d = drag.current;
    if (!d) return;
    const dx = (e.clientX - d.startX) / SCALE;
    const dy = (e.clientY - d.startY) / SCALE;
    const { x, y, w, h } = d.orig;
    const W = template.widthMm;
    const H = template.heightMm;
    let nx = x, ny = y, nw = w, nh = h;
    if (d.mode === 'move') {
      nx = clamp(snap(x + dx), 0, Math.max(0, W - w));
      ny = clamp(snap(y + dy), 0, Math.max(0, H - h));
    } else {
      const minW = d.orig.type === 'line' ? 0.2 : MIN_SIZE_MM;
      const minH = d.orig.type === 'line' ? 0.2 : MIN_SIZE_MM;
      if (d.mode.includes('e')) nw = clamp(snap(w + dx), minW, W - x);
      if (d.mode.includes('s')) nh = clamp(snap(h + dy), minH, H - y);
      if (d.mode.includes('w')) {
        const right = x + w;
        nx = clamp(snap(x + dx), 0, right - minW);
        nw = right - nx;
      }
      if (d.mode.includes('n')) {
        const bottom = y + h;
        ny = clamp(snap(y + dy), 0, bottom - minH);
        nh = bottom - ny;
      }
    }
    updateElement(d.id, { x: nx, y: ny, w: nw, h: nh });
  };
  const endDrag = () => {
    drag.current = null;
  };
  const onKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    const tag = (e.target as HTMLElement).tagName;
    if (!selected || tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
    const step = e.shiftKey ? 2 : SNAP_MM;
    const moves: Record<string, [number, number]> = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] };
    if (moves[e.key]) {
      e.preventDefault();
      const [dx, dy] = moves[e.key];
      updateElement(selected.id, { x: clamp(selected.x + dx, 0, template.widthMm - selected.w), y: clamp(selected.y + dy, 0, template.heightMm - selected.h) });
    } else if (e.key === 'Delete' || e.key === 'Backspace') {
      e.preventDefault();
      removeElement(selected.id);
    }
  };

  // ─── 저장·되돌리기·테스트 출력 ──────────────────────────────────────────────
  const save = async () => {
    setBusy(true);
    setError(null);
    // 이 라벨 디자인과 프린터 여백 중 바뀐 것만 저장한다.
    const [templateResult, marginResult] = await Promise.all([
      dirty ? saveLabelTemplate(template) : null,
      marginDirty ? saveLabelMargin(marginMm) : null,
    ]);
    setBusy(false);
    const failure = templateResult?.error ?? marginResult?.error;
    if (failure) return setError(failure);
    if (templateResult) {
      setTemplate(templateResult.template);
      setDirty(false);
    }
    if (marginResult) {
      setMarginMm(marginResult.marginMm);
      setMarginDirty(false);
    }
    setNotice('저장했습니다.');
  };
  // 쓸 수 없는 곳에 걸친 항목: 프린터 출력 여백(바깥 marginMm) / 접히는 선 주변 / 측면 폭 밖
  const problemOf = (el: LabelElement): { kind: 'margin' | 'fold' | 'side-width'; text: string } | null => {
    if (marginMm > 0 && (el.x < marginMm - 0.01 || el.y < marginMm - 0.01 || el.x + el.w > template.widthMm - marginMm + 0.01 || el.y + el.h > template.heightMm - marginMm + 0.01)) {
      return { kind: 'margin', text: `프린터 출력 여백(${marginMm}mm)에 걸쳐 있어 잘릴 수 있습니다. 점선 안쪽으로 옮겨주세요.` };
    }
    const p = elementProblem(el, template);
    if (p === 'fold') return { kind: 'fold', text: `접히는 선 주변(위아래 ${FOLD_KEEP_OUT_MM}mm)에 걸쳐 있습니다. 접히면 글자·바코드가 깨지니 이 구역을 비워 주세요.` };
    if (p === 'side-width') return { kind: 'side-width', text: '측면이 붙는 폭 밖에 걸쳐 있습니다. 측면 영역의 가운데 폭 안으로 옮겨주세요.' };
    return null;
  };
  const resetToDefault = () => {
    updateTemplate(() => DEFAULT_TEMPLATE);
    setSelectedId(null);
  };

  const numberInput = (label: string, value: number, onChange: (v: number) => void, step = SNAP_MM) => (
    <label className="lb-num">
      <span>{label}</span>
      <input type="number" step={step} value={Number.isFinite(value) ? value : 0} onChange={(e) => { const v = parseFloat(e.target.value); if (Number.isFinite(v)) onChange(v); }} />
    </label>
  );

  return (
    <div className="lb-root">
      <AdminHeader icon={<Barcode size={20} />} title="라벨 설정" sub="박스 뚜껑 모서리에 감아 붙이는 한 장짜리 라벨입니다. 위쪽은 뚜껑 위에, 아래쪽(측면)은 옆면으로 꺾어 붙입니다. 항목을 끌어서 옮기고 모서리를 끌어 크기를 바꿉니다." />

      <div className="ak-toolbar">
        <strong className="lb-title">박스 라벨 (상단 면 + 측면){dirty ? ' ●' : ''}</strong>
        <span className="ak-spacer" />
        {error && <span className="ak-error">{error}</span>}
        {notice && <span className="ak-notice">{notice}</span>}
        <button className="ak-btn" onClick={resetToDefault} disabled={busy}><RotateCcw size={14} /> 기본 배치로</button>
        <button className="ak-btn" onClick={() => setPrintJob({ template, labels: [sample] })} disabled={busy} title="지금 화면의 디자인을 샘플 값으로 한 장 출력합니다. 용지 크기와 위치를 확인할 때 씁니다.">
          <Printer size={14} /> 테스트 출력
        </button>
        <button className="ak-btn ak-btn-primary" onClick={save} disabled={!canEdit || busy || !(dirty || marginDirty)}>저장</button>
      </div>

      <div className="lb-layout">
        <div className="lb-side">
          <section className="lb-card">
            <h3>라벨 크기 (mm)</h3>
            <div className="lb-grid">
              {numberInput('가로', template.widthMm, (v) => updateTemplate((t) => { const widthMm = clamp(v, 20, 300); return { ...t, widthMm, sideWidthMm: Math.min(t.sideWidthMm, widthMm) }; }), 1)}
              {numberInput('상단 면 높이', template.topHeightMm, (v) => updateTemplate((t) => ({ ...t, topHeightMm: clamp(v, 10, 300), heightMm: clamp(v, 10, 300) + sideHeightMm(t) })), 1)}
              {numberInput('측면 높이', sideHeightMm(template), (v) => updateTemplate((t) => ({ ...t, heightMm: t.topHeightMm + clamp(v, 8, 300) })), 1)}
              {numberInput('측면 가로(옆면 폭)', template.sideWidthMm, (v) => updateTemplate((t) => ({ ...t, sideWidthMm: clamp(v, 10, t.widthMm) })), 1)}
            </div>
            <p className="ak-muted">전체 {template.widthMm}×{template.heightMm}mm = 프린터 용지(롤) 크기와 같아야 합니다. 상단 면과 측면 사이의 선이 접히는 곳이고, 그 위아래 {FOLD_KEEP_OUT_MM}mm에는 글자·바코드를 두지 않습니다. 측면 가로는 옆면이 라벨보다 좁을 때만 줄입니다(가운데 폭만 씁니다).</p>
          </section>

          <section className="lb-card">
            <h3>프린터 출력 여백 (mm)</h3>
            <div className="lb-size">
              {numberInput('가장자리 여백', marginMm, (v) => { setMarginMm(Math.min(10, Math.max(0, v))); setMarginDirty(true); setNotice(null); }, 0.5)}
            </div>
            <p className="ak-muted">프린터는 용지 가장자리를 찍지 못합니다. 라벨에서 빗금으로 표시된 바깥 영역은 출력되지 않으니, 점선 안쪽에 항목을 두세요. 여백에 걸친 항목은 빨간 점선으로 표시됩니다. 프린터마다 달라서 테스트 출력으로 확인해 맞추세요(보통 1~3mm).</p>
          </section>

          <section className="lb-card">
            <SilentPrintSetup sizeText={`${template.widthMm}×${template.heightMm}mm`} />
          </section>

          <section className="lb-card">
            <h3>항목 추가</h3>
            <div className="lb-add">
              {(Object.keys(ELEMENT_TYPE_NAMES) as LabelElementType[]).map((type) => (
                <button key={type} className="ak-btn" onClick={() => addElement(type)}><Plus size={13} /> {ELEMENT_TYPE_NAMES[type]}</button>
              ))}
            </div>
          </section>

          <section className="lb-card">
            <h3>선택한 항목</h3>
            {!selected ? (
              <p className="ak-muted">라벨 위의 항목을 눌러 선택하세요. 방향키로 0.5mm씩(Shift는 2mm) 움직이고 Delete로 지웁니다.</p>
            ) : (
              <div className="lb-props">
                {problemOf(selected) && <p className="lb-warn">{problemOf(selected)?.text}</p>}
                <div className="lb-row"><strong>{ELEMENT_TYPE_NAMES[selected.type]}</strong><span className="ak-spacer" /><button className="ak-btn ak-btn-danger" onClick={() => removeElement(selected.id)}><Trash2 size={13} /> 삭제</button></div>
                {selected.type === 'field' && (
                  <label className="lb-field">
                    <span>채울 값</span>
                    <select className="ak-select" value={selected.field} onChange={(e) => updateElement(selected.id, { field: e.target.value as LabelField })}>
                      {(Object.keys(LABEL_FIELDS) as LabelField[]).map((f) => <option key={f} value={f}>{LABEL_FIELDS[f]}</option>)}
                    </select>
                  </label>
                )}
                {selected.type === 'text' && (
                  <label className="lb-field">
                    <span>문구</span>
                    <textarea className="ak-input" rows={2} value={selected.text ?? ''} onChange={(e) => updateElement(selected.id, { text: e.target.value })} />
                  </label>
                )}
                {(selected.type === 'text' || selected.type === 'field') && (
                  <>
                    <div className="lb-grid">
                      {numberInput('글자 크기(pt)', selected.fontSize ?? 12, (v) => updateElement(selected.id, { fontSize: clamp(v, 4, 120) }), 1)}
                      <label className="lb-check"><input type="checkbox" checked={selected.bold === true} onChange={(e) => updateElement(selected.id, { bold: e.target.checked })} /> 굵게</label>
                    </div>
                    <div className="lb-align">
                      {(['left', 'center', 'right'] as const).map((a) => (
                        <button key={a} className={`ak-btn ${(selected.align ?? 'left') === a ? 'ak-btn-primary' : ''}`} onClick={() => updateElement(selected.id, { align: a })}>{a === 'left' ? '왼쪽' : a === 'center' ? '가운데' : '오른쪽'}</button>
                      ))}
                    </div>
                  </>
                )}
                {selected.type === 'barcode' && (
                  <label className="lb-check"><input type="checkbox" checked={selected.showText !== false} onChange={(e) => updateElement(selected.id, { showText: e.target.checked })} /> 바코드 아래에 숫자도 찍기</label>
                )}
                <div className="lb-grid">
                  {numberInput('가로 위치', selected.x, (v) => updateElement(selected.id, { x: clamp(v, 0, template.widthMm - selected.w) }))}
                  {numberInput('세로 위치', selected.y, (v) => updateElement(selected.id, { y: clamp(v, 0, template.heightMm - selected.h) }))}
                  {numberInput('너비', selected.w, (v) => updateElement(selected.id, { w: clamp(v, 0.2, template.widthMm - selected.x) }))}
                  {numberInput('높이', selected.h, (v) => updateElement(selected.id, { h: clamp(v, 0.2, template.heightMm - selected.y) }))}
                </div>
              </div>
            )}
          </section>
        </div>

        <div className="lb-stage" tabIndex={0} onKeyDown={onKeyDown} onPointerDown={() => setSelectedId(null)}>
          <div className="lb-paper" style={{ width: template.widthMm * SCALE, height: template.heightMm * SCALE }}>
            <LabelView template={template} data={sample} unit={`${SCALE}px`} />
            {marginMm > 0 && (
              <div className="lb-margin" aria-hidden>
                <span style={{ left: 0, top: 0, right: 0, height: marginMm * SCALE }} />
                <span style={{ left: 0, bottom: 0, right: 0, height: marginMm * SCALE }} />
                <span style={{ left: 0, top: marginMm * SCALE, bottom: marginMm * SCALE, width: marginMm * SCALE }} />
                <span style={{ right: 0, top: marginMm * SCALE, bottom: marginMm * SCALE, width: marginMm * SCALE }} />
                <i style={{ left: marginMm * SCALE, top: marginMm * SCALE, right: marginMm * SCALE, bottom: marginMm * SCALE }} />
              </div>
            )}
            <div className="lb-fold" aria-hidden>
              {/* 접히는 선과 비워 둘 구역(양쪽 FOLD_KEEP_OUT_MM). 띠 안의 글자는 어느 쪽이 뚜껑 위이고 어느 쪽이 옆면인지 알려 준다. */}
              <div className="lb-fold-band" style={{ top: (template.topHeightMm - FOLD_KEEP_OUT_MM) * SCALE, height: FOLD_KEEP_OUT_MM * 2 * SCALE }}>
                <span>▲ 상단 면 (뚜껑 위)</span>
                <span>측면 (옆면으로 꺾음) ▼</span>
              </div>
              <div className="lb-fold-line" style={{ top: template.topHeightMm * SCALE }} />
              {template.sideWidthMm < template.widthMm && (
                <>
                  <div className="lb-side-off" style={{ left: 0, width: ((template.widthMm - template.sideWidthMm) / 2) * SCALE, top: template.topHeightMm * SCALE, bottom: 0 }} />
                  <div className="lb-side-off" style={{ right: 0, width: ((template.widthMm - template.sideWidthMm) / 2) * SCALE, top: template.topHeightMm * SCALE, bottom: 0 }} />
                </>
              )}
            </div>
            <div className="lb-overlay">
              {template.elements.map((el) => {
                const isSel = el.id === selectedId;
                const outside = !!problemOf(el);
                const hit = Math.max(el.h * SCALE, 8);
                return (
                  <div
                    key={el.id}
                    className={`lb-hit ${isSel ? 'lb-hit-on' : ''} ${outside ? 'lb-hit-out' : ''}`}
                    style={{ left: el.x * SCALE, top: el.y * SCALE - (hit - el.h * SCALE) / 2, width: el.w * SCALE, height: hit }}
                    onPointerDown={(e) => startDrag(e, el, 'move')}
                    onPointerMove={onDragMove}
                    onPointerUp={endDrag}
                    onPointerCancel={endDrag}
                    title={ELEMENT_TYPE_NAMES[el.type]}
                  >
                    {isSel && (
                      <div className="lb-frame" style={{ top: (hit - el.h * SCALE) / 2, height: el.h * SCALE }}>
                        {HANDLES.map((hd) => (
                          <span
                            key={hd.dir}
                            className="lb-handle"
                            style={{ ...hd.style, cursor: hd.cursor }}
                            onPointerDown={(e) => startDrag(e, el, hd.dir)}
                            onPointerMove={onDragMove}
                            onPointerUp={endDrag}
                            onPointerCancel={endDrag}
                          />
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
          <p className="ak-muted lb-hint">미리보기는 샘플 값(스시고유 #2 등)입니다. 실제 라벨은 고객사 값으로 채워지고, 글자가 칸보다 길면 크기가 자동으로 줄어듭니다. 눈금은 5mm, 빨간 빗금은 프린터가 찍지 못하는 여백, 파란 띠는 접히는 선 주변(비워 둘 구역)입니다.</p>
        </div>
      </div>

      <LabelPrinter job={printJob} onDone={() => setPrintJob(null)} />

      <style>{`
        .lb-root { display: flex; flex-direction: column; gap: 0.9rem; min-width: 0; }
        .lb-layout { display: grid; grid-template-columns: 22rem minmax(0, 1fr); gap: 0.9rem; align-items: start; }
        .lb-side { display: flex; flex-direction: column; gap: 0.75rem; }
        .lb-card { background: #fff; border: 1px solid var(--border); border-radius: var(--radius-lg); padding: 0.85rem 1rem; display: flex; flex-direction: column; gap: 0.6rem; box-shadow: var(--shadow-sm); }
        .lb-card h3 { font-size: 0.8125rem; font-weight: 800; color: var(--muted-foreground); }
        .lb-size { display: flex; align-items: flex-end; gap: 0.5rem; }
        .lb-x { color: var(--muted-foreground); margin-bottom: 0.7rem; }
        .lb-add { display: flex; flex-wrap: wrap; gap: 0.4rem; }
        .lb-props { display: flex; flex-direction: column; gap: 0.6rem; }
        .lb-row { display: flex; align-items: center; gap: 0.5rem; }
        .lb-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 0.5rem; align-items: end; }
        .lb-field { display: flex; flex-direction: column; gap: 0.25rem; font-size: 0.75rem; font-weight: 700; color: var(--muted-foreground); }
        .lb-num { display: flex; flex-direction: column; gap: 0.2rem; font-size: 0.75rem; font-weight: 700; color: var(--muted-foreground); }
        .lb-num input { height: 2.25rem; border: 1px solid var(--border); border-radius: 8px; padding: 0 0.5rem; font-size: 0.875rem; font-weight: 700; width: 100%; background: #fff; color: var(--foreground); }
        .lb-check { display: flex; align-items: center; gap: 0.4rem; font-size: 0.8125rem; font-weight: 700; }
        .lb-align { display: flex; gap: 0.35rem; }
        .lb-stage { background: #eef2f6; border: 1px solid var(--border); border-radius: var(--radius-lg); padding: 1.25rem; overflow: auto; outline: none; min-height: 20rem; }
        .lb-paper { position: relative; margin: 0 auto; background-color: #fff; box-shadow: 0 2px 10px rgba(15, 23, 42, 0.25);
          background-image: linear-gradient(to right, rgba(148, 163, 184, 0.28) 1px, transparent 1px), linear-gradient(to bottom, rgba(148, 163, 184, 0.28) 1px, transparent 1px);
          background-size: 20px 20px; }
        .lb-overlay { position: absolute; inset: 0; }
        .lb-hit { position: absolute; cursor: move; touch-action: none; }
        .lb-hit:hover { outline: 1px dashed #3b82f6; }
        .lb-hit-on { outline: 1px solid #2563eb; }
        .lb-frame { position: absolute; left: 0; right: 0; pointer-events: none; }
        .lb-title { font-size: 0.9375rem; font-weight: 800; }
        .lb-fold { position: absolute; inset: 0; pointer-events: none; }
        .lb-fold-band { position: absolute; left: 0; right: 0; background: rgba(37, 99, 235, 0.09); border-top: 1px solid rgba(37, 99, 235, 0.25); border-bottom: 1px solid rgba(37, 99, 235, 0.25); display: flex; align-items: center; justify-content: space-between; padding: 0 6px; font-size: 10px; font-weight: 800; color: #1d4ed8; white-space: nowrap; overflow: hidden; }
        .lb-fold-line { position: absolute; left: 0; right: 0; border-top: 1.5px dashed #2563eb; }
        .lb-side-off { position: absolute; background: repeating-linear-gradient(135deg, rgba(100, 116, 139, 0.28) 0 3px, rgba(100, 116, 139, 0.08) 3px 7px); }
        .lb-margin { position: absolute; inset: 0; pointer-events: none; }
        .lb-margin span { position: absolute; background: repeating-linear-gradient(45deg, rgba(239, 68, 68, 0.22) 0 3px, rgba(239, 68, 68, 0.06) 3px 7px); }
        .lb-margin i { position: absolute; border: 1px dashed rgba(220, 38, 38, 0.8); }
        .lb-hit-out { outline: 1px dashed #dc2626; background: rgba(239, 68, 68, 0.08); }
        .lb-guide summary { font-size: 0.8125rem; font-weight: 800; cursor: pointer; }
        .lb-guide ol { list-style: decimal; margin: 0.6rem 0; padding-left: 1.4rem; display: flex; flex-direction: column; gap: 0.45rem; font-size: 0.8125rem; line-height: 1.45; }
        .lb-shortcut { display: flex; flex-wrap: wrap; gap: 0.4rem; margin: 0.45rem 0; }
        .lb-guide code { background: #f1f5f9; border-radius: 6px; padding: 0.05rem 0.35rem; font-size: 0.78rem; }
        .lb-warn { font-size: 0.8125rem; font-weight: 700; color: #b91c1c; background: #fef2f2; border: 1px solid #fecaca; border-radius: 10px; padding: 0.45rem 0.65rem; }
        .lb-handle { position: absolute; width: 10px; height: 10px; background: #fff; border: 1.5px solid #2563eb; border-radius: 2px; pointer-events: auto; touch-action: none; }
        .lb-hint { margin: 0.75rem 0 0; text-align: center; }
        @media (max-width: 1000px) { .lb-layout { grid-template-columns: 1fr; } }
      `}</style>
    </div>
  );
}
