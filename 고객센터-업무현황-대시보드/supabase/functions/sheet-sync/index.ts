// 구글 시트 → Supabase 동기화 수신용 Edge Function (sheet-sync)
//
// 호출자: Apps Script. 요청 본문:
//   업무 현황 (work-sheet-sync.gs)
//     { dataset: "work_daily", rows: [{ date, agent, work_type, count, seconds }], allowShrink?: boolean }
//   통화 현황 (고객센터-응답률-분석/call-daily-sync-apps-script.gs)
//     { dataset: "call_daily", rows: [{ date, total_calls, answered, unanswered }], allowShrink?: boolean }
// 인증: 헤더 x-sync-secret 이 환경변수 SHEET_SYNC_SECRET 과 같아야 한다.
//       (JWT 검증은 끄고 배포 — 브라우저용 키가 아니라 공유 비밀값으로만 호출 허용)
// 동작: 시트 전체 스냅샷을 받아 upsert(같은 날짜·상담사·업무는 값 갱신) 후,
//       이번 스냅샷에 없는 옛 행(시트에서 지운 행)을 삭제한다. 결과는 sync_logs 에 남긴다.
// service_role 키는 Supabase가 함수 환경변수로 자동 주입하며 브라우저/저장소에 노출되지 않는다.

import { createClient } from "jsr:@supabase/supabase-js@2";

const WORK_TYPES = new Set(["call_in", "call_out", "chat", "open"]);
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

type Row = Record<string, string | number | null>;
type Dataset = { table: string; conflict: string; validate: (rows: unknown) => { rows: Row[]; errors: string[] } };

function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

function timingSafeEqual(a: string, b: string) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

function validateWorkDaily(rows: unknown): { rows: Row[]; errors: string[] } {
  const errors: string[] = [];
  if (!Array.isArray(rows)) return { rows: [], errors: ["rows 가 배열이 아닙니다."] };
  const seen = new Set<string>();
  const out: Row[] = [];
  rows.forEach((r: any, i) => {
    const where = `rows[${i}]`;
    if (!r || typeof r !== "object") return errors.push(`${where}: 객체가 아닙니다.`);
    const { date, agent, work_type, count, seconds } = r;
    if (typeof date !== "string" || !DATE_RE.test(date) || isNaN(Date.parse(date))) errors.push(`${where}: 날짜 형식 오류 (${date})`);
    if (typeof agent !== "string" || !agent.trim() || agent.length > 20) errors.push(`${where}: 상담사 값 오류`);
    if (!WORK_TYPES.has(work_type)) errors.push(`${where}: 업무 구분 오류 (${work_type})`);
    if (!Number.isInteger(count) || count < 0) errors.push(`${where}: 건수 오류 (${count})`);
    if (!Number.isInteger(seconds) || seconds < 0) errors.push(`${where}: 시간(초) 오류 (${seconds})`);
    const key = `${date}|${agent}|${work_type}`;
    if (seen.has(key)) errors.push(`${where}: 중복 (${key})`);
    seen.add(key);
    out.push({ date, agent: String(agent).trim(), work_type, count, seconds });
  });
  return { rows: out, errors };
}

function validateCallDaily(rows: unknown): { rows: Row[]; errors: string[] } {
  const errors: string[] = [];
  if (!Array.isArray(rows)) return { rows: [], errors: ["rows 가 배열이 아닙니다."] };
  const seen = new Set<string>();
  const out: Row[] = [];
  const isCount = (v: unknown) => Number.isInteger(v) && (v as number) >= 0;
  rows.forEach((r: any, i) => {
    const where = `rows[${i}]`;
    if (!r || typeof r !== "object") return errors.push(`${where}: 객체가 아닙니다.`);
    const { date, total_calls, answered, unanswered } = r;
    if (typeof date !== "string" || !DATE_RE.test(date) || isNaN(Date.parse(date))) errors.push(`${where}: 날짜 형식 오류 (${date})`);
    if (!isCount(total_calls)) errors.push(`${where}: 전체 인입 오류 (${total_calls})`);
    if (!isCount(answered)) errors.push(`${where}: 응답 오류 (${answered})`);
    if (unanswered != null && !isCount(unanswered)) errors.push(`${where}: 미응답 오류 (${unanswered})`);
    if (seen.has(date)) errors.push(`${where}: 중복 날짜 (${date})`);
    seen.add(date);
    out.push({ date, total_calls, answered, unanswered: unanswered ?? null });
  });
  return { rows: out, errors };
}

