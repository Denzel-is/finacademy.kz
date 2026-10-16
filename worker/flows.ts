import { z } from "zod";
import { HTTPException } from "hono/http-exception";
import {
  parseStudentList,
  displayName,
  normalizeLogin,
  FLOW_LIMIT,
} from "../shared/flows.ts";
import { digest, temporaryCredentials } from "./security.ts";
const schema = z.object({
  name: z.string().trim().min(2).max(80),
  text: z.string().max(30000).default(""),
  student_ids: z.array(z.string()).max(FLOW_LIMIT).default([]),
  request_id: z.uuid().optional(),
});
async function input(c: any) {
  const text = await c.req.text();
  if (text.length > 40000)
    throw new HTTPException(413, { message: "Список слишком большой." });
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    throw new HTTPException(400, { message: "Некорректный формат списка." });
  }
  return schema.parse(value);
}
async function preview(db: D1Database, value: z.infer<typeof schema>) {
  const students = (
    await db
      .prepare(
        "SELECT id,name,login,login_key,group_id FROM users WHERE role='student'",
      )
      .all<any>()
  ).results;
  const accounts = (
    await db.prepare("SELECT id,login,login_key,role FROM users").all<any>()
  ).results;
  const rows: any[] = parseStudentList(value.text);
  for (const id of [...new Set(value.student_ids)]) {
    const student = students.find((s) => s.id === id);
    rows.push(
      student
        ? {
            line: null,
            name: student.name,
            login: student.name,
            existing_id: id,
            error: "",
          }
        : {
            line: null,
            name: "",
            login: "",
            error: "Выбранный студент не найден.",
          },
    );
  }
  const seen = new Set<string>(),
    seenIds = new Set<string>();
  for (const row of rows) {
    const key = normalizeLogin(row.login);
    const match = accounts.find(
      (a) => (a.login_key || normalizeLogin(a.login)) === key,
    );
    const names = students.filter((s) => normalizeLogin(s.name) === key);
    if (!row.existing_id && match?.role === "student")
      row.existing_id = match.id;
    else if (!row.existing_id && names.length === 1)
      row.existing_id = names[0].id;
    else if (!row.existing_id && names.length > 1)
      row.error =
        "Есть несколько студентов с таким ФИО. Выберите нужного из списка.";
    if (match && match.id !== row.existing_id)
      row.error =
        "Это ФИО уже используется как логин другой учётной записи. Уточните ФИО.";
    if (seen.has(key) || (row.existing_id && seenIds.has(row.existing_id)))
      row.error = "Студент повторяется в списке.";
    seen.add(key);
    if (row.existing_id) seenIds.add(row.existing_id);
    row.name = displayName(row.name);
    row.login = row.name;
    row.status = row.error ? "error" : row.existing_id ? "existing" : "new";
  }
  const errors = [
    ...(rows.length === 0 ? ["Добавьте хотя бы одного студента."] : []),
    ...(rows.length > FLOW_LIMIT
      ? [`В одном потоке не более ${FLOW_LIMIT} студентов.`]
      : []),
  ];
  return {
    name: value.name,
    rows,
    errors,
    total: rows.length,
    can_create: !errors.length && rows.every((r) => !r.error),
  };
}
export function registerFlows(app: any) {
  app.post("/api/admin/flows/preview", async (c: any) =>
    c.json(await preview(c.env.DB, await input(c))),
  );
  app.post("/api/admin/flows", async (c: any) => {
    const value = await input(c),
      db: D1Database = c.env.DB;
    if (!value.request_id)
      throw new HTTPException(400, {
        message: "Обновите форму создания потока.",
      });
    const checksum = await digest(
      JSON.stringify([
        value.name,
        parseStudentList(value.text).map((r) => r.name),
        [...new Set(value.student_ids)].sort(),
      ]),
    );
    const previous = await db
      .prepare("SELECT id,creation_digest FROM groups WHERE creation_key=?")
      .bind(value.request_id)
      .first<any>();
    if (previous) {
      if (previous.creation_digest !== checksum)
        throw new HTTPException(409, {
          message: "Этот запрос уже использован для другого списка.",
        });
      const credentials = (
        await db
          .prepare(
            "SELECT name,login,must_change_password FROM users WHERE group_id=? AND role='student'",
          )
          .bind(previous.id)
          .all<any>()
      ).results;
      return c.json({
        id: previous.id,
        existing: true,
        credentials_available: false,
        credentials: credentials.map((s) => ({
          ...s,
          password: s.must_change_password ? "Не выдаётся повторно; сбросьте пароль" : "Уже изменён студентом",
          password_available: false,
          group: value.name,
        })),
      });
    }
    const result = await preview(db, value);
    if (!result.can_create)
      throw new HTTPException(400, {
        message: result.errors.join(" ") || "Исправьте отмеченные строки.",
      });
    const id = crypto.randomUUID(),
      time = new Date().toISOString();
    const users = await temporaryCredentials(
      result.rows.map((row) => ({
        ...row,
        id: row.existing_id || crypto.randomUUID(),
      })),
    );
    const flowRateKeys = (await Promise.all(users.map(async row => [await digest('login:'+normalizeLogin(row.login)), await digest('password-change:'+row.id)]))).flat();
    await db.batch([
      db
        .prepare(
          "INSERT INTO groups(id,name,description,created_at,creation_key,creation_digest) VALUES(?,?,?,?,?,?)",
        )
        .bind(
          id,
          value.name,
          "Поток Академии финансов",
          time,
          value.request_id,
          checksum,
        ),
      ...users.flatMap((row) =>
        row.existing_id
          ? [
              db
                .prepare(
                  "UPDATE users SET name=?,login=?,login_key=?,group_id=?,password_hash=?,must_change_password=1,blocked=0 WHERE id=? AND role='student'",
                )
                .bind(
                  row.name,
                  row.login,
                  normalizeLogin(row.login),
                  id,
                  row.hash,
                  row.id,
                ),
              db.prepare("DELETE FROM sessions WHERE user_id=?").bind(row.id),
            ]
          : [
              db
                .prepare(
                  "INSERT INTO users(id,name,login,login_key,password_hash,must_change_password,role,group_id,created_at) VALUES(?,?,?,?,?,1,'student',?,?)",
                )
                .bind(
                  row.id,
                  row.name,
                  row.login,
                  normalizeLogin(row.login),
                  row.hash,
                  id,
                  time,
                ),
            ],
      ),
      db.prepare("DELETE FROM rate_limits WHERE key IN(SELECT value FROM json_each(?))").bind(JSON.stringify(flowRateKeys)),
      db
        .prepare(
          "INSERT INTO audit_log(id,user_id,action,details,created_at) VALUES(?,?,?,?,?)",
        )
        .bind(
          crypto.randomUUID(),
          c.get("user").id,
          "flow.create",
          `${value.name}: ${users.length} студентов`,
          time,
        ),
    ]);
    return c.json(
      {
        id,
        credentials_available: true,
        credentials: users.map((row) => ({
          name: row.name,
          login: row.login,
          password: row.password,
          password_available: true,
          group: value.name,
        })),
      },
      201,
    );
  });
  app.post("/api/admin/students/reset-passwords", async (c: any) => {
    const value = z
      .object({ ids: z.array(z.string()).min(1).max(500) })
      .parse(await c.req.json());
    const ids = [...new Set(value.ids)],
      db: D1Database = c.env.DB;
    const rows = (
      await db
        .prepare(
          "SELECT id,name,login FROM users WHERE role='student' AND id IN(SELECT value FROM json_each(?))",
        )
        .bind(JSON.stringify(ids))
        .all<any>()
    ).results;
    if (rows.length !== ids.length)
      throw new HTTPException(400, {
        message: "Один из выбранных студентов не найден.",
      });
    const rateKeys = (await Promise.all(rows.map(async row => [await digest('login:'+normalizeLogin(row.login)), await digest('password-change:'+row.id)]))).flat();
    const credentials = await temporaryCredentials(rows);
    await db.batch([
      ...credentials.map((row) =>
          db
            .prepare(
              "UPDATE users SET password_hash=?,must_change_password=1 WHERE id=?",
            )
            .bind(row.hash, row.id),
        ),
      db
        .prepare(
          "DELETE FROM sessions WHERE user_id IN(SELECT value FROM json_each(?))",
        )
        .bind(JSON.stringify(ids)),
      db.prepare("DELETE FROM rate_limits WHERE key IN(SELECT value FROM json_each(?))").bind(JSON.stringify(rateKeys)),
      db
        .prepare(
          "INSERT INTO audit_log(id,user_id,action,details,created_at) VALUES(?,?,?,?,?)",
        )
        .bind(
          crypto.randomUUID(),
          c.get("user").id,
          "students.password-reset",
          `Сброшено паролей: ${ids.length}`,
          new Date().toISOString(),
        ),
    ]);
    return c.json({ count: rows.length, credentials: credentials.map(({hash: _hash, ...credential}) => credential) });
  });
}
