import { TestPreview } from "./TestPreview";
import { useFilter } from "./useFilter";
import { organizationInstant } from "../shared/time";
import { useState, useEffect } from "react";
import {
  Plus,
  Play,
  ClipboardList,
  Clock3,
  ShieldCheck,
  LibraryBig,
  Pencil,
  ArrowUpRight,
  Upload,
  Trash2,
  Check,
  KeyRound,
  Users,
  Layers,
  Search,
  LockKeyhole,
  FileSpreadsheet,
  Download,
  LoaderCircle,
} from "lucide-react";
import { useData } from "./useData";
import { useApp } from "./app-context";
import { api } from "./api";
import {
  Spinner,
  ErrorState,
  Empty,
  Modal,
  AsyncForm,
  Field,
  Badge,
  SearchInput,
  Pagination,
  date,
} from "./ui";
import { ImportModal } from "./Imports";
import { readExcel, writeExcel } from "./excel";
import type {
  Test,
  BankQuestion,
  Group,
  User,
  Assignment,
  Option,
} from "../shared/types";
const defaultTest = {
  title: "",
  discipline: "",
  description: "",
  question_count: 10,
  pass_percent: 70,
  minutes: 30,
  max_attempts: 2,
  published: 0,
  proctor_mode: "warn" as const,
  proctor_limit: 3,
  fullscreen: 0,
  show_result: 1,
  show_history: 1,
};
export function TestsPage() {
  const {
    data: tests,
    error,
    loading,
    reload,
  } = useData<Test[]>("/admin/tests");
  const { navigate, notify } = useApp();
  const [search, setSearch] = useFilter("tests.search", ""),
    [filter, setFilter] = useFilter("tests.filter", ""),
    [edit, setEdit] = useState<Test | null | undefined>(undefined),
    [preview, setPreview] = useState<Test | null>(null);
  useEffect(() => {
    if (location.hash.includes("create=1")) setEdit(null);
  }, []);
  const filtered = (tests || []).filter(
    (t) =>
      (!search ||
        `${t.title} ${t.discipline}`
          .toLowerCase()
          .includes(search.toLowerCase())) &&
      (!filter || String(t.published) === filter),
  );
  if (preview)
    return <TestPreview test={preview} onExit={() => setPreview(null)} />;
  return (
    <div className="page">
      <div className="page-heading">
        <div>
          <h1>
            Тесты <span className="heading-count">{tests?.length || 0}</span>
          </h1>
          <p>От первого вопроса до объективной оценки знаний.</p>
        </div>
        <button className="btn primary" onClick={() => setEdit(null)}>
          <Plus size={17} /> Создать тест
        </button>
      </div>
      <div className="standalone-toolbar">
        <SearchInput
          value={search}
          onChange={setSearch}
          placeholder="Название теста или дисциплина"
        />
        <div className="segmented">
          <button
            className={!filter ? "active" : ""}
            onClick={() => setFilter("")}
          >
            Все тесты
          </button>
          <button
            className={filter === "1" ? "active" : ""}
            onClick={() => setFilter("1")}
          >
            Опубликованы
          </button>
          <button
            className={filter === "0" ? "active" : ""}
            onClick={() => setFilter("0")}
          >
            Черновики
          </button>
        </div>
      </div>
      {loading && !tests ? (
        <Spinner />
      ) : error ? (
        <ErrorState error={error} retry={reload} />
      ) : filtered.length ? (
        <div className="tests-grid">
          {filtered.map((t, i) => (
            <section className="panel test-card" key={t.id}>
              <div className="test-card-top">
                <span className={`test-icon tone-${i % 4}`}>
                  <ClipboardList size={23} />
                </span>
                <div>
                  <Badge tone={t.published ? "green" : "neutral"}>
                    {t.published ? "Опубликован" : "Черновик"}
                  </Badge>
                  {Boolean(t.demo) && <span className="demo-label">Демо</span>}
                </div>
                <button
                  className="icon-button"
                  aria-label={`Настроить ${t.title}`}
                  onClick={() => setEdit(t)}
                >
                  <Pencil size={16} />
                </button>
              </div>
              <div className="discipline-label">{t.discipline}</div>
              <h2>{t.title}</h2>
              <p>{t.description || "Проверка знаний по дисциплине"}</p>
              <div className="test-specs">
                <span>
                  <LibraryBig size={15} />
                  {t.question_count} вопросов
                </span>
                <span>
                  <Clock3 size={15} />
                  {t.minutes ? `${t.minutes} мин` : "Без таймера"}
                </span>
                <span>
                  <ShieldCheck size={15} />
                  {t.pass_percent} / 100 для зачёта
                </span>
              </div>
              <div className="bank-progress">
                <div>
                  <span>Банк вопросов</span>
                  <strong>{t.bank_count}</strong>
                </div>
                <div className="bank-line">
                  <span
                    style={{
                      width: `${Math.min(100, (t.bank_count / Math.max(t.question_count, 1)) * 100)}%`,
                    }}
                  />
                </div>
                <small>
                  В попытке: {t.question_count} · Попыток: {t.max_attempts}
                </small>
              </div>
              <button
                className="btn primary full-width test-launch"
                disabled={t.bank_count < t.question_count}
                onClick={() => setPreview(t)}
              >
                <Play size={16} /> Пройти тест
              </button>
              <div className="test-card-footer">
                <button
                  className="btn secondary"
                  onClick={() => navigate(`questions?test=${t.id}`)}
                >
                  <LibraryBig size={15} /> Вопросы
                </button>
                <button
                  className="text-button"
                  disabled={!t.published}
                  onClick={() => navigate(`assignments?test=${t.id}`)}
                >
                  Назначить <ArrowUpRight size={16} />
                </button>
              </div>
            </section>
          ))}
        </div>
      ) : (
        <Empty
          title="Тесты не найдены"
          text="Создайте тест и наполните его банк вопросов."
          action={
            <button className="btn primary" onClick={() => setEdit(null)}>
              <Plus size={16} /> Создать тест
            </button>
          }
        />
      )}
      {edit !== undefined && (
        <TestEditor
          test={edit}
          onClose={() => {
            setEdit(undefined);
            history.replaceState(null, "", "#tests");
          }}
          onDone={(id) => {
            setEdit(undefined);
            reload();
            notify("Настройки теста сохранены.");
            if (!edit) navigate(`questions?test=${id}`);
          }}
        />
      )}
    </div>
  );
}
function TestEditor({
  test,
  onClose,
  onDone,
}: {
  test: Test | null;
  onClose: () => void;
  onDone: (id: string) => void;
}) {
  const [form, setForm] = useState({ ...defaultTest, ...test });
  const set = (key: string, value: any) =>
    setForm((s) => ({ ...s, [key]: value }));
  return (
    <Modal
      title={test ? "Настройки теста" : "Новый тест"}
      description="Правила сохраняются в попытке и не меняют уже начатые тестирования."
      onClose={onClose}
      wide
    >
      <AsyncForm
        onCancel={onClose}
        label={test ? "Сохранить настройки" : "Создать и добавить вопросы"}
        onSubmit={async () => {
          const result = await api(
            test ? `/admin/tests/${test.id}` : "/admin/tests",
            form,
            test ? "PUT" : "POST",
          );
          onDone(test?.id || result.id);
        }}
      >
        <div className="form-body">
          <div className="form-grid">
            <Field label="Название теста">
              <input
                required
                minLength={3}
                maxLength={180}
                value={form.title}
                onChange={(e) => set("title", e.target.value)}
                placeholder="Основы финансовой грамотности"
              />
            </Field>
            <Field label="Дисциплина">
              <input
                required
                minLength={2}
                value={form.discipline}
                onChange={(e) => set("discipline", e.target.value)}
                placeholder="Финансы"
              />
            </Field>
          </div>
          <Field label="Описание">
            <textarea
              rows={2}
              value={form.description}
              onChange={(e) => set("description", e.target.value)}
              maxLength={2000}
              placeholder="Что проверяет тест и кому он предназначен"
            />
          </Field>
          <div className="form-section-title">Правила прохождения</div>
          <div className="form-grid three">
            {[
              {
                key: "question_count",
                label: "Вопросов в попытке",
                min: 1,
                max: 200,
              },
              {
                key: "minutes",
                label: "Время, минут (0 = без таймера)",
                min: 0,
                max: 240,
              },
              {
                key: "max_attempts",
                label: "Максимум попыток",
                min: 1,
                max: 20,
              },
              {
                key: "pass_percent",
                label: "Проходной балл (из 100)",
                min: 0,
                max: 100,
              },
            ].map((f) => (
              <Field key={f.key} label={f.label}>
                <input
                  type="number"
                  required
                  min={f.min}
                  max={f.max}
                  value={(form as any)[f.key]}
                  onChange={(e) => set(f.key, Number(e.target.value))}
                />
              </Field>
            ))}
          </div>
          <div className="form-section-title">Контроль и результаты</div>
          <div className="form-grid">
            <Field label="Режим прокторинга">
              <select
                value={form.proctor_mode}
                onChange={(e) => set("proctor_mode", e.target.value)}
              >
                <option value="off">Отключён</option>
                <option value="log">Только журнал событий</option>
                <option value="warn">Журнал и предупреждения</option>
                <option value="block">Блокировка по порогу</option>
              </select>
            </Field>
            <Field label="Порог событий ухода">
              <input
                type="number"
                min={1}
                max={50}
                value={form.proctor_limit}
                onChange={(e) => set("proctor_limit", Number(e.target.value))}
              />
            </Field>
          </div>
          <div className="switch-list">
            {[
              {
                key: "fullscreen",
                label: "Полноэкранный режим",
                hint: "Студент включает его перед началом.",
              },
              {
                key: "show_result",
                label: "Показать итоговый результат",
                hint: "Процент и статус после завершения; правильные ответы не раскрываются.",
              },
              {
                key: "show_history",
                label: "История собственных попыток",
                hint: "Студент может открыть предыдущие результаты.",
              },
              ...(test
                ? [
                    {
                      key: "published",
                      label: "Опубликовать тест",
                      hint: "Для публикации в банке должно быть достаточно вопросов.",
                    },
                  ]
                : []),
            ].map((f) => (
              <label className="switch-row" key={f.key}>
                <span>
                  <strong>{f.label}</strong>
                  <small>{f.hint}</small>
                </span>
                <input
                  type="checkbox"
                  role="switch"
                  checked={Boolean((form as any)[f.key])}
                  onChange={(e) => set(f.key, Number(e.target.checked))}
                />
              </label>
            ))}
          </div>
          {form.proctor_mode === "block" && (
            <div className="notice warning">
              <ShieldCheck size={19} />
              <span>
                При {form.proctor_limit} уходах сервер завершит попытку со
                статусом «Заблокирован». Предупредите студентов об этом правиле.
              </span>
            </div>
          )}
        </div>
      </AsyncForm>
    </Modal>
  );
}
export function QuestionsPage() {
  const { data: tests } = useData<Test[]>("/admin/tests");
  const [test, setTest] = useFilter(
    "questions.test",
    new URLSearchParams(location.hash.split("?")[1]).get("test") || "",
    new URLSearchParams(location.hash.split("?")[1]).has("test"),
  );
  const {
    data: questions,
    loading,
    error,
    reload,
  } = useData<BankQuestion[]>(
    `/admin/questions${test ? `?test_id=${test}` : ""}`,
  );
  const { notify } = useApp();
  const [search, setSearch] = useFilter("questions.search", ""),
    [page, setPage] = useState(1),
    [archived, setArchived] = useState(false),
    [edit, setEdit] = useState<BankQuestion | null | undefined>(undefined),
    [importOpen, setImportOpen] = useState(false);
  useEffect(() => setPage(1), [test, search, archived]);
  const filtered = (questions || []).filter(
    (q) =>
      Boolean(q.archived) === archived &&
      (!search || q.text.toLowerCase().includes(search.toLowerCase())),
  );
  const current = tests?.find((t) => t.id === test);
  return (
    <div className="page">
      <div className="page-heading">
        <div>
          <h1>
            Банк вопросов{" "}
            <span className="heading-count">{filtered.length}</span>
          </h1>
          <p>Содержание тестов под вашим управлением.</p>
        </div>
        <div className="button-group">
          <button
            className="btn secondary"
            disabled={!test}
            onClick={() => setImportOpen(true)}
          >
            <Upload size={16} /> Импорт Excel
          </button>
          <button
            className="btn primary"
            disabled={!test}
            onClick={() => setEdit(null)}
          >
            <Plus size={16} /> Добавить вопрос
          </button>
        </div>
      </div>
      <section className="panel">
        <div className="table-toolbar">
          <SearchInput
            value={search}
            onChange={setSearch}
            placeholder="Поиск по тексту вопроса"
          />
          <div className="filters">
            <select
              aria-label="Тест для банка вопросов"
              value={test}
              onChange={(e) => setTest(e.target.value)}
            >
              <option value="">Все тесты</option>
              {tests?.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.title}
                </option>
              ))}
            </select>
            <select
              aria-label="Состояние вопросов"
              value={String(archived)}
              onChange={(e) => setArchived(e.target.value === "true")}
            >
              <option value="false">Активные вопросы</option>
              <option value="true">Архив</option>
            </select>
          </div>
        </div>
        {!test && (
          <div className="inline-notice">
            <LibraryBig size={17} /> Выберите тест, чтобы добавлять вопросы или
            загружать Excel.
          </div>
        )}
        {current && (
          <div className="bank-summary">
            <span>
              <strong>{current.title}</strong>
            </span>
            <span>В попытке: {current.question_count}</span>
            <span>Проходной балл: {current.pass_percent} из 100</span>
          </div>
        )}
        {loading && !questions ? (
          <Spinner />
        ) : error ? (
          <ErrorState error={error} retry={reload} />
        ) : filtered.length ? (
          <>
            <div className="question-list">
              {filtered.slice((page - 1) * 10, page * 10).map((q, i) => (
                <article className="question-row" key={q.id}>
                  <div className="question-number">
                    {(page - 1) * 10 + i + 1}
                  </div>
                  <div className="question-content">
                    {!test && (
                      <small className="discipline-label">
                        {tests?.find((t) => t.id === q.test_id)?.title}
                      </small>
                    )}
                    <h3>{q.text}</h3>
                    <div className="question-options">
                      {q.options.map((o, n) => (
                        <div
                          key={o.id}
                          className={
                            o.id === q.correct_id ? "correct-option" : ""
                          }
                        >
                          <span>{String.fromCharCode(65 + n)}</span>
                          {o.text}
                          {o.id === q.correct_id && <Check size={14} />}
                        </div>
                      ))}
                    </div>
                  </div>
                  <button
                    className="icon-button"
                    aria-label="Редактировать вопрос"
                    onClick={() => setEdit(q)}
                  >
                    <Pencil size={17} />
                  </button>
                </article>
              ))}
            </div>
            <Pagination
              page={page}
              total={filtered.length}
              onChange={setPage}
            />
          </>
        ) : (
          <Empty
            title="Вопросов пока нет"
            text="Добавьте вопрос вручную или импортируйте банк из Excel."
            action={
              test ? (
                <button className="btn primary" onClick={() => setEdit(null)}>
                  <Plus size={16} /> Добавить вопрос
                </button>
              ) : undefined
            }
          />
        )}
      </section>
      {edit !== undefined && (
        <QuestionEditor
          question={edit}
          testId={edit?.test_id || test}
          onClose={() => setEdit(undefined)}
          onDone={() => {
            setEdit(undefined);
            reload();
            notify(
              "Вопрос сохранён. Активные попытки сохраняют прежнее содержание.",
            );
          }}
        />
      )}
      {importOpen && (
        <ImportModal
          kind="questions"
          testId={test}
          onClose={() => setImportOpen(false)}
          onDone={reload}
        />
      )}
    </div>
  );
}
function QuestionEditor({
  question,
  testId,
  onClose,
  onDone,
}: {
  question: BankQuestion | null;
  testId: string;
  onClose: () => void;
  onDone: () => void;
}) {
  const [text, setText] = useState(question?.text || ""),
    [options, setOptions] = useState<Option[]>(
      question?.options || [
        { id: "1", text: "" },
        { id: "2", text: "" },
        { id: "3", text: "" },
        { id: "4", text: "" },
      ],
    ),
    [correct, setCorrect] = useState(question?.correct_id || "1"),
    [archived, setArchived] = useState(question?.archived || 0);
  return (
    <Modal
      title={question ? "Редактировать вопрос" : "Новый вопрос"}
      description="Закрытый вопрос с одним правильным ответом. Минимум два варианта."
      onClose={onClose}
      wide
    >
      <AsyncForm
        onCancel={onClose}
        onSubmit={async () => {
          await api(
            question ? `/admin/questions/${question.id}` : "/admin/questions",
            { test_id: testId, text, options, correct_id: correct, archived },
            question ? "PUT" : "POST",
          );
          onDone();
        }}
      >
        <div className="form-body">
          <Field label="Текст вопроса">
            <textarea
              required
              minLength={5}
              maxLength={8000}
              rows={4}
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder="Введите вопрос"
            />
          </Field>
          <div className="form-section-title">
            Варианты ответа <small>Отметьте один правильный</small>
          </div>
          <div className="option-editor">
            {options.map((o, i) => (
              <div key={o.id}>
                <input
                  type="radio"
                  name="correct"
                  aria-label={`Вариант ${i + 1} правильный`}
                  checked={correct === o.id}
                  onChange={() => setCorrect(o.id)}
                />
                <span>{String.fromCharCode(65 + i)}</span>
                <input
                  required
                  aria-label={`Текст варианта ${i + 1}`}
                  value={o.text}
                  onChange={(e) =>
                    setOptions(
                      options.map((x) =>
                        x.id === o.id ? { ...x, text: e.target.value } : x,
                      ),
                    )
                  }
                  placeholder={`Вариант ${i + 1}`}
                  maxLength={2000}
                />
                <button
                  type="button"
                  className="icon-button"
                  aria-label={`Удалить вариант ${i + 1}`}
                  disabled={options.length <= 2}
                  onClick={() => {
                    setOptions(options.filter((x) => x.id !== o.id));
                    if (correct === o.id)
                      setCorrect(options.find((x) => x.id !== o.id)!.id);
                  }}
                >
                  <Trash2 size={15} />
                </button>
              </div>
            ))}
          </div>
          <button
            type="button"
            className="text-button"
            disabled={options.length >= 10}
            onClick={() =>
              setOptions([...options, { id: crypto.randomUUID(), text: "" }])
            }
          >
            <Plus size={16} /> Добавить вариант
          </button>
          {question && (
            <label className="switch-row">
              <span>
                <strong>Архивировать вопрос</strong>
                <small>Он не попадёт в новые попытки; старые сохранятся.</small>
              </span>
              <input
                type="checkbox"
                role="switch"
                checked={Boolean(archived)}
                onChange={(e) => setArchived(Number(e.target.checked))}
              />
            </label>
          )}
        </div>
      </AsyncForm>
    </Modal>
  );
}
export function AssignmentsPage() {
  const {
    data: assignments,
    loading,
    error,
    reload,
  } = useData<Assignment[]>("/admin/assignments");
  const { data: tests } = useData<Test[]>("/admin/tests");
  const { data: groups } = useData<Group[]>("/admin/groups");
  const { data: students } = useData<User[]>("/admin/students");
  const { notify } = useApp();
  const [search, setSearch] = useState(""),
    [modal, setModal] = useState(location.hash.includes("?")),
    [closing, setClosing] = useState<Assignment | null>(null);
  const filtered = (assignments || []).filter((a) =>
    `${a.title} ${a.target_name}`.toLowerCase().includes(search.toLowerCase()),
  );
  return (
    <div className="page">
      <div className="page-heading">
        <div>
          <h1>
            Назначения{" "}
            <span className="heading-count">
              {assignments?.filter((a) => !a.closed).length || 0}
            </span>
          </h1>
          <p>Нужный тест для нужных людей. В несколько действий.</p>
        </div>
        <button className="btn primary" onClick={() => setModal(true)}>
          <Plus size={17} /> Выдать доступ
        </button>
      </div>
      <div className="assignment-intro">
        <span className="stat-icon green">
          <KeyRound size={22} />
        </span>
        <div>
          <strong>Один тест. Весь поток.</strong>
          <p>
            Назначьте тест потоку, и все его студенты сразу увидят его в своём
            кабинете. Индивидуальное назначение имеет приоритет.
          </p>
        </div>
      </div>
      <section className="panel">
        <div className="table-toolbar">
          <SearchInput
            value={search}
            onChange={setSearch}
            placeholder="Тест, поток или студент"
          />
          <span className="muted">{filtered.length} назначений</span>
        </div>
        {loading && !assignments ? (
          <Spinner />
        ) : error ? (
          <ErrorState error={error} retry={reload} />
        ) : filtered.length ? (
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>Тест</th>
                  <th>Кому назначен</th>
                  <th>Период доступа</th>
                  <th>Время на тест</th>
                  <th>Попыток</th>
                  <th>Статус</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {filtered.map((a) => (
                  <tr key={a.id}>
                    <td>
                      <strong className="table-title">{a.title}</strong>
                    </td>
                    <td>
                      <div className="assignment-target">
                        {a.group_id ? (
                          <Layers size={17} />
                        ) : (
                          <Users size={17} />
                        )}
                        <div>
                          <strong>{a.target_name}</strong>
                          <small>
                            {a.group_id
                              ? `${a.student_count} студентов`
                              : "Индивидуальный доступ"}
                          </small>
                        </div>
                      </div>
                    </td>
                    <td>
                      <div className="date-range">
                        <span>
                          {a.starts_at
                            ? date(a.starts_at, true)
                            : "Сразу после назначения"}
                        </span>
                        <small>
                          {a.ends_at
                            ? `До ${date(a.ends_at, true)}`
                            : "Без даты окончания"}
                        </small>
                      </div>
                    </td>
                    <td>{a.minutes ?? a.test_minutes ?? 60} мин</td>
                    <td>{a.max_attempts}</td>
                    <td>
                      <Badge
                        tone={
                          a.closed
                            ? "neutral"
                            : a.ends_at && Date.parse(a.ends_at) <= Date.now()
                              ? "orange"
                              : "green"
                        }
                      >
                        {a.closed
                          ? "Закрыт"
                          : a.ends_at && Date.parse(a.ends_at) <= Date.now()
                            ? "Завершён"
                            : "Доступ открыт"}
                      </Badge>
                    </td>
                    <td>
                      <button
                        className="icon-button"
                        disabled={Boolean(a.closed)}
                        aria-label={`Закрыть доступ ${a.target_name}`}
                        onClick={() => setClosing(a)}
                      >
                        <LockKeyhole size={17} />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <Empty
            title="Доступы ещё не назначены"
            text="Выберите опубликованный тест и поток или отдельных студентов."
            action={
              <button className="btn primary" onClick={() => setModal(true)}>
                <KeyRound size={16} /> Выдать доступ
              </button>
            }
          />
        )}
      </section>
      {modal && (
        <AssignmentEditor
          tests={tests || []}
          groups={groups || []}
          students={students || []}
          onClose={() => {
            setModal(false);
            history.replaceState(null, "", "#assignments");
          }}
          onDone={(count) => {
            setModal(false);
            history.replaceState(null, "", "#assignments");
            reload();
            notify(`Доступ выдан. Назначений: ${count}.`);
          }}
        />
      )}
      {closing && (
        <Modal
          title="Закрыть доступ к тесту?"
          description={`${closing.title} · ${closing.target_name}`}
          onClose={() => setClosing(null)}
        >
          <AsyncForm
            label="Закрыть доступ"
            onCancel={() => setClosing(null)}
            onSubmit={async () => {
              await api(`/admin/assignments/${closing.id}/close`, {});
              setClosing(null);
              reload();
              notify("Доступ закрыт для новых попыток.");
            }}
          >
            <div className="form-body">
              <p>
                Студенты не смогут начать новые попытки по этому назначению.
                Начатые попытки и сохранённые результаты останутся доступны.
              </p>
            </div>
          </AsyncForm>
        </Modal>
      )}
    </div>
  );
}
function AssignmentEditor({
  tests,
  groups,
  students,
  onClose,
  onDone,
}: {
  tests: Test[];
  groups: Group[];
  students: User[];
  onClose: () => void;
  onDone: (count: number) => void;
}) {
  const { settings } = useApp();
  const timeZone = settings.timezone || "Asia/Almaty";
  const query = new URLSearchParams(location.hash.split("?")[1]);
  const [test, setTest] = useState(query.get("test") || ""),
    [kind, setKind] = useState(query.has("students") ? "student" : "group"),
    [selectedGroups, setSelectedGroups] = useState<string[]>(
      query.get("group") ? [query.get("group")!] : [],
    ),
    [selectedStudents, setSelectedStudents] = useState<string[]>(
      query.get("students")?.split(",") || [],
    ),
    [attempts, setAttempts] = useState(tests.find(t=>t.id===query.get("test"))?.max_attempts || 2),
    [minutes,setMinutes] = useState(tests.find(t=>t.id===query.get("test"))?.minutes || 60),
    [start, setStart] = useState(""),
    [end, setEnd] = useState(""),
    [search, setSearch] = useState(""),
    [importInfo, setImportInfo] = useState(""),
    [importError, setImportError] = useState("");
  const selectedTest = tests.find((t) => t.id === test);
  const targets = kind === "group" ? groups : students;
  const count =
    kind === "group"
      ? groups
          .filter((g) => selectedGroups.includes(g.id))
          .reduce((s, g) => s + g.student_count, 0)
      : selectedStudents.length;
  function toggle(id: string) {
    if (kind === "group")
      setSelectedGroups((s) =>
        s.includes(id) ? s.filter((x) => x !== id) : [...s, id],
      );
    else
      setSelectedStudents((s) =>
        s.includes(id) ? s.filter((x) => x !== id) : [...s, id],
      );
  }
  async function importLogins(file: File) {
    try {
      setImportError("");
      const matrix = await readExcel(file);
      if (matrix[0][0] !== "Логин")
        throw new Error("Первый столбец должен называться «Логин».");
      const result = await api<{ login: string; user: User | null }[]>(
        "/admin/import/assignments/preview",
        {
          logins: matrix
            .slice(1)
            .map((r) => r[0])
            .filter(Boolean),
        },
      );
      const missing = result.filter((r) => !r.user);
      setImportInfo(
        `Найдено: ${result.length - missing.length}. Не найдено: ${missing.map((r) => r.login).join(", ") || "нет"}. Повторные назначения обновят доступ.`,
      );
      setSelectedStudents([
        ...new Set([
          ...selectedStudents,
          ...result.filter((r) => r.user).map((r) => r.user!.id),
        ]),
      ]);
    } catch (e) {
      setImportError((e as Error).message);
    }
  }
  return (
    <Modal
      title="Выдать доступ к тесту"
      description="Групповое назначение автоматически доступно всем участникам потока."
      onClose={onClose}
      wide
    >
      <AsyncForm
        onCancel={onClose}
        label={`Выдать доступ · ${count} студентов`}
        onSubmit={async () => {
          const result = await api("/admin/assignments", {
            test_id: test,
            group_ids: kind === "group" ? selectedGroups : [],
            user_ids: kind === "student" ? selectedStudents : [],
            starts_at: start ? organizationInstant(start,timeZone) : null,
            ends_at: end ? organizationInstant(end,timeZone) : null,
            max_attempts: attempts,
            minutes,
          });
          onDone(result.count);
        }}
      >
        <div className="form-body">
          <Field label="Опубликованный тест">
            <select
              required
              value={test}
              onChange={(e) => {
                setTest(e.target.value);
                setAttempts(
                  tests.find((t) => t.id === e.target.value)?.max_attempts || 2,
                );
                setMinutes(tests.find(t=>t.id===e.target.value)?.minutes||60);
              }}
            >
              <option value="">Выберите тест</option>
              {tests
                .filter((t) => t.published)
                .map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.title}
                  </option>
                ))}
            </select>
          </Field>
          {!tests.some((t) => t.published) && (
            <div className="notice">
              Сначала создайте и опубликуйте тест с вопросами.
            </div>
          )}
          <div className="form-section-title">Кому выдать доступ</div>
          <div className="tabs">
            <button
              type="button"
              className={kind === "group" ? "active" : ""}
              onClick={() => setKind("group")}
            >
              <Layers size={16} /> Потокам
            </button>
            <button
              type="button"
              className={kind === "student" ? "active" : ""}
              onClick={() => setKind("student")}
            >
              <Users size={16} /> Студентам
            </button>
          </div>
          <SearchInput
            value={search}
            onChange={setSearch}
            placeholder={kind === "group" ? "Найти поток" : "Найти студента"}
          />
          <div className="target-list">
            {targets
              .filter((t) =>
                `${t.name} ${(t as User).login || ""}`
                  .toLowerCase()
                  .includes(search.toLowerCase()),
              )
              .map((target) => (
                <label key={target.id}>
                  <input
                    type="checkbox"
                    checked={(kind === "group"
                      ? selectedGroups
                      : selectedStudents
                    ).includes(target.id)}
                    onChange={() => toggle(target.id)}
                  />
                  <strong>{target.name}</strong>
                  <small>
                    {kind === "group"
                      ? `${(target as Group).student_count} студентов`
                      : (target as User).login}
                  </small>
                </label>
              ))}
          </div>
          {kind === "student" && (
            <div className="assignment-import">
              <label className="btn secondary">
                <Upload size={15} /> Загрузить логины Excel
                <input
                  type="file"
                  accept=".xlsx"
                  className="visually-hidden"
                  onChange={(e) => {
                    if (e.target.files?.[0])
                      void importLogins(e.target.files[0]);
                  }}
                />
              </label>
              <button
                type="button"
                className="text-button"
                onClick={() =>
                  void writeExcel(
                    ["Логин"],
                    [["student001"]],
                    "Шаблон-назначений.xlsx",
                  ).catch((e) => setImportError(e.message))
                }
              >
                <Download size={15} /> Шаблон
              </button>
              {importInfo && <p>{importInfo}</p>}
              {importError && <p className="form-error">{importError}</p>}
            </div>
          )}
          <Field label="Время прохождения этого теста, минут" hint="Таймер начнётся при старте попытки. По истечении времени продолжить тест нельзя; дата окончания доступа может завершить его раньше."><input type="number" required min={1} max={240} value={minutes} onChange={e=>setMinutes(Number(e.target.value))}/></Field>
          <p className="muted">Период доступа — по времени {timeZone}. Часовой пояс компьютера не влияет.</p>
          <div className="form-grid three">
            <Field label="Доступ с">
              <input
                type="datetime-local"
                value={start}
                onChange={(e) => setStart(e.target.value)}
              />
            </Field>
            <Field label="Доступ до">
              <input
                type="datetime-local"
                value={end}
                onChange={(e) => setEnd(e.target.value)}
              />
            </Field>
            <Field label="Всего попыток">
              <input
                type="number"
                required
                min={1}
                max={20}
                value={attempts}
                onChange={(e) => setAttempts(Number(e.target.value))}
              />
            </Field>
          </div>
          <div className="notice">
            <ShieldCheck size={17} />
            <span>
              Лимит включает уже использованные попытки по этому тесту. Чтобы
              дать дополнительную, увеличьте общее количество.{" "}
              {selectedTest &&
                `Проходной балл: ${selectedTest.pass_percent} из 100.`}
            </span>
          </div>
        </div>
      </AsyncForm>
    </Modal>
  );
}
