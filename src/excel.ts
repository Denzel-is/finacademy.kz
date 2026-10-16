import type { ResultRow } from "../shared/types";
export async function writeExcel(
  headers: string[],
  rows: (string | number)[][],
  filename: string,
) {
  const { default: write } = await import("write-excel-file/browser");
  const data = [
    headers.map((value) => ({
      value,
      fontWeight: "bold" as const,
      backgroundColor: "#E9F2ED",
      color: "#176B53",
      height: 28,
    })),
    ...rows.map((row) =>
      row.map((value) => ({
        value,
        type: typeof value === "number" ? Number : String,
      })),
    ),
  ];
  await write(
    data as any,
    {
      columns: headers.map((h, i) => ({
        width: i === 0 ? 32 : Math.max(18, h.length + 4),
      })),
    },
    { fontFamily: "Arial", fontSize: 11 },
  ).toFile(filename);
}
export async function exportResults(rows: ResultRow[]) {
  return writeExcel(
    [
      "ФИО",
      "Логин",
      "Поток",
      "Тест",
      "Дата",
      "Правильно",
      "Вопросов",
      "Процент",
      "Порог",
      "Статус",
      "События",
    ],
    rows.map((r) => [
      r.student_name,
      r.login,
      r.group_name,
      r.test_title,
      r.finished_at || r.started_at,
      r.score ?? "",
      r.total_questions,
      r.percent ?? "",
      r.pass_percent,
      r.status === "active"
        ? "В процессе"
        : r.status === "blocked"
          ? "Заблокирован"
          : r.passed
            ? "Сдал"
            : "Не сдал",
      r.violation_count,
    ]),
    "Результаты-Академия-финансов.xlsx",
  );
}
export async function credentialsExcel(
  rows: { name?: string; login: string; password: string; group?: string }[],
) {
  return writeExcel(
    ["ФИО", "Логин", "Временный пароль", "Поток"],
    rows.map((r) => [r.name || "", r.login, r.password, r.group || ""]),
    "Доступы-студентов.xlsx",
  );
}
export async function readExcel(file: File) {
  if (file.size > 5 * 1024 * 1024)
    throw new Error("Максимальный размер файла: 5 МБ.");
  if (!file.name.toLowerCase().endsWith(".xlsx"))
    throw new Error("Выберите файл Excel в формате .xlsx.");
  const { default: read } = await import("read-excel-file");
  const rows = await read(file);
  if (!rows.length) throw new Error("Файл пуст.");
  return rows.map((row) => row.map((cell) => String(cell ?? "").trim()));
}
export async function studentTemplate() {
  return writeExcel(
    ["ФИО", "Логин", "Пароль", "Поток"],
    [
      ["Иванов Иван", "Иванов Иван", "", "Поток 1"],
      ["Петрова Анна", "Петрова Анна", "", "Поток 1"],
    ],
    "Шаблон-студентов.xlsx",
  );
}
export async function questionTemplate() {
  return writeExcel(
    [
      "Вопрос",
      "Вариант 1",
      "Вариант 2",
      "Вариант 3",
      "Вариант 4",
      "Правильный",
    ],
    [
      [
        "Что такое инфляция?",
        "Рост общего уровня цен",
        "Снижение общего уровня цен",
        "Рост ВВП",
        "Снижение безработицы",
        1,
      ],
    ],
    "Шаблон-вопросов.xlsx",
  );
}
