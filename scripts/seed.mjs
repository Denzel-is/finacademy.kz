import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { pbkdf2Sync, randomBytes, randomUUID, createHash } from "node:crypto";
import { subjects, demoQuestions } from "../content/demo-bank.mjs";
const target = process.argv.includes("--remote") ? "remote" : "local";
mkdirSync(".local", { recursive: true });
const statePath = ".local/seed-state.json";
let state = existsSync(statePath)
  ? JSON.parse(readFileSync(statePath, "utf8"))
  : null;
if (!state) {
  const adminPassword = randomBytes(15).toString("base64url");
  const studentPassword = randomBytes(12).toString("base64url");
  state = { adminPassword, studentPassword };
  writeFileSync(statePath, JSON.stringify(state), "utf8");
  writeFileSync(
    ".local/access.md",
    `# FinanceAcademy: доступы к первой версии\n\nЭти данные не публикуются в исходниках.\n\nАдминистратор\n- Логин: admin\n- Пароль: ${adminPassword}\n\nДемонстрационный студент\n- Логин: student001\n- Пароль: ${studentPassword}\n\nОстальные демонстрационные студенты: student002–student024, тот же временный пароль. Все имена вымышлены.\n\nСмените пароль администратора в настройках.\n`,
    "utf8",
  );
}
function hash(p) {
  const salt = randomUUID();
  return `pbkdf2$100000$${salt}$${pbkdf2Sync(p, salt, 100000, 32, "sha256").toString("hex")}`;
}
const quote = (v) =>
  v === null
    ? "NULL"
    : typeof v === "number"
      ? String(v)
      : `'${String(v).replaceAll("'", "''")}'`;
const insert = (table, data) =>
  `INSERT OR IGNORE INTO ${table}(${Object.keys(data).join(",")}) VALUES(${Object.values(data).map(quote).join(",")});`;
const sql = [];
const now = new Date().toISOString();
const groupNames = ["FA-101", "FA-102", "FA-201", "FA-202"];
for (let i = 0; i < 4; i++)
  sql.push(
    insert("groups", {
      id: `group-${i + 1}`,
      name: groupNames[i],
      description:
        i < 2
          ? "Первый курс · Финансовая грамотность"
          : "Второй курс · Финансы и учёт",
      created_at: now,
    }),
  );
sql.push(
  insert("users", {
    id: "admin-1",
    name: "Данила",
    login: "admin",
    password_hash: hash(state.adminPassword),
    role: "superadmin",
    created_at: now,
  }),
);
const names = [
  "Алия Сейдахметова",
  "Арман Касымов",
  "Дарья Иванова",
  "Тимур Ахметов",
  "София Петрова",
  "Данияр Омаров",
  "Анастасия Волкова",
  "Алихан Нурланов",
  "Мария Соколова",
  "Аружан Тлеубердина",
  "Никита Смирнов",
  "Екатерина Павлова",
  "Диас Муратов",
  "Полина Кузнецова",
  "Айгерим Жумабаева",
  "Максим Орлов",
  "Жанель Сулейменова",
  "Кирилл Морозов",
  "Алина Семёнова",
  "Руслан Искаков",
  "Виктория Новикова",
  "Мади Бекенов",
  "Елена Фёдорова",
  "Илья Андреев",
];
for (let i = 0; i < 24; i++)
  sql.push(
    insert("users", {
      id: `student-${i + 1}`,
      name: names[i],
      login: `student${String(i + 1).padStart(3, "0")}`,
      password_hash: hash(state.studentPassword),
      role: "student",
      group_id: `group-${Math.floor(i / 6) + 1}`,
      created_at: now,
    }),
  );
