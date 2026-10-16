import { useState, useRef } from "react";
import {
  Upload,
  Download,
  FileSpreadsheet,
  CheckCircle2,
  AlertTriangle,
  LoaderCircle,
  ArrowRight,
  Check,
  X,
} from "lucide-react";
import { Modal, Badge, ErrorState } from "./ui";
import { api } from "./api";
import {
  readExcel,
  studentTemplate,
  questionTemplate,
  credentialsExcel,
  writeExcel,
} from "./excel";
import { useApp } from "./app-context";
import { CredentialDelivery } from "./CredentialDelivery";
type Preview = { row: number; status: string; errors: string; data: any };
export function ImportModal({
  kind,
  testId,
  onClose,
  onDone,
}: {
  kind: "students" | "questions";
  testId?: string;
  onClose: () => void;
  onDone: () => void;
}) {
  const [rows, setRows] = useState<any[]>([]),
    [preview, setPreview] = useState<Preview[]>([]),
    [file, setFile] = useState(""),
    [mode, setMode] = useState("skip"),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [done, setDone] = useState<any>(null);
  const input = useRef<HTMLInputElement>(null);
  const { notify } = useApp();
  const isStudents = kind === "students";
  const payload = (raw: any[], m = mode) =>
    isStudents ? { rows: raw, mode: m } : { rows: raw, test_id: testId };
  async function load(file: File) {
    setBusy(true);
    setError("");
    setPreview([]);
    try {
      const matrix = await readExcel(file);
      const headers = matrix[0].map(h=>h === "Группа" ? "Поток" : h);
      const expected = isStudents
        ? ["ФИО", "Логин", "Пароль", "Поток"]
        : ["Вопрос", "Вариант 1", "Вариант 2", "Правильный"];
      if (expected.some((h) => !headers.includes(h)))
        throw new Error(
          "Столбцы не соответствуют шаблону. Скачайте и заполните шаблон.",
        );
      const data = matrix
        .slice(1)
        .filter((row) => row.some(Boolean))
        .map((row) => {
          const get = (name: string) => row[headers.indexOf(name)] || "";
          if (isStudents)
            return {
              name: get("ФИО"),
              login: get("Логин"),
              password: get("Пароль"),
              group: get("Поток"),
            };
          const options = headers
            .filter((h) => /^Вариант \d+$/.test(h))
            .map((h) => ({ id: String(h.match(/\d+/)![0]), text: get(h) }))
            .filter((o) => o.text);
          return {
            text: get("Вопрос"),
            options,
            correct_id: get("Правильный"),
          };
        });
      if (data.length > 500)
        throw new Error("За один импорт можно загрузить до 500 строк.");
      setRows(data);
      setFile(file.name);
      setPreview(await api(`/admin/import/${kind}/preview`, payload(data)));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function changeMode(value: string) {
    setMode(value);
    if (rows.length) {
      setBusy(true);
      try {
        setPreview(
          await api(`/admin/import/${kind}/preview`, payload(rows, value)),
        );
      } catch (e) {
        setError((e as Error).message);
      } finally {
        setBusy(false);
      }
    }
  }
  async function commit() {
    setBusy(true);
    setError("");
    try {
      const result = await api(`/admin/import/${kind}/commit`, payload(rows));
      setDone(result);
      onDone();
      notify(`Импорт завершён. Добавлено: ${result.created}.`);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal
      title={`Импорт ${isStudents ? "студентов" : "вопросов"}`}
      description="Загрузите Excel, проверьте данные и подтвердите импорт."
      onClose={onClose}
      wide
    >
      <div className="import-body">
        {done ? (
          <div className="import-success">
            <CheckCircle2 size={44} />
            <h3>Импорт завершён</h3>
            <p>
              Добавлено: <strong>{done.created}</strong> · Обновлено:{" "}
              <strong>{done.updated || 0}</strong> · Пропущено:{" "}
              <strong>{done.skipped}</strong>
            </p>
            {done.credentials?.length > 0 && (
              <>
                <p className="muted">
                  Скачайте данные для входа сейчас. Повторно посмотреть пароли
                  невозможно; позже их можно сбросить.
                </p>
                <button
                  className="btn primary"
                  onClick={() =>
                    void credentialsExcel(done.credentials).catch((e) =>
                      setError(e.message),
                    )
                  }
                >
                  <Download size={16} /> Скачать доступы
                </button>
              </>
            )}
            <button
              className="btn secondary"
              onClick={() =>
                void writeExcel(
                  ["Строка", "Статус", "Ошибка"],
                  preview.map((r) => [r.row, r.status, r.errors]),
                  "Отчёт-импорта.xlsx",
                ).catch((e) => setError(e.message))
              }
            >
              <FileSpreadsheet size={16} /> Отчёт об импорте
            </button>
          </div>
        ) : (
          <>
            <div className="import-template">
              <span className="stat-icon green">
                <FileSpreadsheet size={22} />
              </span>
              <div>
                <strong>Начните со стандартного шаблона</strong>
                <p>
                  {isStudents
                    ? "ФИО, логин, пароль и поток. Пустой пароль означает уникальный временный пароль с обязательной сменой."
                    : "Один вопрос в строке. В «Правильный» укажите номер верного варианта."}
                </p>
              </div>
              <button
                className="btn secondary"
                onClick={() =>
                  void (
                    isStudents ? studentTemplate() : questionTemplate()
                  ).catch((e) => setError(e.message))
                }
              >
                <Download size={16} /> Шаблон
              </button>
            </div>
            <input
              ref={input}
              type="file"
              accept=".xlsx"
              className="visually-hidden"
              aria-label="Файл Excel"
              onChange={(e) => {
                if (e.target.files?.[0]) void load(e.target.files[0]);
              }}
            />
            <button
              className="dropzone"
              disabled={busy}
              onClick={() => input.current?.click()}
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => {
                e.preventDefault();
                if (e.dataTransfer.files[0]) void load(e.dataTransfer.files[0]);
              }}
            >
              <span className="upload-circle">
                {busy ? (
                  <LoaderCircle size={25} className="spin" />
                ) : (
                  <Upload size={25} />
                )}
              </span>
              <strong>{file || "Нажмите или перетащите файл сюда"}</strong>
              <span>Excel (.xlsx) · до 5 МБ · до 500 строк</span>
            </button>
            {isStudents && (
              <label className="inline-field">
                Повторяющиеся логины
                <select
                  value={mode}
                  onChange={(e) => void changeMode(e.target.value)}
                  disabled={busy}
                >
                  <option value="skip">
                    Пропустить существующих студентов
                  </option>
                  <option value="update">
                    Обновить ФИО и поток; сохранить пароль
                  </option>
                </select>
              </label>
            )}
            {preview.length > 0 && (
              <>
                <div className="import-preview-heading">
                  <h3>
                    Предпросмотр <Badge>{preview.length} строк</Badge>
                  </h3>
                  <span>
                    {preview.filter((r) => r.status === "error").length ? (
                      <Badge tone="red">Есть ошибки</Badge>
                    ) : (
                      <Badge tone="green">Готово к импорту</Badge>
                    )}
                  </span>
                </div>
                <div className="table-scroll import-preview">
                  <table>
                    <thead>
                      <tr>
                        <th>Строка</th>
                        <th>{isStudents ? "ФИО / логин" : "Вопрос"}</th>
                        <th>Действие</th>
                        <th>Проверка</th>
                      </tr>
                    </thead>
                    <tbody>
                      {preview.map((r) => (
                        <tr key={r.row}>
                          <td>{r.row}</td>
                          <td>
                            <strong className="table-title">
                              {r.data.name || r.data.text || "Не заполнено"}
                            </strong>
                            {r.data.login && (
                              <small className="cell-sub">
                                {r.data.login} · {r.data.group}
                              </small>
                            )}
                          </td>
                          <td>
                            <Badge
                              tone={
                                r.status === "error"
                                  ? "red"
                                  : r.status === "create"
                                    ? "green"
                                    : "neutral"
                              }
                            >
                              {
                                {
                                  create: "Добавить",
                                  skip: "Пропустить",
                                  update: "Обновить",
                                  error: "Ошибка",
                                }[r.status]
                              }
                            </Badge>
                          </td>
                          <td>
                            {r.errors ? (
                              <span className="form-error">{r.errors}</span>
                            ) : (
                              <Check size={16} className="green-text" />
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <div className="notice">
                  <AlertTriangle size={16} />
                  <span>
                    Изменения появятся только после подтверждения. Повторная
                    загрузка не создаёт дубликаты.
                  </span>
                </div>
              </>
            )}
          </>
        )}
        {error && <ErrorState error={error} />}
      </div>
      <div className="modal-footer">
        <button className="btn secondary" disabled={busy} onClick={onClose}>
          {done ? "Закрыть" : "Отмена"}
        </button>
        {!done && (
          <button
            className="btn primary"
            onClick={() => void commit()}
            disabled={
              busy ||
              !preview.length ||
              preview.some((r) => r.status === "error")
            }
          >
            {busy ? (
              <LoaderCircle className="spin" size={16} />
            ) : (
              <ArrowRight size={16} />
            )}{" "}
            Подтвердить импорт
          </button>
        )}
      </div>
    </Modal>
  );
}
export function CredentialsModal({credentials,onClose}:{credentials:{name?:string;login:string;password:string;group?:string}[];onClose:()=>void}) {
  const {settings}=useApp();
  return <Modal title="Выдать доступы студентам" description="Пароли показаны только сейчас. Скачайте таблицу или передайте каждому его карточку." onClose={onClose} wide>
    <div className="credentials-body"><CredentialDelivery credentials={credentials} organizationName={settings.academy_name}/></div>
    <div className="modal-footer"><button className="btn secondary" onClick={onClose}>Готово</button></div>
  </Modal>;
}