const DATASETS: Record<string, Dataset> = {
  work_daily: { table: "work_daily_sheet", conflict: "date,agent,work_type", validate: validateWorkDaily },
  call_daily: { table: "call_daily", conflict: "date", validate: validateCallDaily },
};

Deno.serve(async (req) => {
  if (req.method !== "POST") return json(405, { error: "POST only" });

  const secret = Deno.env.get("SHEET_SYNC_SECRET") ?? "";
  if (!secret || !timingSafeEqual(req.headers.get("x-sync-secret") ?? "", secret)) {
    return json(401, { error: "unauthorized" });
  }

  const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
    auth: { persistSession: false },
  });
  let body: any;
  try {
    body = await req.json();
  } catch {
    return json(400, { error: "JSON 본문을 읽을 수 없습니다." });
  }
  const ds = DATASETS[body?.dataset];
  if (!ds) return json(400, { error: `지원하지 않는 dataset: ${body?.dataset}` });
  const log = (status: "success" | "error", row_count: number | null, message: string) =>
    sb.from("sync_logs").insert({ dataset: body.dataset, status, row_count, message: message.slice(0, 2000) });

  const { rows, errors } = ds.validate(body.rows);
  if (errors.length) {
    await log("error", null, `검증 실패 ${errors.length}건: ${errors.slice(0, 20).join(" / ")}`);
    return json(422, { error: "검증 실패", details: errors.slice(0, 50) });
  }
  if (!rows.length) {
    await log("error", 0, "빈 데이터 — 전체 삭제를 막기 위해 동기화를 중단했습니다.");
    return json(422, { error: "빈 데이터는 동기화하지 않습니다." });
  }

  // 시트가 실수로 잘렸을 때 DB가 같이 비지 않도록: 기존 행의 절반 미만이면 중단
  const { count: existing, error: countErr } = await sb.from(ds.table).select("*", { count: "exact", head: true });
  if (countErr) {
    await log("error", null, `기존 행 수 조회 실패: ${countErr.message}`);
    return json(500, { error: countErr.message });
  }
  if (!body.allowShrink && existing && rows.length < existing * 0.5) {
    const msg = `행 수 급감(기존 ${existing} → ${rows.length}) — 시트를 확인하세요. 의도한 것이면 allowShrink 로 다시 실행.`;
    await log("error", rows.length, msg);
    return json(409, { error: msg });
  }

  const syncedAt = new Date().toISOString();
  for (let i = 0; i < rows.length; i += 500) {
    const chunk = rows.slice(i, i + 500).map((r) => ({ ...r, synced_at: syncedAt }));
    const { error } = await sb.from(ds.table).upsert(chunk, { onConflict: ds.conflict });
    if (error) {
      await log("error", rows.length, `저장 실패: ${error.message}`);
      return json(500, { error: error.message });
    }
  }
  // 이번 스냅샷에 포함되지 않은 행 = 시트에서 지워진 행
  const { count: removed, error: delErr } = await sb
    .from(ds.table)
    .delete({ count: "exact" })
    .lt("synced_at", syncedAt);
  if (delErr) {
    await log("error", rows.length, `삭제 행 정리 실패: ${delErr.message}`);
    return json(500, { error: delErr.message });
  }

  const message = `upsert ${rows.length}행, 삭제 ${removed ?? 0}행`;
  await log("success", rows.length, message);
  return json(200, { ok: true, synced_at: syncedAt, upserted: rows.length, removed: removed ?? 0 });
});
