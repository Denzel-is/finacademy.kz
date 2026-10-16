import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { randomBytes, randomUUID } from "node:crypto";
import { administrator, base } from "./load-support.mjs";

mkdirSync(".local", { recursive: true });
const fixturePath = ".local/load-fixture.json";
const fixture = existsSync(fixturePath)
  ? JSON.parse(readFileSync(fixturePath, "utf8"))
  : {
      base,
      group: "Нагрузочная группа · 300 студентов",
      users: Array.from({ length: 300 }, (_, i) => ({
        login: `load${String(i + 1).padStart(3, "0")}`,
        name: `Тестовый студент ${String(i + 1).padStart(3, "0")}`,
        password: randomBytes(18).toString("base64url"),
      })),
    };
if (fixture.base !== base)
  throw new Error("Fixture belongs to a different deployment.");
const save = () => writeFileSync(fixturePath, JSON.stringify(fixture, null, 2));
save();
const admin = await administrator();
for (let offset = 0; offset < 300; offset += 25) {
  const rows = fixture.users
    .slice(offset, offset + 25)
    .map((u) => ({ ...u, group: fixture.group }));
  const report = await admin("/admin/import/students/commit", {
    rows,
    mode: "skip",
  });
  console.log(
    `Students ${offset + 25}/300: created ${report.created}, existing ${report.skipped}`,
  );
}
const groups = await admin("/admin/groups");
const group = groups.find((g) => g.name === fixture.group);
if (!group || group.student_count !== 300)
  throw new Error("Expected exactly 300 users in the load group.");
fixture.group_id = group.id;
if (!fixture.test_id) {
  const tests = await admin("/admin/tests");
  const old = tests.find((t) => t.title === "Нагрузочный тест · 300 студентов");
  if (old) fixture.test_id = old.id;
  else {
    const created = await admin("/admin/tests", {
      title: "Нагрузочный тест · 300 студентов",
      discipline: "Проверка одновременного тестирования",
      description:
        "Технический тест для 300 вымышленных студентов. Не относится к учебной аттестации.",
      question_count: 10,
      pass_percent: 70,
      minutes: 75,
      max_attempts: 20,
      published: 0,
      proctor_mode: "warn",
      proctor_limit: 3,
      fullscreen: 0,
      show_result: 1,
      show_history: 1,
    });
    fixture.test_id = created.id;
  }
  save();
}
let bank = await admin(`/admin/questions?test_id=${fixture.test_id}`);
if (bank.filter((q) => !q.archived).length < 20) {
  const source = await admin("/admin/questions?test_id=test-10");
  await admin("/admin/import/questions/commit", {
    test_id: fixture.test_id,
    rows: source
      .filter((q) => !q.archived)
      .map((q) => ({
        text: q.text,
        options: q.options,
        correct_id: q.correct_id,
      })),
  });
  bank = await admin(`/admin/questions?test_id=${fixture.test_id}`);
}
const test = (await admin("/admin/tests")).find(
  (t) => t.id === fixture.test_id,
);
await admin(
  `/admin/tests/${fixture.test_id}`,
  { ...test, published: 1 },
  "PUT",
);
await admin("/admin/assignments", {
  test_id: fixture.test_id,
  group_ids: [group.id],
  user_ids: [],
  starts_at: null,
  ends_at: null,
  max_attempts: 20,
});
fixture.answer_key = Object.fromEntries(
  bank.filter((q) => !q.archived).map((q) => [q.id, q.correct_id]),
);
fixture.prepared_at = new Date().toISOString();
save();
writeFileSync(
  ".local/load-users.json",
  JSON.stringify(
    fixture.users.map((u) => ({ ...u, test_id: fixture.test_id })),
    null,
    2,
  ),
);
writeFileSync(
  ".local/load-access.csv",
  "Логин,Пароль,ФИО\n" +
    fixture.users.map((u) => `${u.login},${u.password},${u.name}`).join("\n"),
);
console.log(
  `Ready: 300 distinct students, 20-question bank, assigned test ${fixture.test_id} on ${base}. Credentials remain in .local/.`,
);
