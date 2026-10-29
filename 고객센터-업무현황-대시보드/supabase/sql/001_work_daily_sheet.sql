-- 업무 현황: 구글 시트(통화 수신·발신 / 채널톡) 일별 집계 테이블
-- Supabase 대시보드 > SQL Editor 에 붙여넣고 Run.
--
-- 개인정보 최소화: 상담사 이름은 Apps Script에서 마스킹(김*옥)된 값만 들어오고,
-- 고객 정보·통화 원본은 저장하지 않는다. 날짜 × 상담사 × 업무 단위 합계만 저장.

create table if not exists public.work_daily_sheet (
  date        date        not null,
  agent       text        not null check (char_length(agent) between 1 and 20),
  work_type   text        not null check (work_type in ('call_in', 'call_out', 'chat')),
  count       integer     not null default 0 check (count >= 0),
  seconds     integer     not null default 0 check (seconds >= 0),
  synced_at   timestamptz not null default now(),
  primary key (date, agent, work_type)          -- 같은 날짜·상담사·업무 중복 저장 방지
);

-- 동기화 실행 기록 (성공/실패, 행 수, 메시지)
create table if not exists public.sync_logs (
  id          bigint generated always as identity primary key,
  dataset     text        not null,
  status      text        not null check (status in ('success', 'error')),
  row_count   integer,
  message     text,
  created_at  timestamptz not null default now()
);

alter table public.work_daily_sheet enable row level security;
alter table public.sync_logs        enable row level security;

-- 쓰기는 Edge Function(service_role, RLS 우회)만 한다 → insert/update/delete 정책은 만들지 않음.
-- 읽기: 대시보드는 아직 로그인 기능이 없어 publishable(anon) 키로 조회하므로 anon 읽기를 허용한다.
-- 로그인(Supabase Auth)을 붙이면 아래 정책의 `to anon, authenticated`를 `to authenticated`로 바꿀 것.
drop policy if exists "work_daily_sheet read" on public.work_daily_sheet;
create policy "work_daily_sheet read" on public.work_daily_sheet
  for select to anon, authenticated using (true);

-- sync_logs 는 정책 없음 = 브라우저(anon)에서 조회·수정 불가. 콘솔(Table Editor)에서만 확인.
