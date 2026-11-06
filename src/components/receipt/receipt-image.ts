// 영수증 화면 요소를 PNG 이미지로 바꾸고 저장·공유·복사하는 브라우저 전용 도구. 화면 요소는 receipt-sheet.tsx.
// 변환은 html-to-image(기존 Auto-Receipt와 같은 방식)를 쓰되, 글꼴은 영수증에 쓰인 글자를 덮는 조각만 직접 골라 넣는다
// (라이브러리 기본 동작은 한글 글꼴 조각을 수백 개 모두 넣어 수 MB가 되고 느리다).
import '@fontsource/noto-serif-kr/400.css';
import '@fontsource/noto-serif-kr/700.css';
import { toBlob } from 'html-to-image';
import { parseUnicodeRange, rangesCover, textCodepoints } from '@/lib/receipt-font-subset';

const FONT_FAMILIES = ['Noto Serif KR', 'Noto Sans KR'];
const FONT_WEIGHTS = ['400', '700'];
const PIXEL_RATIO = 3; // 420px 영수증을 1260px 폭 이미지로(카톡에서 확대해도 또렷하게)
// 숫자·기호는 항상 쓰이므로 조각 선택에 함께 넣는다.
const ALWAYS_USED = '0123456789,.-()₩/:';

const dataUrlCache = new Map<string, Promise<string>>();

function fetchAsDataUrl(url: string): Promise<string> {
  let cached = dataUrlCache.get(url);
  if (!cached) {
    cached = fetch(url)
      .then((res) => {
        if (!res.ok) throw new Error(`글꼴을 불러오지 못했습니다(${res.status})`);
        return res.blob();
      })
      .then(
        (blob) =>
          new Promise<string>((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(String(reader.result));
            reader.onerror = () => reject(reader.error);
            reader.readAsDataURL(blob);
          }),
      );
    dataUrlCache.set(url, cached);
    cached.catch(() => dataUrlCache.delete(url));
  }
  return cached;
}

function firstFontUrl(src: string): string | null {
  const woff2 = /url\(\s*["']?([^"')]+\.woff2[^"')]*)["']?\s*\)/i.exec(src);
  if (woff2) return woff2[1];
  const any = /url\(\s*["']?([^"')]+)["']?\s*\)/i.exec(src);
  return any ? any[1] : null;
}

// 영수증에 쓰인 글자를 덮는 @font-face 조각만 모아 data URL로 바꾼 CSS를 만든다.
async function buildFontEmbedCss(text: string): Promise<string> {
  const used = textCodepoints(text + ALWAYS_USED);
  const wanted: { family: string; weight: string; style: string; unicodeRange: string; url: string }[] = [];
  for (const sheet of Array.from(document.styleSheets)) {
    let rules: CSSRuleList;
    try {
      rules = sheet.cssRules;
    } catch {
      continue; // 다른 주소의 스타일시트는 읽을 수 없다(우리 글꼴은 같은 주소라 해당 없음)
    }
    for (const rule of Array.from(rules)) {
      if (!(rule instanceof CSSFontFaceRule)) continue;
      const family = rule.style.getPropertyValue('font-family').replace(/["']/g, '').trim();
      const weight = rule.style.getPropertyValue('font-weight').trim();
      if (!FONT_FAMILIES.includes(family) || !FONT_WEIGHTS.includes(weight)) continue;
      const unicodeRange = rule.style.getPropertyValue('unicode-range').trim();
      if (!rangesCover(parseUnicodeRange(unicodeRange), used)) continue;
      const rawUrl = firstFontUrl(rule.style.getPropertyValue('src'));
      if (!rawUrl) continue;
      wanted.push({ family, weight, style: rule.style.getPropertyValue('font-style').trim() || 'normal', unicodeRange, url: new URL(rawUrl, sheet.href ?? document.baseURI).href });
    }
  }
  const css = await Promise.all(
    wanted.map(async (f) => {
      const dataUrl = await fetchAsDataUrl(f.url);
      return `@font-face{font-family:'${f.family}';font-style:${f.style};font-weight:${f.weight};src:url(${dataUrl}) format('woff2');${f.unicodeRange ? `unicode-range:${f.unicodeRange};` : ''}}`;
    }),
  );
  return css.join('\n');
}

// 영수증에 쓰는 글꼴이 실제로 내려받아진 뒤에 찍어야 글자 크기·줄바꿈이 맞는다.
async function loadFonts(text: string): Promise<void> {
  const sample = text.slice(0, 400) + ALWAYS_USED;
  await Promise.all(FONT_FAMILIES.flatMap((family) => FONT_WEIGHTS.map((w) => document.fonts.load(`${w} 14px "${family}"`, sample))));
  await document.fonts.ready;
}

// WebKit(사파리, iOS의 모든 브라우저)은 처음 한 번은 글꼴·이미지가 덜 그려진 채 나오는 경우가 있다(html-to-image의 알려진 문제).
const needsWarmup = () => typeof navigator !== 'undefined' && (/iP(hone|ad|od)/.test(navigator.userAgent) || (/Safari/.test(navigator.userAgent) && !/Chrome|Chromium|Edg|Android/.test(navigator.userAgent)));
let warmedUp = false;

// 영수증 요소 하나를 PNG로 만든다. 요소는 화면에 그려져 있어야 하고(축소해서 보여 주는 것은 괜찮다) 폭은 그 요소의 실제 폭이다.
export async function receiptToPng(node: HTMLElement): Promise<Blob> {
  const text = node.textContent ?? '';
  await loadFonts(text);
  const fontEmbedCSS = await buildFontEmbedCss(text);
  const options = {
    width: node.offsetWidth,
    height: node.offsetHeight + 8, // 아래 테두리가 잘리지 않게 여유를 둔다
    backgroundColor: '#ffffff',
    skipAutoScale: true,
    fontEmbedCSS,
    style: { transform: 'none', margin: '0' },
  };
  // 해당 브라우저에서는 세션에서 처음 한 번 먼저 가볍게 그려 준다.
  if (!warmedUp && needsWarmup()) {
    warmedUp = true;
    await toBlob(node, { ...options, pixelRatio: 1 }).catch(() => null);
  }
  const blob = await toBlob(node, { ...options, pixelRatio: PIXEL_RATIO });
  if (!blob) throw new Error('이미지를 만들지 못했습니다.');
  return blob;
}

export function downloadBlob(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

// 이 기기에서 이미지 파일을 공유 시트로 보낼 수 있는지(모바일 대부분은 true, PC 브라우저는 대개 false).
export function canShareImage(blob: Blob, fileName: string): boolean {
  if (typeof navigator === 'undefined' || typeof navigator.share !== 'function' || typeof navigator.canShare !== 'function') return false;
  return navigator.canShare({ files: [new File([blob], fileName, { type: 'image/png' })] });
}

// 공유 시트를 연다(카카오톡을 고르면 채팅방에 이미지로 올라간다). 사용자가 닫으면 'cancelled'.
export async function shareImage(blob: Blob, fileName: string): Promise<'shared' | 'cancelled'> {
  try {
    await navigator.share({ files: [new File([blob], fileName, { type: 'image/png' })], title: '영수증' });
    return 'shared';
  } catch (e) {
    if (e instanceof DOMException && e.name === 'AbortError') return 'cancelled';
    throw e;
  }
}

export function canCopyImage(): boolean {
  return typeof navigator !== 'undefined' && !!navigator.clipboard && typeof ClipboardItem !== 'undefined';
}

// 이미지를 클립보드에 복사한다(PC 카카오톡 채팅창에 붙여넣기).
export async function copyImage(blob: Blob): Promise<void> {
  await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
}
