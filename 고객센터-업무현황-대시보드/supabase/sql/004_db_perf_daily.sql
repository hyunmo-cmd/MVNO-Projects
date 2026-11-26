-- DB 실적(알뜰폰 OB 청약대기 트래킹) 일별 집계 테이블
-- Supabase 대시보드 > SQL Editor 에 붙여넣고 Run (1회).
--
-- 트래킹 시트의 Apps Script(db-performance-apps-script.gs)가 Edge Function(dataset: "db_perf")으로 보낸다.
-- 날짜별 건수만 저장한다. 전화번호·계약번호 등 고객 정보는 저장하지 않는다.

create table if not exists public.db_perf_daily (
  date        date        primary key,
  inflow      integer     not null default 0 check (inflow   >= 0),  -- 인입
  absent      integer     not null default 0 check (absent   >= 0),  -- 부재
  excluded    integer     not null default 0 check (excluded >= 0),  -- 고객제외
  pending     integer     not null default 0 check (pending  >= 0),  -- 청약대기
  ob          integer     not null default 0 check (ob       >= 0),  -- OB 건수
  usim        integer     not null default 0 check (usim     >= 0),  -- 유심 구매
  opened      integer     not null default 0 check (opened   >= 0),  -- 개통완료 (요금제 유치)
  synced_at   timestamptz not null default now()
);

alter table public.db_perf_daily enable row level security;

-- 쓰기는 Edge Function(service_role)만. 읽기는 대시보드(anon) 허용 — work_daily_sheet 와 같은 방식.
drop policy if exists "db_perf_daily read" on public.db_perf_daily;
create policy "db_perf_daily read" on public.db_perf_daily
  for select to anon, authenticated using (true);
