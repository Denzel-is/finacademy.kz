import { useFilter } from "./useFilter";
import { useState, useEffect } from "react";
import {
  Plus,
  Upload,
  Users,
  Layers,
  ArrowUpRight,
  KeyRound,
  LockKeyhole,
  UnlockKeyhole,
  Pencil,
  Download,
  UserPlus,
  Search,
  Check,
} from "lucide-react";
import { useData } from "./useData";
import { useApp } from "./app-context";
import { api } from "./api";
import {
  Spinner,
  ErrorState,
  Empty,
  Field,
  Modal,
  AsyncForm,
  SearchInput,
  Badge,
  Pagination,
  initials,
} from "./ui";
import { ImportModal, CredentialsModal } from "./Imports";
import { writeExcel } from "./excel";
import type { User, Group } from "../shared/types";
import { FlowCreator } from './Flows';
import { FlowAssignmentPanel } from './FlowAssignments';
type Student = User & { test_count: number };
export function StudentsPage() {
  const {
    data: students,
    loading,
    error,
    reload,
  } = useData<Student[]>("/admin/students");
  const { data: groups, reload: reloadGroups } =
    useData<Group[]>("/admin/groups");
  const { navigate, notify } = useApp();
  const [search, setSearch] = useFilter("students.search", ""),
    [group, setGroup] = useFilter(
      "students.group",
      new URLSearchParams(location.hash.split("?")[1]).get("group") || "",
      new URLSearchParams(location.hash.split("?")[1]).has("group"),
    ),
    [status, setStatus] = useFilter("students.status", ""),
    [page, setPage] = useState(1),
    [selected, setSelected] = useState<string[]>([]),
    [edit, setEdit] = useState<Student | null | undefined>(undefined),
    [importOpen, setImportOpen] = useState(location.hash.includes("import=1")),
    [credentials, setCredentials] = useState<any[] | null>(null),
    [bulk, setBulk] = useState(false),
    [resetting,setResetting] = useState<Student[]|null>(null),
    [bulkGroup, setBulkGroup] = useState("");
  useEffect(() => {
    setPage(1);
    setSelected([]);
  }, [search, group, status]);
  useEffect(() => {
    const listener = () => {
      if (location.hash.includes("import=1")) setImportOpen(true);
    };
    window.addEventListener("hashchange", listener);
    return () => window.removeEventListener("hashchange", listener);
  }, []);
  const filtered = (students || []).filter(
    (s) =>
      (!search ||
        `${s.name} ${s.login}`.toLowerCase().includes(search.toLowerCase())) &&
      (!group || s.group_id === group) &&
      (!status || String(s.blocked) === status),
  );
  const visible = filtered.slice((page - 1) * 10, page * 10);
  function toggle(id: string) {
    setSelected((current) =>
      current.includes(id) ? current.filter((s) => s !== id) : [...current, id],
    );
  }
  async function reset(s: Student) {
    try {
      const result = await api(`/admin/students/${s.id}/reset-password`, {});
      setCredentials([{ ...result, name: s.name, group: s.group_name }]);
      reload();notify("Выдан новый уникальный временный пароль. При входе потребуется смена.");
    } catch (e) {
      notify((e as Error).message);
      throw e;
    }
  }
  async function block(s: Student) {
    try {
      await api(
        `/admin/students/${s.id}`,
        { blocked: Number(!s.blocked) },
        "PUT",
      );
      reload();
      notify(s.blocked ? "Доступ восстановлен." : "Доступ заблокирован.");
    } catch (e) {
      notify((e as Error).message);
    }
  }
  return (
    <div className="page">
      <div className="page-heading">
        <div>
          <h1>
            Студенты{" "}
            <span className="heading-count">{students?.length || 0}</span>
          </h1>
          <p>Учётные записи, потоки и доступ к знаниям.</p>
        </div>
        <div className="button-group">
          <button className="btn secondary" onClick={() => setImportOpen(true)}>
            <Upload size={16} /> Импорт Excel
          </button>
          <button className="btn primary" onClick={() => setEdit(null)}>
            <Plus size={17} /> Добавить студента
          </button>
        </div>
      </div>
      <div className="mini-stats">
        <div>
          <Users size={18} />
          <strong>{students?.filter((s) => !s.blocked).length || 0}</strong>
          <span>активных студентов</span>
        </div>
        <div>
          <Layers size={18} />
          <strong>{groups?.length || 0}</strong>
          <span>потоков</span>
        </div>
        <div>
          <LockKeyhole size={18} />
          <strong>{students?.filter((s) => s.blocked).length || 0}</strong>
          <span>заблокировано</span>
        </div>
      </div>
      <section className="panel">
        <div className="table-toolbar">
          <SearchInput
            value={search}
            onChange={setSearch}
            placeholder="ФИО или логин студента"
          />
          <div className="filters">
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
              aria-label="Фильтр по статусу"
              value={status}
              onChange={(e) => setStatus(e.target.value)}
            >
              <option value="">Все статусы</option>
              <option value="0">Активные</option>
              <option value="1">Заблокированные</option>
            </select>
            <button className="btn secondary" disabled={!filtered.length} onClick={()=>setSelected(filtered.map(s=>s.id))}>Выбрать найденных · {filtered.length}</button>
            <button
              className="icon-button"
              aria-label="Экспорт списка студентов"
              onClick={() =>
                void writeExcel(
                  ["ФИО", "Логин", "Поток", "Статус"],
                  filtered.map((s) => [
                    s.name,
                    s.login,
                    s.group_name || "",
                    s.blocked ? "Заблокирован" : "Активен",
                  ]),
                  "Студенты.xlsx",
                ).catch((e) => notify(e.message))
              }
            >
              <Download size={18} />
            </button>
          </div>
        </div>
        {selected.length > 0 && (
          <div className="selection-toolbar">
            <span>
              <Check size={15} /> Выбрано: {selected.length}
            </span>
            <button className="text-button" onClick={() => setBulk(true)}>
              Переместить в поток
            </button>
            <button className="text-button" onClick={()=>setResetting((students||[]).filter(s=>selected.includes(s.id)))}>Сбросить пароли</button>
            <button
              className="text-button"
              onClick={() =>
                navigate(`assignments?students=${selected.join(",")}`)
              }
            >
              Назначить тест <ArrowUpRight size={14} />
            </button>
            <button className="text-button" onClick={() => setSelected([])}>
              Снять выделение
            </button>
          </div>
        )}
        {loading && !students ? (
          <Spinner />
        ) : error ? (
          <ErrorState error={error} retry={reload} />
        ) : filtered.length ? (
          <>
            <div className="table-scroll">
              <table>
                <thead>
                  <tr>
                    <th className="checkbox-cell">
                      <input
                        type="checkbox"
                        aria-label="Выбрать студентов на странице"
                        checked={
                          visible.length > 0 &&
                          visible.every((s) => selected.includes(s.id))
                        }
                        onChange={(e) =>
                          setSelected(
                            e.target.checked
                              ? [
                                  ...new Set([
                                    ...selected,
                                    ...visible.map((s) => s.id),
                                  ]),
                                ]
                              : selected.filter(
                                  (id) => !visible.some((s) => s.id === id),
                                ),
                          )
                        }
                      />
                    </th>
                    <th>Студент</th>
                    <th>Логин</th>
                    <th>Поток</th>
                    <th>Статус</th>
                    <th>Назначено тестов</th>
                    <th>Действия</th>
                  </tr>
                </thead>
                <tbody>
                  {visible.map((s, i) => (
                    <tr
                      key={s.id}
                      className={selected.includes(s.id) ? "selected" : ""}
                    >
                      <td>
                        <input
                          type="checkbox"
                          aria-label={`Выбрать ${s.name}`}
                          checked={selected.includes(s.id)}
                          onChange={() => toggle(s.id)}
                        />
                      </td>
                      <td>
                        <div className="person-cell">
                          <span className={`avatar tone-${i % 4}`}>
                            {initials(s.name)}
                          </span>
                          <strong>{s.name}</strong>
                        </div>
                      </td>
                      <td>
                        <code className="login-code">{s.login}</code>
                      </td>
                      <td>
                        {s.group_name ? (
                          <Badge>{s.group_name}</Badge>
                        ) : (
                          <span className="muted">Без потока</span>
                        )}
                      </td>
                      <td>
                        <Badge tone={s.blocked ? "red" : "green"}>
                          {s.blocked ? "Заблокирован" : "Активен"}
                        </Badge>
                      </td>
                      <td>
                        <span className="test-count">
                          <ClipboardIcon /> {s.test_count}
                        </span>
                      </td>
                      <td>
                        <div className="row-actions">
                          <button
                            className="icon-button"
                            aria-label={`Редактировать ${s.name}`}
                            onClick={() => setEdit(s)}
                          >
                            <Pencil size={15} />
                          </button>
                          <button
                            className="icon-button"
                            aria-label={`Сбросить пароль ${s.name}`}
                            onClick={() => setResetting([s])}
                          >
                            <KeyRound size={15} />
                          </button>
                          <button
                            className="icon-button"
                            aria-label={`${s.blocked ? "Разблокировать" : "Заблокировать"} ${s.name}`}
                            onClick={() => void block(s)}
                          >
                            {s.blocked ? (
                              <UnlockKeyhole size={15} />
                            ) : (
                              <LockKeyhole size={15} />
                            )}
                          </button>
                          <button
                            className="icon-button"
                            aria-label={`Назначить тест ${s.name}`}
                            onClick={() =>
                              navigate(`assignments?students=${s.id}`)
                            }
                          >
                            <ArrowUpRight size={16} />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <Pagination
              page={page}
              total={filtered.length}
              onChange={setPage}
            />
          </>
        ) : (
          <Empty
            title={
              search || group || status
                ? "Студенты не найдены"
                : "Начните с первого студента"
            }
            text={
              search || group || status
                ? "Попробуйте изменить поиск или фильтры."
                : "Добавьте учётную запись или загрузите список из Excel."
            }
            action={
              <button className="btn primary" onClick={() => setEdit(null)}>
                <UserPlus size={16} /> Добавить студента
              </button>
            }
          />
        )}
      </section>
      {edit !== undefined && (
        <StudentEditor
          student={edit}
          groups={groups || []}
          onClose={() => setEdit(undefined)}
          onDone={(result) => {
            setEdit(undefined);
            reload();
            if (result) setCredentials([result]);
            notify("Данные студента сохранены.");
          }}
        />
      )}
      {importOpen && (
        <ImportModal
          kind="students"
          onClose={() => {
            setImportOpen(false);
            history.replaceState(null, "", "#students");
          }}
          onDone={() => {
            reload();
            reloadGroups();
          }}
        />
      )}
      {credentials && (
        <CredentialsModal
          credentials={credentials}
          onClose={() => setCredentials(null)}
        />
      )}
      {resetting&&<Modal title="Сбросить пароли студентов?" description={`Выбрано: ${resetting.length}. Каждый получит новый уникальный временный пароль, прежние сеансы завершатся.`} onClose={()=>setResetting(null)}><AsyncForm label="Выдать новые пароли" onCancel={()=>setResetting(null)} onSubmit={async()=>{if(resetting.length===1)await reset(resetting[0]);else{const issued=await api('/admin/students/reset-passwords',{ids:resetting.map(s=>s.id)});setCredentials(issued.credentials);notify(`Сброшено паролей: ${resetting.length}. При входе потребуется смена.`);}setResetting(null);setSelected([]);reload();}}><div className="form-body"><p>Каждый студент задаст новый пароль после входа. Ответы и результаты сохранятся.</p><ul>{resetting.map(s=><li key={s.id}>{s.name}</li>)}</ul></div></AsyncForm></Modal>}
      {bulk && (
        <Modal
          title="Переместить студентов в поток"
          description={`Выбрано студентов: ${selected.length}`}
          onClose={() => setBulk(false)}
        >
          <AsyncForm
            onCancel={() => setBulk(false)}
            onSubmit={async () => {
              await api("/admin/students/bulk", {
                ids: selected,
                group_id: bulkGroup || null,
              });
              reload();
              setBulk(false);
              setSelected([]);
              notify("Состав потока обновлён.");
            }}
          >
            <div className="form-body">
              <Field label="Поток">
                <select
                  value={bulkGroup}
                  onChange={(e) => setBulkGroup(e.target.value)}
                >
                  <option value="">Исключить из потока</option>
                  {groups?.map((g) => (
                    <option key={g.id} value={g.id}>
                      {g.name}
                    </option>
                  ))}
                </select>
              </Field>
            </div>
          </AsyncForm>
        </Modal>
      )}
    </div>
  );
}
function ClipboardIcon() {
  return <Layers size={14} />;
}
function StudentEditor({
  student,
  groups,
  onClose,
  onDone,
}: {
  student: Student | null;
  groups: Group[];
  onClose: () => void;
  onDone: (value: any) => void;
}) {
  const [name, setName] = useState(student?.name || ""),
    [login, setLogin] = useState(student?.login || ""),
    [group, setGroup] = useState(student?.group_id || ""),
    [password, setPassword] = useState("");
  return (
    <Modal
      title={student ? "Редактировать студента" : "Новый студент"}
      description="Учётные записи создаёт администратор. Публичной регистрации нет."
      onClose={onClose}
    >
      <AsyncForm
        onCancel={onClose}
        label={student ? "Сохранить изменения" : "Создать студента"}
        onSubmit={async () => {
          const result = await api(
            student ? `/admin/students/${student.id}` : "/admin/students",
            {
              name,
              login,
              group_id: group || null,
              ...(!student && password ? { password } : {}),
            },
            student ? "PUT" : "POST",
          );
          onDone(
            student
              ? null
              : {
                  ...result,
                  name,
                  group: groups.find((g) => g.id === group)?.name || "",
                },
          );
        }}
      >
        <div className="form-body">
          <Field label="Фамилия и имя">
            <input
              required
              minLength={2}
              maxLength={120}
              value={name}
              onChange={(e) => {setName(e.target.value);setLogin(e.target.value);}}
              placeholder="Например, Алия Сейдахметова"
            />
          </Field>
          <Field label="Логин" hint="ФИО студента. Допустимы русские и казахские буквы.">
            <input
              required
              minLength={3}
              maxLength={120}
              value={login}
              onChange={(e) => setLogin(e.target.value)}
              placeholder="student001"
            />
          </Field>
          <Field label="Поток">
            <select value={group} onChange={(e) => setGroup(e.target.value)}>
              <option value="">Без потока</option>
              {groups.map((g) => (
                <option key={g.id} value={g.id}>
                  {g.name}
                </option>
              ))}
            </select>
          </Field>
          {!student && (
            <Field
              label="Временный пароль"
              hint="Оставьте пустым для безопасной генерации. После первого входа студент задаст свой пароль."
            >
              <input
                type="password"
                autoComplete="new-password"
                minLength={10}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Сгенерировать автоматически"
              />
            </Field>
          )}
        </div>
      </AsyncForm>
    </Modal>
  );
}
export function GroupsPage() {
  const {
    data: groups,
    loading,
    error,
    reload,
  } = useData<Group[]>("/admin/groups");
  const { navigate, notify } = useApp();
  const [search, setSearch] = useState(""),
    [edit, setEdit] = useState<Group | null | undefined>(undefined),
    [flowOpen,setFlowOpen] = useState(false),
    [assignmentGroup,setAssignmentGroup] = useState<Group|null>(null),
    [assignmentBusy,setAssignmentBusy] = useState(false);
  const filtered = (groups || []).filter((g) =>
    g.name.toLowerCase().includes(search.toLowerCase()),
  );
  return (
    <div className="page">
      <div className="page-heading">
        <div>
          <h1>
            Потоки{" "}
            <span className="heading-count">{groups?.length || 0}</span>
          </h1>
          <p>Объединяйте студентов и назначайте тесты всему потоку.</p>
        </div>
        <button className="btn primary" onClick={() => setFlowOpen(true)}>
          <Plus size={17} /> Создать поток
        </button>
      </div>
      <div className="standalone-toolbar">
        <SearchInput
          value={search}
          onChange={setSearch}
          placeholder="Найти поток"
        />
        <span className="muted">
          {groups?.reduce((s, g) => s + g.student_count, 0) || 0} студентов в
          потоках
        </span>
      </div>
      {loading && !groups ? (
        <Spinner />
      ) : error ? (
        <ErrorState error={error} retry={reload} />
      ) : filtered.length ? (
        <div className="groups-grid">
          {filtered.map((g, i) => (
            <section className="panel group-card" key={g.id}>
              <div className="group-card-top">
                <span className={`group-icon tone-${i % 4}`}>
                  <Layers size={24} />
                </span>
                <button
                  className="icon-button"
                  aria-label={`Редактировать поток ${g.name}`}
                  onClick={() => setEdit(g)}
                >
                  <Pencil size={16} />
                </button>
              </div>
              <h2>{g.name}</h2>
              <p>{g.description || "Поток Академии финансов"}</p>
              <div className="group-metrics">
                <span>
                  <Users size={16} />
                  <strong>{g.student_count}</strong> студентов
                </span>
                <span>
                  <Layers size={16} />
                  <strong>{g.assignment_count}</strong> назначений
                </span>
              </div>
              <div className="group-card-footer">
                <button
                  className="btn secondary"
                  onClick={() => navigate(`students?group=${g.id}`)}
                >
                  Студенты <ArrowUpRight size={15} />
                </button>
                <button
                  className="text-button"
                  onClick={() => setAssignmentGroup(g)}
                >
                  Назначить тест <Plus size={15} />
                </button>
              </div>
            </section>
          ))}
        </div>
      ) : (
        <Empty
          title="Потоки не найдены"
          text="Создайте поток вручную или во время импорта студентов."
        />
      )}
      {flowOpen&&<FlowCreator onClose={()=>setFlowOpen(false)} onDone={rows=>{setFlowOpen(false);reload();notify(`Поток создан. Студентов: ${rows.length}.`);}}/>}
      {assignmentGroup&&<Modal title={`Тесты для потока «${assignmentGroup.name}»`} wide onClose={()=>{if(!assignmentBusy){setAssignmentGroup(null);reload();}}}><FlowAssignmentPanel group={assignmentGroup} onBusyChange={setAssignmentBusy} onClose={()=>{setAssignmentGroup(null);reload();}}/></Modal>}
      {edit !== undefined && (
        <GroupEditor
          group={edit}
          onClose={() => setEdit(undefined)}
          onDone={() => {
            setEdit(undefined);
            reload();
            notify("Поток сохранён.");
          }}
        />
      )}
    </div>
  );
}
function GroupEditor({
  group,
  onClose,
  onDone,
}: {
  group: Group | null;
  onClose: () => void;
  onDone: () => void;
}) {
  const [name, setName] = useState(group?.name || ""),
    [description, setDescription] = useState(group?.description || "");
  return (
    <Modal
      title={group ? "Редактировать поток" : "Новый поток"}
      onClose={onClose}
    >
      <AsyncForm
        onCancel={onClose}
        onSubmit={async () => {
          await api(
            group ? `/admin/groups/${group.id}` : "/admin/groups",
            { name, description },
            group ? "PUT" : "POST",
          );
          onDone();
        }}
      >
        <div className="form-body">
          <Field label="Название потока">
            <input
              required
              minLength={2}
              maxLength={80}
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Например, FA-101"
            />
          </Field>
          <Field label="Описание">
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={3}
              maxLength={1000}
              placeholder="Специальность, курс или поток"
            />
          </Field>
        </div>
      </AsyncForm>
    </Modal>
  );
}
