'use client';
import { useState } from 'react';
import { Delete, X } from 'lucide-react';
import { resolveColors } from '@/lib/color-palette';
import { MAX_STICKERS_PER_BUSINESS, appendDigit, checkAddSticker, stickerQuantityError, type BusinessSticker, type ItemSticker, type StickerPresetOption } from '@/lib/stickers';
import { balloonPosition, pickStickerTarget, type Rect } from '@/lib/sticker-ui';

// 칠판의 스티커 붙이기 층. 도구 묶음의 스티커 버튼을 켜면 나타난다. 결정: docs/decisions/2026-11-22-stickers.md
// 흐름: 아래 띠에서 스티커를 고른다 → 상품 칸을 탭한다(고객사용 스티커는 고객명 칸을 탭한다, 2026-11-23) → 수량을 쓰는 스티커면 칸 아래에 숫자 말풍선(1~10은 누르는 즉시 붙고, 11 이상은 "11+"로 전체 키패드),
//   안 쓰는 스티커는 탭하는 순간 붙는다. 붙인 뒤에도 같은 스티커가 선택돼 있어 다음 칸을 바로 탭할 수 있다.
// 이미 붙은 스티커를 탭하면 수량 바꾸기·떼기 말풍선이 뜬다. 같은 스티커가 이미 붙은 칸을 탭해도 같은 말풍선이 뜬다(같은 스티커는 한 칸에 하나).
// 이 층이 화면 전체를 덮어 탭을 받으므로 아래 표의 포장 완료 탭은 일어나지 않는다. 펜과 함께 켤 수 없다(펜을 켜면 이 모드는 꺼진다).

interface Props {
  presets: StickerPresetOption[];
  stickersByItem: ReadonlyMap<string, ItemSticker[]>;
  businessStickersByDaily: ReadonlyMap<string, BusinessSticker[]>;
  onAdd: (itemId: string, preset: StickerPresetOption, quantity: number | null) => void;
  onSetQuantity: (sticker: ItemSticker, quantity: number) => void;
  onRemove: (sticker: ItemSticker) => void;
  onAddBusiness: (dailyBusinessId: string, preset: StickerPresetOption) => void;
  onRemoveBusiness: (sticker: BusinessSticker) => void;
  onExit: () => void;
  notify: (message: string) => void;
}

type Balloon =
  | { kind: 'add'; itemId: string; preset: StickerPresetOption; anchor: Rect }
  | { kind: 'edit'; sticker: ItemSticker; anchor: Rect }
  | { kind: 'edit-business'; sticker: BusinessSticker; anchor: Rect }; // 고객사 스티커: 수량이 없어 떼기만 있다

const QUICK_QUANTITIES = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
const BALLOON_W = 236;

const rectOf = (el: Element): Rect => {
  const r = el.getBoundingClientRect();
  return { left: r.left, top: r.top, right: r.right, bottom: r.bottom };
};
// 숨겨진 후보(display: none)는 화면에 없는 것이라 누를 수 없다.
const isShown = (el: Element) => el.getClientRects().length > 0;

