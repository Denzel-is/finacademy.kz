import { useState, useEffect } from "react";
import {
  ClipboardList,
  Clock3,
  ArrowRight,
  ShieldCheck,
  CheckCircle2,
  Download,
  ArrowLeft,
  ChevronLeft,
  ChevronRight,
  CloudCheck,
  CloudOff,
  LoaderCircle,
  AlertTriangle,
  Maximize,
  Flag,
  GraduationCap,
  Target,
  History,
  RefreshCw,
} from "lucide-react";
import { useData } from "./useData";
import { useApp } from "./app-context";
import { useExam } from "./useExam";
import { api, downloadFile, downloadBlob } from "./api";
import {
  Spinner,
  Empty,
  ErrorState,
  Badge,
  StatusBadge,
  Modal,
  AsyncForm,
  date,
} from "./ui";
import type { Test, Attempt, ResultRow } from "../shared/types";
export function StudentHome({ onStart }: { onStart: (a: Attempt) => void }) {
  const {
    data: tests,
    error,
    loading,
    reload,
  } = useData<Test[]>("/student/tests");
  const { user, notify } = useApp();
  const [prepare, setPrepare] = useState<Test | null>(null),
    [busy, setBusy] = useState(false),
    [startError, setStartError] = useState("");
  async function start() {
    if (!prepare) return;
    setBusy(true);
    setStartError("");
    try {
      const a = await api<Attempt>("/student/start", { test_id: prepare.id });
      onStart(a);
    } catch (e) {
      setStartError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="page student-page">
      <div className="page-heading">
        <div>
          <div className="page-eyebrow">ЛИЧНЫЙ КАБИНЕТ СТУДЕНТА</div>
          <h1>
            Здравствуйте, {user.name.split(" ")[0]}
            <span className="heading-dot">.</span>
          </h1>
          <p>Ваш следующий шаг к новым знаниям начинается здесь.</p>
        </div>
        {user.group_name && (
          <Badge tone="green">Поток {user.group_name}</Badge>
        )}
      </div>
      <section className="student-welcome">
        <span className="student-welcome-icon">
          <GraduationCap size={34} />
        </span>
        <div>
          <h2>Покажите, на что вы способны.</h2>
          <p>
            Выберите назначенный тест. Мы сохраним ваши ответы,
            <br />а после завершения вы увидите результат.
          </p>
        </div>
        <div>
          <ShieldCheck size={48} strokeWidth={1} />
        </div>
      </section>
      <div className="section-heading">
        <h2>
          Мои тесты <span className="count-pill">{tests?.length || 0}</span>
        </h2>
        <button className="text-button" onClick={reload}>
          <RefreshCw size={15} /> Обновить
        </button>
      </div>
      {loading && !tests ? (
        <Spinner />
      ) : error ? (
        <ErrorState error={error} retry={reload} />
      ) : tests?.length ? (
        <div className="student-tests-grid">
          {tests.map((t, i) => {
            const used = t.attempts_used || 0,
              max = t.access?.max_attempts || t.max_attempts;
            const before =
                t.access?.starts_at &&
                Date.parse(t.access.starts_at) > Date.now(),
              after =
                t.access?.ends_at && Date.parse(t.access.ends_at) <= Date.now();
            const unavailable =
              !t.active_attempt &&
              (Boolean(before) || Boolean(after) || used >= max);
            return (
              <section className="panel student-test-card" key={t.id}>
                <div className="test-card-top">
                  <span className={`test-icon tone-${i % 4}`}>
                    <ClipboardList size={23} />
                  </span>
                  <Badge
                    tone={
                      t.active_attempt
                        ? "blue"
                        : unavailable
                          ? "neutral"
                          : "green"
                    }
                  >
                    {t.active_attempt
                      ? "Есть незавершённая попытка"
                      : before
                        ? "Скоро откроется"
                        : after
                          ? "Доступ завершён"
                          : used >= max
                            ? "Попытки использованы"
                            : "Доступен"}
                  </Badge>
                </div>
                <div className="discipline-label">
                  {t.discipline}
                  {Boolean(t.demo) && " · Демонстрационный тест"}
                </div>
                <h2>{t.title}</h2>
                <p>{t.description}</p>
                <div className="student-test-meta">
                  <div>
                    <LibraryIcon />
                    <strong>{t.question_count}</strong>
                    <span>вопросов</span>
                  </div>
                  <div>
                    <Clock3 size={18} />
                    <strong>{t.minutes || "∞"}</strong>
                    <span>{t.minutes ? "минут" : "без таймера"}</span>
                  </div>
                  <div>
                    <Target size={18} />
                    <strong>{t.pass_percent} / 100</strong>
                    <span>баллов для зачёта</span>
                  </div>
                </div>
                <div className="student-test-bottom">
                  <span>
                    Попытки: {used} из {max}
                  </span>
                  {t.proctor_mode !== "off" && (
                    <span>
                      <ShieldCheck size={14} /> С контролем
                    </span>
                  )}
                </div>
                {t.access?.ends_at && (
                  <p className="test-deadline">
                    Доступ до {date(t.access.ends_at, true)}
                  </p>
                )}
                <button
                  className={`btn ${unavailable ? "secondary" : "primary"} full-width`}
                  disabled={unavailable}
                  onClick={() => {
                    setPrepare(t);
                    setStartError("");
                  }}
                >
                  {t.active_attempt
                    ? "Продолжить тест"
                    : unavailable
                      ? "Тест недоступен"
                      : "Начать тест"}
                  <ArrowRight size={17} />
                </button>
              </section>
            );
          })}
        </div>
      ) : (
        <Empty
          title="Назначенных тестов пока нет"
          text="Когда администратор выдаст вам доступ, тесты появятся здесь."
        />
      )}
      {prepare && (
        <Modal
          title={
            prepare.active_attempt
              ? "Продолжить тестирование"
              : "Перед началом теста"
          }
          description={prepare.title}
          onClose={() => setPrepare(null)}
        >
          <div className="form-body">
            <div className="preparation-specs">
              <span>
                <ClipboardList size={19} />
                {prepare.question_count} вопросов
              </span>
              <span>
                <Clock3 size={19} />
                {prepare.minutes
                  ? `${prepare.minutes} минут`
                  : "Без ограничения времени"}
              </span>
              <span>
                <Target size={19} />
                {prepare.pass_percent} из 100 баллов для зачёта
              </span>
            </div>
            <p>
              Максимум — 100 баллов. Баллов за правильный ответ:{" "}
              {Number((100 / prepare.question_count).toFixed(2))}.
              Вопросы выбираются случайно для каждой новой попытки.
            </p>
            <h3>Подготовьте рабочее место</h3>
            <p>
              Проверьте соединение, отключите уведомления и закройте лишние
              программы. Ответы автоматически сохраняются, а таймер продолжает
              идти при уходе из вкладки.
            </p>
            {prepare.proctor_mode !== "off" && (
              <div className="notice">
                <ShieldCheck size={22} />
                <span>
                  Фиксируются уходы из вкладки и потеря фокуса.{" "}
                  {prepare.proctor_mode === "block"
                    ? `При ${prepare.proctor_limit} уходах попытка блокируется.`
                    : "События доступны администратору."}
                  {Boolean(prepare.fullscreen) &&
                    " Требуется полноэкранный режим."}
                </span>
              </div>
            )}
            {startError && (
              <p className="form-error" role="alert">
                {startError}
              </p>
            )}
          </div>
          <div className="modal-footer">
            <button
              className="btn secondary"
              onClick={() => setPrepare(null)}
              disabled={busy}
            >
              Отмена
            </button>
            <button
              className="btn primary"
              onClick={() => void start()}
              disabled={busy}
            >
              {busy ? (
                <LoaderCircle className="spin" size={16} />
              ) : (
                <ArrowRight size={16} />
              )}{" "}
              {prepare.active_attempt ? "Продолжить" : "Начать попытку"}
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}
function LibraryIcon() {
  return <ClipboardList size={18} />;
}
export function StudentHistory() {
  const {
    data: results,
    loading,
    error,
    reload,
  } = useData<ResultRow[]>("/student/results");
  const { notify } = useApp();
  return (
    <div className="page student-page">
      <div className="page-heading">
        <div>
          <h1>Мои результаты</h1>
          <p>Ваш прогресс, достижения и документы о результатах.</p>
        </div>
      </div>
      {loading && !results ? (
        <Spinner />
      ) : error ? (
        <ErrorState error={error} retry={reload} />
      ) : results?.length ? (
        <div className="history-list">
          {results.map((r) => (
            <section className="panel history-card" key={r.id}>
              <span
                className={`history-result ${r.passed ? "green" : "orange"}`}
              >
                {r.show_result ? `${r.percent} / 100` : "…"}
              </span>
              <div>
                <h2>{r.test_title}</h2>
                <p>
                  {date(r.finished_at, true)} ·{" "}
                  {r.show_result
                    ? `${r.score} из ${r.total_questions} правильных`
                    : "Результат доступен только администратору"}
                </p>
                <StatusBadge status={r.status} passed={r.passed} />
              </div>
              <button
                className="btn secondary"
                disabled={!r.show_result}
                onClick={() =>
                  void downloadFile(
                    `/student/attempts/${r.id}/certificate`,
                    "Результат-тестирования.pdf",
                  ).catch((e) => notify(e.message))
                }
              >
                <Download size={16} /> Документ PDF
              </button>
            </section>
          ))}
        </div>
      ) : (
        <Empty
          title="Ваша история только начинается"
          text="Завершите первый тест, чтобы увидеть результат. История также может быть отключена настройками теста."
        />
      )}
    </div>
  );
}
export function ExamPage({
  initial,
  onExit,
  onBeforeLeave,
}: {
  initial: Attempt;
  onExit: () => void;
  onBeforeLeave?: (callback: (()=>Promise<void>) | null)=>void;
}) {
  const { user } = useApp();
  const exam = useExam(initial, user.id);
  const [index, setIndex] = useState(0),
    [flagged, setFlagged] = useState<string[]>([]),
    [confirm, setConfirm] = useState(false),
    [busy, setBusy] = useState(false),
    [finishError, setFinishError] = useState(""),
    [recoveryChoices,setRecoveryChoices] = useState<Record<string,'local'|'server'>>({});
  useEffect(()=>{onBeforeLeave?.(exam.flushBeforeExit);return()=>onBeforeLeave?.(null);},[onBeforeLeave,exam.flushBeforeExit]);
  useEffect(()=>setRecoveryChoices({}),[exam.recovery]);
  const a = exam.attempt,
    q = a.questions[index],
    answered = Object.keys(exam.answers).length;
  exam.setPosition(q?.id || "");
  const journalNotice=exam.logTruncated&&<div className="notice warning" role="alert"><span>Достигнут предел серверного журнала контроля. Новые неподтверждённые события сохранены на устройстве; ответы продолжают отправляться.</span><button className="btn secondary" onClick={()=>downloadBlob(new Blob([JSON.stringify({attempt_id:a.id,events:exam.rejectedEvents},null,2)],{type:'application/json'}),`Локальный-журнал-${a.id}.json`)}>Скачать журнал</button></div>;

  if (a.status !== "active")
    return <>{journalNotice}{exam.unconfirmed && <div className="notice warning" role="alert"><span>Часть ответов осталась только на устройстве и не вошла в результат. Сервер принимает ответы до окончания времени. Можно скачать локальную копию для обращения к администратору.</span><button className="btn secondary" onClick={()=>downloadBlob(new Blob([JSON.stringify({attempt_id:a.id,questions:a.questions,local_answers:exam.unconfirmed!.answers,server_answers:a.answers,deadline:a.deadline},null,2)],{type:'application/json'}),`Локальные-ответы-${a.id}.json`)}>Скачать копию</button></div>}<ResultScreen attempt={a} onExit={onExit} /></>;
  const savedLabels: Record<string, string> = {
    saved: "Все ответы сохранены",
    pending: "Ожидают синхронизации",
    saving: "Сохраняем ответы…",
    offline: "Нет сети · сохранено на устройстве",
    error: "Не удалось синхронизировать",
  };
  async function finish() {
    setBusy(true);
    setFinishError("");
    try {
      await exam.finish();
      setConfirm(false);
    } catch (e) {
      setFinishError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="page exam-page">
      {journalNotice}
      <div className="exam-top">
        <div>
          <div className="page-eyebrow">ТЕСТИРОВАНИЕ</div>
          <h1>{a.test_title}</h1>
          <p>
            {user.name} · {user.group_name || "Индивидуальное тестирование"}
          </p>
        </div>
        <div
          className={`exam-timer ${exam.seconds !== null && exam.seconds < 120 ? "urgent" : ""}`}
        >
          <Clock3 size={23} />
          <div>
            <span>Осталось времени</span>
            <strong>
              {exam.seconds === null
                ? a.deadline
                  ? "…"
                  : "Без таймера"
                : `${String(Math.floor(exam.seconds / 60)).padStart(2, "0")}:${String(exam.seconds % 60).padStart(2, "0")}`}
            </strong>
          </div>
        </div>
      </div>
      <div className="exam-save-bar" role="status" aria-live="polite">
        <span className={exam.saveState === "saved" ? "green-text" : ""}>
          {exam.saveState === "saved" ? (
            <CloudCheck size={17} />
          ) : exam.saveState === "offline" ? (
            <CloudOff size={17} />
          ) : (
            <LoaderCircle
              size={17}
              className={exam.saveState === "saving" ? "spin" : ""}
            />
          )}{" "}
          {exam.connecting
            ? "Подключаем попытку…"
            : exam.saveState==='offline'&&!exam.localSafe ? 'Нет сети · ответы только в памяти вкладки' : savedLabels[exam.saveState]}
        </span>
        <span>
          {a.proctor_mode !== "off" ? (
            <>
              <ShieldCheck size={15} /> Контроль включён · Уходов:{" "}
              {a.violation_count}
            </>
          ) : (
            "Базовый режим"
          )}
        </span>
      </div>
      {!exam.localSafe && (
        <div className="notice warning">
          <AlertTriangle size={17} /> Хранилище браузера недоступно. Сохраняем
          ответы на сервере; не закрывайте вкладку до синхронизации.
        </div>
      )}
      {exam.error && (
        <div className="notice warning" role="alert">
          <AlertTriangle size={17} />
          {exam.error}
          <button
            className="text-button"
            onClick={() => void exam.sync().catch(() => {})}
          >
            Повторить
          </button>
        </div>
      )}
      {exam.warning && (
        <div className="notice warning" role="status">
          <ShieldCheck size={20} />
          <span>{exam.warning}</span>
          <button className="text-button" onClick={exam.clearWarning}>
            Понятно
          </button>
        </div>
      )}
      {exam.seconds===0&&<div className="notice" role="alert"><span>Время теста истекло. Ответы больше не принимаются. Результат появится после подтверждения сервером; при потере сети восстановите соединение.</span><button className="btn secondary" disabled={busy} onClick={()=>void finish()}>Обновить результат</button></div>}
      <div className="exam-layout">
        <section className="panel exam-question">
          <div className="exam-question-top">
            <Badge>
              Вопрос {index + 1} из {a.questions.length}
            </Badge>
            <button
              className={`text-button ${flagged.includes(q.id) ? "green-text" : ""}`}
              onClick={() =>
                setFlagged((s) =>
                  s.includes(q.id)
                    ? s.filter((id) => id !== q.id)
                    : [...s, q.id],
                )
              }
            >
              <Flag size={16} />
              {flagged.includes(q.id) ? "Отмечен" : "Вернуться позже"}
            </button>
          </div>
          <h2>{q.text}</h2>
          <p className="question-instruction">
            Выберите один правильный ответ · Баллов за ответ: {Number((100 / a.questions.length).toFixed(2))}
          </p>
          <div className="exam-options">
            {q.options.map((o, i) => (
              <label
                key={o.id}
                className={exam.answers[q.id] === o.id ? "chosen" : ""}
              >
                <input
                  type="radio"
                  name={q.id}
                  checked={exam.answers[q.id] === o.id}
                  disabled={!exam.ready || busy}
                  onChange={() => exam.answer(q.id, o.id)}
                />
                <span className="option-letter">
                  {String.fromCharCode(65 + i)}
                </span>
                <span>{o.text}</span>
                {exam.answers[q.id] === o.id && <CheckCircle2 size={20} />}
              </label>
            ))}
          </div>
          <div className="exam-question-footer">
            <button
              className="btn secondary"
              disabled={index === 0}
              onClick={() => setIndex((i) => i - 1)}
            >
              <ChevronLeft size={17} /> Назад
            </button>
            <span>
              {index + 1} / {a.questions.length}
            </span>
            {index < a.questions.length - 1 ? (
              <button
                className="btn primary"
                onClick={() => setIndex((i) => i + 1)}
              >
                Далее <ChevronRight size={17} />
              </button>
            ) : (
              <button className="btn primary" onClick={() => setConfirm(true)}>
                Завершить <CheckCircle2 size={17} />
              </button>
            )}
          </div>
        </section>
        <aside className="panel exam-navigation">
          <h3>Ваш прогресс</h3>
          <div className="exam-progress-label">
            <strong>
              {answered} из {a.questions.length}
            </strong>
            <span>{Math.round((answered / a.questions.length) * 100)}%</span>
          </div>
          <div className="exam-progress">
            <span
              style={{ width: `${(answered / a.questions.length) * 100}%` }}
            />
          </div>
          <div className="question-grid">
            {a.questions.map((q, i) => (
              <button
                key={q.id}
                aria-label={`Вопрос ${i + 1}${exam.answers[q.id] ? ", отвечен" : ""}${flagged.includes(q.id) ? ", отмечен" : ""}`}
                aria-current={index === i ? "step" : undefined}
                className={`${exam.answers[q.id] ? "answered" : ""} ${i === index ? "current" : ""} ${flagged.includes(q.id) ? "flagged" : ""}`}
                onClick={() => setIndex(i)}
              >
                {i + 1}
              </button>
            ))}
          </div>
          <div className="question-legend">
            <span>
              <i className="legend-answered" /> Ответ сохранён локально
            </span>
            <span>
              <i className="legend-current" /> Текущий вопрос
            </span>
            <span>
              <i className="legend-flagged" /> Вернуться позже
            </span>
          </div>
          <button
            className="btn secondary full-width"
            onClick={() => setConfirm(true)}
            disabled={!exam.ready}
          >
            Завершить тест <ArrowRight size={16} />
          </button>
          <p className="exam-hint">
            <ShieldCheck size={16} /> Сервер подтверждает сохранение и
            рассчитывает итоговый результат.
          </p>
        </aside>
      </div>
      {exam.recovery && exam.seconds!==0 && <Modal title="Сравните восстановленные ответы" description="На устройстве и сервере есть разные варианты. Выберите ответ для каждого вопроса." onClose={onExit} wide>
        <div className="form-body">{exam.recovery.conflicts.map(conflict=>{
          const question=a.questions.find(q=>q.id===conflict.id)!;
          const label=(id?:string)=>question.options.find(o=>o.id===id)?.text||'Нет ответа';
          return <fieldset className="recovery-question" key={conflict.id}><legend>{question.text}</legend>{(['server','local'] as const).map(source=><label key={source}><input type="radio" name={`recovery-${conflict.id}`} checked={(recoveryChoices[conflict.id]||'server')===source} onChange={()=>setRecoveryChoices(old=>({...old,[conflict.id]:source}))}/><span><strong>{source==='server'?'Сохранено на сервере':'На этом устройстве'}</strong>: {label(conflict[source])}</span></label>)}</fieldset>;
        })}{exam.error&&<p className="form-error" role="alert">{exam.error}</p>}</div>
        <div className="modal-footer"><button className="btn primary" disabled={exam.connecting} onClick={()=>void exam.recover(recoveryChoices)}>{exam.connecting?'Восстанавливаем…':'Сохранить выбранные ответы'}</button></div>
      </Modal>}
      {!exam.ready && !exam.connecting && !exam.recovery && exam.seconds!==0 && (
        <Modal
          title={
            a.fullscreen
              ? "Продолжить в полноэкранном режиме"
              : "Подключить попытку"
          }
          description="Начатая попытка сохраняет те же вопросы и ограничения времени."
          onClose={onExit}
        >
          <div className="form-body">
            <div className="notice">
              <ShieldCheck size={22} />
              <span>
                Подключайте тест только в одной вкладке. Это действие завершит
                управление попыткой из других вкладок.{" "}
                {a.fullscreen
                  ? "Для продолжения включите полноэкранный режим."
                  : ""}
              </span>
            </div>
            {exam.error && <p className="form-error">{exam.error}</p>}
          </div>
          <div className="modal-footer">
            <button
              className="btn primary"
              disabled={busy}
              onClick={async () => {
                setBusy(true);
                try {
                  await exam.connect(true);
                } finally {
                  setBusy(false);
                }
              }}
            >
              {busy ? (
                <LoaderCircle className="spin" size={17} />
              ) : a.fullscreen ? (
                <Maximize size={17} />
              ) : (
                <ArrowRight size={17} />
              )}{" "}
              Продолжить тест
            </button>
          </div>
        </Modal>
      )}
      {confirm && (
        <Modal
          title="Завершить тест?"
          description="После подтверждения изменить ответы будет нельзя."
          onClose={() => {
            if (!busy) setConfirm(false);
          }}
        >
          <div className="form-body">
            <div className="finish-summary">
              <div>
                <strong>{answered}</strong>
                <span>отвечено</span>
              </div>
              <div>
                <strong>{a.questions.length - answered}</strong>
                <span>пропущено</span>
              </div>
            </div>
            {a.questions.length > answered && (
              <div className="notice warning">
                <AlertTriangle size={18} /> Пропущенные вопросы будут засчитаны
                как неправильные.
              </div>
            )}
            <p>
              Дождитесь синхронизации ответов. Результат появится после
              подтверждения сервером.
            </p>
            {finishError && (
              <p className="form-error" role="alert">
                {finishError}
              </p>
            )}
          </div>
          <div className="modal-footer">
            <button
              className="btn secondary"
              disabled={busy}
              onClick={() => setConfirm(false)}
            >
              Вернуться к тесту
            </button>
            <button
              className="btn primary"
              disabled={busy}
              onClick={() => void finish()}
            >
              {busy ? (
                <LoaderCircle size={16} className="spin" />
              ) : (
                <CheckCircle2 size={16} />
              )}{" "}
              {busy ? "Сохраняем и проверяем…" : "Завершить тест"}
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}
function ResultScreen({
  attempt: a,
  onExit,
}: {
  attempt: Attempt;
  onExit: () => void;
}) {
  const { notify } = useApp();
  return (
    <div className="page result-screen">
      <div className="result-celebration">
        <span className={`result-symbol ${a.passed ? "green" : "orange"}`}>
          {a.passed ? <CheckCircle2 size={45} /> : <GraduationCap size={45} />}
        </span>
        <Badge tone={a.passed ? "green" : "neutral"}>
          Тестирование завершено
        </Badge>
        <h1>
          {!a.show_result
            ? "Ответы приняты"
            : a.status === "blocked"
              ? "Попытка заблокирована"
              : a.passed
                ? "Отличная работа!"
                : "Следующий шаг к знаниям"}
        </h1>
        <p>{a.test_title}</p>
        <span>
          {a.student_name} · {date(a.finished_at, true)}
        </span>
      </div>
      <section className="panel result-card">
        {a.show_result ? (
          <>
            <div className="result-big-score">
              <strong>
                {a.percent}
                <span>из 100</span>
              </strong>
              <StatusBadge status={a.status} passed={a.passed} />
            </div>
            <div className="result-card-stats">
              <div>
                <strong>
                  {a.score} / {a.questions.length}
                </strong>
                <span>правильных ответов</span>
              </div>
              <div>
                <strong>{a.pass_percent} / 100</strong>
                <span>баллов для зачёта</span>
              </div>
              <div>
                <strong>{a.violation_count}</strong>
                <span>событий ухода</span>
              </div>
            </div>
            {a.status === "expired" && (
              <p className="notice">
                Время истекло. Результат рассчитан по ответам, подтверждённым
                сервером до окончания времени.
              </p>
            )}
            {a.status === "blocked" && (
              <p className="notice warning">
                Достигнут порог событий контроля. За дополнительной попыткой
                обратитесь к администратору.
              </p>
            )}
            <button
              className="btn primary full-width"
              onClick={() =>
                void downloadFile(
                  `/student/attempts/${a.id}/certificate`,
                  "Результат-тестирования.pdf",
                ).catch((e) => notify(e.message))
              }
            >
              <Download size={17} /> Скачать документ с результатом
            </button>
          </>
        ) : (
          <div className="form-body">
            <p>
              Администратор получит результат. Показ оценки отключён настройками
              этого теста.
            </p>
          </div>
        )}
        <button className="btn secondary full-width" onClick={onExit}>
          <ArrowLeft size={16} /> Вернуться в кабинет
        </button>
      </section>
      <p className="result-assurance">
        <CloudCheck size={17} /> Результат сохранён на сервере.
      </p>
    </div>
  );
}
