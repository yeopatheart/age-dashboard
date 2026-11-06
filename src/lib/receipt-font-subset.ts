// 영수증 이미지에 넣을 글꼴 조각 고르기(순수 함수). html-to-image는 쓰는 글꼴의 모든 @font-face 조각을 이미지에 넣는데,
// 한글 글꼴은 조각이 수백 개라 수 MB가 된다. 그래서 영수증에 실제로 쓰인 글자를 덮는 조각(unicode-range)만 골라 넣는다.

export type CodepointRange = [number, number];

// CSS unicode-range 값("U+AC00-AD7F, U+20, U+4??")을 코드포인트 범위 목록으로 바꾼다. 읽을 수 없는 조각은 건너뛴다.
export function parseUnicodeRange(value: string): CodepointRange[] {
  const ranges: CodepointRange[] = [];
  for (const part of value.split(',')) {
    const m = /^\s*u\+([0-9a-f?]+)(?:-([0-9a-f]+))?\s*$/i.exec(part);
    if (!m) continue;
    const [, first, last] = m;
    if (first.includes('?')) {
      ranges.push([parseInt(first.replace(/\?/g, '0'), 16), parseInt(first.replace(/\?/g, 'f'), 16)]);
    } else {
      const start = parseInt(first, 16);
      ranges.push([start, last ? parseInt(last, 16) : start]);
    }
  }
  return ranges;
}

// 글자(코드포인트) 집합. 공백·줄바꿈은 글꼴 조각 선택에 영향이 없어 뺀다.
export function textCodepoints(text: string): Set<number> {
  const set = new Set<number>();
  for (const ch of text) {
    const cp = ch.codePointAt(0);
    if (cp !== undefined && !/\s/.test(ch)) set.add(cp);
  }
  return set;
}

// 조각이 쓰인 글자 중 하나라도 덮으면 true. unicode-range가 비어 있으면(전체를 덮는 조각) true.
export function rangesCover(ranges: CodepointRange[], codepoints: Set<number>): boolean {
  if (ranges.length === 0) return true;
  for (const cp of codepoints) {
    for (const [start, end] of ranges) if (cp >= start && cp <= end) return true;
  }
  return false;
}
