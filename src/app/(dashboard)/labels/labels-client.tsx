'use client';
import '@/components/admin/admin.css';
import { useRef, useState } from 'react';
import { Barcode, Minus, Plus, Printer, RotateCcw, Trash2 } from 'lucide-react';
import { AdminHeader } from '@/components/admin/admin-kit';
import { LabelView } from '@/components/labels/label-view';
import { LabelPrinter, type LabelPrintJob } from '@/components/labels/label-printer';
import {
  DEFAULT_TEMPLATES,
  ELEMENT_TYPE_NAMES,
  LABEL_FIELDS,
  LABEL_KIND_NAMES,
  SAMPLE_LABEL_DATA,
  type LabelElement,
  type LabelElementType,
  type LabelField,
  type LabelKind,
  type LabelTemplate,
} from '@/lib/labels/template';
import { saveLabelTemplate } from './actions';
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

export function LabelsClient({ initial, company, contact }: { initial: Record<LabelKind, LabelTemplate>; company: string; contact: string }) {
  const canEdit = useCan()('labels:edit');
  const [templates, setTemplates] = useState(initial);
  const [kind, setKind] = useState<LabelKind>('top');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [dirty, setDirty] = useState<Record<LabelKind, boolean>>({ top: false, side: false });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [printJob, setPrintJob] = useState<LabelPrintJob | null>(null);
  const drag = useRef<DragState | null>(null);

  const template = templates[kind];
  const selected = template.elements.find((e) => e.id === selectedId) ?? null;
  const sample = { ...SAMPLE_LABEL_DATA, company: company || SAMPLE_LABEL_DATA.company, contact: contact || SAMPLE_LABEL_DATA.contact };

  const updateTemplate = (fn: (t: LabelTemplate) => LabelTemplate) => {
    setTemplates((prev) => ({ ...prev, [kind]: fn(prev[kind]) }));
    setDirty((d) => ({ ...d, [kind]: true }));
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
    const result = await saveLabelTemplate(template);
    setBusy(false);
    if (result.error) return setError(result.error);
    setTemplates((prev) => ({ ...prev, [kind]: result.template }));
    setDirty((d) => ({ ...d, [kind]: false }));
    setNotice(`${LABEL_KIND_NAMES[kind]} 디자인을 저장했습니다.`);
  };
  const resetToDefault = () => {
    updateTemplate(() => DEFAULT_TEMPLATES[kind]);
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
      <AdminHeader icon={<Barcode size={20} />} title="라벨 설정" sub="박스 뚜껑 상단·측면 라벨의 크기와 항목 배치를 정합니다. 항목을 끌어서 옮기고 모서리를 끌어 크기를 바꿉니다." />

      <div className="ak-toolbar">
        {(['top', 'side'] as const).map((k) => (
          <button key={k} className={`ak-btn ${kind === k ? 'ak-btn-primary' : ''}`} onClick={() => { setKind(k); setSelectedId(null); setError(null); setNotice(null); }}>
            {LABEL_KIND_NAMES[k]}{dirty[k] ? ' ●' : ''}
          </button>
        ))}
        <span className="ak-spacer" />
        {error && <span className="ak-error">{error}</span>}
        {notice && <span className="ak-notice">{notice}</span>}
        <button className="ak-btn" onClick={resetToDefault} disabled={busy}><RotateCcw size={14} /> 기본 배치로</button>
        <button className="ak-btn" onClick={() => setPrintJob({ template, labels: [sample] })} disabled={busy} title="지금 화면의 디자인을 샘플 값으로 한 장 출력합니다. 용지 크기와 위치를 확인할 때 씁니다.">
          <Printer size={14} /> 테스트 출력
        </button>
        <button className="ak-btn ak-btn-primary" onClick={save} disabled={!canEdit || busy || !dirty[kind]}>저장</button>
      </div>

      <div className="lb-layout">
        <div className="lb-side">
          <section className="lb-card">
            <h3>라벨 크기 (mm)</h3>
            <div className="lb-size">
              {numberInput('가로', template.widthMm, (v) => updateTemplate((t) => ({ ...t, widthMm: clamp(v, 20, 300) })), 1)}
              <Minus size={12} className="lb-x" />
              {numberInput('세로', template.heightMm, (v) => updateTemplate((t) => ({ ...t, heightMm: clamp(v, 10, 300) })), 1)}
            </div>
            <p className="ak-muted">프린터 용지 크기와 같아야 합니다. 크기를 줄이면 밖으로 나간 항목은 잘리니 위치를 다시 맞춰주세요.</p>
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
            <div className="lb-overlay">
              {template.elements.map((el) => {
                const isSel = el.id === selectedId;
                const hit = Math.max(el.h * SCALE, 8);
                return (
                  <div
                    key={el.id}
                    className={`lb-hit ${isSel ? 'lb-hit-on' : ''}`}
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
          <p className="ak-muted lb-hint">미리보기는 샘플 값(스시고유, 박스 2번 등)입니다. 실제 라벨은 고객사 값으로 채워집니다. 눈금은 5mm입니다.</p>
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
        .lb-handle { position: absolute; width: 10px; height: 10px; background: #fff; border: 1.5px solid #2563eb; border-radius: 2px; pointer-events: auto; touch-action: none; }
        .lb-hint { margin: 0.75rem 0 0; text-align: center; }
        @media (max-width: 1000px) { .lb-layout { grid-template-columns: 1fr; } }
      `}</style>
    </div>
  );
}
