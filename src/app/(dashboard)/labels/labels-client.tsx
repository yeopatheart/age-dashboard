'use client';
import '@/components/admin/admin.css';
import { useRef, useState } from 'react';
import { Barcode, Pencil, Plus, Printer, Trash2 } from 'lucide-react';
import { AdminHeader } from '@/components/admin/admin-kit';
import { LabelView } from '@/components/labels/label-view';
import { LabelPrinter, type LabelPrintJob } from '@/components/labels/label-printer';
import {
  ELEMENT_TYPE_NAMES,
  FOLD_KEEP_OUT_MM,
  LABEL_FIELDS,
  LABEL_PRESETS,
  SAMPLE_LABEL_DATA,
  elementProblem,
  foldOf,
  normalizeTemplate,
  type LabelElement,
  type LabelElementType,
  type LabelField,
  type LabelPresetKey,
  type LabelTemplate,
} from '@/lib/labels/template';
import type { LabelDesign } from '@/lib/labels/server';
import { activateLabelDesign, createLabelDesign, deleteLabelDesign, renameLabelDesign, saveLabelDesign, saveLabelMargin, saveLabelRotate } from './actions';
import { qrTestTemplate } from '@/lib/labels/qr-test';
import { PRINTER_DPI, qrModuleDots, qrModuleMm } from '@/lib/labels/qr';
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

const newElement = (type: LabelElementType, t: LabelTemplate): LabelElement => {
  const id = `e-${Date.now().toString(36)}${Math.floor(Math.random() * 1000)}`;
  if (type === 'fold') return { id, type, x: 0, y: Math.round((t.heightMm * 0.75) / SNAP_MM) * SNAP_MM, w: t.widthMm, h: 0 };
  if (type === 'barcode') return { id, type, x: 5, y: 5, w: 21, h: 21 };
  if (type === 'line') return { id, type, x: 5, y: 5, w: 50, h: 0.4 };
  if (type === 'field') return { id, type, field: 'businessBox', x: 5, y: 5, w: 50, h: 10, fontSize: 18, bold: true, align: 'left' };
  return { id, type: 'text', text: '문구', x: 5, y: 5, w: 40, h: 8, fontSize: 14, bold: false, align: 'left' };
};

