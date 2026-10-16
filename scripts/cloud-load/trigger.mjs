import { readFileSync } from "node:fs";
const { CONTROL_TOKEN } = JSON.parse(readFileSync(".local/cloud-load-secrets.json", "utf8"));
const { runId } = JSON.parse(readFileSync(".local/cloud-bootstrap-state.json", "utf8"));
const response = await fetch("https://finance-academy-load.borodinda.workers.dev/bootstrap", { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${CONTROL_TOKEN}` }, body: JSON.stringify({ runId, action: "init" }), signal: AbortSignal.timeout(20000) });
console.log(response.status, await response.json());
