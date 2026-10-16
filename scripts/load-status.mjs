import { readdirSync, readFileSync, statSync } from "node:fs";
const file = readdirSync("output/load").filter((name) => name.endsWith(".json") && name !== "latest.json").sort((a, b) => statSync(`output/load/${a}`).mtimeMs - statSync(`output/load/${b}`).mtimeMs).at(-1);
if (!file) throw new Error("No load report yet. Run npm run load:hour.");
const report = JSON.parse(readFileSync(`output/load/${file}`, "utf8"));
console.log(JSON.stringify({
  report: `output/load/${file}`,
  in_progress: report.in_progress,
  exam_started_at: report.exam_started_at,
  exam_due_at: report.exam_due_at,
  elapsed_seconds: report.elapsed_seconds ?? (report.exam_started_at ? Math.floor(((report.in_progress ? Date.now() : Date.parse(report.finished_at)) - Date.parse(report.exam_started_at)) / 1000) : 0),
  updated_at: report.updated_at,
  last_active_checkpoint: report.active_checkpoints.at(-1),
  requests: report.requests,
  errors: report.errors ?? report.failures.length,
  completed: report.confirmed_completed,
  save_p95_ms: report.phases.save?.p95_ms,
  heartbeat_p95_ms: report.phases.heartbeat?.p95_ms,
  save_server_p95_ms: report.server_timing["save.total"]?.p95_ms,
  heartbeat_server_p95_ms: report.server_timing["heartbeat.total"]?.p95_ms,
  passed: report.passed,
  performance_passed: report.performance_passed,
}, null, 2));