export function LabelsClient({ initialDesigns, initialActiveId, company, contact, initialMarginMm, initialRotate }: { initialDesigns: LabelDesign[]; initialActiveId: string | null; company: string; contact: string; initialMarginMm: number; initialRotate: boolean }) {
  const canEdit = useCan()('labels:edit');
  // 디자인 보관함: 저장된 디자인 목록, 사용 중(출력에 쓰는) 디자인, 지금 편집 중인 디자인
  const [designs, setDesigns] = useState(initialDesigns);
  const [activeId, setActiveId] = useState(initialActiveId);
  const [currentId, setCurrentId] = useState<string | null>(initialActiveId ?? initialDesigns[0]?.id ?? null);
  const current = designs.find((d) => d.id === currentId) ?? null;
  const [creating, setCreating] = useState(initialDesigns.length === 0);
  const [newName, setNewName] = useState('');
  const [newFrom, setNewFrom] = useState<string>(`preset:${LABEL_PRESETS[0].key}`);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [template, setTemplate] = useState<LabelTemplate>((initialDesigns.find((d) => d.id === (initialActiveId ?? initialDesigns[0]?.id)) ?? { template: LABEL_PRESETS[0].template }).template);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [printJob, setPrintJob] = useState<LabelPrintJob | null>(null);
  // 프린터가 찍지 못하는 가장자리(mm). 빗금으로 보여주고, 여백에 걸친 항목에는 경고한다.
  const [marginMm, setMarginMm] = useState(initialMarginMm);
  const [marginDirty, setMarginDirty] = useState(false);
  // 롤 방향에 맞춰 90도 돌려 출력(프린터 용지는 높이×가로가 된다). 프린터 설정이라 라벨 디자인과 따로 저장한다.
  const [rotate, setRotate] = useState(initialRotate);
  const [rotateDirty, setRotateDirty] = useState(false);
  const paperText = rotate ? `${template.heightMm}×${template.widthMm}mm` : `${template.widthMm}×${template.heightMm}mm`;
  const drag = useRef<DragState | null>(null);

  const selected = template.elements.find((e) => e.id === selectedId) ?? null;
  const fold = foldOf(template);
  const sample = { ...SAMPLE_LABEL_DATA, company: company || SAMPLE_LABEL_DATA.company, contact: contact || SAMPLE_LABEL_DATA.contact };

  const updateTemplate = (fn: (t: LabelTemplate) => LabelTemplate) => {
    setTemplate((prev) => fn(prev));
    setDirty(true);
    setNotice(null);
  };
  const updateElement = (id: string, patch: Partial<LabelElement>) =>
    updateTemplate((t) => normalizeTemplate({ ...t, elements: t.elements.map((e) => (e.id === id ? { ...e, ...patch } : e)) }));
  const removeElement = (id: string) => {
    updateTemplate((t) => ({ ...t, elements: t.elements.filter((e) => e.id !== id) }));
    setSelectedId(null);
  };
  const addElement = (type: LabelElementType) => {
    if (type === 'fold' && fold) return; // 접는선은 한 디자인에 하나
    const el = newElement(type, template);
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
    if (d.mode === 'move' && d.orig.type === 'fold') {
      ny = clamp(snap(y + dy), 10, Math.max(10, H - 8)); // 접는선은 위아래로만 움직인다
    } else if (d.mode === 'move') {
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
      updateElement(selected.id, selected.type === 'fold' ? { y: selected.y + dy } : { x: clamp(selected.x + dx, 0, template.widthMm - selected.w), y: clamp(selected.y + dy, 0, template.heightMm - selected.h) });
    } else if (e.key === 'Delete' || e.key === 'Backspace') {
      e.preventDefault();
      removeElement(selected.id);
    }
  };

  // ─── 저장·테스트 출력 ──────────────────────────────────────────────────────
  const save = async () => {
    if (!currentId) return;
    setBusy(true);
    setError(null);
    // 이 디자인과 프린터 설정(여백·방향) 중 바뀐 것만 저장한다.
    const [templateResult, marginResult, rotateResult] = await Promise.all([
      dirty ? saveLabelDesign(currentId, template) : null,
      marginDirty ? saveLabelMargin(marginMm) : null,
      rotateDirty ? saveLabelRotate(rotate) : null,
    ]);
    setBusy(false);
    const failure = templateResult?.error ?? marginResult?.error ?? rotateResult?.error;
    if (failure) return setError(failure);
    if (templateResult) {
      setTemplate(templateResult.template);
      setDesigns((list) => list.map((d) => (d.id === currentId ? { ...d, template: templateResult.template } : d)));
      setDirty(false);
    }
    if (marginResult) {
      setMarginMm(marginResult.marginMm);
      setMarginDirty(false);
    }
    if (rotateResult) {
      setRotate(rotateResult.rotate);
      setRotateDirty(false);
    }
    setNotice('저장했습니다.');
  };

  // ─── 디자인 보관함: 고르기·새로 만들기·이름 바꾸기·삭제·사용 중 지정 ───────────────────
  const confirmDiscard = () => !dirty || window.confirm('저장하지 않은 변경이 있습니다. 버리고 계속할까요?');
  const openDesign = (design: LabelDesign) => {
    setCurrentId(design.id);
    setTemplate(design.template);
    setDirty(false);
    setSelectedId(null);
    setRenaming(null);
    setNotice(null);
    setError(null);
  };
  const selectDesign = (id: string) => {
    const design = designs.find((d) => d.id === id);
    if (!design || id === currentId || !confirmDiscard()) return;
    openDesign(design);
  };
  const createDesign = async () => {
    if (!confirmDiscard()) return;
    const from = newFrom.startsWith('copy:') ? ({ kind: 'copy', id: newFrom.slice(5) } as const) : ({ kind: 'preset', key: newFrom.slice(7) as LabelPresetKey } as const);
    setBusy(true);
    setError(null);
    const res = await createLabelDesign({ name: newName, from });
    setBusy(false);
    if (res.error || !res.design) return setError(res.error ?? '디자인을 만들지 못했습니다.');
    const design = res.design;
    setDesigns((list) => [...list, design]);
    setActiveId(res.activeId);
    openDesign(design);
    setCreating(false);
    setNewName('');
    setNotice(`"${design.name}" 디자인을 만들었습니다.`);
  };
  const renameDesign = async () => {
    if (!current || renaming === null) return;
    setBusy(true);
    setError(null);
    const res = await renameLabelDesign(current.id, renaming);
    setBusy(false);
    if (res.error) return setError(res.error);
    setDesigns((list) => list.map((d) => (d.id === current.id ? { ...d, name: res.name } : d)));
    setRenaming(null);
  };
  const removeDesign = async () => {
    if (!current || !window.confirm(`"${current.name}" 디자인을 지울까요? 되돌릴 수 없습니다.`)) return;
    setBusy(true);
    setError(null);
    const res = await deleteLabelDesign(current.id);
    setBusy(false);
    if (res.error) return setError(res.error);
    const rest = designs.filter((d) => d.id !== current.id);
    setDesigns(rest);
    const next = rest.find((d) => d.id === activeId) ?? rest[0];
    if (next) openDesign(next);
    setNotice('디자인을 지웠습니다.');
  };
  const useDesign = async () => {
    if (!current) return;
    setBusy(true);
    setError(null);
    const res = await activateLabelDesign(current.id);
    setBusy(false);
    if (res.error) return setError(res.error);
    setActiveId(current.id);
    setNotice(`"${current.name}" 디자인을 사용합니다. 이제 박스 라벨은 이 디자인으로 출력됩니다.`);
  };
  // 쓸 수 없는 곳에 걸친 항목: 프린터 출력 여백(바깥 marginMm) / 접히는 선 주변 / 측면 폭 밖
  const problemOf = (el: LabelElement): { kind: 'margin' | 'fold' | 'side-width'; text: string } | null => {
    if (el.type === 'fold') return null;
    if (marginMm > 0 && (el.x < marginMm - 0.01 || el.y < marginMm - 0.01 || el.x + el.w > template.widthMm - marginMm + 0.01 || el.y + el.h > template.heightMm - marginMm + 0.01)) {
      return { kind: 'margin', text: `프린터 출력 여백(${marginMm}mm)에 걸쳐 있어 잘릴 수 있습니다. 점선 안쪽으로 옮겨주세요.` };
    }
    const p = elementProblem(el, template);
    if (p === 'fold') return { kind: 'fold', text: `접히는 선 주변(위아래 ${FOLD_KEEP_OUT_MM}mm)에 걸쳐 있습니다. 접히면 글자·QR이 깨지니 이 구역을 비워 주세요.` };
    if (p === 'side-width') return { kind: 'side-width', text: '측면이 붙는 폭 밖에 걸쳐 있습니다. 측면 영역의 가운데 폭 안으로 옮겨주세요.' };
    return null;
  };
  const numberInput = (label: string, value: number, onChange: (v: number) => void, step = SNAP_MM) => (
    <label className="lb-num">
      <span>{label}</span>
      <input type="number" step={step} value={Number.isFinite(value) ? value : 0} onChange={(e) => { const v = parseFloat(e.target.value); if (Number.isFinite(v)) onChange(v); }} />
    </label>
  );

  return (
    <div className="lb-root">
      <AdminHeader icon={<Barcode size={20} />} title="라벨 설정" sub="라벨 디자인을 여러 개 저장해 두고, 그중 사용 중으로 고른 디자인으로 박스 라벨을 출력합니다. 항목을 끌어서 옮기고 모서리를 끌어 크기를 바꿉니다. 접는선을 넣으면 뚜껑 모서리에 감아 붙이는 라벨, 빼면 윗면 전용 라벨입니다." />

      <div className="ak-toolbar lb-designs">
        {current && (
          <>
            <label className="lb-design-pick">
              <span>디자인</span>
              <select className="ak-select" value={currentId ?? ''} onChange={(e) => selectDesign(e.target.value)} disabled={busy}>
                {designs.map((d) => <option key={d.id} value={d.id}>{d.name}{d.id === activeId ? ' (사용 중)' : ''}</option>)}
              </select>
            </label>
            {current.id === activeId ? (
              <span className="lb-badge">사용 중</span>
            ) : (
              <button className="ak-btn ak-btn-primary" onClick={useDesign} disabled={!canEdit || busy || dirty} title={dirty ? '저장하지 않은 변경이 있습니다. 먼저 저장하세요.' : '박스 라벨을 이 디자인으로 출력합니다.'}>이 디자인을 사용</button>
            )}
            {renaming !== null ? (
              <>
                <input className="ak-input lb-rename" value={renaming} maxLength={40} autoFocus onChange={(e) => setRenaming(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') void renameDesign(); if (e.key === 'Escape') setRenaming(null); }} />
                <button className="ak-btn ak-btn-primary" onClick={renameDesign} disabled={busy}>확인</button>
                <button className="ak-btn" onClick={() => setRenaming(null)} disabled={busy}>취소</button>
              </>
            ) : (
              <button className="ak-btn" onClick={() => setRenaming(current.name)} disabled={!canEdit || busy}><Pencil size={13} /> 이름 바꾸기</button>
            )}
            <button className="ak-btn ak-btn-danger" onClick={removeDesign} disabled={!canEdit || busy || current.id === activeId || designs.length <= 1} title={current.id === activeId ? '사용 중인 디자인은 지울 수 없습니다.' : designs.length <= 1 ? '마지막 디자인은 지울 수 없습니다.' : undefined}><Trash2 size={13} /> 삭제</button>
          </>
        )}
        <span className="ak-spacer" />
        {error && <span className="ak-error">{error}</span>}
        {notice && <span className="ak-notice">{notice}</span>}
        <button className="ak-btn" onClick={() => setCreating((v) => !v)} disabled={!canEdit || busy}><Plus size={14} /> 새 디자인</button>
      </div>

      {creating && (
        <section className="lb-card lb-new">
          <h3>새 디자인 만들기</h3>
          <div className="lb-new-row">
            <label className="lb-field">
              <span>이름</span>
              <input className="ak-input" value={newName} maxLength={40} placeholder="예: 윗면 전용 B" onChange={(e) => setNewName(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') void createDesign(); }} />
            </label>
            <label className="lb-field">
              <span>시작 배치</span>
              <select className="ak-select" value={newFrom} onChange={(e) => setNewFrom(e.target.value)}>
                <optgroup label="기본 배치">
                  {LABEL_PRESETS.map((p) => <option key={p.key} value={`preset:${p.key}`}>{p.name} — {p.description}</option>)}
                </optgroup>
                {designs.length > 0 && (
                  <optgroup label="저장된 디자인 복제">
                    {designs.map((d) => <option key={d.id} value={`copy:${d.id}`}>{d.name} 복제 (저장된 내용)</option>)}
                  </optgroup>
                )}
              </select>
            </label>
            <button className="ak-btn ak-btn-primary" onClick={createDesign} disabled={busy || !newName.trim()}>만들기</button>
            <button className="ak-btn" onClick={() => setCreating(false)} disabled={busy}>취소</button>
          </div>
          <p className="ak-muted">만든 디자인은 보관함에 저장되고, 편집해서 저장한 뒤 [이 디자인을 사용]을 눌러야 박스 라벨 출력에 쓰입니다(처음 만드는 디자인은 바로 사용 중이 됩니다).</p>
        </section>
      )}

      {!current ? (
        <section className="lb-card"><p className="ak-muted">저장된 디자인이 없습니다. 위에서 새 디자인을 만들어 시작하세요. 디자인이 없는 동안은 기본 배치(감아 붙이기)로 출력됩니다.</p></section>
      ) : (
      <>
      <div className="ak-toolbar">
        <strong className="lb-title">{current.name}{dirty ? ' ●' : ''}</strong>
        <span className="ak-spacer" />
        <button className="ak-btn" onClick={() => setPrintJob({ template, labels: [sample], rotate })} disabled={busy} title="지금 화면의 디자인을 샘플 값으로 한 장 출력합니다. 용지 크기와 위치를 확인할 때 씁니다.">
          <Printer size={14} /> 테스트 출력
        </button>
        <button className="ak-btn" onClick={() => setPrintJob({ template: qrTestTemplate(template), labels: [sample], rotate })} disabled={busy} title={`같은 QR을 한 칸 3~10도트(${PRINTER_DPI}dpi)로 한 장에 출력합니다. 폰으로 각각 스캔해서 읽히는 가장 작은 크기를 찾습니다.`}>
          <Barcode size={14} /> QR 시험 출력
        </button>
        <button className="ak-btn ak-btn-primary" onClick={save} disabled={!canEdit || busy || !(dirty || marginDirty || rotateDirty)}>저장</button>
      </div>

      <div className="lb-layout">
        <div className="lb-side">
          <section className="lb-card">
            <h3>라벨 크기 (mm)</h3>
            <div className="lb-grid">
              {numberInput('가로', template.widthMm, (v) => updateTemplate((t) => normalizeTemplate({ ...t, widthMm: clamp(v, 20, 300) })), 1)}
              {numberInput('높이', template.heightMm, (v) => updateTemplate((t) => normalizeTemplate({ ...t, heightMm: clamp(v, 20, 300) })), 1)}
            </div>
            <label className="lb-check" title="롤에 들어 있는 라벨의 방향에 맞춰 출력 방향을 바꿉니다. 같은 롤로 가로·세로 배치를 모두 시험할 때 씁니다.">
              <input type="checkbox" checked={rotate} onChange={(e) => { setRotate(e.target.checked); setRotateDirty(true); setNotice(null); }} /> 롤 방향에 맞춰 90도 돌려 출력
            </label>
            <p className="ak-muted">{rotate ? `라벨 ${template.widthMm}×${template.heightMm}mm를 시계 방향으로 90도 돌려 ${paperText} 용지에 출력합니다. 프린터 용지 크기를 ${paperText}로 맞추세요.` : `전체 ${template.widthMm}×${template.heightMm}mm = 프린터 용지(롤) 크기와 같아야 합니다.`} {fold ? `접는선(위 ${fold.yMm}mm / 아래 ${template.heightMm - fold.yMm}mm)의 위아래 ${FOLD_KEEP_OUT_MM}mm에는 글자·QR을 두지 않습니다.` : '접는선이 없는 윗면 전용 라벨입니다. 감아 붙이려면 아래 "항목 추가"에서 접는선을 넣으세요.'}</p>
          </section>

          <section className="lb-card">
            <h3>프린터 출력 여백 (mm)</h3>
            <div className="lb-size">
              {numberInput('가장자리 여백', marginMm, (v) => { setMarginMm(Math.min(10, Math.max(0, v))); setMarginDirty(true); setNotice(null); }, 0.5)}
            </div>
            <p className="ak-muted">프린터는 용지 가장자리를 찍지 못합니다. 라벨에서 빗금으로 표시된 바깥 영역은 출력되지 않으니, 점선 안쪽에 항목을 두세요. 여백에 걸친 항목은 빨간 점선으로 표시됩니다. 프린터마다 달라서 테스트 출력으로 확인해 맞추세요(보통 1~3mm).</p>
          </section>

          <section className="lb-card">
            <SilentPrintSetup sizeText={paperText} />
          </section>

          <section className="lb-card">
            <h3>항목 추가</h3>
            <div className="lb-add">
              {(Object.keys(ELEMENT_TYPE_NAMES) as LabelElementType[]).map((type) => (
                <button key={type} className="ak-btn" onClick={() => addElement(type)} disabled={type === 'fold' && !!fold} title={type === 'fold' && fold ? '접는선은 하나만 둘 수 있습니다.' : undefined}><Plus size={13} /> {ELEMENT_TYPE_NAMES[type]}</button>
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
                <div className="lb-row"><strong>{ELEMENT_TYPE_NAMES[selected.type]}</strong><span className="ak-spacer" /><button className="ak-btn ak-btn-danger" onClick={() => removeElement(selected.id)} title={selected.type === 'fold' ? '지우면 접는선 없는 윗면 전용 라벨이 됩니다.' : undefined}><Trash2 size={13} /> 삭제</button></div>
                {selected.type === 'fold' && (
                  <>
                    <p className="ak-muted">접는선 위는 뚜껑 위(윗면 {selected.y}mm), 아래는 옆면으로 꺾는 측면({Math.round((template.heightMm - selected.y) * 10) / 10}mm)입니다. 인쇄되지 않고 위치만 나타냅니다. 선을 끌어 위아래로 옮기거나 값을 입력하세요.</p>
                    <div className="lb-grid">
                      {numberInput('접는 위치(세로)', selected.y, (v) => updateElement(selected.id, { y: v }))}
                      {numberInput('옆면 가로 폭', selected.w, (v) => updateElement(selected.id, { w: v }), 1)}
                    </div>
                  </>
                )}
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
                  <p className="ak-muted">QR은 가로·세로 중 작은 쪽에 맞춰 정사각형으로 그려집니다. 한 칸 {qrModuleMm(Math.min(selected.w, selected.h), 21).toFixed(3)}mm = {qrModuleDots(qrModuleMm(Math.min(selected.w, selected.h), 21)).toFixed(1)}도트({PRINTER_DPI}dpi). 사방 4칸은 비워 두세요.</p>
                )}
                {selected.type !== 'fold' && (
                <div className="lb-grid">
                  {numberInput('가로 위치', selected.x, (v) => updateElement(selected.id, { x: clamp(v, 0, template.widthMm - selected.w) }))}
                  {numberInput('세로 위치', selected.y, (v) => updateElement(selected.id, { y: clamp(v, 0, template.heightMm - selected.h) }))}
                  {numberInput('너비', selected.w, (v) => updateElement(selected.id, { w: clamp(v, 0.2, template.widthMm - selected.x) }))}
                  {numberInput('높이', selected.h, (v) => updateElement(selected.id, { h: clamp(v, 0.2, template.heightMm - selected.y) }))}
                </div>
                )}
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
            {fold && (
              <div className="lb-fold" aria-hidden>
                {/* 접는선과 비워 둘 구역(양쪽 FOLD_KEEP_OUT_MM). 띠 안의 글자는 어느 쪽이 뚜껑 위이고 어느 쪽이 옆면인지 알려 준다. */}
                <div className="lb-fold-band" style={{ top: (fold.yMm - FOLD_KEEP_OUT_MM) * SCALE, height: FOLD_KEEP_OUT_MM * 2 * SCALE }}>
                  <span>▲ 상단 면 (뚜껑 위)</span>
                  <span>측면 (옆면으로 꺾음) ▼</span>
                </div>
                <div className="lb-fold-line" style={{ top: fold.yMm * SCALE }} />
                {fold.sideWidthMm < template.widthMm && (
                  <>
                    <div className="lb-side-off" style={{ left: 0, width: ((template.widthMm - fold.sideWidthMm) / 2) * SCALE, top: fold.yMm * SCALE, bottom: 0 }} />
                    <div className="lb-side-off" style={{ right: 0, width: ((template.widthMm - fold.sideWidthMm) / 2) * SCALE, top: fold.yMm * SCALE, bottom: 0 }} />
                  </>
                )}
              </div>
            )}
            <div className="lb-overlay">
              {template.elements.map((el) => {
                const isSel = el.id === selectedId;
                const outside = !!problemOf(el);
                const hit = el.type === 'fold' ? 14 : Math.max(el.h * SCALE, 8); // 접는선은 얇아서 누르기 쉽게 띠 모양으로 잡는다
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
                    {isSel && el.type !== 'fold' && (
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
          <p className="ak-muted lb-hint">미리보기는 샘플 값(스시고유 #2 등)입니다. 실제 라벨은 고객사 값으로 채워지고, 글자가 칸보다 길면 크기가 자동으로 줄어듭니다. 눈금은 5mm, 빨간 빗금은 프린터가 찍지 못하는 여백, 파란 띠는 접는선 주변(비워 둘 구역)입니다.</p>
        </div>
      </div>
      </>
      )}

      <LabelPrinter job={printJob} onDone={() => setPrintJob(null)} />

      <style>{`
        .lb-root { display: flex; flex-direction: column; gap: 0.9rem; min-width: 0; }
        .lb-layout { display: grid; grid-template-columns: 22rem minmax(0, 1fr); gap: 0.9rem; align-items: start; }
        .lb-side { display: flex; flex-direction: column; gap: 0.75rem; }
        .lb-card { background: #fff; border: 1px solid var(--border); border-radius: var(--radius-lg); padding: 0.85rem 1rem; display: flex; flex-direction: column; gap: 0.6rem; box-shadow: var(--shadow-sm); }
        .lb-card h3 { font-size: var(--fs-sm); font-weight: 800; color: var(--muted-foreground); }
        .lb-size { display: flex; align-items: flex-end; gap: 0.5rem; }
        .lb-x { color: var(--muted-foreground); margin-bottom: 0.7rem; }
        .lb-add { display: flex; flex-wrap: wrap; gap: 0.4rem; }
        .lb-props { display: flex; flex-direction: column; gap: 0.6rem; }
        .lb-row { display: flex; align-items: center; gap: 0.5rem; }
        .lb-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 0.5rem; align-items: end; }
        .lb-field { display: flex; flex-direction: column; gap: 0.25rem; font-size: var(--fs-xs); font-weight: 700; color: var(--muted-foreground); }
        .lb-num { display: flex; flex-direction: column; gap: 0.2rem; font-size: var(--fs-xs); font-weight: 700; color: var(--muted-foreground); }
        .lb-num input { height: 2.25rem; border: 1px solid var(--border); border-radius: 8px; padding: 0 0.5rem; font-size: var(--fs-md); font-weight: 700; width: 100%; background: #fff; color: var(--foreground); }
        .lb-check { display: flex; align-items: center; gap: 0.4rem; font-size: var(--fs-sm); font-weight: 700; }
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
        .lb-title { font-size: var(--fs-md); font-weight: 800; }
        .lb-designs { flex-wrap: wrap; }
        .lb-design-pick { display: flex; align-items: center; gap: 0.4rem; font-size: var(--fs-sm); font-weight: 800; color: var(--muted-foreground); }
        .lb-badge { font-size: var(--fs-sm); font-weight: 800; color: #166534; background: #dcfce7; border: 1px solid #86efac; border-radius: 999px; padding: 0.2rem 0.7rem; }
        .lb-rename { width: 12rem; }
        .lb-new-row { display: flex; flex-wrap: wrap; align-items: flex-end; gap: 0.6rem; }
        .lb-new-row .lb-field { min-width: 12rem; }
        .lb-fold { position: absolute; inset: 0; pointer-events: none; }
        .lb-fold-band { position: absolute; left: 0; right: 0; background: rgba(37, 99, 235, 0.09); border-top: 1px solid rgba(37, 99, 235, 0.25); border-bottom: 1px solid rgba(37, 99, 235, 0.25); display: flex; align-items: center; justify-content: space-between; padding: 0 6px; font-size: 10px; font-weight: 800; color: #1d4ed8; white-space: nowrap; overflow: hidden; }
        .lb-fold-line { position: absolute; left: 0; right: 0; border-top: 1.5px dashed #2563eb; }
        .lb-side-off { position: absolute; background: repeating-linear-gradient(135deg, rgba(100, 116, 139, 0.28) 0 3px, rgba(100, 116, 139, 0.08) 3px 7px); }
        .lb-margin { position: absolute; inset: 0; pointer-events: none; }
        .lb-margin span { position: absolute; background: repeating-linear-gradient(45deg, rgba(239, 68, 68, 0.22) 0 3px, rgba(239, 68, 68, 0.06) 3px 7px); }
        .lb-margin i { position: absolute; border: 1px dashed rgba(220, 38, 38, 0.8); }
        .lb-hit-out { outline: 1px dashed #dc2626; background: rgba(239, 68, 68, 0.08); }
        .lb-guide summary { font-size: var(--fs-sm); font-weight: 800; cursor: pointer; }
        .lb-guide ol { list-style: decimal; margin: 0.6rem 0; padding-left: 1.4rem; display: flex; flex-direction: column; gap: 0.45rem; font-size: var(--fs-sm); line-height: 1.45; }
        .lb-shortcut { display: flex; flex-wrap: wrap; gap: 0.4rem; margin: 0.45rem 0; }
        .lb-guide code { background: #f1f5f9; border-radius: 6px; padding: 0.05rem 0.35rem; font-size: var(--fs-md); }
        .lb-warn { font-size: var(--fs-sm); font-weight: 700; color: #b91c1c; background: #fef2f2; border: 1px solid #fecaca; border-radius: 10px; padding: 0.45rem 0.65rem; }
        .lb-handle { position: absolute; width: 10px; height: 10px; background: #fff; border: 1.5px solid #2563eb; border-radius: 2px; pointer-events: auto; touch-action: none; }
        .lb-hint { margin: 0.75rem 0 0; text-align: center; }
        @media (max-width: 1000px) { .lb-layout { grid-template-columns: 1fr; } }
      `}</style>
    </div>
  );
}
