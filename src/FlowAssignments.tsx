import { useEffect, useRef, useState } from "react";
import { Check, ClipboardList } from "lucide-react";
import type { Test } from "../shared/types";
import { api } from "./api";
import { useApp } from "./app-context";
import { useData } from "./useData";
import { CredentialDelivery } from "./CredentialDelivery";
import { Field, Spinner, ErrorState } from "./ui";
import "./FlowAssignments.css";
import {
  buildFlowAssignmentPlans,
  sendFlowAssignmentPlans,
} from "./flow-assignment-plan";

export type FlowCredential = {
  name: string;
  login: string;
  password: string;
  group?: string;
};
type Selection = {
  minutes: string;
  attempts: string;
  status: "idle" | "saving" | "saved" | "error";
  error?: string;
};

export function FlowAssignmentPanel({
  group,
  credentials,
  onClose,
  onBusyChange,
}: {
  group: { id: string; name: string; student_count: number };
  credentials?: FlowCredential[];
  onClose: () => void;
  onBusyChange?: (busy: boolean) => void;
}) {
  const { settings } = useApp();
  const timeZone = settings.timezone || "Asia/Almaty";
  const { data: tests, loading, error: loadError, reload } = useData<Test[]>("/admin/tests");
  const [selected, setSelected] = useState<Record<string, Selection>>({});
  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [summary, setSummary] = useState("");
  const submitting = useRef(false);
  const heading = useRef<HTMLHeadingElement>(null);
  const published = (tests || []).filter((test) => test.published);
  const entries = Object.entries(selected);
  const savedCount = entries.filter(([, row]) => row.status === "saved").length;
  const remaining = entries.filter(([, row]) => row.status !== "saved");
  const failedCount = entries.filter(([, row]) => row.status === "error").length;
  useEffect(() => { heading.current?.focus(); }, []);

  function toggle(test: Test) {
    if (submitting.current || selected[test.id]?.status === "saved") return;
    setError("");
    setSummary("");
    setSelected((old) => {
      const next = { ...old };
      if (next[test.id]) delete next[test.id];
      else next[test.id] = {
        minutes: String(test.minutes || 60),
        attempts: String(test.max_attempts || 1),
        status: "idle",
      };
      return next;
    });
  }

  function edit(testId: string, field: "minutes" | "attempts", value: string) {
    setError("");
    setSummary("");
    setSelected((old) => ({
      ...old,
      [testId]: { ...old[testId], [field]: value, status: "idle", error: undefined },
    }));
  }

  async function submit() {
    if (submitting.current) return;
    setError("");
    setSummary("");
    let plans;
    try {
      plans = buildFlowAssignmentPlans(
        group.id,
        remaining.map(([testId, row]) => ({
          test_id: testId,
          minutes: Number(row.minutes),
          max_attempts: Number(row.attempts),
        })),
        start,
        end,
        timeZone,
      );
    } catch (error) {
      setError((error as Error).message);
      return;
    }
    submitting.current = true;
    setBusy(true);
    onBusyChange?.(true);
    try {
      const result = await sendFlowAssignmentPlans(
        plans,
        (plan) => api("/admin/assignments", plan),
        (testId, status, rowError) => setSelected((old) => ({
          ...old,
          [testId]: { ...old[testId], status, error: rowError },
        })),
      );
      setSummary(
        result.failed
          ? `Выдан доступ к ${result.saved} тестам. Не удалось назначить: ${result.failed}. Исправьте отмеченные строки и повторите.`
          : `Доступ выдан ко всем выбранным тестам. Студентов в потоке: ${group.student_count}.`,
      );
    } finally {
      submitting.current = false;
      setBusy(false);
      onBusyChange?.(false);
    }
  }


  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        void submit();
      }}
      className="flow-assignment-wizard"
      aria-busy={busy}
    >
      <div className="form-body">
        {credentials && (
          <ol className="flow-wizard-steps" aria-label="Подготовка потока">
            <li className="complete"><Check size={15} /> Студенты созданы</li>
            <li className={savedCount && !remaining.length ? "complete" : "current"} aria-current={remaining.length || !savedCount ? "step" : undefined}><ClipboardList size={15} /> Доступ к тестам</li>
            <li>Таблица доступов</li>
          </ol>
        )}
        <h3 className="flow-wizard-heading" tabIndex={-1} ref={heading}>Тесты для потока «{group.name}»</h3>
        <div className="notice">
          <span>
            <strong>{group.name}</strong> · {group.student_count} студентов.
            Выберите нужные тесты: доступ получит весь поток. Для каждого теста можно задать своё время.
          </span>
        </div>
        {loading ? <Spinner /> : loadError ? (
          <ErrorState error={loadError} retry={reload} />
        ) : !published.length ? (
          <p className="muted">Опубликованных тестов пока нет. Поток уже создан; назначить тесты можно позже.</p>
        ) : (
          <>
            <fieldset className="form-fields flow-test-choices" disabled={busy}>
              <legend>Тесты для потока</legend>
              {published.map((test) => {
                const row = selected[test.id];
                const saved = row?.status === "saved";
                return (
                  <section className={`flow-test-choice ${row ? "selected" : ""}`} key={test.id}>
                    <label className="flow-test-choice-heading">
                      <input
                        type="checkbox"
                        checked={Boolean(row)}
                        disabled={saved}
                        onChange={() => toggle(test)}
                      />
                      <span><strong>{test.title}</strong><small>{test.question_count} вопросов · проходной балл {test.pass_percent} из 100</small></span>
                      {saved && <span className="flow-assignment-saved"><Check size={15} /> Доступ выдан</span>}
                    </label>
                    {row && (
                      <div className="flow-test-choice-settings">
                        <Field label={`Время, минут · ${test.title}`}>
                          <input type="number" required min={1} max={240} step={1} value={row.minutes} disabled={saved} onChange={(event) => edit(test.id, "minutes", event.target.value)} />
                        </Field>
                        <Field label={`Всего попыток · ${test.title}`}>
                          <input type="number" required min={1} max={20} step={1} value={row.attempts} disabled={saved} onChange={(event) => edit(test.id, "attempts", event.target.value)} />
                        </Field>
                        {row.status === "saving" && <p className="muted" role="status">Выдаём доступ…</p>}
                        {row.error && <p className="form-error" role="alert">{row.error}</p>}
                      </div>
                    )}
                  </section>
                );
              })}
            </fieldset>
            <fieldset className="form-fields" disabled={busy || savedCount > 0}>
              <legend>Общий период доступа</legend>
              <div className="form-grid two">
                <Field label="Доступ с" hint="Пусто — сразу после назначения."><input type="datetime-local" value={start} onChange={(event) => setStart(event.target.value)} /></Field>
                <Field label="Доступ до" hint="Пусто — без общей даты окончания."><input type="datetime-local" value={end} onChange={(event) => setEnd(event.target.value)} /></Field>
              </div>
            </fieldset>
            <p className="muted">Время организации: {timeZone}. Таймер запускается при старте попытки; конец периода доступа может завершить её раньше. Лимит попыток включает уже использованные.</p>
            {savedCount > 0 && <p className="muted">Успешные назначения сохранены. Для изменения их расписания откройте «Назначения».</p>}
          </>
        )}
        {failedCount > 0 && (
          <div className="notice">
            <span>При обрыве связи назначение могло сохраниться. Повторение обновит доступ к тому же тесту без дубликатов. Уже подтверждённые назначения повторно не отправляются.</span>
          </div>
        )}
        {summary && <p className={failedCount ? "form-error" : "flow-assignment-success"} role="status" aria-live="polite">{summary}</p>}
        {credentials && <CredentialDelivery credentials={credentials} organizationName={settings.academy_name} title={`Доступы потока «${group.name}»`}/>}
        {error && <p className="form-error" role="alert">{error}</p>}
      </div>
      <div className="modal-footer">
        <button type="button" className="btn secondary" disabled={busy} onClick={() => { if (!submitting.current) onClose(); }}>
          {savedCount && !remaining.length ? "Готово" : failedCount ? "Закрыть мастер" : credentials ? "Назначить позже" : "Закрыть"}
        </button>
        {published.length > 0 && <button type="submit" className="btn primary" disabled={busy || !remaining.length}>
          {busy ? "Выдаём доступ…" : failedCount ? `Повторить неуспешные · ${remaining.length}` : `Выдать доступ · ${remaining.length} тестов`}
        </button>}
      </div>
    </form>
  );
}
