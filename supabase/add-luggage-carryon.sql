-- 짐 종류를 3개(없음/작은 짐/큰 짐)에서 4개(없음/백팩·소형/기내용 캐리어/대형 캐리어)로 세분화.
-- add-luggage.sql이 만든 제약(check)을 지우고 다시 건다. SQL Editor에 붙여넣고 실행한다.
-- 여러 번 실행해도 안전하다. 기존 값(none/small/large)은 그대로 유효해서 마이그레이션 불필요.

alter table public.pod_participants drop constraint if exists pod_participants_luggage_type_check;
alter table public.pod_participants add constraint pod_participants_luggage_type_check
  check (luggage_type in ('none', 'small', 'carryon', 'large'));
