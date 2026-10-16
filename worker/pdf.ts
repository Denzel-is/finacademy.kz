import { PDFDocument, rgb, type PDFFont } from "pdf-lib";
import fontkit from "@pdf-lib/fontkit";
import type { AttemptRecord } from "./exam.ts";
function wrap(text: string, font: PDFFont, size: number, width: number) {
  const lines: string[] = [];
  let line = "";
  for (const word of text.split(/\s+/)) {
    if (font.widthOfTextAtSize(`${line} ${word}`, size) > width && line) {
      lines.push(line);
      line = word;
    } else line = line ? `${line} ${word}` : word;
  }
  if (line) lines.push(line);
  return lines;
}
export async function certificatePdf(
  row: AttemptRecord,
  academy: string,
  fontData: ArrayBuffer,
  timezone = "Asia/Almaty",
) {
  const doc = await PDFDocument.create();
  doc.registerFontkit(fontkit);
  const font = await doc.embedFont(fontData, { subset: true });
  const page = doc.addPage([842, 595]);
  const ink = rgb(0.12, 0.23, 0.17),
    muted = rgb(0.43, 0.52, 0.45),
    accent = rgb(0.13, 0.4, 0.3),
    line = rgb(0.83, 0.88, 0.81);
  doc.setTitle(`Результат тестирования - ${row.student_name}`);
  doc.setAuthor(academy);
  doc.setSubject(row.test_title);
  page.drawRectangle({
    x: 0,
    y: 0,
    width: 842,
    height: 595,
    color: rgb(0.98, 0.99, 0.97),
  });
  page.drawRectangle({
    x: 20,
    y: 20,
    width: 802,
    height: 555,
    borderColor: line,
    borderWidth: 1,
  });
  page.drawRectangle({ x: 20, y: 20, width: 10, height: 555, color: accent });
  const text = (value: string, x: number, y: number, size = 12, color = ink) =>
    page.drawText(value, { x, y, size, font, color });
  text(academy, 57, 530, 18, accent);
  text("ПЛАТФОРМА ОНЛАЙН-ТЕСТИРОВАНИЯ", 57, 508, 8, muted);
  text(`№ FA-${row.id.slice(0, 8).toUpperCase()}`, 635, 530, 10, muted);
  page.drawLine({
    start: { x: 57, y: 484 },
    end: { x: 785, y: 484 },
    color: line,
    thickness: 1,
  });
  text("ДОКУМЕНТ О РЕЗУЛЬТАТЕ", 57, 432, 29, accent);
  text(
    "Настоящим зафиксирован результат онлайн-тестирования:",
    57,
    400,
    11,
    muted,
  );
  const size =
    row.student_name.length > 65 ? 20 : row.student_name.length > 40 ? 24 : 29;
  wrap(row.student_name, font, size, 720)
    .slice(0, 2)
    .forEach((v, i) => text(v, 57, 350 - i * 31, size));
  text("ДИСЦИПЛИНА / ТЕСТ", 57, 281, 8, muted);
  wrap(row.test_title, font, 18, 720)
    .slice(0, 2)
    .forEach((v, i) => text(v, 57, 253 - i * 24, 18));
  const total = JSON.parse(row.question_snapshot_json).length;
  const fields = [
    ["ПРАВИЛЬНЫХ ОТВЕТОВ", `${row.score} из ${total}`],
    ["БАЛЛЫ ИЗ 100", `${row.percent} / 100`],
    ["ПРОХОДНОЙ БАЛЛ", `${row.pass_percent} / 100`],
    [
      "ИТОГОВЫЙ СТАТУС",
      row.status === "blocked"
        ? "ЗАБЛОКИРОВАН"
        : row.passed
          ? "СДАЛ"
          : "НЕ СДАЛ",
    ],
  ];
  fields.forEach(([label, value], i) => {
    const x = 57 + i * 184;
    text(label, x, 179, 8, muted);
    text(value, x, 149, i === 3 ? 14 : 21, i === 3 ? accent : ink);
  });
  page.drawLine({
    start: { x: 57, y: 115 },
    end: { x: 785, y: 115 },
    color: line,
    thickness: 1,
  });
  text("ДАТА ПРОХОЖДЕНИЯ", 57, 86, 8, muted);
  text(
    new Intl.DateTimeFormat("ru-RU", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      timeZone: timezone,
    }).format(new Date(row.finished_at!)),
    57,
    66,
    12,
  );
  text("УЧЕБНАЯ ГРУППА", 260, 86, 8, muted);
  text(row.group_name || "Индивидуальное тестирование", 260, 66, 12);
  text("Документ сформирован автоматически", 554, 86, 9, muted);
  text("Первая версия платформы", 554, 66, 9, muted);
  return doc.save();
}
