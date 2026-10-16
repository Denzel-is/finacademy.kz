import { useMemo, useState, useEffect } from "react";
import {
  Users,
  Layers,
  ClipboardList,
  CheckCheck,
  ArrowUpRight,
  ArrowRight,
  Plus,
  Download,
  ShieldCheck,
  CalendarDays,
  Activity,
  ChevronRight,
  GraduationCap,
  Target,
} from "lucide-react";
import { useData } from "./useData";
import { useApp } from "./app-context";
import {
  Spinner,
  ErrorState,
  Badge,
  StatusBadge,
  initials,
  number,
  date,
} from "./ui";
import { exportResults } from "./excel";
import type { Dashboard, ResultRow } from "../shared/types";
import { api } from "./api";
export function DashboardPage() {
  const {
    data: d,
    error,
    loading,
    reload,
  } = useData<Dashboard>("/admin/dashboard");
  const { user, navigate, notify, settings } = useApp();
  const [range, setRange] = useState(7);
  const [liveActive, setLiveActive] = useState<number | null>(null);
  const [activeUnavailable, setActiveUnavailable] = useState(false);
  useEffect(() => {
    let mounted = true, pending = false;
    const refreshActive = async () => {
      if (pending || document.visibilityState !== "visible") return;
      pending = true;
      try {
        const value = await api<{ active: number }>("/admin/active-count");
        if (mounted) { setLiveActive(value.active); setActiveUnavailable(false); }
      } catch { if (mounted) setActiveUnavailable(true); }
      finally { pending = false; }
    };
    void refreshActive();
    const timer = setInterval(() => {
      void refreshActive();
    }, 10000);
    const summaryTimer = setInterval(() => {
      if (document.visibilityState === "visible") reload();
    }, 60000);
    return () => { mounted = false; clearInterval(timer); clearInterval(summaryTimer); };
  }, [reload]);
  const days = useMemo(
    () =>
      Array.from({ length: range }, (_, i) => {
        const day = new Date();
        day.setUTCDate(day.getUTCDate() - (range - 1 - i));
        const id = day.toISOString().slice(0, 10);
        return {
          day: id,
          completed: d?.trend.find((x) => x.day === id)?.completed || 0,
          passed: d?.trend.find((x) => x.day === id)?.passed || 0,
        };
      }),
    [d, range],
  );
  if (loading && !d) return <Spinner />;
  if (error || !d) return <ErrorState error={error} retry={reload} />;
  const active = liveActive ?? d.active;
  const max = Math.max(5, ...days.map((d) => d.completed)),
    total = days.reduce((s, d) => s + d.completed, 0),
    pass = days.reduce((s, d) => s + d.passed, 0);
  return (
    <div className="page dashboard-page">
      <div className="page-heading">
        <div>
          <div className="page-eyebrow">ВАШЕ РАБОЧЕЕ ПРОСТРАНСТВО</div>
          <h1>
            Всё под контролем<span className="heading-dot">.</span>
          </h1>
          <p>
            Добро пожаловать, {user.name}. Вот что происходит в
            Академии.
          </p>
        </div>
        <div className="date-label">
          <CalendarDays size={16} />
          {new Intl.DateTimeFormat("ru-RU", {
            day: "numeric",
            month: "long",
            year: "numeric",
            timeZone: settings.timezone || "Asia/Almaty",
          }).format(new Date())}
        </div>
      </div>
      <button className="live-exam-status" onClick={() => navigate("results")}>
        <Activity size={18} />
        <strong>Сейчас проходят тест: {activeUnavailable ? "—" : active}</strong>
        <span>
          {activeUnavailable ? "Не удалось обновить счётчик" : "Обновляется каждые 10 секунд"} <ArrowUpRight size={14} />
        </span>
      </button>
      <section className="welcome-banner">
        <div>
          <Badge tone="green">Оценка знаний без лишних сложностей</Badge>
          <h2>
            Больше времени на обучение.
            <br />
            Меньше на организацию.
          </h2>
          <p>
            Создавайте тесты, объединяйте студентов в потоки
            <br className="desktop-break" /> и следите за результатами в одном
            пространстве.
          </p>
          <button
            className="btn dark"
            onClick={() => navigate("tests?create=1")}
          >
            <Plus size={17} /> Создать тест <ArrowUpRight size={17} />
          </button>
        </div>
        <div className="banner-art" aria-hidden="true">
          <div className="art-orbit orbit-one" />
          <div className="art-orbit orbit-two" />
          <div className="art-orbit orbit-three" />
          <div className="art-sheet">
            <div className="art-sheet-icon">
              <GraduationCap size={22} />
            </div>
            <div className="art-line long" />
            <div className="art-line" />
            {[76, 95, 56].map((n, i) => (
              <div className="art-answer" key={n}>
                <span>{i < 2 ? <CheckCheck size={12} /> : null}</span>
                <div style={{ width: `${n}%` }} />
              </div>
            ))}
          </div>
          <div className="art-check">
            <CheckCheck size={29} />
          </div>
          <div className="art-asterisk">✳</div>
        </div>
      </section>
      <section className="stats-grid" aria-label="Статистика платформы">
        {[
          {
            label: "Всего студентов",
            value: d.students,
            icon: Users,
            detail: `В ${d.groups} потоках`,
            color: "green",
            path: "students",
          },
          {
            label: "Потоки",
            value: d.groups,
            icon: Layers,
            detail: "Вместе к новым знаниям",
            color: "blue",
            path: "groups",
          },
          {
            label: "Опубликовано тестов",
            value: d.tests,
            icon: ClipboardList,
            detail: "Доступны для назначения",
            color: "purple",
            path: "tests",
          },
          {
            label: "Завершено попыток",
            value: d.completed,
            icon: CheckCheck,
            detail: `Средний результат ${d.average}%`,
            color: "orange",
            path: "results",
          },
        ].map((s) => (
          <button
            className="stat-card"
            key={s.label}
            onClick={() => navigate(s.path)}
          >
            <div className="stat-top">
              <span>{s.label}</span>
              <span className={`stat-icon ${s.color}`}>
                <s.icon size={19} />
              </span>
            </div>
            <strong>{number(s.value)}</strong>
            <div className="stat-bottom">
              <span>{s.detail}</span>
              <ArrowUpRight size={15} />
            </div>
          </button>
        ))}
      </section>
      <div className="dashboard-middle">
        <section className="panel chart-panel">
          <div className="panel-heading">
            <div>
              <h2>Динамика тестирования</h2>
              <p>Завершённые попытки за выбранный период</p>
            </div>
            <select
              aria-label="Период статистики"
              value={range}
              onChange={(e) => setRange(Number(e.target.value))}
            >
              <option value={7}>Последние 7 дней</option>
              <option value={14}>Последние 14 дней</option>
            </select>
          </div>
          <div className="chart-summary">
            <strong>
              {total}
              <small>попыток</small>
            </strong>
            <span>
              <span className="legend-dot" /> Успешных: {pass}
            </span>
            <span>
              <span className="legend-dot light" /> Всего завершено
            </span>
          </div>
          <div className="bar-chart">
            <div className="chart-axis">
              {[1, 0.75, 0.5, 0.25, 0].map((n) => (
                <span key={n}>{Math.round(max * n)}</span>
              ))}
            </div>
            <div className="chart-plot">
              <div className="chart-grid">
                {[0, 1, 2, 3, 4].map((n) => (
                  <div key={n} />
                ))}
              </div>
              <div className="chart-bars">
                {days.map((day) => (
                  <div className="chart-column" key={day.day}>
                    <div
                      className="bar-group"
                      title={`${date(day.day)}: ${day.completed} попыток, сдали ${day.passed}`}
                    >
                      <div
                        className="bar-total"
                        style={{
                          height: `${(day.completed / max) * 100}%`,
                          minHeight: day.completed ? 3 : 0,
                        }}
                      >
                        <div
                          className="bar-passed"
                          style={{
                            height: `${day.completed ? (day.passed / day.completed) * 100 : 0}%`,
                          }}
                        />
                      </div>
                    </div>
                    <span>
                      {new Date(day.day).toLocaleDateString("ru-RU", {
                        day: "2-digit",
                        month: "2-digit",
                      })}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </section>
        <section className="panel quick-panel">
          <div className="panel-heading">
            <div>
              <h2>Быстрые действия</h2>
              <p>Всё нужное под рукой</p>
            </div>
            <span className="panel-small-icon">
              <Activity size={18} />
            </span>
          </div>
          {[
            {
              icon: Users,
              title: "Добавить студентов",
              text: "Вручную или из Excel",
              path: "students?import=1",
              color: "green",
            },
            {
              icon: ClipboardList,
              title: "Создать тест",
              text: "Настроить проверку знаний",
              path: "tests?create=1",
              color: "blue",
            },
            {
              icon: KeyIcon,
              title: "Выдать доступ",
              text: "Потоку или одному студенту",
              path: "assignments?create=1",
              color: "purple",
            },
          ].map((action) => (
            <button
              className="quick-action"
              key={action.title}
              onClick={() => navigate(action.path)}
            >
              <span className={`stat-icon ${action.color}`}>
                <action.icon size={19} />
              </span>
              <span>
                <strong>{action.title}</strong>
                <small>{action.text}</small>
              </span>
              <ChevronRight size={17} />
            </button>
          ))}
          <button
            className="quick-action"
            onClick={async () => {
              try {
                await exportResults(await api<ResultRow[]>("/admin/results"));
                notify("Отчёт Excel скачан.");
              } catch (e) {
                notify((e as Error).message);
              }
            }}
          >
            <span className="stat-icon orange">
              <Download size={19} />
            </span>
            <span>
              <strong>Скачать результаты</strong>
              <small>Общий отчёт в Excel</small>
            </span>
            <ChevronRight size={17} />
          </button>
          <div className="live-status">
            <span className="live-dot" />
            <div>
              <strong>
                {activeUnavailable ? "Счётчик временно недоступен" : active
                  ? `${active} студентов проходят тесты`
                  : "Платформа готова к тестированию"}
              </strong>
              <small>Ответы синхронизируются автоматически</small>
            </div>
          </div>
        </section>
      </div>
      <section className="panel recent-panel">
        <div className="panel-heading">
          <div>
            <h2>
              Последние попытки{" "}
              <span className="count-pill">{d.recent.length}</span>
            </h2>
            <p>Результаты и ход тестирования студентов</p>
          </div>
          <button className="text-button" onClick={() => navigate("results")}>
            Все результаты <ArrowRight size={16} />
          </button>
        </div>
        {d.recent.length ? (
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>Студент</th>
                  <th>Тест / дисциплина</th>
                  <th>Результат</th>
                  <th>Статус</th>
                  <th>Дата</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {d.recent.map((r, i) => (
                  <tr key={r.id}>
                    <td>
                      <div className="person-cell">
                        <span className={`avatar tone-${i % 4}`}>
                          {initials(r.student_name)}
                        </span>
                        <span>
                          <strong>{r.student_name}</strong>
                          <small>{r.group_name || "Без потока"}</small>
                        </span>
                      </div>
                    </td>
                    <td>
                      <span className="table-title">{r.test_title}</span>
                      <small className="cell-sub">
                        {r.total_questions} вопросов
                      </small>
                    </td>
                    <td>
                      {r.percent !== null ? (
                        <div className="score-cell">
                          <strong>{r.percent}%</strong>
                          <div>
                            <span style={{ width: `${r.percent}%` }} />
                          </div>
                        </div>
                      ) : (
                        <span className="muted">Ожидается</span>
                      )}
                    </td>
                    <td>
                      <StatusBadge status={r.status} passed={r.passed} />
                    </td>
                    <td className="muted">
                      {date(r.finished_at || r.started_at, true)}
                    </td>
                    <td>
                      <button
                        className="icon-button"
                        aria-label={`Открыть результат ${r.student_name}`}
                        onClick={() => navigate(`results?attempt=${r.id}`)}
                      >
                        <ArrowUpRight size={16} />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="dashboard-empty">
            <GraduationCap size={26} />
            <p>Первые результаты появятся после завершения тестов.</p>
          </div>
        )}
      </section>
      <div className="dashboard-bottom">
        <section className="proctor-card">
          <div className="proctor-symbol">
            <ShieldCheck size={27} />
          </div>
          <div>
            <h3>Честная оценка знаний</h3>
            <p>
              Прокторинг фиксирует события браузера.
              <br />
              Все сигналы доступны в журнале попытки.
            </p>
          </div>
          <button className="text-button" onClick={() => navigate("results")}>
            Перейти к результатам <ArrowUpRight size={16} />
          </button>
        </section>
        <section className="overview-mini">
          <div>
            <span className="stat-icon green">
              <Target size={19} />
            </span>
            <strong>
              {d.completed ? Math.round((d.passed / d.completed) * 100) : 0}%
            </strong>
            <p>Успешных попыток</p>
          </div>
          <div>
            <span className="stat-icon orange">
              <ShieldCheck size={19} />
            </span>
            <strong>{d.violations}</strong>
            <p>Событий ухода</p>
          </div>
        </section>
      </div>
    </div>
  );
}
function KeyIcon(props: { size: number }) {
  return <ArrowUpRight {...props} />;
}
