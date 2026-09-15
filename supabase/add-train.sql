-- 참가자가 고른 KTX 정보(열차번호/날짜/시각). SQL Editor에 붙여넣고 실행한다. 여러 번 실행해도 안전하다.
-- 포항역이 경로에 있을 때만 채워진다 — 없으면 전부 null.

alter table public.pod_participants add column if not exists train_no text;
alter table public.pod_participants add column if not exists train_type text; -- "KTX-산천" 등 표시용
alter table public.pod_participants add column if not exists train_date date;
alter table public.pod_participants add column if not exists train_time text; -- "HH:MM", 열차 자체 시각(택시 출발시각과 다름)
