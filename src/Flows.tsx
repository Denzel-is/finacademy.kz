import { useState, useRef, useMemo } from "react";
import { api } from "./api";
import { useData } from "./useData";
import { Modal, Field, Spinner } from "./ui";
import type { User } from "../shared/types";
import { parseStudentList, FLOW_LIMIT } from "../shared/flows";
import { FlowAssignmentPanel, type FlowCredential } from "./FlowAssignments";
type Preview = {
  total: number;
  can_create: boolean;
  errors: string[];
  rows: { line: number | null; name: string; status: string; error: string }[];
};
export function FlowCreator({
  onClose,
  onDone,
}: {
  onClose: () => void;
  onDone: (credentials: any[]) => void;
}) {
  const [name, setName] = useState(""),
    [text, setText] = useState(""),
    [selected, setSelected] = useState<string[]>([]),
    [search, setSearch] = useState(""),
    [preview, setPreview] = useState<Preview | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const [created, setCreated] = useState<{ id: string; credentials: FlowCredential[]; credentials_available?: boolean } | null>(null);
  const request = useRef(crypto.randomUUID());
  const submitting = useRef(false);
  const { data: students, loading } = useData<User[]>("/admin/students");
  const total = parseStudentList(text).length + selected.length;
  const filtered = useMemo(
    () =>
      (students || []).filter(
        (s) =>
          !s.blocked &&
          `${s.name} ${s.login}`.toLowerCase().includes(search.toLowerCase()),
      ),
    [students, search],
  );
  function edited() {
    setPreview(null);
    setError("");
    request.current = crypto.randomUUID();
  }
  async function submit(create = false) {
    if(submitting.current)return;
    submitting.current=true;
    setBusy(true);
    setError("");
    try {
      const payload = {
        name,
        text,
        student_ids: selected,
        request_id: request.current,
      };
      if (create) {
        const result = await api<{ id: string; credentials: FlowCredential[]; credentials_available?: boolean }>("/admin/flows", payload);
        setCreated(result);
      } else setPreview(await api("/admin/flows/preview", payload));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      submitting.current=false;
      setBusy(false);
    }
  }
  if (created) {
    const close = () => {
      if (!submitting.current) onDone(created.credentials);
    };
    return (
      <Modal title="Поток создан · тесты и доступы" description="Назначьте нужные тесты и скачайте доступы без перехода на другую страницу." onClose={close} wide>
        {created.credentials_available===false&&<p className="notice warning" role="alert">Поток уже был создан. Пароли выдаются только один раз. Если первый ответ не загрузился, выделите студентов этого потока и выдайте новые пароли через массовый сброс.</p>}
        <FlowAssignmentPanel
          group={{ id: created.id, name, student_count: created.credentials.length }}
          credentials={created.credentials}
          onClose={close}
          onBusyChange={(value) => { submitting.current = value; }}
        />
      </Modal>
    );
  }
  return (
    <Modal
      title="Создать поток"
      description="Вставьте ФИО или выберите существующих студентов. До 50 человек."
      onClose={()=>{if(!submitting.current)onClose();}}
      wide
    >
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void submit(Boolean(preview?.can_create));
        }}
      >
        <fieldset className="form-body form-fields" disabled={busy}>
          <Field label="Название потока">
            <input
              required
              minLength={2}
              maxLength={80}
              value={name}
              onChange={(e) => {
                setName(e.target.value);
                edited();
              }}
              placeholder="МСФО · октябрь 2026"
            />
          </Field>
          <Field
            label="Список студентов"
            hint="Каждое ФИО с новой строки. Можно 1. ФИО, 1) ФИО, 1: ФИО или без номера."
          >
            <textarea
              rows={8}
              maxLength={30000}
              value={text}
              onChange={(e) => {
                setText(e.target.value);
                edited();
              }}
              placeholder={
                "1. Иванова Анна Сергеевна\n2: Әбілова Айдана Ерланқызы"
              }
            />
          </Field>
          <p className={total > FLOW_LIMIT ? "form-error" : "muted"}>
            Студентов: {total} из {FLOW_LIMIT}
          </p>
          <details>
            <summary>Выбрать существующих студентов</summary>
            <Field label="Поиск студента">
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </Field>
            {loading ? (
              <Spinner />
            ) : (
              <div className="target-list">
                {filtered.map((s) => (
                  <label key={s.id}>
                    <input
                      type="checkbox"
                      checked={selected.includes(s.id)}
                      onChange={() => {
                        setSelected((old) =>
                          old.includes(s.id)
                            ? old.filter((id) => id !== s.id)
                            : [...old, s.id],
                        );
                        edited();
                      }}
                    />
                    <strong>{s.name}</strong>
                    <small>{s.group_name || "Без потока"}</small>
                  </label>
                ))}
              </div>
            )}
          </details>
          <div className="notice">
            <span>
              Логин — ФИО, временный пароль — <strong>уникальный для каждого</strong>. После входа
              студент задаст свой пароль. Существующие студенты будут переведены в
              новый поток, их пароли тоже сбросятся; прежние результаты сохранятся.
            </span>
          </div>
          {preview && (
            <>
              <h3>Предпросмотр · {preview.total} студентов</h3>
              {preview.errors.map((message) => (
                <p className="form-error" key={message}>
                  {message}
                </p>
              ))}
              <div className="table-scroll">
                <table>
                  <thead>
                    <tr>
                      <th>Строка</th>
                      <th>ФИО / логин</th>
                      <th>Проверка</th>
                    </tr>
                  </thead>
                  <tbody>
                    {preview.rows.map((row, index) => (
                      <tr key={index}>
                        <td>{row.line || "Выбор"}</td>
                        <td>{row.name}</td>
                        <td className={row.error ? "form-error" : ""}>
                          {row.error ||
                            (row.status === "existing"
                              ? "Будет переведён"
                              : "Будет создан")}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
          {error && (
            <p className="form-error" role="alert">
              {error}
            </p>
          )}
        </fieldset>
        <div className="modal-footer">
          <button
            type="button"
            className="btn secondary"
            disabled={busy}
            onClick={onClose}
          >
            Отмена
          </button>
          <button
            className="btn primary"
            disabled={
              busy ||
              total === 0 ||
              total > FLOW_LIMIT ||
              Boolean(preview && !preview.can_create)
            }
          >
            {busy
              ? "Обрабатываем…"
              : preview?.can_create
                ? "Создать поток"
                : "Проверить список"}
          </button>
        </div>
      </form>
    </Modal>
  );
}
