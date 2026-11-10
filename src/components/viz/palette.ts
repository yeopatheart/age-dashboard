// 리포트 차트의 범주 색. 스킬(dataviz)의 검증된 라이트 팔레트 8색을 정해진 순서로 쓴다(순환·생성하지 않는다). 검증: 인접 쌍 CVD ΔE 9.1, 일반시야 ΔE 19.6 통과.
// 일부 색(aqua·yellow·magenta)은 표면 대비 3:1 미만이라, 차트에는 항상 범례와 "표로 보기"를 함께 둔다.
export const CATEGORICAL = ['#2a78d6', '#eb6834', '#1baf7a', '#eda100', '#e87ba4', '#008300', '#6250d6', '#e34948'] as const;
export const OTHER_COLOR = '#898781'; // 8색을 넘는 항목(기타)
export const OTHER_NAME = '기타';

// 항목의 색은 "항목 이름이 order에서 몇 번째인지"로 정한다. 기간·필터가 바뀌어 보이는 항목 수가 달라도 같은 항목은 같은 색이다.
export function colorOf(name: string, order: string[]): string {
  const i = order.indexOf(name);
  return i >= 0 && i < CATEGORICAL.length ? CATEGORICAL[i] : OTHER_COLOR;
}

// 색 위에 올리는 글자색: 밝은 색(노랑·청록·분홍)에는 거의 검정, 나머지는 흰색.
export function inkOn(hex: string): string {
  const n = parseInt(hex.slice(1), 16);
  const lin = (c: number) => {
    const v = c / 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  };
  const l = 0.2126 * lin((n >> 16) & 255) + 0.7152 * lin((n >> 8) & 255) + 0.0722 * lin(n & 255);
  return l > 0.3 ? '#0b0b0b' : '#ffffff';
}
