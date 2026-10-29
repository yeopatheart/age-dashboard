-- 새 "대시보드"(진행 현황, /overview) 메뉴. 기존 "대시보드"는 "주문 목록"(permission key는 그대로 dashboard)으로 이름이 바뀌었다.
-- 이미 주문 목록을 볼 수 있던 사용자가 새 대시보드도 바로 볼 수 있게 view 권한을 한 번 넣어 준다(master는 원래 전부 가진다).
-- 새 대시보드를 못 보게 하려면 사용자 및 권한 화면에서 끄면 된다. 여러 번 실행해도 같은 결과다.
update user_permissions
set permissions = array_append(permissions, 'overview:view'), updated_at = now()
where 'dashboard:view' = any(permissions) and not ('overview:view' = any(permissions));
