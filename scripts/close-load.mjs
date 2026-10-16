import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { administrator, client } from "./load-support.mjs";
const fixture = JSON.parse(readFileSync(process.env.LOAD_FIXTURE || ".local/load-fixture.json", "utf8"));
const admin = await administrator();
const active = (
  await admin(`/admin/results?test_id=${fixture.test_id}`)
).filter((a) => a.status === "active");
const remaining = [...active];
let finished = 0;
await Promise.all(
  Array.from({ length: 15 }, async () => {
    while (remaining.length) {
      const a = remaining.pop();
      const user = fixture.users.find((u) => u.login === a.login);
      if (!user) throw new Error("Refusing to close a non-fixture attempt.");
      const request = client();
      await request("/auth/login", {
        login: user.login,
        password: user.password,
      });
      const clientId = randomUUID();
      const current = await request(`/student/attempts/${a.id}/lease`, {
        clientId,
        force: true,
      });
      await request(`/student/attempts/${a.id}/finish`, {
        clientId,
        version: current.version,
        answers: current.answers,
      });
      finished++;
    }
  }),
);
console.log(
  `Finished ${finished} interrupted fixture attempts using their server-confirmed answers.`,
);
