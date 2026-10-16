import { test } from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import { FocusEpisodes, normalizeEvent } from "../shared/proctor.ts";
import {
  grade,
  validateAnswers,
  finalize,
  publicAttempt,
  type AttemptRecord,
} from "../worker/exam.ts";
import { hashPassword, verifyPassword, digest } from "../worker/security.ts";
import app from "../worker/index.ts";

import {database} from "./support.ts";

test("grading uses exact threshold and rejects answers outside the snapshot", () => {
  assert.deepEqual(
    grade({ a: "x", b: "x", c: "no" }, { a: "x", b: "x", c: "y" }, 70),
    { score: 2, percent: 66.67, passed: 0 },
  );
  assert.equal(grade({ a: "x" }, { a: "x" }, 100).passed, 1);
  const key25 = Object.fromEntries(Array.from({ length: 25 }, (_, i) => [String(i), "A"]));
  const correct = (count: number) => Object.fromEntries(Object.keys(key25).slice(0, count).map((id) => [id, "A"]));
  assert.deepEqual(grade(correct(12), key25, 50), { score: 12, percent: 48, passed: 0 });
  assert.deepEqual(grade(correct(13), key25, 50), { score: 13, percent: 52, passed: 1 });
  assert.deepEqual(grade(correct(25), key25, 50), { score: 25, percent: 100, passed: 1 });
  assert.throws(() =>
    validateAnswers({ foreign: "x" }, [
      {
        id: "a",
        text: "Q",
        options: [
          { id: "x", text: "yes" },
          { id: "y", text: "no" },
        ],
      },
    ]),
  );
  assert.throws(() =>
    validateAnswers({ a: "foreign" }, [
      { id: "a", text: "Q", options: [{ id: "x", text: "yes" }] },
    ]),
  );
});
test("CenterTest focus episodes coalesce and retain departure identity", () => {
  let time = 100000,
    id = 0;
  const events: any[] = [];
  const episodes = new FocusEpisodes(
    (e) => events.push(e),
    () => String(++id),
    () => time,
  );
  episodes.change("focus", false);
  episodes.change("hidden", false);
  episodes.change("fullscreen", false);
  assert.equal(events.length, 1);
  time += 120;
  episodes.change("focus", true);
  assert.equal(events[1].id, events[0].id);
  assert.equal(events[1].durationMs, 120);
  episodes.change("hidden", false);
  assert.equal(events[2].id, "2");
  assert.equal(
    normalizeEvent({
      id: "invalid",
      kind: "focus",
      occurredAt: new Date().toISOString(),
    }),
    null,
  );
});
test("passwords are salted and verify without retaining plaintext", async () => {
  const a = await hashPassword("test-password-strong"),
    b = await hashPassword("test-password-strong");
  assert.notEqual(a, b);
  assert.ok(!a.includes("test-password"));
  assert.equal(await verifyPassword("test-password-strong", a), true);
  assert.equal(await verifyPassword("wrong", a), false);
});
test("API access, snapshots, version order, leases, events, finalization, expiry and isolation", async () => {
  const { sql, db } = database();
  const timestamp = new Date().toISOString(),
    studentPass = await hashPassword("student-password"),
    adminPass = await hashPassword("admin-password");
  sql
    .prepare("INSERT INTO groups(id,name,created_at) VALUES(?,?,?)")
    .run("g", "FA-QA", timestamp);
  for (const [id, role, hash] of [
    ["admin", "superadmin", adminPass],
    ["student", "student", studentPass],
    ["other", "student", studentPass],
  ])
    sql
      .prepare(
        "INSERT INTO users(id,name,login,password_hash,role,group_id,created_at) VALUES(?,?,?,?,?,?,?)",
      )
      .run(id, id, `${id}qa`, hash, role, "g", timestamp);
  const env: any = {
    DB: db,
    ASSETS: {
      fetch: async () =>
        new Response(readFileSync("public/fonts/Roboto-Regular.ttf")),
    },
    APP_NAME: "Академия финансов",
  };
  async function req(
    path: string,
    data?: unknown,
    cookie = "",
    method?: string,
  ) {
    const response = await app.fetch(
      new Request(`https://qa.local/api${path}`, {
        method: method || (data ? "POST" : "GET"),
        headers: {
          ...(data ? { "Content-Type": "application/json" } : {}),
          ...(cookie ? { Cookie: cookie } : {}),
          Origin: "https://qa.local",
        },
        body: data ? JSON.stringify(data) : undefined,
      }),
      env,
    );
    const value: any = await response.json().catch(() => null);
    return { response, value };
  }
  const adminLogin = await req("/auth/login", {
    login: "adminqa",
    password: "admin-password",
  });
  assert.equal(adminLogin.response.status, 200);
  const adminCookie = adminLogin.response.headers
    .get("set-cookie")!
    .split(";")[0];
  assert.ok(
    adminLogin.response.headers.get("set-cookie")!.includes("HttpOnly"),
  );
  assert.ok(adminLogin.response.headers.get("set-cookie")!.includes("Secure"));
  const login = await req("/auth/login", {
    login: "studentqa",
    password: "student-password",
  });
  const cookie = login.response.headers.get("set-cookie")!.split(";")[0];
  const other = await req("/auth/login", {
    login: "otherqa",
    password: "student-password",
  });
  const otherCookie = other.response.headers.get("set-cookie")!.split(";")[0];
  assert.equal(
    (await req("/admin/tests", undefined, cookie)).response.status,
    403,
  );
  assert.equal((await req("/student/tests")).response.status, 401);
  const defaults = {
    title: "QA test",
    discipline: "Finance",
    description: "QA",
    question_count: 3,
    pass_percent: 70,
    minutes: 20,
    max_attempts: 2,
    published: 0,
    proctor_mode: "block",
    proctor_limit: 3,
    fullscreen: 0,
    show_result: 1,
    show_history: 1,
  };
  const created = await req("/admin/tests", defaults, adminCookie);
  assert.equal(created.response.status, 201);
  const testId = created.value.id;
  for (let n = 0; n < 5; n++) {
    const q = await req(
      "/admin/questions",
      {
        test_id: testId,
        text: `Financial QA question ${n}`,
        options: [
          { id: "1", text: "Correct" },
          { id: "2", text: "Incorrect" },
        ],
        correct_id: "1",
      },
      adminCookie,
    );
    assert.equal(q.response.status, 201);
  }
  assert.equal(
    (
      await req(
        `/admin/tests/${testId}`,
        { ...defaults, published: 1 },
        adminCookie,
        "PUT",
      )
    ).response.status,
    200,
  );
  const assign = await req(
    "/admin/assignments",
    {
      test_id: testId,
      group_ids: ["g"],
      user_ids: [],
      starts_at: null,
      ends_at: null,
      max_attempts: 2,
    },
    adminCookie,
  );
  assert.equal(assign.response.status, 200);
  const future = new Date(Date.now() + 3600000).toISOString();
  sql.prepare("INSERT INTO assignments(id,test_id,user_id,starts_at,max_attempts,created_at) VALUES(?,?,?,?,?,?)").run("future-individual", testId, "student", future, 2, timestamp);
  assert.equal((await req("/student/start", { test_id: testId }, cookie)).response.status, 403, "future individual access overrides currently open group access");
  sql.prepare("UPDATE assignments SET closed=1 WHERE id='future-individual'").run();
  const beforeStart = { ...db.calls };
  const started = await req("/student/start", { test_id: testId }, cookie);
  assert.equal(db.calls.first - beforeStart.first, 1, "fresh launch is one atomic SQL call");
  assert.equal(db.calls.batch - beforeStart.batch, 0);
  assert.equal(started.response.status, 201);
  const attempt = started.value;
  assert.equal(attempt.questions.length, 3);
  assert.equal(new Set(attempt.questions.map((q: any) => q.id)).size, 3);
  assert.equal(JSON.stringify(attempt).includes("correct_id"), false);
  assert.equal(Object.hasOwn(attempt, "answer_key_json"), false);
  assert.equal((await req("/admin/active-count", undefined, cookie)).response.status, 403);
  assert.equal((await req("/admin/active-count", undefined, adminCookie)).value.active, 1);
  sql.prepare("UPDATE attempts SET deadline=? WHERE id=?").run(new Date(Date.now() - 1000).toISOString(), attempt.id);
  assert.equal((await req("/admin/active-count", undefined, adminCookie)).value.active, 0, "expired attempts are excluded without scanning history or mutating results");
  sql.prepare("UPDATE attempts SET deadline=? WHERE id=?").run(attempt.deadline, attempt.id);
  const activePlan = sql.prepare("EXPLAIN QUERY PLAN SELECT COUNT(*) AS active FROM attempts WHERE status='active' AND (deadline IS NULL OR deadline>?)").all(timestamp);
  assert.ok(activePlan.some((row) => String(row.detail).includes("COVERING INDEX idx_attempts_status")), "active counter reads the covering status/deadline index");
  const assignmentId = sql
    .prepare("SELECT id FROM assignments WHERE test_id=?")
    .get(testId)!.id;
  await req(`/admin/assignments/${assignmentId}/close`, {}, adminCookie);
  const closedList = await req("/student/tests", undefined, cookie);
  assert.equal(
    closedList.value.find((t: any) => t.id === testId)?.active_attempt,
    attempt.id,
  );
  const repeat = await req("/student/start", { test_id: testId }, cookie);
  assert.equal(repeat.value.id, attempt.id);
  assert.deepEqual(repeat.value.questions, attempt.questions);
  await req(
    "/admin/assignments",
    {
      test_id: testId,
      group_ids: ["g"],
      user_ids: [],
      starts_at: null,
      ends_at: null,
      max_attempts: 2,
    },
    adminCookie,
  );
  assert.equal(
    (await req(`/student/attempts/${attempt.id}`, undefined, otherCookie))
      .response.status,
    404,
  );
  const client = crypto.randomUUID();
  assert.equal(
    (
      await req(
        `/student/attempts/${attempt.id}/lease`,
        { clientId: client, force: true },
        cookie,
      )
    ).response.status,
    200,
  );
  const beforeHeartbeat = { ...db.calls };
  const heartbeat = await req(`/student/attempts/${attempt.id}/lease`, { clientId: client, compact: true }, cookie);
  assert.equal(heartbeat.value.status, "active");
  assert.equal(Object.hasOwn(heartbeat.value, "questions"), false);
  assert.equal(db.calls.first - beforeHeartbeat.first, 1, "idle heartbeat is one atomic SQL call");
  assert.equal(db.calls.batch - beforeHeartbeat.batch, 0);
  assert.equal((await req(`/student/attempts/${attempt.id}/lease`, { clientId: crypto.randomUUID(), compact: true }, cookie)).response.status, 409);
  assert.equal((await req(`/student/attempts/${attempt.id}/lease`, { clientId: client, compact: true }, otherCookie)).response.status, 404);
  const answers = Object.fromEntries(
    attempt.questions.map((q: any) => [q.id, "1"]),
  );
  const save = (version: number, values: any) =>
    req(
      `/student/attempts/${attempt.id}/save`,
      { clientId: client, version, answers: values },
      cookie,
    );
  const beforeSave = { ...db.calls };
  const savedFast = await save(2, answers);
  assert.equal(savedFast.value.version, 2);
  assert.equal(db.calls.first - beforeSave.first, 1, "fresh save is one atomic SQL call");
  assert.equal(db.calls.batch - beforeSave.batch, 0);
  assert.match(savedFast.response.headers.get("server-timing")!, /total;dur=/);
  assert.equal((await save(3, { foreign: "1" })).response.status, 409);
  assert.equal((await save(3, { [attempt.questions[0].id]: "foreign" })).response.status, 409);
  await save(1, {});
  await save(2, {});
  const read = await req(`/student/attempts/${attempt.id}`, undefined, cookie);
  assert.deepEqual(read.value.answers, answers);
  assert.equal(
    (
      await req(
        `/student/attempts/${attempt.id}/save`,
        { clientId: crypto.randomUUID(), version: 3, answers: {} },
        cookie,
      )
    ).response.status,
    409,
  );
  const event = {
    id: crypto.randomUUID(),
    kind: "hidden",
    occurredAt: timestamp,
  };
  const events = (items: any[]) =>
    req(
      `/student/attempts/${attempt.id}/events`,
      { clientId: client, epoch: 0, events: items },
      cookie,
    );
  await events([event]);
  const duplicated = await events([
    event,
    { ...event, returnedAt: timestamp, durationMs: 300 },
  ]);
  assert.equal(duplicated.value.violation_count, 1);
  assert.equal(
    sql
      .prepare("SELECT COUNT(*) AS n FROM proctor_events WHERE attempt_id=?")
      .get(attempt.id)!.n,
    1,
  );
  await events([{ ...event, id: crypto.randomUUID(), kind: "reload" }]);
  assert.equal((await events([])).value.violation_count, 1);
  const blocked = await events([
    { ...event, id: crypto.randomUUID() },
    { ...event, id: crypto.randomUUID() },
  ]);
  assert.equal(blocked.value.attempt.status, "blocked");
  assert.equal(blocked.value.attempt.score, 3);
  assert.equal(blocked.value.attempt.passed, 0);
  const second = await req("/student/start", { test_id: testId }, cookie);
  const id = second.value.id;
  await req(
    `/student/attempts/${id}/lease`,
    { clientId: client, force: true },
    cookie,
  );
  const secondAnswers = Object.fromEntries(
    second.value.questions.map((q: any) => [q.id, "1"]),
  );
  // A second tab takes control after the owner was read but before finalization commits.
  db.beforeRun = (query: string) => {
    if (query.includes("SET status=?,finished_at=?")) {
      db.beforeRun = undefined;
      sql
        .prepare("UPDATE attempts SET client_id=? WHERE id=?")
        .run(crypto.randomUUID(), id);
    }
  };
  const interrupted = await req(
    `/student/attempts/${id}/finish`,
    { clientId: client, version: 1, answers: secondAnswers },
    cookie,
  );
  assert.equal(interrupted.response.status, 409);
  assert.equal(
    sql.prepare("SELECT status FROM attempts WHERE id=?").get(id)!.status,
    "active",
  );
  await req(
    `/student/attempts/${id}/lease`,
    { clientId: client, force: true },
    cookie,
  );
  const finish = await req(
    `/student/attempts/${id}/finish`,
    { clientId: client, version: 1, answers: secondAnswers },
    cookie,
  );
  assert.equal(finish.value.percent, 100);
  const again = await req(
    `/student/attempts/${id}/finish`,
    { clientId: client, version: 2, answers: {} },
    cookie,
  );
  assert.equal(again.value.percent, 100);
  assert.equal(again.value.finished_at, finish.value.finished_at);
  assert.equal(
    (await req("/student/start", { test_id: testId }, cookie)).response.status,
    403,
  );
  assert.equal(
    sql
      .prepare("SELECT COUNT(*) AS n FROM attempts WHERE user_id='student'")
      .get()!.n,
    2,
  );
  const expired = await req("/student/start", { test_id: testId }, otherCookie);
  await req(
    `/student/attempts/${expired.value.id}/lease`,
    { clientId: client, force: true },
    otherCookie,
  );
  sql
    .prepare("UPDATE attempts SET deadline=? WHERE id=?")
    .run("2000-01-01T00:00:00.000Z", expired.value.id);
  const late = await req(
    `/student/attempts/${expired.value.id}/finish`,
    {
      clientId: client,
      version: 99,
      answers: Object.fromEntries(
        expired.value.questions.map((q: any) => [q.id, "1"]),
      ),
    },
    otherCookie,
  );
  assert.equal(late.value.status, "expired");
  assert.equal(late.value.score, 0);
  const raw = sql
    .prepare("SELECT * FROM attempts WHERE id=?")
    .get(id) as unknown as AttemptRecord;
  assert.ok(!Object.hasOwn(publicAttempt(raw), "answer_key_json"));
  await req(
    "/admin/import/students/commit",
    {
      rows: [
        {
          name: "Imported Student",
          login: "importedqa",
          password: "",
          group: "New QA group",
        },
      ],
      mode: "skip",
    },
    adminCookie,
  );
  const duplicateImport = await req(
    "/admin/import/students/commit",
    {
      rows: [
        {
          name: "Imported Student",
          login: "importedqa",
          password: "",
          group: "New QA group",
        },
      ],
      mode: "skip",
    },
    adminCookie,
  );
  assert.equal(duplicateImport.value.created, 0);
  assert.equal(duplicateImport.value.skipped, 1);
  sql.prepare("UPDATE users SET blocked=1 WHERE id='student'").run();
  assert.equal(
    (await req("/student/tests", undefined, cookie)).response.status,
    401,
  );
  assert.equal((await req(`/student/attempts/${id}/save`, { clientId: client, version: 999, answers: {} }, cookie)).response.status, 401);
  assert.equal((await req(`/student/attempts/${id}`, undefined, cookie)).response.status, 401);
  sql.close();
});
test("Cloudflare quota errors return service-unavailable and a reset interval", async () => {
  const env: any = { DB: { prepare: () => ({ bind() { return this; }, async first() { throw new Error("D1_ERROR: Your account has exceeded D1's free tier daily row read limit."); } }) } };
  const response = await app.fetch(new Request("https://qa.local/api/auth/me", { headers: { Cookie: "fa_session=quota-test" } }), env);
  assert.equal(response.status, 503);
  const retry = Number(response.headers.get("retry-after"));
  assert.ok(retry > 0 && retry <= 86400);
  const data: any = await response.json();
  assert.match(data.error, /временно недоступен/);
  assert.equal(data.error.includes("D1_ERROR"), false);
});
