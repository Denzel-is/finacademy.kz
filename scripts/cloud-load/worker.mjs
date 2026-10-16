const json = (data, status = 200) => Response.json(data, { status, headers: { "Cache-Control": "no-store" } });
const ensure = (condition, label) => { if (!condition) throw new Error(label); };
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const signature = async (value) => Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(JSON.stringify(value))))).map((n) => n.toString(16).padStart(2, "0")).join("");
function summary(s) {
  if (!s) return { status: "missing" };
  const { cookie, adminCookie, keys, questions, answers, snapshot, ...safe } = s;
  return safe;
}
async function call(env, s, path, data, phase, cookie = s.cookie) {
  for (let retry = 0; retry < 3; retry++) {
    const started = Date.now();
    s.requests++;
    try {
      const response = await fetch(`${env.BASE}/api${path}`, {
        method: data === undefined ? "GET" : "POST",
        headers: { ...(data === undefined ? {} : { "Content-Type": "application/json" }), ...(cookie ? { Cookie: cookie } : {}) },
        body: data === undefined ? undefined : JSON.stringify(data), signal: AbortSignal.timeout(15000),
      });
      const value = await response.json();
      if (!response.ok) { const error = new Error(`HTTP ${response.status}: ${value.error}`); error.status = response.status; throw error; }
      const freshCookie = response.headers.get("set-cookie");
      if (freshCookie && phase === "login") s.cookie = freshCookie.split(";")[0];
      const rev = response.headers.get("x-app-revision") || "unknown";
      s.revisions[rev] = (s.revisions[rev] || 0) + 1;
      const timing = Number((response.headers.get("server-timing") || "").match(/total;dur=([\d.]+)/)?.[1] || 0);
      (s.server[phase] ||= []).push(timing);
      if (retry) s.recovered++;
      return value;
    } catch (error) {
      s.errorCount++;
      if (s.errors.length < 20) s.errors.push({ at: new Date().toISOString(), phase, status: error.status || 0, error: error.message });
      if (retry === 2 || (error.status && error.status < 500 && error.status !== 429)) throw error;
      s.retries++;
      await pause(250 * (retry + 1));
    } finally { (s.timings[phase] ||= []).push(Date.now() - started); }
  }
}
class VirtualStudent {
  constructor(ctx, env) { this.ctx = ctx; this.env = env; }
  async fetch(request) {
    const input = await request.json();
    let s = await this.ctx.storage.get("state");
    if (input.action === "status") return json(summary(s));
    if (input.action === "stop") {
      await this.ctx.storage.deleteAlarm();
      if (s) { s.status = "stopped"; s.cookie = ""; s.adminCookie = ""; await this.ctx.storage.put("state", s); }
      return json(summary(s));
    }
    ensure(input.action === "init", "Unknown action");
    if (s) return json(summary(s)); // Idempotent dispatch after a lost controller response.
    s = { login: input.user.login, runId: input.runId, begin: input.begin, end: input.end, status: "initializing", cookie: "", adminCookie: input.adminCookie, clientId: crypto.randomUUID(), eventId: crypto.randomUUID(), round: 0, answerRound: 0, requests: 0, retries: 0, recovered: 0, errorCount: 0, errors: [], checks: 0, timings: {}, server: {}, revisions: {}, answers: {} };
    try {
      await call(this.env, s, "/auth/login", { login: input.user.login, password: input.user.password }, "login");
      const a = await call(this.env, s, "/student/start", { test_id: this.env.TEST_ID }, "start");
      ensure(a.status === "active" && a.questions.length === 25 && new Set(a.questions.map((q) => q.id)).size === 25, "Invalid random sample");
      ensure(!Object.hasOwn(a, "answer_key_json") && !JSON.stringify(a).includes("correct_id"), "Answer key exposed");
      ensure(Date.parse(a.deadline) > input.end + 60000, "Insufficient test window");
      s.checks += 3;
      s.attemptId = a.id; s.version = a.version; s.answers = a.answers;
      s.questions = a.questions.map((q) => ({ id: q.id, options: q.options.map((o) => o.id) }));
      s.snapshot = await signature(a.questions);
      s.keys = Object.fromEntries(s.questions.map((q) => [q.id, input.answerKey[q.id]]));
      ensure(Object.values(s.keys).every((key) => typeof key === "string"), "Missing verifier key");
      s.epoch = a.proctor_epoch; s.initialViolations = a.violation_count;
      await call(this.env, s, `/student/attempts/${a.id}/lease`, { clientId: s.clientId, force: true }, "lease");
      s.status = "ready";
      s.preparedAt = new Date().toISOString();
      await this.ctx.storage.put("state", s);
      // Keep the lease alive while the controller prepares all 300 students.
      await this.ctx.storage.setAlarm(Math.min(input.begin, Date.now() + 17000));
    } catch (error) { s.status = "failed"; s.fatal = error.message; await this.ctx.storage.put("state", s); }
    return json(summary(s));
  }
  async alarm() {
    const s = await this.ctx.storage.get("state");
    if (!s || ["failed", "completed", "stopped"].includes(s.status)) return;
    try {
      if (Date.now() < s.begin) {
        const heartbeat = await call(this.env, s, `/student/attempts/${s.attemptId}/lease`, { clientId: s.clientId, compact: true }, "preflight_heartbeat");
        ensure(heartbeat.status === "active", "Attempt ended before hour began");
        await this.ctx.storage.put("state", s);
        await this.ctx.storage.setAlarm(Math.min(s.begin, Date.now() + 17000));
        return;
      }
      s.status = "active";
      if (Date.now() >= s.end) {
        if (Date.now() < s.end + 15000) { await this.ctx.storage.setAlarm(s.end + 15000); return; }
        for (const q of s.questions) if (!s.answers[q.id]) s.answers[q.id] = q.options[Number(s.login.slice(-3)) % q.options.length];
        const input = { clientId: s.clientId, version: ++s.version, answers: s.answers };
        const a = await call(this.env, s, `/student/attempts/${s.attemptId}/finish`, input, "finish");
        ensure(a.status === "completed" && JSON.stringify(a.answers) === JSON.stringify(s.answers), "Finish lost answers");
        const score = s.questions.filter((q) => s.answers[q.id] === s.keys[q.id]).length;
        ensure(a.score === score && a.percent === score * 4, "Incorrect server grade");
        ensure(Date.parse(a.finished_at) >= s.end, "Finished before full hour");
        const again = await call(this.env, s, `/student/attempts/${s.attemptId}/finish`, input, "repeat_finish");
        ensure(again.finished_at === a.finished_at && again.percent === a.percent, "Non-idempotent finish");
        const audited = await call(this.env, s, `/admin/attempts/${s.attemptId}`, undefined, "admin_verify", s.adminCookie);
        ensure(audited.attempt.status === "completed" && JSON.stringify(audited.attempt.answers) === JSON.stringify(s.answers) && audited.attempt.percent === a.percent, "Administrative answer verification failed");
        ensure(audited.events.filter((e) => e.counted).length === s.initialViolations + 1, "Duplicate proctor event");
        s.checks += 6; s.confirmedAnswers = Object.keys(a.answers).length; s.percent = a.percent;
        s.finishedAt = a.finished_at; s.activeSeconds = Math.floor((Date.parse(a.finished_at) - s.begin) / 1000);
        s.status = "completed"; s.cookie = ""; s.adminCookie = "";
        delete s.keys; delete s.questions; delete s.answers; delete s.snapshot;
        await this.ctx.storage.put("state", s);
        await this.ctx.storage.deleteAlarm();
        return;
      }
      if (s.round % 5 === 4) {
        const heartbeat = await call(this.env, s, `/student/attempts/${s.attemptId}/lease`, { clientId: s.clientId, compact: true }, "heartbeat");
        ensure(heartbeat.status === "active" && heartbeat.version === s.version && !heartbeat.questions, "Invalid compact heartbeat");
      } else {
        const q = s.questions[s.answerRound++ % s.questions.length];
        s.answers[q.id] = q.options[(s.round + Number(s.login.slice(-3))) % q.options.length];
        const a = await call(this.env, s, `/student/attempts/${s.attemptId}/save`, { clientId: s.clientId, version: ++s.version, answers: s.answers }, "save");
        ensure(a.version === s.version && !a.attempt, "Save did not acknowledge version");
      }
      s.checks++;
      if (s.round === 1) {
        const event = { id: s.eventId, kind: "hidden", occurredAt: new Date(s.begin + 17000).toISOString(), returnedAt: new Date(s.begin + 17500).toISOString(), durationMs: 500 };
        const a = await call(this.env, s, `/student/attempts/${s.attemptId}/events`, { clientId: s.clientId, epoch: s.epoch, events: [event, event] }, "events");
        ensure(a.violation_count === s.initialViolations + 1, "Event deduplication failed"); s.checks++;
      }
      if (s.round === 2 || (s.round > 2 && s.round % 40 === 0)) {
        const a = await call(this.env, s, `/student/attempts/${s.attemptId}`, undefined, "recovery");
        ensure(JSON.stringify(a.answers) === JSON.stringify(s.answers) && await signature(a.questions) === s.snapshot, "Recovery changed answers or snapshot"); s.checks++;
      }
      s.round++; s.lastActivity = new Date().toISOString();
      await this.ctx.storage.put("state", s);
      await this.ctx.storage.setAlarm(Math.min(s.end, Date.now() + 15000 + Math.floor(Math.random() * 4000)));
    } catch (error) {
      s.status = "failed"; s.fatal = error.message;
      await this.ctx.storage.put("state", s);
      await this.ctx.storage.deleteAlarm();
    }
  }
}
// Ten isolated cookies share only a scheduler. A shard makes at most 30 normal
// API calls per alarm, and one alarm write per ten students keeps the whole hour
// within the Free plan storage budget. Each student still has its own state/key.
export class Student {
  constructor(ctx, env) { this.ctx = ctx; this.env = env; }
  virtual(login) {
    const storage = this.ctx.storage;
    return new VirtualStudent({ storage: {
      get: () => storage.get(`student:${login}`),
      put: (_key, value) => storage.put(`student:${login}`, value),
      setAlarm: async () => {}, deleteAlarm: async () => {},
    } }, this.env);
  }
  async fetch(request) {
    const input = await request.json();
    const values = await Promise.all(input.users.map(async (user) => {
      const response = await this.virtual(user.login).fetch(new Request("https://virtual/", { method: "POST", body: JSON.stringify({ ...input, users: undefined, user }) }));
      return response.json();
    }));
    if (input.action === "init") {
      await this.ctx.storage.put("meta", { members: input.users.map((u) => u.login), begin: input.begin, end: input.end });
      await this.ctx.storage.setAlarm(Math.min(input.begin, Date.now() + 19500));
    } else if (input.action === "stop") await this.ctx.storage.deleteAlarm();
    return json(values);
  }
  async alarm() {
    if (this.env.LOAD_PAUSED === "1") { await this.ctx.storage.deleteAlarm(); return; }
    const meta = await this.ctx.storage.get("meta");
    if (!meta) return;
    await Promise.all(meta.members.map((login) => this.virtual(login).alarm()));
    const states = await Promise.all(meta.members.map((login) => this.ctx.storage.get(`student:${login}`)));
    if (!states.some((s) => ["ready", "active"].includes(s?.status))) { await this.ctx.storage.deleteAlarm(); return; }
    const time = Date.now();
    const boundary = time < meta.begin ? meta.begin : time < meta.end ? meta.end : meta.end + 15000;
    await this.ctx.storage.setAlarm(Math.min(boundary, time + 19000 + Math.floor(Math.random() * 1000)));
  }
}
export class Monitor {
  constructor(ctx, env) { this.ctx = ctx; this.env = env; }
  async fetch(request) {
    const input = await request.json();
    let s = await this.ctx.storage.get("state");
    if (input.action === "status") return json(summary(s));
    if (input.action === "stop") { await this.ctx.storage.deleteAlarm(); if (s) { s.status = "stopped"; s.adminCookie = ""; await this.ctx.storage.put("state", s); } return json(summary(s)); }
    if (s) return json(summary(s));
    ensure(input.ids.length === 300 && new Set(input.ids).size === 300, "Need 300 unique attempts");
    s = { runId: input.runId, begin: input.begin, end: input.end, ids: input.ids, adminCookie: input.adminCookie, status: "ready", checkpoints: [], errors: [], errorCount: 0, requests: 0, retries: 0, recovered: 0, timings: {}, server: {}, revisions: {}, checks: 0 };
    await this.ctx.storage.put("state", s); await this.ctx.storage.setAlarm(input.begin);
    return json(summary(s));
  }
  async alarm() {
    if (this.env.LOAD_PAUSED === "1") { await this.ctx.storage.deleteAlarm(); return; }
    const s = await this.ctx.storage.get("state");
    if (!s || ["completed", "stopped", "failed"].includes(s.status)) return;
    try {
      const rows = await call(this.env, s, `/admin/results?test_id=${this.env.TEST_ID}`, undefined, "active_monitor", s.adminCookie);
      const ids = new Set(s.ids), selected = rows.filter((a) => ids.has(a.id));
      const elapsed = Math.floor((Date.now() - s.begin) / 1000);
      const active = selected.filter((a) => a.status === "active").length;
      const valid = selected.length === 300 && (Date.now() < s.end ? active === 300 : selected.every((a) => !a.finished_at || Date.parse(a.finished_at) >= s.end));
      s.checkpoints.push({ at: new Date().toISOString(), elapsed_seconds: elapsed, active, valid });
      ensure(valid, `300 active attempts not confirmed at ${elapsed}s (${active})`); s.checks++;
      if (Date.now() >= s.end) { s.status = "completed"; s.adminCookie = ""; await this.ctx.storage.deleteAlarm(); }
      else { s.status = "active"; await this.ctx.storage.setAlarm(Math.min(s.end + 1000, Date.now() + 60000)); }
    } catch (error) { s.status = "failed"; s.fatal = error.message; await this.ctx.storage.deleteAlarm(); }
    await this.ctx.storage.put("state", s);
  }
}
const percentiles = (values) => {
  values.sort((a, b) => a - b);
  const at = (p) => Math.round(values[Math.min(values.length - 1, Math.ceil(values.length * p) - 1)] || 0);
  return { requests: values.length, p50_ms: at(.5), p95_ms: at(.95), p99_ms: at(.99), max_ms: at(1) };
};
export class Coordinator {
  constructor(ctx, env) { this.ctx = ctx; this.env = env; }
  async fetch(request) {
    // Pass the configuration with the dispatch: a Durable Object's environment
    // can retain the deployment that created it during a secret rollout.
    const { config } = await request.json();
    ensure(config && [1, 300].includes(config.count) && [60000, 3600000].includes(config.duration), "Invalid coordinator configuration");
    let s = await this.ctx.storage.get("state");
    if (s) ensure(s.runId === config.runId, "Coordinator run mismatch; prepare a fresh run ID");
    if (s && this.env.LOAD_PAUSED === "1") {
      if (s.phase === "completed") return json({ phase: s.phase, prepared: s.prepared.length, paused: true });
      s.phase = "failed"; s.fatal = "Stopped: Cloudflare D1 daily free-tier row-read quota exhausted. Full hour was not completed.";
      await this.ctx.storage.deleteAlarm(); await this.ctx.storage.put("state", s);
      await this.publish(s, s.prepared, undefined);
      return json({ phase: s.phase, prepared: s.prepared.length, error: s.fatal });
    }
    if (s) return json({ phase: s.phase, prepared: s.prepared.length, alarm: await this.ctx.storage.getAlarm(), server_now: new Date().toISOString() });
    ensure(this.env.LOAD_PAUSED !== "1", "Load generator is paused");
    s = { ...config, phase: "preparing", begin: Date.now() + (config.count === 1 ? 20000 : 180000), prepared: [], started_at: new Date().toISOString(), adminCookie: "" };
    s.end = s.begin + s.duration;
    await this.ctx.storage.put("state", s); await this.ctx.storage.setAlarm(Date.now() + 100);
    return json({ phase: s.phase });
  }
  users(s) { return Array.from({ length: 6 }, (_, i) => JSON.parse(this.env[`LOAD_USERS_${i}`])).flat().slice(0, s.count); }
  async group(s, users, action, extra = {}) {
    const shard = Math.floor((Number(users[0].login.slice(-3)) - 1) / 10);
    const stub = this.env.STUDENTS.get(this.env.STUDENTS.idFromName(`${s.runId}:shard${shard}`), { locationHint: "weur" });
    const response = await stub.fetch(new Request("https://student/", { method: "POST", body: JSON.stringify({ action, runId: s.runId, begin: s.begin, end: s.end, users, ...extra }) }));
    return response.json();
  }
  async publish(s, results, monitor) {
    const report = {
      run_id: s.runId, base: this.env.BASE, transport: "300 isolated Cloudflare HTTP sessions; 30 independent durable schedulers; public application API; no direct application DB access",
      phase: s.phase, started_at: s.started_at, exam_started_at: new Date(s.begin).toISOString(), exam_due_at: new Date(s.end).toISOString(), duration_seconds: s.duration / 1000,
      updated_at: new Date().toISOString(), elapsed_seconds: Math.max(0, Math.floor((Date.now() - s.begin) / 1000)), requested_users: s.count, bank_count: s.bankCount, questions_per_attempt: 25,
      prepared: s.prepared.length, statuses: results.reduce((a, r) => { a[r.status] = (a[r.status] || 0) + 1; return a; }, {}),
      requests: results.reduce((n, r) => n + r.requests, 0), errors: results.reduce((n, r) => n + r.errorCount, 0), retries: results.reduce((n, r) => n + r.retries, 0), recovered: results.reduce((n, r) => n + r.recovered, 0),
      checks: results.reduce((n, r) => n + r.checks, 0), confirmed_completed: results.filter((r) => r.status === "completed").length, confirmed_answers: results.reduce((n, r) => n + (r.confirmedAnswers || 0), 0),
      active_checkpoints: monitor?.checkpoints || [], monitor_status: monitor?.status, monitor_error: monitor?.fatal, monitor_requests: monitor?.requests || 0,
      phases: {}, server_timing: {}, revisions: {}, failures: results.filter((r) => r.fatal || r.errorCount).map((r) => ({ login: r.login, fatal: r.fatal, errors: r.errors })),
      in_progress: s.phase !== "completed" && s.phase !== "failed", error: s.fatal,
    };
    for (const metric of ["timings", "server"]) {
      for (const phase of new Set(results.flatMap((r) => Object.keys(r[metric] || {})))) (metric === "timings" ? report.phases : report.server_timing)[phase] = percentiles(results.flatMap((r) => r[metric]?.[phase] || []));
    }
    for (const r of results) for (const [rev, n] of Object.entries(r.revisions || {})) report.revisions[rev] = (report.revisions[rev] || 0) + n;
    report.passed = report.confirmed_completed === s.count && report.confirmed_answers === s.count * 25 && !s.fatal && !results.some((r) => r.fatal) && (s.count === 1 || (monitor?.status === "completed" && monitor.checkpoints.every((p) => p.valid)));
    report.performance_passed = ["login", "start", "save", "finish"].every((p) => report.phases[p]?.p95_ms < 2000) && (!report.phases.heartbeat || report.phases.heartbeat.p95_ms < 2000) && report.errors / report.requests < .01;
    await this.env.LOAD_REPORTS.put(s.runId, JSON.stringify(report));
    await this.env.LOAD_REPORTS.put("latest", JSON.stringify(report));
  }
  async alarm() {
    if (this.env.LOAD_PAUSED === "1") { await this.ctx.storage.deleteAlarm(); return; }
    const s = await this.ctx.storage.get("state");
    if (!s || ["completed", "failed"].includes(s.phase)) return;
    let results = [], monitor;
    try {
      const users = this.users(s);
      if (s.phase === "preparing") {
        if (!s.adminCookie) {
          const response = await fetch(`${this.env.BASE}/api/auth/login`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ login: "admin", password: this.env.ADMIN_PASSWORD }), signal: AbortSignal.timeout(15000) });
          const value = await response.json(); ensure(response.ok, `Admin login failed: ${value.error}`);
          s.adminCookie = response.headers.get("set-cookie").split(";")[0];
        }
        const batch = users.slice(s.prepared.length, s.prepared.length + 300);
        const answerKey = { ...JSON.parse(this.env.ANSWER_KEY_0), ...JSON.parse(this.env.ANSWER_KEY_1) };
        const chunks = Array.from({ length: Math.ceil(batch.length / 10) }, (_, i) => batch.slice(i * 10, i * 10 + 10));
        const ready = (await Promise.all(chunks.map((chunk) => this.group(s, chunk, "init", { answerKey, adminCookie: s.adminCookie })))).flat();
        s.prepared.push(...ready);
        ensure(ready.every((r) => r.status === "ready"), `Startup failure: ${ready.filter((r) => r.fatal).map((r) => r.fatal).join("; ")}`);
        results = s.prepared;
        if (s.prepared.length === s.count) {
          ensure(Date.now() < s.begin, "Preparation missed common start time");
          if (s.count === 300) {
            const stub = this.env.MONITOR.get(this.env.MONITOR.idFromName(s.runId), { locationHint: "weur" });
            const response = await stub.fetch(new Request("https://monitor/", { method: "POST", body: JSON.stringify({ action: "init", runId: s.runId, begin: s.begin, end: s.end, ids: s.prepared.map((r) => r.attemptId), adminCookie: s.adminCookie }) }));
            await response.arrayBuffer();
          }
          s.phase = "running";
        }
      } else {
        const chunks = Array.from({ length: Math.ceil(users.length / 10) }, (_, i) => users.slice(i * 10, i * 10 + 10));
        results = (await Promise.all(chunks.map((chunk) => this.group(s, chunk, "status")))).flat();
        if (s.count === 300) {
          const stub = this.env.MONITOR.get(this.env.MONITOR.idFromName(s.runId), { locationHint: "weur" });
          monitor = await (await stub.fetch(new Request("https://monitor/", { method: "POST", body: JSON.stringify({ action: "status" }) }))).json();
        }
        if (results.every((r) => ["completed", "failed", "stopped"].includes(r.status)) && Date.now() >= s.end + 15000) {
          s.phase = results.every((r) => r.status === "completed") ? "completed" : "failed";
          s.adminCookie = "";
        }
      }
    } catch (error) { s.phase = "failed"; s.fatal = error.message; }
    await this.ctx.storage.put("state", s);
    await this.publish(s, results, monitor);
    if (["completed", "failed"].includes(s.phase)) await this.ctx.storage.deleteAlarm();
    else await this.ctx.storage.setAlarm(Date.now() + (s.phase === "preparing" ? 1000 : 60000));
  }
}
export default {
  async scheduled(_event, env, ctx) {
    if (!env.BOOTSTRAP_CONFIG || env.LOAD_PAUSED === "1") return;
    const config = JSON.parse(env.BOOTSTRAP_CONFIG);
    const stub = env.COORDINATOR.get(env.COORDINATOR.idFromName(config.runId), { locationHint: "weur" });
    ctx.waitUntil(stub.fetch(new Request("https://coordinator/", { method: "POST", body: JSON.stringify({ config }) })).then((response) => response.arrayBuffer()));
  },
  async fetch(request, env) {
    if (!env.CONTROL_TOKEN || request.headers.get("Authorization") !== `Bearer ${env.CONTROL_TOKEN}`) return json({ error: "Unauthorized" }, 401);
    if (request.method !== "POST") return json({ error: "POST required" }, 405);
    try {
      const input = await request.json();
      ensure(/^[a-zA-Z0-9-]{1,80}$/.test(input.runId), "Invalid run ID");
      ensure(["init", "status", "stop"].includes(input.action), "Invalid action");
      if (new URL(request.url).pathname === "/bootstrap") {
        const config = JSON.parse(env.BOOTSTRAP_CONFIG);
        ensure(config.runId === input.runId, "Bootstrap run mismatch");
        const stub = env.COORDINATOR.get(env.COORDINATOR.idFromName(config.runId), { locationHint: "weur" });
        return stub.fetch(new Request("https://coordinator/", { method: "POST", body: JSON.stringify({ config }) }));
      }
      if (new URL(request.url).pathname === "/monitor") {
        const stub = env.MONITOR.get(env.MONITOR.idFromName(input.runId), { locationHint: "weur" });
        return stub.fetch(new Request("https://monitor/", { method: "POST", body: JSON.stringify(input) }));
      }
      ensure(Array.isArray(input.users) && input.users.length <= 30 && input.users.every((u) => /^load\d{3}$/.test(u.login)), "Only 30 fixture users per batch");
      if (input.action === "init") ensure([60000, 3600000].includes(input.end - input.begin) && input.begin > Date.now() && input.begin < Date.now() + 600000, "Invalid duration/start");
      const groups = new Map();
      for (const user of input.users) { const group = Math.floor((Number(user.login.slice(-3)) - 1) / 10); if (!groups.has(group)) groups.set(group, []); groups.get(group).push(user); }
      const results = await Promise.all([...groups].map(async ([group, users]) => {
        const stub = env.STUDENTS.get(env.STUDENTS.idFromName(`${input.runId}:shard${group}`), { locationHint: "weur" });
        const response = await stub.fetch(new Request("https://student/", { method: "POST", body: JSON.stringify({ ...input, users }) }));
        return response.json();
      }));
      return json(results.flat());
    } catch (error) { return json({ error: error.message }, 400); }
  },
};
