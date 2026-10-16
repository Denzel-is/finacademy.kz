import { useEffect, useState } from "react";
import {
  ArrowLeft,
  ArrowRight,
  CheckCircle2,
  ClipboardList,
  RotateCcw,
} from "lucide-react";
import { api } from "./api";
import { Badge, ErrorState, Spinner } from "./ui";
import type { Answers, BankQuestion, Test } from "../shared/types";

function shuffled<T>(items: T[]) {
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = crypto.getRandomValues(new Uint32Array(1))[0] % (i + 1);
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}
export function TestPreview({
  test,
  onExit,
}: {
  test: Test;
  onExit: () => void;
}) {
  const [questions, setQuestions] = useState<BankQuestion[] | null>(null),
    [error, setError] = useState(""),
    [index, setIndex] = useState(0),
    [answers, setAnswers] = useState<Answers>({}),
    [done, setDone] = useState(false),
    [revision, setRevision] = useState(0);
  useEffect(() => {
    let active = true;
    setQuestions(null);
    setError("");
    setIndex(0);
    setAnswers({});
    setDone(false);
    api<BankQuestion[]>(
      `/admin/questions?test_id=${encodeURIComponent(test.id)}`,
    )
      .then((bank) => {
        const available = bank.filter((q) => !q.archived);
        if (available.length < test.question_count)
          throw new Error(
            `Для прохождения добавьте минимум ${test.question_count} активных вопросов.`,
          );
        if (active)
          setQuestions(
            shuffled(available)
              .slice(0, test.question_count)
              .map((q) => ({ ...q, options: shuffled(q.options) })),
          );
      })
      .catch((e) => {
        if (active) setError(e.message);
      });
    return () => {
      active = false;
    };
  }, [test.id, test.question_count, revision]);
  const back = (
    <button className="btn secondary" onClick={onExit}>
      <ArrowLeft size={16} /> К списку тестов
    </button>
  );
  if (error)
    return (
      <div className="page">
        {back}
        <ErrorState error={error} retry={() => setRevision((v) => v + 1)} />
      </div>
    );
  if (!questions)
    return (
      <div className="page">
        {back}
        <Spinner />
      </div>
    );
  const q = questions[index],
    answered = Object.keys(answers).length,
    score = questions.filter((q) => answers[q.id] === q.correct_id).length,
    percent = Math.round((score / questions.length) * 10000) / 100,
    passed = score * 100 >= questions.length * test.pass_percent;
  return (
    <div className="page exam-page">
      <div className="page-heading">
        <div>
          <div className="page-eyebrow">ПРОБНОЕ ПРОХОЖДЕНИЕ</div>
          <h1>{test.title}</h1>
          <p>Проверьте вопросы и оценку перед назначением студентам.</p>
        </div>
        {back}
      </div>
      <div className="notice">
        <ClipboardList size={20} />
        <span>
          Вы проходите тест как администратор. Эта проверка не расходует попытки
          студентов и не попадает в их результаты.
        </span>
      </div>
      {done ? (
        <section className="panel preview-result">
          <Badge tone={passed ? "green" : "orange"}>
            {passed ? "Сдал" : "Не сдал"}
          </Badge>
          <h2>Пробное прохождение завершено</h2>
          <strong className="preview-score">{percent} / 100</strong>
          <p>
            Правильных ответов: {score} из {questions.length}. Проходной порог:{" "}
            {test.pass_percent} из 100 баллов.
          </p>
          <div className="button-group">
            <button
              className="btn primary"
              onClick={() => setRevision((v) => v + 1)}
            >
              <RotateCcw size={16} /> Пройти ещё раз
            </button>
            {back}
          </div>
        </section>
      ) : (
        <div className="exam-layout">
          <section className="panel exam-question">
            <div className="exam-question-top">
              <Badge>
                Вопрос {index + 1} из {questions.length}
              </Badge>
              <span className="muted">Один правильный ответ</span>
            </div>
            <h2>{q.text}</h2>
            <div className="exam-options">
              {q.options.map((o, i) => (
                <label
                  key={o.id}
                  className={answers[q.id] === o.id ? "chosen" : ""}
                >
                  <input
                    type="radio"
                    name={`preview-${q.id}`}
                    checked={answers[q.id] === o.id}
                    onChange={() => setAnswers((a) => ({ ...a, [q.id]: o.id }))}
                  />
                  <span className="option-letter">
                    {String.fromCharCode(65 + i)}
                  </span>
                  <span>{o.text}</span>
                  {answers[q.id] === o.id && <CheckCircle2 size={20} />}
                </label>
              ))}
            </div>
            <div className="exam-question-footer">
              <button
                className="btn secondary"
                disabled={index === 0}
                onClick={() => setIndex((i) => i - 1)}
              >
                <ArrowLeft size={16} /> Назад
              </button>
              <span>
                {index + 1} / {questions.length}
              </span>
              {index < questions.length - 1 ? (
                <button
                  className="btn primary"
                  onClick={() => setIndex((i) => i + 1)}
                >
                  Далее <ArrowRight size={16} />
                </button>
              ) : (
                <button className="btn primary" onClick={() => setDone(true)}>
                  Завершить тест
                </button>
              )}
            </div>
          </section>
          <aside className="panel exam-navigation">
            <h3>Ваш прогресс</h3>
            <p>
              {answered} из {questions.length} отвечено
            </p>
            <div className="question-grid">
              {questions.map((q, i) => (
                <button
                  key={q.id}
                  aria-label={`Вопрос ${i + 1}${answers[q.id] ? ", отвечен" : ""}`}
                  aria-current={i === index ? "step" : undefined}
                  className={`${answers[q.id] ? "answered" : ""} ${i === index ? "current" : ""}`}
                  onClick={() => setIndex(i)}
                >
                  {i + 1}
                </button>
              ))}
            </div>
            <button
              className="btn primary full-width"
              onClick={() => setDone(true)}
            >
              Завершить тест <CheckCircle2 size={16} />
            </button>
            <p className="exam-hint">
              Пропущенные вопросы считаются неправильными.
            </p>
          </aside>
        </div>
      )}
    </div>
  );
}
