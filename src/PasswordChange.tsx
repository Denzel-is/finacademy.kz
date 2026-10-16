import { useState } from "react";
import { api } from "./api";
import { Field } from "./ui";
export function PasswordChange({
  required = false,
  onDone,
  onCancel,
}: {
  required?: boolean;
  onDone: () => Promise<void>;
  onCancel: () => void;
}) {
  const [current, setCurrent] = useState(""),
    [password, setPassword] = useState(""),
    [confirmation, setConfirmation] = useState(""),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  return (
    <div className="app-loading">
      <section
        className="panel"
        style={{ width: "min(480px, calc(100vw - 32px))" }}
      >
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            setError("");
            if (password !== confirmation) {
              setError("Новые пароли не совпадают.");
              return;
            }
            setBusy(true);
            try {
              await api("/auth/password", { current, password });
              await onDone();
            } catch (e) {
              setError((e as Error).message);
            } finally {
              setBusy(false);
            }
          }}
        >
          <div className="form-body">
            <h1>{required ? "Задайте свой пароль" : "Изменить пароль"}</h1>
            <p>
              {required
                ? "Перед тестированием замените выданный временный пароль."
                : "Введите текущий и новый пароль."}
            </p>
            <Field label={required ? "Временный пароль" : "Текущий пароль"}>
              <input
                required
                type="password"
                autoComplete="current-password"
                value={current}
                onChange={(e) => setCurrent(e.target.value)}
              />
            </Field>
            <Field label="Новый пароль" hint="Не менее 10 символов.">
              <input
                required
                minLength={10}
                maxLength={128}
                type="password"
                autoComplete="new-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </Field>
            <Field label="Повторите новый пароль">
              <input
                required
                minLength={10}
                maxLength={128}
                type="password"
                autoComplete="new-password"
                value={confirmation}
                onChange={(e) => setConfirmation(e.target.value)}
              />
            </Field>
            {error && (
              <p className="form-error" role="alert">
                {error}
              </p>
            )}
          </div>
          <div className="modal-footer">
            <button
              type="button"
              className="btn secondary"
              disabled={busy}
              onClick={onCancel}
            >
              {required ? "Выйти" : "Отмена"}
            </button>
            <button className="btn primary" disabled={busy}>
              {busy ? "Сохраняем…" : "Сохранить пароль"}
            </button>
          </div>
        </form>
      </section>
    </div>
  );
}
