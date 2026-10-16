import assert from "node:assert/strict";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { performance } from "node:perf_hooks";
import { administrator, base } from "./load-support.mjs";
import { Agent } from "undici";
import { Http2Transport } from "./load-http2.mjs";

const fixturePath = process.env.LOAD_FIXTURE || ".local/load-fixture.json";
const fixture = JSON.parse(readFileSync(fixturePath, "utf8"));
const questionCount = fixture.question_count || 10;
// Preserve TCP/TLS connections across the 15–19 second browser-like save interval.
// Cookies remain isolated per student; no result/auth response cache is used.
const dispatcher = new Agent({ connections: 300, pipelining: 1, keepAliveTimeout: 65000, keepAliveMaxTimeout: 65000 });
const http2 = process.env.LOAD_HTTP2 === "1" ? new Http2Transport(base) : null;
const loadFetch = http2 ? http2.fetch.bind(http2) : fetch;
assert.equal(base, fixture.base);
assert.equal(fixture.users.length, 300);
const duration = Number(process.env.DURATION_SECONDS || 180);
assert.ok(duration >= 60 && duration <= 3600);
const runId = new Date().toISOString().replace(/[:.]/g, "-");
mkdirSync("output/load", { recursive: true });
const report = {
  run_id: runId,
  base,
  requested_users: 300,
  duration_seconds: duration,
  questions_per_attempt: questionCount,
  bank_count: fixture.bank_count || 20,
  transport: http2 ? "HTTP/2, 300 pooled TLS connections, 300 isolated session cookies" : "HTTP/1.1 keep-alive, max 300 pooled connections; 300 isolated session cookies",
  active_checkpoints: [],
  server_timing: {},
  revisions: {},
  worker_colos: {},
  in_progress: true,
  started_at: new Date().toISOString(),
  phases: {},
  requests: 0,
  failures: [],
  recovered_requests: 0,
  retry_attempts: 0,
  checks: 0,
  check_failures: [],
  peak_active: 0,
  confirmed_completed: 0,
  confirmed_answers: 0,
  confirmed_grades: 0,
};
const timings = new Map();
const serverTimings = new Map();
const percentileStats = (input) => {
  const values = [...input].sort((a, b) => a - b);
  const at = (p) => Math.round(values[Math.min(values.length - 1, Math.ceil(values.length * p) - 1)]);
  return { requests: values.length, p50_ms: at(.5), p95_ms: at(.95), p99_ms: at(.99), max_ms: Math.round(values.at(-1)) };
};
const sessions = fixture.users.map((user) => ({
  ...user,
  cookie: "",
  clientId: randomUUID(),
  version: 0,
  answers: {},
  attempt: null,
  finished: null,
}));
const admin = await administrator();
const saveReport = () => {
  for (const [phase, values] of timings) report.phases[phase] = { ...report.phases[phase], ...percentileStats(values) };
  for (const [phase, values] of serverTimings) report.server_timing[phase] = percentileStats(values);
  report.updated_at = new Date().toISOString();
  writeFileSync(`output/load/${runId}.json`, JSON.stringify(report, null, 2));
};
function check(condition, label, login) {
  report.checks++;
  if (!condition) {
    report.check_failures.push({ label, login });
    throw new Error(`Check failed: ${label} (${login})`);
  }
}
async function requestOnce(s, path, data, phase) {
  const t = performance.now();
  report.requests++;
  let status = 0;
  try {
    const res = await loadFetch(`${base}/api${path}`, {
      method: data === undefined ? "GET" : "POST",
      headers: {
        ...(data === undefined ? {} : { "Content-Type": "application/json" }),
        ...(s.cookie ? { Cookie: s.cookie } : {}),
      },
      body: data === undefined ? undefined : JSON.stringify(data),
      signal: AbortSignal.timeout(60000),
      dispatcher,
    });
    status = res.status;
    const revision = res.headers.get("x-app-revision") || "unknown";
    report.revisions[revision] = (report.revisions[revision] || 0) + 1;
    const colo = res.headers.get("x-worker-colo") || "unknown";
    report.worker_colos[colo] = (report.worker_colos[colo] || 0) + 1;
    for (const match of (res.headers.get("server-timing") || "").matchAll(/([a-z]+);dur=([\d.]+)/g)) {
      const label = `${phase}.${match[1]}`;
      const values = serverTimings.get(label) || [];
      values.push(Number(match[2]));
      serverTimings.set(label, values);
    }
    let value;
    try { value = await res.json(); } catch (error) { error.transportFailure = true; throw error; }
    if (!res.ok) throw new Error(value.error || `HTTP ${status}`);
    const cookie = res.headers.get("set-cookie");
    if (cookie) s.cookie = cookie.split(";")[0];
    return value;
  } catch (e) {
    report.failures.push({ phase, login: s.login, status, error: e.message });
    e.status = e.transportFailure ? 0 : status;
    throw e;
  } finally {
    const values = timings.get(phase) || [];
    values.push(performance.now() - t);
    timings.set(phase, values);
  }
}
async function request(s, path, data, phase) {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const value = await requestOnce(s, path, data, phase);
      if (attempt) report.recovered_requests++;
      return value;
    } catch (error) {
      if (
        attempt === 2 ||
        !(error.status === 0 || error.status >= 500 || error.status === 429)
      )
        throw error;
      report.retry_attempts++;
      await new Promise((r) => setTimeout(r, 300 * 2 ** attempt));
    }
  }
}
async function phase(name, action) {
  const t = Date.now();
  const results = await Promise.allSettled(sessions.map((s) => action(s)));
  const failed = results.filter((r) => r.status === "rejected");
  report.phases[name] = {
    users: results.length,
    succeeded: 300 - failed.length,
    failed: failed.length,
    elapsed_ms: Date.now() - t,
  };
  saveReport();
  console.log(
    `${name}: ${300 - failed.length}/300 successful (${Date.now() - t}ms)`,
  );
  if (failed.length)
    throw new Error(`${name}: ${failed.length} failed sessions; see report.`);
}
const pause = (ms) => new Promise((r) => setTimeout(r, ms));
try {
  // A browser loads the site before submitting the login form; warm HTTPS connections explicitly.
  await phase("connect", (s) => request(s, "/health", undefined, "connect"));
  await phase("login", (s) =>
    request(
      s,
      "/auth/login",
      { login: s.login, password: s.password },
      "login",
    ),
  );
  await phase("start", async (s) => {
    const a = await request(
      s,
      "/student/start",
      { test_id: fixture.test_id },
      "start",
    );
    check(a.status === "active", "active attempt", s.login);
    check(
      a.questions.length === questionCount &&
        new Set(a.questions.map((q) => q.id)).size === questionCount,
      "unique sample",
      s.login,
    );
    check(
      !Object.hasOwn(a, "answer_key_json") &&
        !JSON.stringify(a).includes("correct_id"),
      "no answer keys",
      s.login,
    );
    s.attempt = a;
    s.version = a.version;
    s.answers = { ...a.answers };
  });
  await phase("lease", (s) =>
    request(
      s,
      `/student/attempts/${s.attempt.id}/lease`,
      { clientId: s.clientId, force: true },
      "lease",
    ),
  );
  const active = (
    await admin(`/admin/results?test_id=${fixture.test_id}`)
  ).filter(
    (a) => a.status === "active" && sessions.some((s) => s.attempt.id === a.id),
  );
  report.peak_active = active.length;
  report.active_checkpoints.push({ at: new Date().toISOString(), active: active.length, elapsed_seconds: 0 });
  check(active.length === 300, "300 simultaneously active", "all");
  saveReport();
  console.log("Server confirms 300 active attempts simultaneously.");
  const end = Date.now() + duration * 1000;
  const examStarted = Date.now();
  report.exam_started_at = new Date(examStarted).toISOString();
  report.exam_due_at = new Date(end).toISOString();
  let lastLog = Date.now();
  let monitorBusy = null;
  const monitor = setInterval(() => {
    if (monitorBusy) return;
    monitorBusy = (async () => {
      const rows = await admin(`/admin/results?test_id=${fixture.test_id}`);
      const ids = new Set(sessions.map((s) => s.attempt.id));
      const count = rows.filter((a) => a.status === "active" && ids.has(a.id)).length;
      report.active_checkpoints.push({ at: new Date().toISOString(), active: count, elapsed_seconds: Math.round((Date.now() - examStarted) / 1000) });
      check(count === 300, "300 remain active throughout", "all");
      saveReport();
    })().catch((e) => { report.check_failures.push({ label: "active monitor", error: e.message }); }).finally(() => { monitorBusy = null; });
  }, 60000);
  try {
  await phase("exam", async (s) => {
    let round = 0;
    while (Date.now() < end) {
      if (round % 5 === 4) {
        const heartbeat = await request(s, `/student/attempts/${s.attempt.id}/lease`, { clientId: s.clientId, compact: true }, "heartbeat");
        check(heartbeat.status === "active" && heartbeat.version === s.version && !heartbeat.questions, "compact heartbeat preserves session", s.login);
      } else {
      const q = s.attempt.questions[round % s.attempt.questions.length];
      s.answers[q.id] =
        q.options[(round + Number(s.login.slice(-3))) % q.options.length].id;
      s.version++;
      const saved = await request(
        s,
        `/student/attempts/${s.attempt.id}/save`,
        { clientId: s.clientId, version: s.version, answers: s.answers },
        "save",
      );
      check(
        saved.version === s.version && !saved.attempt,
        "version acknowledged",
        s.login,
      );
      }
      if (round === 1) {
        const e = {
          id: randomUUID(),
          kind: "hidden",
          occurredAt: new Date().toISOString(),
          returnedAt: new Date().toISOString(),
          durationMs: 500,
        };
        const journal = await request(
          s,
          `/student/attempts/${s.attempt.id}/events`,
          {
            clientId: s.clientId,
            epoch: s.attempt.proctor_epoch,
            events: [e, e],
          },
          "events",
        );
        check(
          journal.violation_count === s.attempt.violation_count + 1,
          "duplicate event counted once",
          s.login,
        );
      }
      if (round === 2 || (round > 2 && round % 40 === 0)) {
        const recovered = await request(
          s,
          `/student/attempts/${s.attempt.id}`,
          undefined,
          "recovery",
        );
        check(
          JSON.stringify(recovered.answers) === JSON.stringify(s.answers),
          "answers restored",
          s.login,
        );
        check(
          JSON.stringify(recovered.questions) ===
            JSON.stringify(s.attempt.questions),
          "same immutable questions",
          s.login,
        );
      }
      round++;
      if (Date.now() - lastLog > 20000) {
        lastLog = Date.now();
        console.log(
          `Exam ongoing: ${Math.max(0, Math.ceil((end - Date.now()) / 1000))}s remaining, ${report.requests} requests, ${report.failures.length} errors.`,
        );
        saveReport();
      }
      await pause(
        Math.max(0, Math.min(15000 + Math.random() * 4000, end - Date.now())),
      );
    }
  });
  } finally {
    clearInterval(monitor);
    if (monitorBusy) await monitorBusy;
  }
  report.active_duration_seconds = Math.floor((Date.now() - examStarted) / 1000);
  check(report.active_duration_seconds >= duration, "full requested duration elapsed", "all");
  check(report.check_failures.length === 0, "all periodic checks passed", "all");
  const beforeFinish = (await admin(`/admin/results?test_id=${fixture.test_id}`)).filter((a) => a.status === "active" && sessions.some((s) => s.attempt.id === a.id));
  report.active_checkpoints.push({ at: new Date().toISOString(), active: beforeFinish.length, elapsed_seconds: report.active_duration_seconds });
  check(beforeFinish.length === 300, "300 active after full duration", "all");
  await phase("finish", async (s) => {
    // Answer every question before the synchronized finish, including any missed during a slow connection.
    for (const q of s.attempt.questions) {
      if (!Object.hasOwn(s.answers, q.id))
        s.answers[q.id] =
          q.options[Number(s.login.slice(-3)) % q.options.length].id;
    }
    s.version++;
    const a = await request(
      s,
      `/student/attempts/${s.attempt.id}/finish`,
      { clientId: s.clientId, version: s.version, answers: s.answers },
      "finish",
    );
    s.finished = a;
    check(a.status === "completed", "completed", s.login);
    check(
      JSON.stringify(a.answers) === JSON.stringify(s.answers),
      "all final answers preserved",
      s.login,
    );
    const score = a.questions.filter(
      (q) => s.answers[q.id] === fixture.answer_key[q.id],
    ).length;
    check(
      a.score === score &&
        a.percent === Math.round((score / a.questions.length) * 10000) / 100,
      "correct server grade",
      s.login,
    );
    const again = await request(
      s,
      `/student/attempts/${s.attempt.id}/finish`,
      { clientId: s.clientId, version: s.version, answers: s.answers },
      "repeat_finish",
    );
    check(
      again.percent === a.percent && again.finished_at === a.finished_at,
      "idempotent finish",
      s.login,
    );
  });
  await phase("verify", async (s) => {
    const result = await admin(`/admin/attempts/${s.attempt.id}`);
    check(
      result.attempt.status === "completed",
      "admin sees completion",
      s.login,
    );
    check(
      JSON.stringify(result.attempt.answers) === JSON.stringify(s.answers),
      "admin sees saved answers",
      s.login,
    );
    check(
      result.events.filter((e) => e.counted).length ===
        s.attempt.violation_count + 1,
      "one journal violation",
      s.login,
    );
    report.confirmed_completed++;
    report.confirmed_answers += Object.keys(result.attempt.answers).length;
    report.confirmed_grades++;
  });
  report.passed = true;
} catch (e) {
  report.passed = false;
  report.error = e.message;
  console.error(e.message);
  process.exitCode = 1;
} finally {
  report.in_progress = false;
  for (const [phase, values] of timings) {
    values.sort((a, b) => a - b);
    const percentile = (p) =>
      Math.round(
        values[Math.min(values.length - 1, Math.ceil(values.length * p) - 1)],
      );
    report.phases[phase] = {
      ...report.phases[phase],
      requests: values.length,
      p50_ms: percentile(0.5),
      p95_ms: percentile(0.95),
      p99_ms: percentile(0.99),
      max_ms: Math.round(values.at(-1)),
    };
  }
  report.finished_at = new Date().toISOString();
  report.elapsed_seconds = Math.round(
    (Date.parse(report.finished_at) - Date.parse(report.started_at)) / 1000,
  );
  report.error_rate = report.requests
    ? report.failures.length / report.requests
    : 0;
  report.performance_passed =
    ["login", "start", "save", "finish"].every(
      (phase) => report.phases[phase]?.p95_ms < 2000,
    ) && report.error_rate < 0.01;
  saveReport();
  const lines = [
    `# Прогон 300 студентов — ${report.started_at}`,
    ``,
    `Адрес: ${base}`,
    ``,
    `Функциональная проверка: ${report.passed ? "ПРОЙДЕНА" : "НЕ ПРОЙДЕНА"}.`,
    `Производительность p95 < 2 с / ошибки < 1%: ${report.performance_passed ? "ПРОЙДЕНА" : "НЕ ПРОЙДЕНА"}.`,
    `Одновременно активных попыток, подтверждено сервером: ${report.peak_active}.`,
    `Время активной работы: ${report.active_duration_seconds || 0} секунд. Общее время: ${report.elapsed_seconds} секунд.`,
    `Вопросов на студента: ${questionCount}; банк: ${report.bank_count}. Проверок числа активных сессий: ${report.active_checkpoints.length}.`,
    `Завершено и проверено администратором: ${report.confirmed_completed}/300.`,
    `Подтверждённых ответов: ${report.confirmed_answers}.`,
    `HTTP-запросов студентов: ${report.requests}; ошибок: ${report.failures.length}.`,
    `Повторных отправок после сбоев: ${report.retry_attempts}; успешно восстановленных операций: ${report.recovered_requests}.`,
    ``,
    `| Этап | Запросов | p50, мс | p95, мс | p99, мс |`,
    `|---|---:|---:|---:|---:|`,
    ...Object.entries(report.phases)
      .filter(([, p]) => p.requests)
      .map(
        ([name, p]) =>
          `| ${name} | ${p.requests} | ${p.p50_ms} | ${p.p95_ms} | ${p.p99_ms} |`,
      ),
    ``,
    `Нагрузка создавалась 300 независимыми HTTP-сессиями из Node.js с одного компьютера. TCP/TLS-соединения переиспользуются между сохранениями. Проверялись запуск, пакетное сохранение через 15–19 секунд, периодическое восстановление, дедупликация событий, массовое завершение, идемпотентность и серверные результаты. Это не 300 открытых браузеров.${report.passed && report.active_duration_seconds >= 3600 ? " Полный час активной работы подтверждён контрольными выборками сервера." : " Полный час активной работы этим прогоном не подтверждён."}`,
    ``,
    `| Серверный этап | Измерений | p50, мс | p95, мс | p99, мс |`,
    `|---|---:|---:|---:|---:|`,
    ...Object.entries(report.server_timing).map(([name, p]) => `| ${name} | ${p.requests} | ${p.p50_ms} | ${p.p95_ms} | ${p.p99_ms} |`),
    ...(report.error ? [``, `Ошибка: ${report.error}`] : []),
  ];
  writeFileSync(`output/load/${runId}.md`, lines.join("\n"));
  writeFileSync("output/load/latest.json", JSON.stringify(report, null, 2));
  writeFileSync("output/load/latest.md", lines.join("\n"));
  console.log(
    JSON.stringify({
      passed: report.passed,
      performance_passed: report.performance_passed,
      peak_active: report.peak_active,
      completed: report.confirmed_completed,
      requests: report.requests,
      errors: report.failures.length,
      report: `output/load/${runId}.md`,
    }),
  );
  await admin("/auth/logout", {}).catch(() => {});
  await dispatcher.close();
  if (http2) await http2.close();
}
