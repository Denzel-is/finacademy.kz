import { AppContext } from "./app-context";
import { useState, useEffect, useCallback, useRef, type ReactNode } from "react";
import {
  Landmark,
  LayoutDashboard,
  Users,
  Layers,
  ClipboardList,
  LibraryBig,
  KeyRound,
  ChartNoAxesCombined,
  Settings,
  LogOut,
  ChevronRight,
  ArrowUpRight,
  HelpCircle,
  Menu,
  X,
  ShieldCheck,
  ArrowRight,
  Eye,
  EyeOff,
  LoaderCircle,
  BookOpen,
  CheckCircle2,
} from "lucide-react";
import { api, ApiError } from "./api";
import { Spinner, IconButton, Modal, initials, setDateTimezone } from "./ui";
import { DashboardPage } from "./Dashboard";
import { StudentsPage, GroupsPage } from "./Students";
import { TestsPage, QuestionsPage, AssignmentsPage } from "./Tests";
import { ResultsPage, SettingsPage } from "./Results";
import { StudentHome, StudentHistory, ExamPage } from "./Student";
import { PasswordChange } from './PasswordChange';
import type { User, Attempt } from "../shared/types";

const adminNav = [
  { id: "dashboard", label: "Обзор", icon: LayoutDashboard },
  { id: "students", label: "Студенты", icon: Users },
  { id: "groups", label: "Потоки", icon: Layers },
  { id: "tests", label: "Тесты", icon: ClipboardList },
  { id: "questions", label: "Банк вопросов", icon: LibraryBig },
  { id: "assignments", label: "Назначения", icon: KeyRound },
  { id: "results", label: "Результаты", icon: ChartNoAxesCombined },
];
const studentNav = [
  { id: "my-tests", label: "Мои тесты", icon: ClipboardList },
  { id: "my-results", label: "Мои результаты", icon: ChartNoAxesCombined },
];
export function App() {
  const beforeExamLeave=useRef<(()=>Promise<void>)|null>(null);
  const registerBeforeLeave=useCallback((callback:(()=>Promise<void>)|null)=>{beforeExamLeave.current=callback;},[]);
  const [user, setUser] = useState<User | null>(null),
    [settings, setSettings] = useState<Record<string, string>>({}),
    [loading, setLoading] = useState(true),
    [route, setRoute] = useState(location.hash.slice(1)),
    [toast, setToast] = useState(""),
    [mobile, setMobile] = useState(false),
    [help, setHelp] = useState(false),
    [passwordOpen,setPasswordOpen] = useState(false),
    [attempt, setAttempt] = useState<Attempt | null>(null);
  const updateSettings = useCallback((value: Record<string, string>) => {
    setDateTimezone(value.timezone || "Asia/Almaty");
    setSettings(value);
  }, []);
  const notify = useCallback((text: string) => setToast(text), []);
  const navigate = useCallback((path: string) => {
    location.hash = path;
    setMobile(false);
  }, []);
  useEffect(() => {
    api("/auth/me")
      .then((data) => {
        setUser(data.user);
        updateSettings(data.settings);
      })
      .catch((e) => {
        if (!(e instanceof ApiError && e.status === 401)) setToast(e.message);
      })
      .finally(() => setLoading(false));
    const hash = () => {
      setRoute(location.hash.slice(1));
      window.scrollTo({ top: 0 });
    };
    window.addEventListener("hashchange", hash);
    return () => window.removeEventListener("hashchange", hash);
  }, []);
  useEffect(() => {
    const expired = () => {
      setUser(null);
      setAttempt(null);
    };
    window.addEventListener("fa-session-expired", expired);
    return () => window.removeEventListener("fa-session-expired", expired);
  }, []);
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(""), 6000);
    return () => clearTimeout(t);
  }, [toast]);
  async function logout() {
    try {
      await beforeExamLeave.current?.();
      await api("/auth/logout", {});
      setUser(null);
      setAttempt(null);
      navigate("");
    } catch (e) {
      notify((e as Error).message);
    }
  }
  if (loading)
    return (
      <div className="app-loading">
        <Brand />
        <Spinner />
      </div>
    );
  if (!user)
    return (
      <Login
        onLogin={async (user) => {
          setUser(user);
          const value = await api("/auth/me");
          updateSettings(value.settings);
          navigate(user.role === "student" ? "my-tests" : "dashboard");
        }}
      />
    );
  if (user.must_change_password || passwordOpen) return <PasswordChange required={Boolean(user.must_change_password)} onCancel={()=>user.must_change_password?void logout():setPasswordOpen(false)} onDone={async()=>{const data=await api('/auth/me');setUser(data.user);setPasswordOpen(false);notify('Пароль изменён.');}}/>;
  const student = user.role === "student",
    nav = student ? studentNav : adminNav,
    current = (route || (student ? "my-tests" : "dashboard")).split("?")[0];
  let content: ReactNode;
  if (student && attempt)
    content = (
      <ExamPage
        initial={attempt}
        onBeforeLeave={registerBeforeLeave}
        onExit={() => {
          setAttempt(null);
          navigate("my-results");
        }}
      />
    );
  else if (student)
    content =
      current === "my-results" ? (
        <StudentHistory />
      ) : (
        <StudentHome onStart={setAttempt} />
      );
  else
    switch (current) {
      case "students":
        content = <StudentsPage />;
        break;
      case "groups":
        content = <GroupsPage />;
        break;
      case "tests":
        content = <TestsPage />;
        break;
      case "questions":
        content = <QuestionsPage />;
        break;
      case "assignments":
        content = <AssignmentsPage />;
        break;
      case "results":
        content = <ResultsPage />;
        break;
      case "settings":
        content = <SettingsPage />;
        break;
      default:
        content = <DashboardPage />;
    }
  return (
    <AppContext.Provider
      value={{ user, notify, navigate, settings, updateSettings }}
    >
      <div
        className={`app-shell ${mobile ? "nav-open" : ""} ${attempt ? "exam-shell" : ""}`}
      >
        <a className="skip-link" href="#main-content" onClick={e=>{e.preventDefault();document.getElementById('main-content')?.focus();}}>К содержимому</a>
        {mobile && (
          <button
            className="nav-scrim"
            aria-label="Закрыть меню"
            onClick={() => setMobile(false)}
          />
        )}
        <aside className="sidebar">
          <a className="brand-link" href={student ? "#my-tests" : "#dashboard"}>
            <Brand />
          </a>
          <div className="workspace-label">
            <span className="workspace-icon">АФ</span>
            <div>
              <strong>
                {student ? "Личный кабинет" : "Рабочее пространство"}
              </strong>
              <span>{student ? "Студент" : "Администрирование"}</span>
            </div>
            <ChevronRight size={14} />
          </div>
          <div className="nav-label">{student ? "ОБУЧЕНИЕ" : "УПРАВЛЕНИЕ"}</div>
          <nav aria-label="Основная навигация">
            {nav.map(({ id, label, icon: Icon }) => (
              <a
                key={id}
                href={`#${id}`}
                onClick={() => setMobile(false)}
                className={`nav-item ${current === id && !attempt ? "active" : ""}`}
                aria-current={current === id ? "page" : undefined}
              >
                <Icon size={19} />
                <span>{label}</span>
                {current === id && !attempt && (
                  <span className="nav-indicator" />
                )}
              </a>
            ))}
          </nav>
          <div className="sidebar-bottom">
            {student&&<button className="nav-item" onClick={async()=>{try{await beforeExamLeave.current?.();setPasswordOpen(true);}catch(e){notify((e as Error).message);}}}><KeyRound size={19}/><span>Изменить пароль</span></button>}
            {!student && (
              <a
                className={`nav-item ${current === "settings" ? "active" : ""}`}
                href="#settings"
              >
                <Settings size={19} />
                <span>Настройки</span>
              </a>
            )}
            <button className="nav-item" onClick={() => setHelp(true)}>
              <HelpCircle size={19} />
              <span>Помощь и поддержка</span>
              <ArrowUpRight size={15} />
            </button>
            <div className="sidebar-note">
              <ShieldCheck size={19} />
              <div>
                <strong>Сосредоточьтесь на знаниях</strong>
                <p>Остальное мы берём на себя.</p>
              </div>
            </div>
            <div className="profile">
              <span className="avatar">{initials(user.name)}</span>
              <div>
                <strong>{user.name}</strong>
                <span>
                  {student
                    ? user.group_name || "Студент"
                    : "Администратор"}
                </span>
              </div>
              <IconButton label="Выйти" onClick={() => void logout()}>
                <LogOut size={17} />
              </IconButton>
            </div>
          </div>
        </aside>
        <div className="main-shell">
          <header className="topbar">
            <div className="breadcrumbs">
              <IconButton
                label="Открыть меню"
                className="mobile-menu"
                onClick={() => setMobile(!mobile)}
              >
                {mobile ? <X size={20} /> : <Menu size={20} />}
              </IconButton>
              <span>Платформа тестирования</span>
              <ChevronRight size={14} />
              <strong>
                {attempt
                  ? "Прохождение теста"
                  : current === "settings"
                    ? "Настройки"
                    : nav.find((n) => n.id === current)?.label || "Обзор"}
              </strong>
            </div>
            <div className="topbar-right">
              <span className="environment-tag">FINACADEMY</span>
              <button className="help-button" onClick={() => setHelp(true)}>
                <HelpCircle size={17} />
                <span>Помощь</span>
              </button>
              <span className="avatar small">{initials(user.name)}</span>
            </div>
          </header>
          <main id="main-content" tabIndex={-1}>{content}</main>
          <footer className="app-footer">
            <span>
              © {new Date().getFullYear()}{" "}
              {settings.academy_name || "Академия финансов"}
            </span>
            <span>
              <span className="status-dot" /> Подключено к платформе
            </span>
          </footer>
        </div>
        {toast && (
          <div className="toast" role="status">
            <CheckCircle2 size={20} />
            <span>{toast}</span>
            <button
              aria-label="Закрыть уведомление"
              onClick={() => setToast("")}
            >
              <X size={16} />
            </button>
          </div>
        )}
        {help && (
          <Modal title="Помощь и поддержка" onClose={() => setHelp(false)}>
            <div className="help-content">
              <p>
                Начните с потока: добавьте студентов вручную или загрузите
                Excel. Создайте тест, наполните банк вопросов и опубликуйте его.
                В разделе «Назначения» выдайте доступ потоку или студенту.
              </p>
              <h3>Надёжное сохранение</h3>
              <p>
                Ответы сохраняются на устройстве и отправляются на сервер
                пакетами. При потере связи продолжайте отвечать в открытой
                вкладке. Для завершения требуется соединение с сервером.
              </p>
              <h3>Прокторинг</h3>
              <p>
                Фиксируются уходы из вкладки, потеря фокуса и выход из
                полноэкранного режима. Несколько сигналов одного ухода
                объединяются. Настройки теста определяют предупреждение и
                блокировку.
              </p>
              <p className="muted">
                Доступны учебные банки МСФО и МСФООС на русском и казахском.
                Браузерные сигналы помогают проверке и сами по себе не
                доказывают списывание.
              </p>
              {settings.support_email && (
                <a
                  className="btn primary"
                  href={`mailto:${settings.support_email}`}
                >
                  Связаться с поддержкой <ArrowUpRight size={16} />
                </a>
              )}
            </div>
          </Modal>
        )}
      </div>
    </AppContext.Provider>
  );
}
export function Brand() {
  return (
    <div className="brand">
      <span className="brand-mark">
        <Landmark size={24} strokeWidth={1.7} />
      </span>
      <div>
        <strong>
          Академия
          <br />
          финансов
        </strong>
        <span>ПЛАТФОРМА ТЕСТИРОВАНИЯ</span>
      </div>
    </div>
  );
}
function Login({ onLogin }: { onLogin: (user: User) => Promise<void> }) {
  const [login, setLogin] = useState(""),
    [password, setPassword] = useState(""),
    [show, setShow] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  return (
    <div className="login-page">
      <div className="login-story">
        <Brand />
        <div className="login-story-body">
          <span className="login-eyebrow">
            <span className="status-dot" /> Образование с уверенностью
          </span>
          <h1>
            Большие знания.
            <br />
            <span>Новые возможности.</span>
          </h1>
          <p>
            Единое пространство для проверки знаний и профессионального роста.
          </p>
          <div className="login-features">
            <span>
              <ShieldCheck size={20} /> Надёжное тестирование
            </span>
            <span>
              <BookOpen size={20} /> Финансовые дисциплины
            </span>
            <span>
              <ChartNoAxesCombined size={20} /> Понятные результаты
            </span>
          </div>
        </div>
        <div className="login-story-footer">
          Академия финансов <span>Знания, которые работают.</span>
        </div>
      </div>
      <div className="login-form-panel">
        <form
          className="login-form"
          onSubmit={async (e) => {
            e.preventDefault();
            setBusy(true);
            setError("");
            try {
              const data = await api("/auth/login", { login, password });
              await onLogin(data.user);
            } catch (e) {
              setError((e as Error).message);
            } finally {
              setBusy(false);
            }
          }}
        >
          <div className="login-icon">
            <KeyRound size={24} />
          </div>
          <h2>Рады видеть вас</h2>
          <p>
            Войдите в свою учётную запись,
            <br />
            чтобы продолжить работу.
          </p>
          <label className="field">
            <span>Логин</span>
            <input
              name="username"
              autoComplete="username"
              required
              placeholder="ФИО студента или логин администратора"
              value={login}
              onChange={(e) => setLogin(e.target.value)}
            />
          </label>
          <label className="field">
            <span>Пароль</span>
            <div className="password-field">
              <input
                name="password"
                type={show ? "text" : "password"}
                autoComplete="current-password"
                required
                placeholder="Введите пароль"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
              <button
                type="button"
                aria-label={show ? "Скрыть пароль" : "Показать пароль"}
                onClick={() => setShow(!show)}
              >
                {show ? <EyeOff size={18} /> : <Eye size={18} />}
              </button>
            </div>
          </label>
          {error && (
            <p className="form-error" role="alert">
              {error}
            </p>
          )}
          <button className="btn primary login-submit" disabled={busy}>
            {busy ? (
              <LoaderCircle size={18} className="spin" />
            ) : (
              <>
                Войти в кабинет <ArrowRight size={18} />
              </>
            )}
          </button>
          <div className="login-help">
            <HelpCircle size={16} />
            <p>
              Нет данных для входа?
              <br />
              <span>Обратитесь к администратору Академии.</span>
            </p>
          </div>
          <div className="login-version">
            Учётные данные выдаёт администратор Академии
          </div>
        </form>
        <span className="login-copyright">
          © {new Date().getFullYear()} Академия финансов
        </span>
      </div>
    </div>
  );
}
