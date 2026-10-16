import assert from "node:assert/strict";
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { administrator, base } from "./load-support.mjs";

// Only extract-msfo.py's private output and explicitly confirmed overrides are used.
const folder = process.env.MSFO_INPUT || ".local/msfo";
const family = process.env.BANK_FAMILY || 'МСФО';
const read = (name) => JSON.parse(readFileSync(`${folder}/${name}`, "utf8"));
const source = read("source.json"), manifest = read("manifest.json");
const overrides = existsSync(`${folder}/confirmed-keys.json`) ? read("confirmed-keys.json") : {};
const fixturePath = `${folder}/deployed.json`;
const fixture = existsSync(fixturePath) ? read("deployed.json") : { base, tests: {} };
assert.equal(fixture.base, base, "Import fixture belongs to a different deployment.");
const save = () => writeFileSync(fixturePath, JSON.stringify(fixture, null, 2));
const ready = [], pending = [];
for (const question of source) {
  const marks = question.options.flatMap((o, i) => o.correct ? [i] : []);
  assert.ok(marks.length <= 1);
  let key = marks[0];
  if (Object.hasOwn(overrides, question.number)) {
    assert.equal(marks.length, 0, "Overrides only resolve a missing source key.");
    const override = overrides[question.number];
    assert.ok(/^[A-D]$/.test(override.option) && override.confirmed_by === "user" && override.evidence);
    key = override.option.charCodeAt(0) - 65;
  }
  if (key === undefined) pending.push(question.number);
  else ready.push({ ...question, key });
}
assert.equal(source.length, 200);
const admin = await administrator();
const groups = process.env.ASSIGN_DEMO_GROUPS === '1' ? (await admin('/admin/groups')).filter(g=>/^FA-/.test(g.name)) : [];
const report = { base, imported_at: new Date().toISOString(), source: manifest, pending_numbers: pending, tests: [] };
for (const lang of ["RU", "KZ"]) {
  const title = `Тесты ${family} 210 (${lang})`;
  const config = {
    title,
    discipline: family==='МСФООС' ? 'Международные стандарты финансовой отчётности общественного сектора' : 'Международные стандарты финансовой отчётности',
    description: `${lang === "RU" ? "Русский" : "Казахский"} язык. 25 случайных вопросов из ${ready.length}. По 4 балла за правильный ответ, максимум 100 баллов. Проходной балл — 50. Время — 60 минут.`,
    question_count: 25,
    pass_percent: 50,
    minutes: 60,
    max_attempts: 2,
    published: 0,
    proctor_mode: "warn",
    proctor_limit: 3,
    fullscreen: 0,
    show_result: 1,
    show_history: 1,
  };
  if (!fixture.tests[lang]) {
    const existing = (await admin("/admin/tests")).find((t) => t.title === title);
    fixture.tests[lang] = existing?.id || (await admin("/admin/tests", config)).id;
    save();
  }
  const id = fixture.tests[lang];
  const bank = ready.map((q) => ({
    text: q[lang],
    options: q.options.map((o, i) => ({ id: String.fromCharCode(65 + i), text: o[lang] })),
    correct_id: String.fromCharCode(65 + q.key),
  }));
  const preview = await admin("/admin/import/questions/preview", { test_id: id, rows: bank });
  assert.equal(preview.filter((r) => r.status === "error").length, 0, "Invalid source question");
  const imported = await admin("/admin/import/questions/commit", { test_id: id, rows: bank });
  const stored = (await admin(`/admin/questions?test_id=${id}`)).filter((q) => !q.archived);
  assert.equal(stored.length, ready.length, "Unexpected duplicate or extra bank content");
  // Compare all stored texts, four options and keys against the extracted source.
  for (const q of bank) {
    const found = stored.find((s) => s.text === q.text && JSON.stringify(s.options) === JSON.stringify(q.options));
    assert.ok(found, "Question changed during import");
    assert.equal(found.correct_id, q.correct_id);
  }
  await admin(`/admin/tests/${id}`, { ...config, published: 1 }, "PUT");
  if (groups.length) await admin("/admin/assignments", {
    test_id: id, group_ids: groups.map((g) => g.id), user_ids: [],
    starts_at: null, ends_at: null, max_attempts: 2,
  });
  const verified = (await admin("/admin/tests")).find((t) => t.id === id);
  assert.equal(verified.demo, 0);
  assert.equal(verified.bank_count, ready.length);
  assert.equal(verified.question_count, 25);
  assert.equal(verified.minutes, 60);
  assert.equal(verified.pass_percent, 50);
  report.tests.push({ id, title, bank_count: stored.length, questions_per_attempt: 25, minutes: 60, max_points: 100, points_per_question: 4, pass_points: 50, imported: imported.created, existing: imported.skipped, assigned_groups: groups.map((g) => g.name) });
  console.log(`${title}: ${stored.length} questions verified, ${imported.created} new; assigned to ${groups.length} demo groups.`);
}
fixture.source_sha256 = manifest.sha256;
save();
const output = family==='МСФООС' ? 'output/msfoos' : 'output/msfo';
mkdirSync(output, { recursive: true });
writeFileSync(`${output}/import.json`, JSON.stringify(report, null, 2));
console.log(`Pending source keys: ${pending.join(", ") || "none"}. No missing answer was guessed.`);
await admin("/auth/logout", {});
