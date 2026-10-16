import assert from "node:assert/strict";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { administrator, base } from "./load-support.mjs";

// Reuse only the 300 fictitious accounts. Keep all academic tests unchanged.
const original = JSON.parse(readFileSync(".local/load-fixture.json", "utf8"));
assert.equal(original.base, base);
const path = ".local/load-hour-fixture.json";
const fixture = existsSync(path) ? JSON.parse(readFileSync(path, "utf8")) : { ...original, test_id: undefined, answer_key: undefined };
const save = () => writeFileSync(path, JSON.stringify(fixture, null, 2));
const admin = await administrator();
const source = JSON.parse(readFileSync(".local/msfo/deployed.json", "utf8"));
const bank = (await admin(`/admin/questions?test_id=${source.tests.RU}`)).filter((q) => !q.archived);
assert.equal(bank.length, 200);
const title = "Нагрузочный тест · 300 студентов · час";
const config = { title, discipline: "Техническая проверка · МСФО RU", description: "Отдельная техническая копия банка МСФО: 25 вопросов из 200 для 300 вымышленных студентов. Окно 75 минут позволяет провести полный час нагрузки и массовое завершение.", question_count: 25, pass_percent: 50, minutes: 75, max_attempts: 20, published: 0, proctor_mode: "warn", proctor_limit: 3, fullscreen: 0, show_result: 1, show_history: 1 };
if (!fixture.test_id) {
  const existing = (await admin("/admin/tests")).find((t) => t.title === title);
  fixture.test_id = existing?.id || (await admin("/admin/tests", config)).id;
  save();
}
await admin("/admin/import/questions/commit", { test_id: fixture.test_id, rows: bank.map(({ text, options, correct_id }) => ({ text, options, correct_id })) });
const stored = (await admin(`/admin/questions?test_id=${fixture.test_id}`)).filter((q) => !q.archived);
assert.equal(stored.length, 200);
await admin(`/admin/tests/${fixture.test_id}`, { ...config, published: 1 }, "PUT");
await admin("/admin/assignments", { test_id: fixture.test_id, group_ids: [fixture.group_id], user_ids: [], starts_at: null, ends_at: null, max_attempts: 20 });
fixture.question_count = 25;
fixture.bank_count = 200;
fixture.answer_key = Object.fromEntries(stored.map((q) => [q.id, q.correct_id]));
fixture.prepared_at = new Date().toISOString();
save();
await admin("/auth/logout", {});
console.log("Hour fixture ready: 300 fictitious students, 200-question private bank, random 25, 75-minute window. Academic RU/KZ remain at 200 questions / 60 minutes.");
