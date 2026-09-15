-- 참가자별 짐 종류(없음/작은 짐/큰 짐). SQL Editor에 붙여넣고 실행한다. 여러 번 실행해도 안전하다.
-- 개수를 세는 스테퍼 대신 종류 3개 중 고르는 칩으로 뒀다 — 칩 한 번 탭이면 끝난다.

alter table public.pod_participants add column if not exists luggage_type text not null default 'none'
  check (luggage_type in ('none', 'small', 'large'));
