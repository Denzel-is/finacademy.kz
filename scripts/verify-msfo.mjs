import assert from "node:assert/strict";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { administrator, base } from "./load-support.mjs";

// Consumes one attempt in each bank for the pre-existing fictitious student024.
const admin = await administrator();
const fixture = JSON.parse(readFileSync(".local/msfo/deployed.json", "utf8"));
const credentials = JSON.parse(readFileSync(".local/seed-state.json", "utf8"));
assert.equal(fixture.base, base);
let cookie = "";
async function student(path, data, binary = false) {
  const response = await fetch(`${base}/api${path}`, {
    method: data === undefined ? "GET" : "POST",
    headers: { ...(cookie ? { Cookie: cookie } : {}), ...(data === undefined ? {} : { "Content-Type": "application/json" }) },
    body: data === undefined ? undefined : JSON.stringify(data),
    signal: AbortSignal.timeout(60000),
  });
  const session = response.headers.get("set-cookie");
  if (session) cookie = session.split(";")[0];
  assert.ok(response.ok, `${path}: HTTP ${response.status}`);
  if (binary) {
    assert.match(response.headers.get("content-type"), /application\/pdf/);
    return Buffer.from(await response.arrayBuffer());
  }
  return response.json();
}
await student("/auth/login", { login: "student024", password: credentials.studentPassword });
const assigned = await student("/student/tests");
mkdirSync("output/msfo", { recursive: true });
const report = { base, verified_at: new Date().toISOString(), account: "student024 (fictitious)", cases: [] };
for (const [lang, correctCount] of [["RU", 13], ["KZ", 12]]) {
  const id = fixture.tests[lang];
  const config = assigned.find((t) => t.id === id);
  assert.ok(config);
  assert.equal(config.question_count, 25);
  assert.equal(config.minutes, 60);
  assert.equal(config.pass_percent, 50);
  const bank = (await admin(`/admin/questions?test_id=${id}`)).filter((q) => !q.archived);
  assert.ok(bank.length === 199 || bank.length === 200);
  const key = Object.fromEntries(bank.map((q) => [q.id, q.correct_id]));
  const attempt = await student("/student/start", { test_id: id });
  assert.equal(attempt.status, "active");
  assert.equal(attempt.questions.length, 25);
  assert.equal(new Set(attempt.questions.map((q) => q.id)).size, 25);
  assert.ok(attempt.questions.every((q) => Object.hasOwn(key, q.id)));
  assert.ok(attempt.questions.every((q) => !Object.hasOwn(q, "correct_id")));
  assert.equal(Object.hasOwn(attempt, "answer_key_json"), false);
  assert.equal(Date.parse(attempt.deadline) - Date.parse(attempt.started_at), 3600000);
  const clientId = crypto.randomUUID();
  await student(`/student/attempts/${attempt.id}/lease`, { clientId, force: true });
  const answers = Object.fromEntries(attempt.questions.map((q, i) => [q.id,
    i < correctCount ? key[q.id] : q.options.find((o) => o.id !== key[q.id]).id,
  ]));
  await student(`/student/attempts/${attempt.id}/save`, { clientId, version: attempt.version + 1, answers });
  const recovered = await student(`/student/attempts/${attempt.id}`);
  assert.deepEqual(recovered.answers, answers);
  assert.deepEqual(recovered.questions, attempt.questions);
  const finished = await student(`/student/attempts/${attempt.id}/finish`, { clientId, version: attempt.version + 2, answers });
  assert.equal(finished.status, "completed");
  assert.equal(finished.score, correctCount);
  assert.equal(finished.percent, correctCount * 4);
  assert.equal(finished.passed, Number(correctCount >= 13));
  const repeat = await student(`/student/attempts/${attempt.id}/finish`, { clientId, version: attempt.version + 3, answers: {} });
  assert.equal(repeat.finished_at, finished.finished_at);
  assert.equal(repeat.percent, finished.percent);
  const stored = await admin(`/admin/attempts/${attempt.id}`);
  assert.deepEqual(stored.attempt.answers, answers);
  assert.equal(stored.attempt.percent, finished.percent);
  const bytes = await student(`/student/attempts/${attempt.id}/certificate`, undefined, true);
  assert.equal(bytes.subarray(0, 4).toString(), "%PDF");
  writeFileSync(`output/msfo/result-${lang.toLowerCase()}.pdf`, bytes);
  report.cases.push({ language: lang, title: config.title, attempt_id: attempt.id, bank_count: bank.length, selected_unique: 25, timer_seconds: 3600, saved_answers: 25, correct_answers: correctCount, points: finished.percent, max_points: 100, pass_points: 50, passed: Boolean(finished.passed), pdf_bytes: bytes.length, immutable_snapshot: true, idempotent_finish: true, keys_hidden: true });
  writeFileSync("output/msfo/verification.json", JSON.stringify(report, null, 2));
  console.log(`${lang}: ${correctCount}/25 correct = ${finished.percent}/100, ${finished.passed ? "passed" : "failed"}; snapshot, recovery, timer, server result and PDF verified.`);
}
await student("/auth/logout", {});
await admin("/auth/logout", {});
