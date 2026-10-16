import type { Answers, Question } from "../shared/types.ts";
export type AttemptRecord = {
  id: string;
  user_id: string;
  test_id: string;
  assignment_id: string;
  test_title: string;
  student_name: string;
  group_name: string;
  status: string;
  started_at: string;
  deadline: string | null;
  finished_at: string | null;
  pass_percent: number;
  question_snapshot_json: string;
  answer_key_json: string;
  answers_json: string;
  version: number;
  score: number | null;
  percent: number | null;
  passed: number | null;
  proctor_mode: string;
  proctor_limit: number;
  fullscreen: number;
  show_result: number;
  show_history: number;
  violation_count: number;
  proctor_epoch: number;
  client_id: string | null;
  client_lease_until: number;
};
export function publicAttempt(row: AttemptRecord, admin = false) {
  const {
    question_snapshot_json,
    answer_key_json: _key,
    answers_json,
    client_id: _client,
    client_lease_until: _lease,
    ...rest
  } = row;
  const hidden = !admin && !row.show_result;
  return {
    ...rest,
    score: hidden ? null : row.score,
    percent: hidden ? null : row.percent,
    passed: hidden ? null : row.passed,
    questions: JSON.parse(question_snapshot_json) as Question[],
    answers: JSON.parse(answers_json) as Answers,
    server_now: new Date().toISOString(),
  };
}
export function validateAnswers(
  value: unknown,
  questions: Question[],
): Answers {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("Неверный формат ответов.");
  const allowed = new Map(
    questions.map((q) => [q.id, new Set(q.options.map((o) => o.id))]),
  );
  const result: Answers = {};
  for (const [id, selected] of Object.entries(value)) {
    if (
      !allowed.has(id) ||
      typeof selected !== "string" ||
      !allowed.get(id)!.has(selected)
    )
      throw new Error("Ответ не соответствует вопросу этой попытки.");
    result[id] = selected;
  }
  return result;
}
export function grade(
  answers: Answers,
  key: Record<string, string>,
  threshold: number,
) {
  const total = Object.keys(key).length;
  const score = Object.entries(key).filter(
    ([id, correct]) => answers[id] === correct,
  ).length;
  const percent = total ? Math.round((score / total) * 10000) / 100 : 0;
  return {
    score,
    percent,
    passed: Number(total > 0 && score * 100 >= total * threshold),
  };
}
export async function finalize(
  db: D1Database,
  id: string,
  requested?: { answers: Answers; version: number; clientId: string },
  reason?: "blocked" | "expired",
  initial?: AttemptRecord,
) {
  for (let retry = 0; retry < 5; retry++) {
    const row =
      retry === 0 && initial?.id === id
        ? initial
        : await db
            .prepare("SELECT * FROM attempts WHERE id=?")
            .bind(id)
            .first<AttemptRecord>();
    if (!row) throw new Error("Попытка не найдена.");
    if (row.status !== "active") return row;
    const expired = row.deadline && Date.parse(row.deadline) <= Date.now();
    const blocked =
      row.proctor_mode === "block" && row.violation_count >= row.proctor_limit;
    if (!reason && !expired && !blocked && !requested) return row;
    // Expired or blocked attempts use only already acknowledged server answers.
    let answers = JSON.parse(row.answers_json) as Answers,
      version = row.version;
    if (requested && !expired && !blocked) {
      if (
        row.client_id !== requested.clientId ||
        row.client_lease_until < Date.now()
      )
        throw new Error(
          "Попытка открыта в другой вкладке. Подключитесь заново.",
        );
      if (requested.version === row.version) {
        const values = validateAnswers(requested.answers, JSON.parse(row.question_snapshot_json));
        if (Object.keys(values).length !== Object.keys(answers).length || Object.entries(values).some(([id,value])=>answers[id]!==value))
          throw new Error("Ответы изменяются в другой вкладке. Подключитесь заново перед завершением.");
      }
      if (requested.version > row.version) {
        answers = validateAnswers(
          requested.answers,
          JSON.parse(row.question_snapshot_json),
        );
        version = requested.version;
      }
    }
    const result = grade(
      answers,
      JSON.parse(row.answer_key_json),
      row.pass_percent,
    );
    const status =
      blocked || reason === "blocked"
        ? "blocked"
        : expired || reason === "expired"
          ? "expired"
          : "completed";
    const finishedAt = new Date().toISOString();
    const saved = await db
      .prepare(
        `UPDATE attempts SET status=?,finished_at=?,answers_json=?,version=?,score=?,percent=?,passed=? WHERE id=? AND status='active' AND version=? AND violation_count=? AND (?=0 OR (client_id=? AND client_lease_until>=?))`,
      )
      .bind(
        status,
        finishedAt,
        JSON.stringify(answers),
        version,
        result.score,
        result.percent,
        status === "blocked" ? 0 : result.passed,
        id,
        row.version,
        row.violation_count,
        Number(Boolean(requested && !expired && !blocked)),
        requested?.clientId || null,
        Date.now(),
      )
      .run();
    if (saved.meta.changes)
      return {
        ...row,
        status,
        finished_at: finishedAt,
        answers_json: JSON.stringify(answers),
        version,
        ...result,
        passed: status === "blocked" ? 0 : result.passed,
      };
  }
  throw new Error("Ответы изменяются в другой вкладке. Повторите завершение.");
}
export function shuffle<T>(items: T[]): T[] {
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i--) {
    const n = crypto.getRandomValues(new Uint32Array(1))[0];
    const j = n % (i + 1);
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}
