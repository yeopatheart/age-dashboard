// 정산 화면의 주소. 기간(?g=day|week|month, ?d=기준일)을 한 곳에서 만든다. 판매내역·매입내역·그래프는 한 화면이다.
import type { Granularity } from '@/lib/report';

export const settlementUrl = (g: Granularity, d: string) => `/settlement?g=${g}&d=${d}`;

// "오늘" 버튼: 기간을 기본값(오늘, 일)으로 돌린다.
export const settlementTodayUrl = () => '/settlement';
