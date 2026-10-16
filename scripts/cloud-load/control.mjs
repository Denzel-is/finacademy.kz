import { randomBytes, randomUUID } from "node:crypto";
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import assert from "node:assert/strict";
import { administrator } from "../load-support.mjs";

const secretPath = ".local/cloud-load-secrets.json";
if (!existsSync(secretPath)) writeFileSync(secretPath, JSON.stringify({ CONTROL_TOKEN: randomBytes(32).toString("hex") }));
const token = JSON.parse(readFileSync(secretPath, "utf8")).CONTROL_TOKEN;
const action = process.argv[2] || "status";
if (action === "secret") { console.log("Control secret prepared in ignored .local directory."); process.exit(0); }
const fixture = JSON.parse(readFileSync(".local/load-hour-fixture.json", "utf8"));
const statePath = ".local/cloud-load-state.json";
const base = "https://finance-academy-load.borodinda.workers.dev";
const pause = (ms) => new Promise((r) => setTimeout(r, ms));
async function control(path, body) {
  for (let n = 0; n < 5; n++) {
    try {
      const res = await fetch(base + path, { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` }, body: JSON.stringify(body), signal: AbortSignal.timeout(60000) });
      const value = await res.json();
      if (!res.ok) throw new Error(`Control HTTP ${res.status}: ${value.error}`);
      return value;
    } catch (e) { if (n === 4) throw e; await pause(1000 * (n + 1)); }
  }
}
const stats = (values) => {
  values.sort((a, b) => a - b);
  const at = (p) => Math.round(values[Math.min(values.length - 1, Math.ceil(p * values.length) - 1)] || 0);
  return { requests: values.length, p50_ms: at(.5), p95_ms: at(.95), p99_ms: at(.99), max_ms: at(1) };
};
if (action === "start" || action === "smoke") {
  const duration = action === "smoke" ? 60000 : 3600000;
  const runId = `cloud-${new Date().toISOString().replace(/[:.]/g, "-")}-${randomUUID().slice(0, 8)}`;
  const begin = Date.now() + (action === "smoke" ? 60000 : 180000);
  const users = action === "smoke" ? fixture.users.slice(0, 1) : fixture.users;
  const state = { runId, begin, end: begin + duration, duration, users: users.map(({ login }) => ({ login })), started_at: new Date().toISOString(), results: [] };
  writeFileSync(statePath, JSON.stringify(state, null, 2));
  const admin = await administrator();
  // Capture an ordinary authenticated admin cookie without printing it.
  const secrets = JSON.parse(readFileSync(".local/seed-state.json", "utf8"));
  const login = await fetch(`${fixture.base}/api/auth/login`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ login: "admin", password: secrets.adminPassword }) });
  assert.equal(login.status, 200);
  const adminCookie = login.headers.get("set-cookie").split(";")[0];
  await login.arrayBuffer();
  const chunks = Array.from({ length: Math.ceil(users.length / 30) }, (_, i) => users.slice(i * 30, i * 30 + 30));
  // Dispatch 30 per invocation, keeping below the Free plan subrequest limit.
  for (const chunk of chunks) {
    const prepared = await control("/students", { action: "init", runId, begin, end: state.end, users: chunk, answerKey: fixture.answer_key, adminCookie });
    state.results.push(...prepared);
    writeFileSync(statePath, JSON.stringify(state, null, 2));
    console.log(`Prepared ${state.results.length}/${users.length}; failed ${state.results.filter((s) => s.status === "failed").length}.`);
  }
  assert.equal(state.results.filter((s) => s.status === "ready").length, users.length);
  assert.ok(Date.now() < begin, "Preparation must finish before the common hour starts");
  if (users.length === 300) {
    await control("/monitor", { action: "init", runId, begin, end: state.end, ids: state.results.map((s) => s.attemptId), adminCookie });
  }
  await admin("/auth/logout", {});
  console.log(JSON.stringify({ runId, starts: new Date(begin).toISOString(), ends: new Date(state.end).toISOString(), users: users.length }));
  process.exit(0);
}
const state = JSON.parse(readFileSync(statePath, "utf8"));
const results = [];
for (let i = 0; i < state.users.length; i += 30) results.push(...await control("/students", { action: action === "stop" ? "stop" : "status", runId: state.runId, users: state.users.slice(i, i + 30) }));
const monitor = state.users.length === 300 ? await control("/monitor", { action: action === "stop" ? "stop" : "status", runId: state.runId }) : null;
const report = {
  run_id: state.runId, base: fixture.base, transport: "300 independent Cloudflare Durable Object HTTP sessions; real wall-clock alarms; no direct database writes",
  started_at: state.started_at, exam_started_at: new Date(state.begin).toISOString(), exam_due_at: new Date(state.end).toISOString(), duration_seconds: state.duration / 1000,
  updated_at: new Date().toISOString(), elapsed_seconds: Math.max(0, Math.floor((Date.now() - state.begin) / 1000)), requested_users: state.users.length, bank_count: fixture.bank_count, questions_per_attempt: 25,
  statuses: results.reduce((acc, s) => { acc[s.status] = (acc[s.status] || 0) + 1; return acc; }, {}),
  requests: results.reduce((n, s) => n + s.requests, 0), errors: results.reduce((n, s) => n + s.errorCount, 0), retries: results.reduce((n, s) => n + s.retries, 0), recovered: results.reduce((n, s) => n + s.recovered, 0),
  checks: results.reduce((n, s) => n + s.checks, 0), confirmed_completed: results.filter((s) => s.status === "completed").length, confirmed_answers: results.reduce((n, s) => n + (s.confirmedAnswers || 0), 0),
  active_checkpoints: monitor?.checkpoints || [], monitor_status: monitor?.status, monitor_error: monitor?.fatal,
  phases: {}, server_timing: {}, revisions: {}, failures: results.filter((s) => s.fatal || s.errorCount).map((s) => ({ login: s.login, fatal: s.fatal, errors: s.errors })),
  in_progress: results.some((s) => ["ready", "active", "initializing"].includes(s.status)),
};
for (const metric of ["timings", "server"]) {
  const phases = new Set(results.flatMap((s) => Object.keys(s[metric] || {})));
  for (const phase of phases) (metric === "timings" ? report.phases : report.server_timing)[phase] = stats(results.flatMap((s) => s[metric]?.[phase] || []));
}
for (const s of results) for (const [rev, n] of Object.entries(s.revisions || {})) report.revisions[rev] = (report.revisions[rev] || 0) + n;
report.passed = report.confirmed_completed === report.requested_users && report.confirmed_answers === report.requested_users * 25 && !results.some((s) => s.fatal) && (state.users.length < 300 || (monitor?.status === "completed" && monitor.checkpoints.every((p) => p.valid)));
report.performance_passed = ["login", "start", "save", "heartbeat", "finish"].every((p) => report.phases[p]?.p95_ms < 2000) && report.errors / report.requests < .01;
mkdirSync("output/load", { recursive: true });
writeFileSync(`output/load/${state.runId}.json`, JSON.stringify(report, null, 2));
if (!report.in_progress) {
  writeFileSync("output/load/latest.json", JSON.stringify(report, null, 2));
  const lines = [`# Облачный прогон: ${state.runId}`, ``, `Функционально: ${report.passed ? "ПРОЙДЕН" : "НЕ ПРОЙДЕН"}. Целевые задержки: ${report.performance_passed ? "ПРОЙДЕНЫ" : "НЕ ПРОЙДЕНЫ"}.`, ``, `Длительность активной нагрузки: ${report.duration_seconds} секунд. Завершено ${report.confirmed_completed}/${report.requested_users}, подтверждено ${report.confirmed_answers} ответов. Запросов ${report.requests}; ошибок ${report.errors}.`, `Контрольных выборок администратора: ${report.active_checkpoints.length}.`, ``, `| Этап | Запросов | p50 мс | p95 мс | p99 мс |`, `|---|---:|---:|---:|---:|`, ...Object.entries(report.phases).map(([name, p]) => `| ${name} | ${p.requests} | ${p.p50_ms} | ${p.p95_ms} | ${p.p99_ms} |`), ``, `300 независимых HTTP-сессий работают из Cloudflare через публичный API. База не изменяется в обход API. Это не 300 браузеров и не измерение задержек пользовательских сетей в Казахстане или России. Полный час подтверждается только при функциональном успехе, duration_seconds=3600 и контрольных выборках администратора.`, ``, `Результаты прерванного локального прогона с ECONNRESET/ENOTFOUND сохранены отдельно; его ошибки не исключались из собственных счётчиков.`, ``, `Версии приложения: ${JSON.stringify(report.revisions)}.`];
  writeFileSync(`output/load/${state.runId}.md`, lines.join("\n")); writeFileSync("output/load/latest.md", lines.join("\n"));
}
console.log(JSON.stringify({ run_id: state.runId, elapsed_seconds: report.elapsed_seconds, statuses: report.statuses, requests: report.requests, errors: report.errors, last_checkpoint: report.active_checkpoints.at(-1), save_p95_ms: report.phases.save?.p95_ms, heartbeat_p95_ms: report.phases.heartbeat?.p95_ms, passed: report.passed, performance_passed: report.performance_passed }, null, 2));
