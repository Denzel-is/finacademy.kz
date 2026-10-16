import http from "k6/http";
import { check, sleep } from "k6";
import { SharedArray } from "k6/data";
const users = new SharedArray("exam-users", () =>
  JSON.parse(open(__ENV.USERS_FILE || "../.local/load-users.json")),
);
export const options = {
  scenarios: {
    exam: {
      executor: "per-vu-iterations",
      vus: 300,
      iterations: 1,
      maxDuration: "75m",
    },
  },
  thresholds: {
    http_req_duration: ["p(95)<2000"],
    http_req_failed: ["rate<0.01"],
    checks: ["rate>0.999"],
  },
};
// Use a separate staging database and 300 purpose-created students with one assigned test.
// Configure the staging test for at least 65 minutes with no blocking proctor mode and a 75-minute access window.
// Provide BASE_URL and USERS_FILE; each entry: {login,password,test_id}.
export default function () {
  const user = users[__VU - 1];
  if (!user) throw new Error("Prepare 300 unique staging students.");
  const base = __ENV.BASE_URL;
  if (!base)
    throw new Error("BASE_URL must target the approved staging environment.");
  const json = { "Content-Type": "application/json" };
  const login = http.post(
    `${base}/api/auth/login`,
    JSON.stringify({ login: user.login, password: user.password }),
    { headers: json },
  );
  check(login, { login: (r) => r.status === 200 });
  const start = http.post(
    `${base}/api/student/start`,
    JSON.stringify({ test_id: user.test_id }),
    { headers: json },
  );
  check(start, { start: (r) => r.status === 201 || r.status === 200 });
  const a = start.json();
  if (!a.id) return;
  if (new Date(a.deadline).getTime() - Date.now() < 65 * 60 * 1000)
    throw new Error("Staging attempt must allow at least 65 minutes.");
  if (a.proctor_mode === "block")
    throw new Error("Use non-blocking staging proctor mode.");
  const clientId = uuid();
  http.post(
    `${base}/api/student/attempts/${a.id}/lease`,
    JSON.stringify({ clientId, force: true }),
    { headers: json },
  );
  let answers = {},
    version = a.version;
  const end = Date.now() + 60 * 60 * 1000;
  while (Date.now() < end) {
    const q = a.questions[version % a.questions.length];
    answers[q.id] = q.options[version % q.options.length].id;
    version++;
    const save = http.post(
      `${base}/api/student/attempts/${a.id}/save`,
      JSON.stringify({ clientId, version, answers }),
      { headers: json },
    );
    check(save, {
      "batch save": (r) => r.status === 200,
      "version acknowledged": (r) => r.json("version") >= version,
    });
    if (version % 20 === 0) {
      const event = {
        id: uuid(),
        kind: "hidden",
        occurredAt: new Date().toISOString(),
        returnedAt: new Date().toISOString(),
        durationMs: 500,
      };
      http.post(
        `${base}/api/student/attempts/${a.id}/events`,
        JSON.stringify({
          clientId,
          epoch: a.proctor_epoch,
          events: [event, event],
        }),
        { headers: json },
      );
    }
    sleep(15 + Math.random() * 4);
  }
  const result = http.post(
    `${base}/api/student/attempts/${a.id}/finish`,
    JSON.stringify({ clientId, version: ++version, answers }),
    { headers: json },
  );
  check(result, {
    finished: (r) => r.status === 200 && r.json("status") !== "active",
  });
  const repeated = http.post(
    `${base}/api/student/attempts/${a.id}/finish`,
    JSON.stringify({ clientId, version, answers }),
    { headers: json },
  );
  check(repeated, {
    "idempotent result": (r) => r.json("percent") === result.json("percent"),
  });
}
function uuid() {
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const n = (Math.random() * 16) | 0;
    return (c === "x" ? n : (n & 3) | 8).toString(16);
  });
}
