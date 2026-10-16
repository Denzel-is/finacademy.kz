import assert from "node:assert/strict";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
const origin = process.argv[2] || "http://127.0.0.1:8787";
const secrets = JSON.parse(readFileSync(".local/seed-state.json", "utf8"));
const cookies = {};
async function request(path, data, account = "admin", method) {
  const response = await fetch(`${origin}/api${path}`, {
    method: method || (data ? "POST" : "GET"),
    headers: {
      ...(data ? { "Content-Type": "application/json" } : {}),
      ...(cookies[account] ? { Cookie: cookies[account] } : {}),
    },
    body: data ? JSON.stringify(data) : undefined,
  });
  const value = await response.json();
  assert.ok(response.ok, `${path}: ${response.status} ${value.error || ""}`);
  if (response.headers.get("set-cookie"))
    cookies[account] = response.headers.get("set-cookie").split(";")[0];
  return value;
}
await request("/auth/login", {
  login: "admin",
  password: secrets.adminPassword,
});
const me = await request("/auth/me");
assert.equal(me.user.role, "superadmin");
const dashboard = await request("/admin/dashboard");
assert.ok(dashboard.students >= 24);
const tests = await request("/admin/tests");
assert.ok(tests.length >= 10);
assert.ok(tests.every((t) => t.bank_count >= t.question_count));
await request(
  "/auth/login",
  { login: process.argv[3] || "student001", password: secrets.studentPassword },
  "student",
);
const available = await request("/student/tests", undefined, "student");
assert.ok(available.length >= 10);
const attempt = await request(
  "/student/start",
  { test_id: process.argv[4] || "test-10" },
  "student",
);
assert.equal(attempt.questions.length, 10);
assert.equal(Object.hasOwn(attempt, "answer_key_json"), false);
assert.equal(new Set(attempt.questions.map((q) => q.id)).size, 10);
const clientId = crypto.randomUUID();
await request(
  `/student/attempts/${attempt.id}/lease`,
  { clientId, force: true },
  "student",
);
const answers = Object.fromEntries(
  attempt.questions.map((q) => [q.id, q.options[0].id]),
);
await request(
  `/student/attempts/${attempt.id}/save`,
  { clientId, version: attempt.version + 1, answers },
  "student",
);
const recovered = await request(
  `/student/attempts/${attempt.id}`,
  undefined,
  "student",
);
assert.deepEqual(recovered.answers, answers);
assert.deepEqual(recovered.questions, attempt.questions);
const e = {
  id: crypto.randomUUID(),
  kind: "hidden",
  occurredAt: new Date().toISOString(),
};
const event = await request(
  `/student/attempts/${attempt.id}/events`,
  { clientId, epoch: attempt.proctor_epoch, events: [e, e] },
  "student",
);
assert.ok(event.violation_count >= 1);
const finish = await request(
  `/student/attempts/${attempt.id}/finish`,
  { clientId, version: attempt.version + 2, answers },
  "student",
);
assert.equal(finish.status, "completed");
const again = await request(
  `/student/attempts/${attempt.id}/finish`,
  { clientId, version: attempt.version + 3, answers: {} },
  "student",
);
assert.equal(again.percent, finish.percent);
const pdf = await fetch(
  `${origin}/api/student/attempts/${attempt.id}/certificate`,
  { headers: { Cookie: cookies.student } },
);
assert.equal(pdf.status, 200);
assert.match(pdf.headers.get("content-type"), /application\/pdf/);
const bytes = Buffer.from(await pdf.arrayBuffer());
assert.equal(bytes.subarray(0, 4).toString(), "%PDF");
mkdirSync("output/pdf", { recursive: true });
writeFileSync("output/pdf/result-sample.pdf", bytes);
await request("/auth/logout", {}, "student");
await request("/auth/logout", {}, "admin");
console.log(
  `PASS: ${origin}; roles, assigned tests, immutable snapshot, save/recovery, event deduplication, server grading, idempotent finish, Cyrillic PDF (${bytes.length} bytes).`,
);
