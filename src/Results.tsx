import { useFilter } from "./useFilter";
import { useState, useEffect, useRef } from "react";
import {
  Download,
  ArrowUpRight,
  ShieldCheck,
  CheckCircle2,
  Clock3,
  Target,
  FileText,
  RefreshCw,
  Users,
  Plus,
  Settings as SettingsIcon,
  KeyRound,
  Save,
} from "lucide-react";
import { useData } from "./useData";
import { useApp } from "./app-context";
import { api, downloadFile } from "./api";
import { exportResults } from "./excel";
import { CredentialsModal } from "./Imports";
import {
  Spinner,
  ErrorState,
  Empty,
  SearchInput,
  Badge,
  StatusBadge,
  Pagination,
  Modal,
  AsyncForm,
  Field,
  initials,
  date,
  number,
} from "./ui";
import { PROCTOR_LABELS } from "../shared/proctor";
import type {
  ResultRow,
  Group,
  Test,
  Attempt,
  JournalRow,
  User,
  ResultsPageData,
  ResultsExportChunk,
} from "../shared/types";
export function ResultsPage() {
  const [test, setTest] = useFilter("results.test", ""),
    [group, setGroup] = useFilter("results.group", "");
  const { data: tests } = useData<Test[]>("/admin/tests");
  const { data: groups } = useData<Group[]>("/admin/groups");
  const { notify } = useApp();
  const [search, setSearch] = useFilter("results.search", ""),
    [status, setStatus] = useFilter("results.status", ""),
    [page, setPage] = useState(1),
    [detail, setDetail] = useState<string | null>(
      new URLSearchParams(location.hash.split("?")[1]).get("attempt"),
    );
  const [debouncedSearch,setDebouncedSearch]=useState(search),[exporting,setExporting]=useState(false),[exportCount,setExportCount]=useState(0);
  const exportingNow=useRef(false);
  useEffect(()=>{const timer=setTimeout(()=>setDebouncedSearch(search),350);return()=>clearTimeout(timer);},[search]);
  useEffect(() => setPage(1), [debouncedSearch, status, test, group]);
  const query=new URLSearchParams({test_id:test,group_id:group,search:debouncedSearch,status});
  const {data:results,loading,error,reload}=useData<ResultsPageData>(`/admin/results?${query}&page=${page}&page_size=25`);
  const filtered=results?.items||[], stats=results?.stats;
  async function downloadResults(){
    if(exportingNow.current)return;
    exportingNow.current=true;setExporting(true);setExportCount(0);
    const rows:ResultRow[]=[],seen=new Set<string>();let cursor:string|null=null;
    try {
      do {
        const chunk:ResultsExportChunk=await api<ResultsExportChunk>(`/admin/results/export?${query}${cursor?'&cursor='+encodeURIComponent(cursor):''}`);
        for(const row of chunk.items)if(!seen.has(row.id)){seen.add(row.id);rows.push(row);}
        setExportCount(rows.length);cursor=chunk.next_cursor;
      }while(cursor);
      await exportResults(rows);notify(`Выгружено результатов: ${rows.length}.`);
    }catch(e){notify((e as Error).message);}finally{exportingNow.current=false;setExporting(false);}
  }
  return (
    <div className="page">
      <div className="page-heading">
        <div>
          <h1>Результаты</h1>
          <p>За каждым результатом стоит история обучения.</p>
        </div>
        <div className="button-group">
          <button className="btn secondary" onClick={reload}>
            <RefreshCw size={16} /> Обновить
          </button>
          <button
            className="btn primary"
            disabled={exporting||loading||search!==debouncedSearch}
            onClick={()=>void downloadResults()}
          >
            <Download size={17} /> {exporting?`Выгружаем: ${exportCount}`:'Скачать все в Excel'}
          </button>
        </div>
      </div>
      <div className="results-stats">
        <div className="panel">
          <span className="stat-icon green">
            <CheckCircle2 size={20} />
          </span>
          <div>
            <strong>{stats?.completed??0}</strong>
            <small>Завершено попыток</small>
          </div>
        </div>
        <div className="panel">
          <span className="stat-icon blue">
            <Target size={20} />
          </span>
          <div>
            <strong>{stats?.average??0}%</strong>
            <small>Средний результат</small>
          </div>
        </div>
        <div className="panel">
          <span className="stat-icon purple">
            <Clock3 size={20} />
          </span>
          <div>
            <strong>
              {stats?.active??0}
            </strong>
            <small>Проходят сейчас</small>
          </div>
        </div>
        <div className="panel">
          <span className="stat-icon orange">
            <ShieldCheck size={20} />
          </span>
          <div>
            <strong>
              {stats?.violations??0}
            </strong>
            <small>Событий ухода</small>
          </div>
        </div>
      </div>
      <section className="panel">
        <div className="table-toolbar wrap">
          <SearchInput
            value={search}
            onChange={setSearch}
            placeholder="Имя студента, логин или тест"
          />
          <div className="filters">
            <select
              aria-label="Фильтр по тесту"
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
              aria-label="Фильтр по потоку"
              value={group}
              onChange={(e) => setGroup(e.target.value)}
            >
              <option value="">Все потоки</option>
              {groups?.map((g) => (
                <option key={g.id} value={g.id}>
                  {g.name}
                </option>
              ))}
            </select>
            <select
              aria-label="Фильтр по результату"
              value={status}
              onChange={(e) => setStatus(e.target.value)}
            >
              <option value="">Все статусы</option>
              <option value="passed">Сдал</option>
              <option value="failed">Не сдал</option>
              <option value="active">В процессе</option>
              <option value="blocked">Заблокирован</option>
            </select>
          </div>
        </div>
        {loading ? (
          <Spinner />
        ) : error ? (
          <ErrorState error={error} retry={reload} />
        ) : filtered.length ? (
          <>
            <div className="table-scroll">
              <table>
                <thead>
                  <tr>
                    <th>Студент</th>
                    <th>Тест</th>
                    <th>Результат</th>
                    <th>Статус</th>
                    <th>Контроль</th>
                    <th>Дата</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((r, i) => (
                    <tr key={r.id}>
                      <td>
                        <div className="person-cell">
                          <span className={`avatar tone-${i % 4}`}>
                            {initials(r.student_name)}
                          </span>
                          <span>
                            <strong>{r.student_name}</strong>
                            <small>
                              {r.group_name || "Без потока"} · {r.login}
                            </small>
                          </span>
                        </div>
                      </td>
                      <td>
                        <strong className="table-title">{r.test_title}</strong>
                        <small className="cell-sub">
                          {r.total_questions} вопросов · порог {r.pass_percent}%
                        </small>
                      </td>
                      <td>
                        {r.percent !== null ? (
                          <div className="score-cell">
                            <strong>{r.percent}%</strong>
                            <small>
                              {r.score} из {r.total_questions}
                            </small>
                          </div>
                        ) : (
                          <span className="muted">В процессе</span>
                        )}
                      </td>
                      <td>
                        <StatusBadge status={r.status} passed={r.passed} />
                      </td>
                      <td>
                        <Badge tone={r.violation_count ? "orange" : "neutral"}>
                          <ShieldCheck size={12} />
                          {r.violation_count} событий
                        </Badge>
                      </td>
                      <td className="muted">
                        {date(r.finished_at || r.started_at, true)}
                      </td>
                      <td>
                        <button
                          className="icon-button"
                          aria-label={`Подробнее о попытке ${r.student_name}`}
                          onClick={() => setDetail(r.id)}
                        >
                          <ArrowUpRight size={17} />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <Pagination
              page={page}
              total={results?.total||0}
              pageSize={25}
              onChange={setPage}
            />
          </>
        ) : (
          <Empty
            title="Результаты пока не найдены"
            text="После начала тестирования здесь появятся попытки студентов."
          />
        )}
      </section>
      {detail && (
        <AttemptDetail
          id={detail}
          onClose={() => {
            setDetail(null);
            history.replaceState(null, "", "#results");
          }}
        />
      )}
    </div>
  );
}
export function AttemptDetail({
  id,
  onClose,
}: {
  id: string;
  onClose: () => void;
}) {
  const { data, loading, error, reload } = useData<{
    attempt: Attempt;
    events: JournalRow[];
    correct_answers: Record<string, string>;
    event_count: number;
    events_has_more: boolean;
    log_truncated: boolean;
  }>(`/admin/attempts/${id}`);
  const [tab, setTab] = useState("summary");
  const { notify } = useApp();
  const a = data?.attempt;
  return (
    <Modal
      title="Карточка попытки"
      description={
        a
          ? `${a.student_name} · ${a.group_name}`
          : "Результат и журнал контроля"
      }
      onClose={onClose}
      wide
    >
      {loading && !data ? (
        <Spinner />
      ) : error || !a ? (
        <ErrorState error={error} retry={reload} />
      ) : (
        <div className="attempt-detail">
          <div className="attempt-detail-title">
            <div>
              <h3>{a.test_title}</h3>
              <span>{date(a.started_at, true)}</span>
            </div>
            <StatusBadge status={a.status} passed={a.passed} />
          </div>
          <div className="tabs">
            <button
              className={tab === "summary" ? "active" : ""}
              onClick={() => setTab("summary")}
            >
              Результат
            </button>
            <button
              className={tab === "answers" ? "active" : ""}
              onClick={() => setTab("answers")}
            >
              Ответы ({Object.keys(a.answers).length})
            </button>
            <button
              className={tab === "proctor" ? "active" : ""}
              onClick={() => setTab("proctor")}
            >
              <ShieldCheck size={15} /> Контроль ({a.violation_count})
            </button>
          </div>
          {tab === "summary" ? (
            <>
              <div className="attempt-score">
                <div
                  className="score-ring"
                  style={
                    { "--score": `${a.percent || 0}%` } as React.CSSProperties
                  }
                >
                  <div>
                    <strong>
                      {a.percent ?? "…"}
                      <small>%</small>
                    </strong>
                    <span>результат</span>
                  </div>
                </div>
                <div className="attempt-score-details">
                  <p>
                    <span>Правильных ответов</span>
                    <strong>
                      {a.score ?? "…"} из {a.questions.length}
                    </strong>
                  </p>
                  <p>
                    <span>Проходной порог</span>
                    <strong>{a.pass_percent}%</strong>
                  </p>
                  <p>
                    <span>Завершено</span>
                    <strong>
                      {a.finished_at
                        ? date(a.finished_at, true)
                        : "Ещё проходит"}
                    </strong>
                  </p>
                  <p>
                    <span>Состояние</span>
                    <strong>
                      {
                        {
                          active: "В процессе",
                          completed: "Завершён",
                          expired: "Время истекло",
                          blocked: "Блокировка по правилу",
                        }[a.status]
                      }
                    </strong>
                  </p>
                </div>
              </div>
              <div className="modal-footer">
                <button className="btn secondary" onClick={onClose}>
                  Закрыть
                </button>
                <button
                  className="btn primary"
                  disabled={a.status === "active"}
                  onClick={() =>
                    void downloadFile(
                      `/admin/attempts/${a.id}/certificate`,
                      `${a.student_name}-результат.pdf`,
                    ).catch((e) => notify(e.message))
                  }
                >
                  <Download size={16} /> Документ PDF
                </button>
              </div>
            </>
          ) : tab === "answers" ? (
            <div className="answer-review">
              {a.questions.map((q, i) => (
                <div key={q.id}>
                  <h4>
                    <span>{i + 1}.</span> {q.text}
                  </h4>
                  {q.options.map((o) => (
                    <p
                      key={o.id}
                      className={`${a.answers[q.id] === o.id ? "selected-answer" : ""} ${data.correct_answers?.[q.id] === o.id ? "correct-answer" : ""}`}
                    >
                      <span>{a.answers[q.id] === o.id ? "●" : "○"}</span>
                      {o.text}
                      {data.correct_answers?.[q.id] === o.id && (
                        <CheckCircle2 size={14} />
                      )}
                    </p>
                  ))}
                </div>
              ))}
            </div>
          ) : (
            <div className="journal">
              {data.events_has_more&&<p className="notice">Показаны последние {data.events.length} из {data.event_count} событий.</p>}
              {data.log_truncated&&<p className="notice warning" role="alert">Достигнут предел журнала — 1000 событий. Дополнительные события могут находиться в локальной копии студента.</p>}
              <div className="notice">
                <ShieldCheck size={18} />
                <span>
                  Один уход учитывается один раз. Обновления и потеря соединения
                  отмечаются как технические события.
                </span>
              </div>
              {data.events.length ? (
                data.events.map((e) => (
                  <article key={`${e.epoch}:${e.event_id}`}>
                    <span
                      className={`journal-icon ${e.counted ? "orange" : "green"}`}
                    >
                      <ShieldCheck size={17} />
                    </span>
                    <div>
                      <strong>{PROCTOR_LABELS[e.kind]}</strong>
                      <p>
                        {e.returned_at
                          ? `Возврат через ${(e.duration_ms / 1000).toFixed(1)} с`
                          : "Возврат не зафиксирован"}
                        {e.question_code &&
                          ` · Вопрос ${a.questions.findIndex((q) => q.id === e.question_code) + 1}`}
                      </p>
                    </div>
                    <div>
                      <time>{date(e.occurred_at, true)}</time>
                      <small>
                        {e.counted ? "Событие ухода" : "Техническое событие"}
                      </small>
                    </div>
                  </article>
                ))
              ) : (
                <Empty
                  title="Событий пока нет"
                  text="Сигналы браузера появятся здесь при прохождении теста."
                />
              )}
              <p className="muted">
                События браузера сами по себе не доказывают списывание.
              </p>
            </div>
          )}
        </div>
      )}
    </Modal>
  );
}
export function SettingsPage() {
  const { user, settings, notify, updateSettings } = useApp();
  const [form, setForm] = useState({
      academy_name: settings.academy_name || "Академия финансов",
      support_email: settings.support_email || "",
      timezone: settings.timezone || "Asia/Almaty",
    }),
    [current, setCurrent] = useState(""),
    [password, setPassword] = useState(""),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [adminOpen, setAdminOpen] = useState(false),
    [credentials, setCredentials] = useState<any[] | null>(null);
  const { data: audit, reload: reloadAudit } = useData<any[]>("/admin/audit");
  const { data: admins, reload: reloadAdmins } = useData<User[]>(
    "/admin/administrators",
  );
  async function save() {
    setBusy(true);
    setError("");
    try {
      await api("/admin/settings", form, "PUT");
      updateSettings(form);
      notify("Настройки сохранены.");
      reloadAudit();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="page">
      <div className="page-heading">
        <div>
          <h1>Настройки</h1>
          <p>Организация, безопасность и история изменений.</p>
        </div>
      </div>
      <div className="settings-layout">
        <section className="panel settings-panel">
          <div className="panel-heading">
            <div>
              <h2>
                <SettingsIcon size={19} /> Организация
              </h2>
              <p>Общие параметры платформы</p>
            </div>
          </div>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void save();
            }}
          >
            <div className="form-body">
              <Field label="Название организации">
                <input
                  required
                  minLength={2}
                  maxLength={120}
                  value={form.academy_name}
                  onChange={(e) =>
                    setForm({ ...form, academy_name: e.target.value })
                  }
                />
              </Field>
              <Field label="Email поддержки">
                <input
                  type="email"
                  value={form.support_email}
                  onChange={(e) =>
                    setForm({ ...form, support_email: e.target.value })
                  }
                  placeholder="Не указан"
                />
              </Field>
              <Field label="Часовой пояс организации">
                <select
                  value={form.timezone}
                  onChange={(e) =>
                    setForm({ ...form, timezone: e.target.value })
                  }
                >
                  <option value="Asia/Almaty">Казахстан · Алматы</option>
                  <option value="Asia/Aqtobe">Казахстан · Актобе</option>
                  <option value="Europe/Moscow">Москва</option>
                </select>
              </Field>
              <p className="muted">
                Даты отображаются в часовом поясе организации.
              </p>
              {error && (
                <p className="form-error" role="alert">
                  {error}
                </p>
              )}
            </div>
            <div className="modal-footer">
              <button className="btn primary" disabled={busy}>
                <Save size={16} /> {busy ? "Сохраняем…" : "Сохранить настройки"}
              </button>
            </div>
          </form>
        </section>
        <section className="panel settings-panel">
          <div className="panel-heading">
            <div>
              <h2>
                <KeyRound size={19} /> Безопасность аккаунта
              </h2>
              <p>
                {user.login} ·{" "}
                Администратор
              </p>
            </div>
          </div>
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              try {
                await api("/auth/password", { current, password });
                setCurrent("");
                setPassword("");
                notify("Пароль изменён. Другие сессии завершены.");
              } catch (e) {
                notify((e as Error).message);
              }
            }}
          >
            <div className="form-body">
              <Field label="Текущий пароль">
                <input
                  type="password"
                  autoComplete="current-password"
                  required
                  value={current}
                  onChange={(e) => setCurrent(e.target.value)}
                />
              </Field>
              <Field label="Новый пароль" hint="Не менее 10 символов.">
                <input
                  type="password"
                  autoComplete="new-password"
                  minLength={10}
                  maxLength={128}
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                />
              </Field>
              <div className="notice">
                <ShieldCheck size={20} />
                <span>
                  Пароли хранятся в виде хешей. Сессии защищены HttpOnly cookie
                  и ограничены по времени.
                </span>
              </div>
            </div>
            <div className="modal-footer">
              <button className="btn secondary">
                <KeyRound size={16} /> Изменить пароль
              </button>
            </div>
          </form>
        </section>
      </div>
      {user.role !== "student" && (
        <section className="panel admin-panel">
          <div className="panel-heading">
            <div>
              <h2>Администраторы</h2>
              <p>Доступ сотрудников к управлению платформой</p>
            </div>
            <button
              className="btn secondary"
              onClick={() => setAdminOpen(true)}
            >
              <Plus size={16} /> Добавить
            </button>
          </div>
          <div className="admin-list">
            {Array.isArray(admins) &&
              admins.map((a) => (
                <div className="person-cell" key={a.id}>
                  <span className="avatar">{initials(a.name)}</span>
                  <span>
                    <strong>{a.name}</strong>
                    <small>{a.login}</small>
                  </span>
                  <Badge>
                    Администратор
                  </Badge>
                </div>
              ))}
          </div>
        </section>
      )}
      <section className="panel audit-panel">
        <div className="panel-heading">
          <div>
            <h2>Журнал действий</h2>
            <p>Последние изменения в административной панели</p>
          </div>
          <button
            className="icon-button"
            aria-label="Обновить журнал"
            onClick={reloadAudit}
          >
            <RefreshCw size={17} />
          </button>
        </div>
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>Сотрудник</th>
                <th>Действие</th>
                <th>Подробности</th>
                <th>Время</th>
              </tr>
            </thead>
            <tbody>
              {audit?.slice(0, 15).map((a) => (
                <tr key={a.id}>
                  <td>{a.name || "Система"}</td>
                  <td>
                    <code>{a.action}</code>
                  </td>
                  <td>{a.details}</td>
                  <td className="muted">{date(a.created_at, true)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {!audit?.length && (
          <Empty
            title="Изменений пока нет"
            text="Здесь будет история действий администраторов."
          />
        )}
      </section>
      {adminOpen && (
        <AdminEditor
          onClose={() => setAdminOpen(false)}
          onDone={(value) => {
            setAdminOpen(false);
            setCredentials([value]);
            reloadAdmins();
            reloadAudit();
          }}
        />
      )}
      {credentials && (
        <CredentialsModal
          credentials={credentials}
          onClose={() => setCredentials(null)}
        />
      )}
    </div>
  );
}
function AdminEditor({
  onClose,
  onDone,
}: {
  onClose: () => void;
  onDone: (v: any) => void;
}) {
  const [name, setName] = useState(""),
    [login, setLogin] = useState("");
  return (
    <Modal title="Новый администратор" onClose={onClose}>
      <AsyncForm
        onCancel={onClose}
        label="Создать администратора"
        onSubmit={async () => {
          onDone({
            ...(await api("/admin/administrators", { name, login })),
            name,
          });
        }}
      >
        <div className="form-body">
          <Field label="Имя сотрудника">
            <input
              required
              minLength={2}
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </Field>
          <Field label="Логин">
            <input
              required
              minLength={3}
              value={login}
              onChange={(e) => setLogin(e.target.value)}
            />
          </Field>
          <p className="muted">
            Временный пароль будет сгенерирован и показан один раз.
          </p>
        </div>
      </AsyncForm>
    </Modal>
  );
}
