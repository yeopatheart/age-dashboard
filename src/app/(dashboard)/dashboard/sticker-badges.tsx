import { resolveColors } from '@/lib/color-palette';
import { stickerText, type ItemSticker } from '@/lib/stickers';

// 상품 칸에 붙은 스티커 배지들. 색은 스티커 목록에서 고른 팔레트 색이다.
export function StickerBadges({ stickers, fontSize }: { stickers: ItemSticker[]; fontSize: string }) {
  return (
    <>
      {stickers.map((s) => {
        const c = resolveColors(s.fillColor, s.borderColor);
        return (
          <span
            key={s.id}
            className="whitespace-nowrap rounded-[3px] px-[3px] font-semibold"
            style={{ fontSize, lineHeight: 1.15, background: c.fill, color: c.text, boxShadow: `inset 0 0 0 1px ${c.border}` }}
          >
            {stickerText(s)}
          </span>
        );
      })}
    </>
  );
}

// 스티커는 항상 상품 칸의 **오른쪽 위**에, 칸의 위쪽 경계에 걸쳐 붙는다(사용자 결정 2026-11-22). 칸의 글자는 스티커 때문에 줄이거나 옮기지 않는다 —
// 대신 윗칸의 오른쪽 아래와 겹친다. 모든 칸에 같은 기준이라 어느 상품의 스티커인지 항상 같은 자리에서 읽는다.
// 칸 안으로 들어오는 폭은 OVERLAP_PX뿐이라 상품 글자는 거의 가리지 않는다. 스티커가 둘이면 오른쪽 끝에서 왼쪽으로 나란히 놓인다.
// 칸을 감싸는 상자(relative)에 놓이므로 칸의 overflow-hidden에 잘리지 않고, pointer-events-none이라 아래 칸의 탭을 막지 않는다(스티커 붙이기 모드는 위치로 판정한다).
const OVERLAP_PX = 2;

export function ChipStickers({ stickers, fontSize }: { stickers: ItemSticker[]; fontSize: string }) {
  return (
    <div className="pointer-events-none absolute right-[1px] z-20 flex items-center justify-end gap-[2px]" style={{ bottom: `calc(100% - ${OVERLAP_PX}px)` }}>
      <StickerBadges stickers={stickers} fontSize={fontSize} />
    </div>
  );
}
