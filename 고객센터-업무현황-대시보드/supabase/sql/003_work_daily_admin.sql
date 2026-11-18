-- 업무 현황: 시트의 '전산처리 업무' 탭을 work_daily_sheet 로 받기 위해 업무 구분에 'admin' 추가
-- 기존 프로젝트에서 1회 Run. (새 프로젝트는 001 에 이미 반영돼 있어 생략 가능)
alter table public.work_daily_sheet drop constraint if exists work_daily_sheet_work_type_check;
alter table public.work_daily_sheet add constraint work_daily_sheet_work_type_check
  check (work_type in ('call_in', 'call_out', 'chat', 'open', 'admin'));
