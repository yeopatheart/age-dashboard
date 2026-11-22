import { resolveColors } from '@/lib/color-palette';
import { stickerText, type ItemSticker } from '@/lib/stickers';

// 상품 칸에 붙은 스티커 배지들. 칸 안(글자 흐름), 이웃 빈 칸, 반투명 얹기에서 같은 모양을 쓴다(자리 규칙: src/lib/sticker-placement.ts).
// 색은 스티커 목록에서 고른 팔레트 색이다. 글자 크기는 쓰는 자리가 정한다(칸 안은 칸의 글자 크기 단계 변수 --po를 따라 같이 줄어든다).
export function StickerBadges({ stickers, fontSize }: { stickers: ItemSticker[]; fontSize: string }) {
  return (
    <>
      {stickers.map((s) => {
        const c = resolveColors(s.fillColor, s.borderColor);
        return (
          <span
            key={s.id}
            data-sticker-id={s.id}
            data-sticker-item={s.orderItemId}
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