export function StickerLayer({ presets, stickersByItem, businessStickersByDaily, onAdd, onSetQuantity, onRemove, onAddBusiness, onRemoveBusiness, onExit, notify }: Props) {
  const [presetId, setPresetId] = useState<string | null>(null);
  const [balloon, setBalloon] = useState<Balloon | null>(null);
  const [full, setFull] = useState(false); // 11 이상: 전체 키패드
  const [typed, setTyped] = useState('');

  // 아직 고르지 않았으면 목록의 첫 스티커. 고른 스티커가 목록에서 사라졌으면(다른 곳에서 지움) 첫 스티커로 돌아간다.
  const preset = presets.find((p) => p.id === presetId) ?? presets[0] ?? null;

  const closeBalloon = () => {
    setBalloon(null);
    setFull(false);
    setTyped('');
  };

  const onTap = (e: React.MouseEvent) => {
    const badges = [...document.querySelectorAll<HTMLElement>('[data-sticker-id]')].filter(isShown).map((el) => ({ stickerId: el.dataset.stickerId as string, itemId: el.dataset.stickerItem, dailyBusinessId: el.dataset.stickerBusiness, rect: rectOf(el) }));
    const names = [...document.querySelectorAll<HTMLElement>('[data-name-cell]')].filter((el) => isShown(el) && !el.closest('[data-ink-ignore]')).map((el) => ({ dailyBusinessId: el.dataset.nameCell as string, rect: rectOf(el) }));
    const chips = [...document.querySelectorAll<HTMLElement>('[data-chip]')].filter((el) => !el.closest('[data-ink-ignore]')).map((el) => ({ itemId: el.dataset.chip as string, rect: rectOf(el) }));
    const target = pickStickerTarget(e.clientX, e.clientY, badges, chips, names);
    closeBalloon();
    if (!target) return;
    if (target.kind === 'business-badge') {
      const sticker = businessStickersByDaily.get(target.dailyBusinessId)?.find((s) => s.id === target.stickerId);
      const anchor = badges.find((b) => b.stickerId === target.stickerId)?.rect;
      if (sticker && anchor) setBalloon({ kind: 'edit-business', sticker, anchor });
      return;
    }
    if (target.kind === 'badge') {
      const sticker = stickersByItem.get(target.itemId)?.find((s) => s.id === target.stickerId);
      const anchor = badges.find((b) => b.stickerId === target.stickerId)?.rect;
      if (sticker && anchor) setBalloon({ kind: 'edit', sticker, anchor });
      return;
    }
    if (!preset) {
      notify('붙일 스티커가 없습니다. PC의 "스티커 관리"에서 먼저 만들어 주세요.');
      return;
    }
    if (target.kind === 'name') {
      // 고객명 칸: 고객사용 스티커만 붙는다. 상품 칸 스티커를 골라 둔 채 누르면 알려 준다.
      if (preset.scope !== 'business') {
        notify(`'${preset.label}'은(는) 상품 칸에 붙이는 스티커입니다. 고객명 칸에는 고객사용 스티커(고객명 칸 표시)를 고르세요.`);
        return;
      }
      const nameAnchor = names.find((n) => n.dailyBusinessId === target.dailyBusinessId)?.rect;
      if (!nameAnchor) return;
      const existingBusiness = businessStickersByDaily.get(target.dailyBusinessId) ?? [];
      const businessCheck = checkAddSticker(existingBusiness.map((s) => s.label), preset.label, MAX_STICKERS_PER_BUSINESS);
      if (!businessCheck.ok) {
        if (businessCheck.reason === 'duplicate') {
          const same = existingBusiness.find((s) => s.label === preset.label);
          if (same) setBalloon({ kind: 'edit-business', sticker: same, anchor: nameAnchor });
          return;
        }
        notify('한 고객사에는 스티커를 2개까지 붙일 수 있습니다. 먼저 하나를 떼 주세요.');
        return;
      }
      onAddBusiness(target.dailyBusinessId, preset);
      return;
    }
    if (preset.scope === 'business') {
      notify(`'${preset.label}'은(는) 고객사에 붙이는 스티커입니다. 고객명 칸을 눌러 주세요.`);
      return;
    }
    const anchor = chips.find((c) => c.itemId === target.itemId)?.rect;
    if (!anchor) return;
    const existing = stickersByItem.get(target.itemId) ?? [];
    const check = checkAddSticker(existing.map((s) => s.label), preset.label);
    if (!check.ok) {
      if (check.reason === 'duplicate') {
        const same = existing.find((s) => s.label === preset.label);
        if (same) setBalloon({ kind: 'edit', sticker: same, anchor });
        return;
      }
      notify('한 칸에는 스티커를 2개까지 붙일 수 있습니다. 먼저 하나를 떼 주세요.');
      return;
    }
    if (preset.usesQuantity) {
      setBalloon({ kind: 'add', itemId: target.itemId, preset, anchor });
      return;
    }
    onAdd(target.itemId, preset, null);
  };

  const pickQuantity = (quantity: number) => {
    if (!balloon || balloon.kind === 'edit-business') return;
    if (balloon.kind === 'add') {
      const problem = stickerQuantityError(true, quantity);
      if (problem) return notify(problem);
      onAdd(balloon.itemId, balloon.preset, quantity);
    } else {
      const problem = stickerQuantityError(true, quantity);
      if (problem) return notify(problem);
      onSetQuantity(balloon.sticker, quantity);
    }
    closeBalloon();
  };

  const typedNumber = typed === '' ? null : Number(typed);
  const typedValid = typedNumber !== null && stickerQuantityError(true, typedNumber) === null;

  const editingQuantity = balloon?.kind === 'edit' && balloon.sticker.quantity !== null; // 수량을 쓰는 스티커의 수정
  const balloonHeight = !balloon ? 0 : full ? 290 : (balloon.kind === 'edit' && !editingQuantity) || balloon.kind === 'edit-business' ? 120 : 196;
  const balloonAt = balloon ? balloonPosition(balloon.anchor, { width: BALLOON_W, height: balloonHeight }, { width: window.innerWidth, height: window.innerHeight }) : null;
  const title = balloon ? (balloon.kind === 'add' ? `${balloon.preset.label} — 몇 개?` : editingQuantity ? `${balloon.sticker.label} — 수량 바꾸기` : balloon.sticker.label) : '';

  return (
    <>
      <div className="absolute inset-0 z-30 cursor-pointer ring-4 ring-inset ring-sky-400/50" style={{ touchAction: 'manipulation' }} onClick={onTap} aria-label="스티커 붙이기 — 상품 칸이나 고객명 칸을 누르세요" />

      {/* 아래 띠: 붙일 스티커 고르기 */}
      <div className="fixed bottom-3 left-1/2 z-40 flex max-w-[calc(100vw-140px)] -translate-x-1/2 items-center gap-2 rounded-2xl border border-slate-300 bg-white/95 px-3 py-2 shadow-xl">
        <span className="shrink-0 text-xs font-bold text-slate-500">붙일 스티커</span>
        {/* 선택한 스티커의 테두리 링(바깥 4px)이 스크롤 영역에 잘리지 않게 안쪽 여백을 주고, 바깥 배치는 음수 여백으로 되돌린다. */}
        <div className="-mx-1.5 -my-1.5 flex items-center gap-1.5 overflow-x-auto px-1.5 py-1.5">
          {presets.length === 0 ? (
            <span className="whitespace-nowrap text-xs text-slate-500">스티커가 없습니다. PC의 &quot;스티커 관리&quot;에서 만들어 주세요.</span>
          ) : (
            presets.map((p) => {
              const c = resolveColors(p.fillColor, p.borderColor);
              const selected = preset?.id === p.id;
              return (
                <button
                  key={p.id}
                  type="button"
                  aria-pressed={selected}
                  onClick={() => {
                    setPresetId(p.id);
                    closeBalloon();
                  }}
                  className={`h-10 shrink-0 whitespace-nowrap rounded-full px-4 text-sm font-bold ${selected ? 'ring-2 ring-[#003057] ring-offset-2' : ''}`}
                  style={{ background: c.fill, color: c.text, boxShadow: selected ? undefined : `inset 0 0 0 2px ${c.border}` }}
                >
                  {p.label}
                  {p.usesQuantity ? ' 1' : ''}
                  {p.scope === 'business' && <span className="ml-1 text-[10px] font-semibold opacity-70">고객명 칸</span>}
                </button>
              );
            })
          )}
        </div>
        <button type="button" onClick={onExit} className="flex h-10 shrink-0 items-center gap-1 rounded-full bg-[#003057] px-3 text-sm font-bold text-white">
          <X className="h-4 w-4" />
          끝내기
        </button>
      </div>

      {/* 수량 말풍선 */}
      {balloon && balloonAt && (
        <div className="fixed z-50 rounded-xl border border-slate-300 bg-white p-2 shadow-xl" style={{ left: balloonAt.left, top: balloonAt.top, width: BALLOON_W }}>
          <div className="mb-1.5 flex items-center justify-between">
            <span className="text-xs font-bold text-slate-700">{title}</span>
            <button type="button" aria-label="닫기" onClick={closeBalloon} className="flex h-7 w-7 items-center justify-center rounded-full text-slate-500 hover:bg-slate-100">
              <X className="h-4 w-4" />
            </button>
          </div>

          {full ? (
            <>
              <div className="mb-1.5 flex h-10 items-center justify-end rounded-lg bg-slate-100 px-3 text-xl font-black text-slate-800">{typed === '' ? <span className="text-sm font-bold text-slate-400">수량 (1~9999)</span> : typed}</div>
              <div className="grid grid-cols-3 gap-1.5">
                {['1', '2', '3', '4', '5', '6', '7', '8', '9'].map((d) => (
                  <button key={d} type="button" onClick={() => setTyped((t) => appendDigit(t, d))} className="h-11 rounded-lg border border-slate-300 bg-white text-lg font-bold text-slate-800 active:bg-slate-100">
                    {d}
                  </button>
                ))}
                <button type="button" aria-label="지우기" onClick={() => setTyped((t) => t.slice(0, -1))} className="flex h-11 items-center justify-center rounded-lg border border-slate-300 bg-white text-slate-700 active:bg-slate-100">
                  <Delete className="h-5 w-5" />
                </button>
                <button type="button" onClick={() => setTyped((t) => appendDigit(t, '0'))} className="h-11 rounded-lg border border-slate-300 bg-white text-lg font-bold text-slate-800 active:bg-slate-100">
                  0
                </button>
                <button type="button" disabled={!typedValid} onClick={() => typedNumber !== null && pickQuantity(typedNumber)} className="h-11 rounded-lg bg-[#003057] text-sm font-bold text-white disabled:opacity-40">
                  확인
                </button>
              </div>
            </>
          ) : (
            <>
              {(balloon.kind === 'add' || editingQuantity) && (
                <div className="grid grid-cols-5 gap-1.5">
                  {QUICK_QUANTITIES.map((n) => {
                    const current = balloon.kind === 'edit' && balloon.sticker.quantity === n;
                    return (
                      <button
                        key={n}
                        type="button"
                        onClick={() => pickQuantity(n)}
                        className={`h-11 rounded-lg border text-base font-bold ${current ? 'border-[#003057] bg-[#003057] text-white' : 'border-slate-300 bg-white text-slate-800 active:bg-slate-100'}`}
                      >
                        {n}
                      </button>
                    );
                  })}
                </div>
              )}
              <div className="mt-1.5 flex gap-1.5">
                {(balloon.kind === 'add' || editingQuantity) && (
                  <button type="button" onClick={() => setFull(true)} className="h-10 flex-1 rounded-lg border border-slate-300 bg-white text-sm font-bold text-slate-700 active:bg-slate-100">
                    11 이상
                  </button>
                )}
                {(balloon.kind === 'edit' || balloon.kind === 'edit-business') && (
                  <button
                    type="button"
                    onClick={() => {
                      if (balloon.kind === 'edit') onRemove(balloon.sticker);
                      else onRemoveBusiness(balloon.sticker);
                      closeBalloon();
                    }}
                    className="h-10 flex-1 rounded-lg border-2 border-rose-300 bg-rose-50 text-sm font-bold text-rose-700 active:bg-rose-100"
                  >
                    떼기
                  </button>
                )}
              </div>
            </>
          )}
        </div>
      )}
    </>
  );
}
