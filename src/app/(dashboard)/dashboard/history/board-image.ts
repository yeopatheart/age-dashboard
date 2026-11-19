// 필기 이력 화면을 이미지(PNG)로 저장한다. 표를 확대·축소 배율(transform) 없이 2배 해상도로 찍고, 위에 "날짜·화면·시각" 띠를 붙인다.
// 그래서 화면에서 얼마나 확대해 보고 있든 저장되는 이미지의 크기와 선명도는 같다. html-to-image는 이미 설치된 라이브러리다(영수증 이미지도 이것을 쓴다).
const PIXEL_RATIO = 2;
const BAND_H = 36;
const FONT = '-apple-system, "Apple SD Gothic Neo", "Malgun Gothic", "Noto Sans KR", sans-serif';

const loadImage = (src: string) =>
  new Promise<HTMLImageElement>((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('이미지를 만들지 못했습니다.'));
    img.src = src;
  });

// root 안의 [data-board-capture] 표를 찍어 파일로 내려받는다. 실패하면 예외를 던진다(호출하는 쪽이 안내한다).
export async function saveBoardImage(root: HTMLElement, caption: string, filename: string): Promise<void> {
  const inner = root.querySelector<HTMLElement>('[data-board-capture]');
  if (!inner) throw new Error('표를 찾지 못했습니다.');
  const { toPng } = await import('html-to-image');
  const dataUrl = await toPng(inner, {
    pixelRatio: PIXEL_RATIO,
    width: inner.offsetWidth,
    height: inner.offsetHeight,
    backgroundColor: '#f7f5f1',
    style: { transform: 'none', transformOrigin: 'top left' },
  });
  const img = await loadImage(dataUrl);
  const band = BAND_H * PIXEL_RATIO;
  const canvas = document.createElement('canvas');
  canvas.width = img.width;
  canvas.height = img.height + band;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('이미지를 만들지 못했습니다.');
  ctx.fillStyle = '#232b36';
  ctx.fillRect(0, 0, canvas.width, band);
  ctx.fillStyle = '#ffffff';
  ctx.font = `700 ${14 * PIXEL_RATIO}px ${FONT}`;
  ctx.textBaseline = 'middle';
  ctx.fillText(caption, 14 * PIXEL_RATIO, band / 2);
  ctx.drawImage(img, 0, band);
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'));
  if (!blob) throw new Error('이미지를 만들지 못했습니다.');
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
