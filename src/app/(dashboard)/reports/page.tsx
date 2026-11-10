import { redirect } from 'next/navigation';

// 리포트의 첫 화면은 박스 리포트다. 예전에는 여기에 주문 수량 표가 있었는데 판매·수익 리포트(품목별·업체별·터미널별)로 대체해 없앴다.
// 이 주소는 메뉴·북마크의 진입점이라 박스 리포트로 보낸다(권한은 각 리포트 페이지가 확인한다).
export default function ReportsIndexPage() {
  redirect('/reports/box');
}
