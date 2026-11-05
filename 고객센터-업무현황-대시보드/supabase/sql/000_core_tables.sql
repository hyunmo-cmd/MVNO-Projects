-- 고객센터 대시보드 기본 테이블 (새 Supabase 프로젝트 최초 1회)
-- Supabase 대시보드 > SQL Editor 에 붙여넣고 Run. 그다음 001_work_daily_sheet.sql 도 Run.
--
-- 대시보드(cs-dashboard.html)가 publishable(anon) 키로 직접 읽고 쓰는 테이블:
--   work_records      : 업무 입력(AI 입력·직접 입력·파일 업로드) — 개통 등
--   complaint_records : 민원 관리(STT 업로드 = 유선 상담, 1:1문의 업로드)
-- Edge Function(sheet-sync)만 쓰는 테이블:
--   call_daily        : 통화 현황 탭(응답률 시트 '일별 응답률' 동기화)
--
-- anon 은 INSERT/SELECT 만 허용, UPDATE/DELETE 는 막는다. 재업로드/정정은
-- 새 행을 넣고 대시보드가 읽을 때 최신 행만 고르는 방식(reduceWorkRows)으로 처리한다.

-- ── 업무 기록 ──────────────────────────────────────────
create table if not exists public.work_records (
  id              bigint generated always as identity primary key,
  date            date        not null,
  agent           text        not null check (char_length(agent) between 1 and 20),
  major_category  text        not null check (char_length(major_category) <= 40),
  minor_category  text        not null check (char_length(minor_category) <= 40),
  count           integer     not null default 0 check (count >= 0),
  duration        numeric     not null default 0 check (duration >= 0),  -- 분 단위
  source          text        check (char_length(source) <= 40),
  unique_key      text        not null unique,
  created_at      timestamptz not null default now()
);
create index if not exists work_records_date_idx on public.work_records (date);

-- ── 민원 기록 ──────────────────────────────────────────
create table if not exists public.complaint_records (
  id            bigint generated always as identity primary key,
  date          date        not null,
  channel       text        not null check (channel in ('유선 상담', '1:1문의', '채널톡')),
  agent         text        not null default '' check (char_length(agent) <= 20),
  inquiry_type  text        not null check (char_length(inquiry_type) <= 60),
  count         integer     not null default 1 check (count >= 0),
  source        text        check (char_length(source) <= 40),
  unique_key    text        not null unique,
  created_at    timestamptz not null default now()
);
create index if not exists complaint_records_channel_date_idx on public.complaint_records (channel, date);

-- ── 통화 현황(일별 응답률) ─────────────────────────────
create table if not exists public.call_daily (
  date         date        primary key,          -- 하루 1행, 재동기화 시 값 갱신
  total_calls  integer     not null default 0 check (total_calls >= 0),
  answered     integer     not null default 0 check (answered >= 0),
  unanswered   integer     check (unanswered >= 0),
  synced_at    timestamptz not null default now()
);

-- ── 권한(RLS) ──────────────────────────────────────────
alter table public.work_records      enable row level security;
alter table public.complaint_records enable row level security;
alter table public.call_daily        enable row level security;

drop policy if exists "work_records read"   on public.work_records;
drop policy if exists "work_records insert" on public.work_records;
create policy "work_records read"   on public.work_records for select to anon, authenticated using (true);
create policy "work_records insert" on public.work_records for insert to anon, authenticated with check (true);

drop policy if exists "complaint_records read"   on public.complaint_records;
drop policy if exists "complaint_records insert" on public.complaint_records;
create policy "complaint_records read"   on public.complaint_records for select to anon, authenticated using (true);
create policy "complaint_records insert" on public.complaint_records for insert to anon, authenticated with check (true);

-- call_daily 쓰기는 Edge Function(service_role)만 → 읽기 정책만 둔다.
drop policy if exists "call_daily read" on public.call_daily;
create policy "call_daily read" on public.call_daily for select to anon, authenticated using (true);