const allBanks = [];
for (let i = 0; i < subjects.length; i++) {
  const s = subjects[i],
    testId = `test-${i + 1}`,
    bank = demoQuestions(s, i).map((q, n) => ({
      id: `question-${i + 1}-${n + 1}`,
      text: q.text,
      options: q.options.map((text, k) => ({ id: String(k + 1), text })),
      correct_id: "1",
    }));
  allBanks.push(bank);
  sql.push(
    insert("tests", {
      id: testId,
      title: s.title,
      discipline: s.discipline,
      description: s.description,
      question_count: 10,
      pass_percent: 70,
      minutes: 20,
      max_attempts: 2,
      published: 1,
      proctor_mode: "warn",
      proctor_limit: 3,
      fullscreen: 0,
      show_result: 1,
      show_history: 1,
      demo: 1,
      created_at: new Date(Date.now() - i * 60000).toISOString(),
    }),
  );
  for (const q of bank) {
    const content_hash = createHash("sha256")
      .update(
        q.text.trim().toLowerCase() +
          "|" +
          q.options
            .map((o) => o.text.trim().toLowerCase())
            .sort()
            .join("|"),
      )
      .digest("hex");
    sql.push(
      insert("questions", {
        id: q.id,
        test_id: testId,
        text: q.text,
        options_json: JSON.stringify(q.options),
        correct_id: q.correct_id,
        content_hash,
        created_at: now,
      }),
    );
  }
  for (let g = 0; g < 4; g++)
    sql.push(
      insert("assignments", {
        id: `assignment-${i + 1}-${g + 1}`,
        test_id: testId,
        group_id: `group-${g + 1}`,
        max_attempts: 2,
        created_at: now,
      }),
    );
}
for (let i = 0; i < 56; i++) {
  const student = i % 24,
    subject = Math.floor(i / 24),
    bank = allBanks[subject].slice(0, 10),
    answers = {},
    score = i % 7 === 0 ? 5 : i % 5 === 0 ? 6 : i % 3 === 0 ? 10 : 8;
  for (let q = 0; q < 10; q++) answers[bank[q].id] = q < score ? "1" : "2";
  const start = new Date(
    Date.now() - (13 - (i % 14)) * 86400000 - (i % 4) * 3600000,
  );
  const finished = new Date(start.getTime() + 13 * 60000);
  const publicQs = bank.map(({ correct_id, ...q }) => q);
  sql.push(
    insert("attempts", {
      id: `demo-attempt-${i + 1}`,
      user_id: `student-${student + 1}`,
      test_id: `test-${subject + 1}`,
      assignment_id: `assignment-${subject + 1}-${Math.floor(student / 6) + 1}`,
      test_title: subjects[subject].title,
      student_name: names[student],
      group_name: groupNames[Math.floor(student / 6)],
      status: "completed",
      started_at: start.toISOString(),
      deadline: new Date(start.getTime() + 20 * 60000).toISOString(),
      finished_at: finished.toISOString(),
      pass_percent: 70,
      question_snapshot_json: JSON.stringify(publicQs),
      answer_key_json: JSON.stringify(
        Object.fromEntries(bank.map((q) => [q.id, "1"])),
      ),
      answers_json: JSON.stringify(answers),
      version: 10,
      score,
      percent: score * 10,
      passed: Number(score >= 7),
      proctor_mode: "warn",
      proctor_limit: 3,
      show_result: 1,
      show_history: 1,
      violation_count: i % 9 === 0 ? 1 : 0,
    }),
  );
  if (i % 9 === 0)
    sql.push(
      insert("proctor_events", {
        attempt_id: `demo-attempt-${i + 1}`,
        epoch: 0,
        event_id: randomUUID(),
        kind: "hidden",
        occurred_at: new Date(start.getTime() + 5 * 60000).toISOString(),
        received_at: new Date(
          start.getTime() + 5 * 60000 + 12000,
        ).toISOString(),
        returned_at: new Date(start.getTime() + 5 * 60000 + 8000).toISOString(),
        duration_ms: 8000,
        question_code: bank[3].id,
        counted: 1,
      }),
    );
}
sql.push(
  insert("audit_log", {
    id: "seed-initial",
    user_id: "admin-1",
    action: "demo.initialize",
    details:
      "Первая версия: 24 вымышленных студента, 4 группы, 10 тестов, 200 демонстрационных вопросов, 56 учебных результатов.",
    created_at: now,
  }),
);
const sqlPath = ".local/demo-seed.sql";
writeFileSync(sqlPath, sql.join("\n"), "utf8");
const result = spawnSync(
  process.execPath,
  [
    "node_modules/wrangler/bin/wrangler.js",
    "d1",
    "execute",
    "DB",
    `--${target}`,
    "--file",
    sqlPath,
  ],
  { stdio: "inherit" },
);
if (result.status !== 0) process.exit(result.status || 1);
console.log(
  `Seeded ${target}. Private access file: .local/access.md (not deployed).`,
);
