-- 더미(시드) 데이터와 실제 사용자를 구분하는 플래그. SQL Editor에 붙여넣고 실행한다.
--
-- 근거: 2026-08-25 09:54:06~17 사이 11초 만에 프로필 56개가 생성됐고, 닉네임이 정확히
-- 두 번씩 중복된다("새벽조깅"이 같은 시각대에 두 번 등장하는 식) — 사람이 한 명씩 가입한
-- 흔적이 아니라 스크립트로 심은 시드 데이터의 특징이다. 지우진 않고(데모용으로 필요할 수
-- 있어 보존), 앱이 실제 사용자를 우선 추천하도록 표시만 해둔다.

alter table public.profiles add column if not exists is_seed boolean not null default false;

update public.profiles set is_seed = true where id in (
  '25731d9c-c1cb-454b-afb2-df4064064390','b7d2687c-9cd0-4529-867b-ad916c2642fa',
  'e6b71a82-79a8-4e8f-a85c-21784413aec8','6c0f1e1b-7eed-4477-96ec-19e757385a35',
  'de93611a-1d1c-4d92-9fc7-dd5a2ef2782b','51555624-57eb-4de7-b5ab-80478dfd9bbe',
  '9716e8d0-fc9d-46ad-a1eb-c7f293fc9873','55984f51-3e6f-4cdb-bf9a-2593657cc3a3',
  '6bb41afb-9515-4948-8432-f90d7e270b6a','8b17de2c-6c39-497f-881c-2e506351fe43',
  'cbe70348-2566-40fe-b7ba-1d87a377910a','bb6d032f-431c-48f1-9857-a31d0fd4a0a6',
  '566ea8e4-1f88-4371-b99e-dcbfcffe2a87','e28bfe40-1eda-4284-8841-0a08e2b98ef5',
  '145e8352-b2f2-4406-b76b-eed346997be7','4f41e85c-3e6b-40eb-a5b6-053082cf3f33',
  '18813964-1de9-434b-a8fa-813bdd3bc903','f23aaa31-2ad6-4095-b0a2-581ffd71890c',
  '03e907b9-c72a-4c0d-8d04-663a78305513','2798936c-9ed8-4e30-9b23-80e7d83538a8',
  '4b46bce5-54be-484e-8c12-5cc1cee289b9','b46b0ace-fbb5-45cb-a9a7-43bcce025911',
  '5d6557e9-3261-417c-b631-31df3c8bb66c','fb9831ff-5aad-44e6-923b-9e63fb17587a',
  'd95c48b1-4e2e-4173-8f22-1ea7288d5d62','1a67ca4a-c4c6-49f8-a5ab-1a0284252ee5',
  '0a856eb0-1d9b-48aa-96be-0bf1b75edccc','f7efb39b-9e7f-4b58-847e-eb98a2dc0cbe',
  'b792ee4b-9298-4564-80a4-494707170f1c','55bca08b-61f9-416d-aaa0-233d270a3ec6',
  '92a969bd-4454-40c6-91ae-4a0884f94455','6ec2a1fa-8651-4c57-8df7-ec72365ad706',
  '454e11f1-5c43-4c12-ab16-6e9390c6c044','0c5a9211-289b-4d3b-aa36-a74418b980b8',
  '41eeba1d-e97c-4a09-8195-4db14439d1b0','c12c6bb2-7c5c-41d4-8dcd-ae540cf0c623',
  'c6253e9d-e2f1-48a4-80e7-27d790cbf455','68918b4f-f748-4fbd-9e75-cb505d46c7eb',
  'e52f44ec-c00d-41b9-be96-cb0ad1063cbb','88c7e747-6dfa-4aa5-84d7-ba12e1150aec',
  'a92b70f0-e9e1-4eef-84d7-9a84d23f8b9b','480a5b03-3d41-4a0c-8adf-704d38c185f4',
  'cffc2a63-421e-4347-a36c-776df23bd367','a02dca4b-9ebc-43b6-9c45-6d83a098b449',
  '9fa9354c-9d01-4028-a201-3842c97cb05d','4dfbcb08-0883-4a46-911b-63e1f2146013',
  '6e8bea45-ef45-4384-84e3-269d38697b8d','9e451609-e771-4fe4-8246-4ba0a122a922',
  '98adab96-d7db-40cb-99bd-4660bbe4e4c6','7102a8b3-f53c-4f2c-990f-76cf1e70916e',
  '53780fdc-ef79-435c-bee2-0ca31b89a0a9','28920389-8765-463c-b665-07605d04f55e',
  '1e4c2523-cdbe-43e0-ae4f-ad153a619820','6f7b607a-f45f-46b8-8d06-4e89b2b958ea',
  '761c075a-205c-435c-9687-9cd0ef1f7442','e57752d6-db6e-4564-80bd-8609e310a297'
);

-- profiles는 select 정책이 이미 전체 공개(anon, using true)라 is_seed 컬럼도 그대로 클라이언트에서 읽힌다.
-- 별도 RLS 정책 추가는 필요 없다.
