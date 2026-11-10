// "재출력 필요" 판정: 라벨에 박스 종류를 찍는 디자인을 쓰는데, 이미 붙인 라벨에 찍힌 박스 종류가 지금 제출된 박스 종류와 다른 경우.
// 순수 함수만 둔다(DB·화면 접근 없음). 서버와 화면과 테스트가 같이 쓴다.
import type { LabelTemplate } from './template.ts';

export function templateShowsBoxType(template: Pick<LabelTemplate, 'elements'> | null | undefined): boolean {
  return !!template && template.elements.some((e) => e.type === 'field' && e.field === 'boxType');
}

// 출력할 때 box_labels.printed_box_type에 저장할 값: 라벨에 박스 종류가 찍히면 그 이름(없으면 빈 글자), 안 찍히면 null.
export function printedBoxTypeValue(template: Pick<LabelTemplate, 'elements'>, boxType: string): string | null {
  return templateShowsBoxType(template) ? boxType : null;
}

export interface ReprintInput {
  templateShowsBoxType: boolean; // 사용 중인 디자인에 박스 종류 항목이 있는지
  printCount: number; // 지금까지 출력한 횟수(0이면 아직 붙인 라벨이 없다)
  printedBoxType: string | null | undefined; // 마지막 출력 때 찍힌 값. null = 안 찍음. undefined = 알 수 없음(마이그레이션 0051 전)
  currentBoxType: string; // 지금 제출된 박스 종류(없으면 빈 글자)
}

export function labelNeedsReprint(input: ReprintInput): boolean {
  if (!input.templateShowsBoxType || input.printCount <= 0) return false;
  if (input.printedBoxType === undefined) return false; // 무엇이 찍혔는지 모르면 경고하지 않는다
  return (input.printedBoxType ?? '') !== input.currentBoxType;
}
