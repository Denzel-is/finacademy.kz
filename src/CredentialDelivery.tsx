import { useRef, useState } from "react";
import { Copy, Download, Printer } from "lucide-react";
import { credentialsExcel } from "./excel";
import {
  canDeliverCredential,
  credentialAccessUrl,
  credentialUnavailableReason,
  formatCredentialMessage,
  type DeliveryCredential,
  type IssuedCredential,
} from "./credential-delivery";
import "./CredentialDelivery.css";

const PRINT_STYLES = `
  @page { size: A4; margin: 12mm; }
  * { box-sizing: border-box; }
  body { margin: 24px; color: #17251f; font: 14px/1.5 Arial, sans-serif; }
  h1 { margin: 0 0 8px; font-size: 22px; }
  .print-hint { margin: 0 0 24px; color: #526158; }
  .credential-cards { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; }
  .credential-card { border: 1px dashed #82958a; border-radius: 8px; padding: 20px; break-inside: avoid; }
  h2 { margin: 0 0 12px; font-size: 17px; }
  p { margin: 8px 0; overflow-wrap: anywhere; }
  .credential-value { font-weight: bold; }
  .credential-password { font: bold 18px/1.5 Consolas, monospace; letter-spacing: 0.03em; }
  .card-note { color: #526158; font-size: 12px; margin-top: 14px; }
  a { color: inherit; text-decoration: none; }
  @media print { body { margin: 0; } .print-hint { display: none; } }
`;

function printCredentialCards(rows: IssuedCredential[], accessUrl: string, organizationName?: string) {
  const popup = window.open("about:blank", "_blank", "popup=yes,width=980,height=800");
  if (!popup) throw new Error("Браузер заблокировал окно печати. Разрешите всплывающие окна для этого сайта и повторите.");
  popup.opener = null;
  const doc = popup.document;
  doc.documentElement.lang = "ru";
  const meta = doc.createElement("meta");
  meta.setAttribute("charset", "utf-8");
  const title = doc.createElement("title");
  title.textContent = "Карточки доступа · finacademy.kz";
  const style = doc.createElement("style");
  style.textContent = PRINT_STYLES;
  doc.head.replaceChildren(meta, title, style);
  const heading = doc.createElement("h1");
  heading.textContent = organizationName || "Карточки доступа к тестированию";
  const hint = doc.createElement("p");
  hint.className = "print-hint";
  hint.textContent = `Карточек: ${rows.length}. Передайте каждому студенту только его карточку. Окно можно закрыть после печати.`;
  const cards = doc.createElement("main");
  cards.className = "credential-cards";
  for (const row of rows) {
    const card = doc.createElement("section");
    card.className = "credential-card";
    const name = doc.createElement("h2");
    name.textContent = row.name || row.login;
    card.appendChild(name);
    const add = (label: string, value: string, className?: string) => {
      const paragraph = doc.createElement("p");
      paragraph.appendChild(doc.createTextNode(`${label}: `));
      const text = doc.createElement("span");
      text.className = className || "credential-value";
      text.textContent = value;
      paragraph.appendChild(text);
      card.appendChild(paragraph);
    };
    if (row.group) add("Поток", row.group);
    add("Адрес", accessUrl);
    add("Логин", row.login);
    add("Временный пароль", row.password, "credential-password");
    const note = doc.createElement("p");
    note.className = "card-note";
    note.textContent = "При первом входе замените временный пароль своим. Сохраните новый пароль и не передавайте его другим.";
    card.appendChild(note);
    cards.appendChild(card);
  }
  doc.body.replaceChildren(heading, hint, cards);
  popup.focus();
  popup.requestAnimationFrame(() => popup.print());
}

export function CredentialDelivery({
  credentials,
  title = "Доступы студентов",
  organizationName,
  siteUrl = "https://finacademy.kz/",
}: {
  credentials: DeliveryCredential[];
  title?: string;
  organizationName?: string;
  siteUrl?: string;
}) {
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [status, setStatus] = useState("");
  const running = useRef(false);
  const issued = credentials.filter(canDeliverCredential);

  async function action(key: string, perform: () => Promise<void>, message: string) {
    if (running.current) return;
    running.current = true;
    setBusy(key);
    setError("");
    setStatus("");
    try {
      await perform();
      setStatus(message);
    } catch (error) {
      setError(error instanceof Error ? error.message : "Не удалось подготовить доступы.");
    } finally {
      running.current = false;
      setBusy("");
    }
  }

  function copy(rows: IssuedCredential[], key: string) {
    void action(key, async () => {
      if (!navigator.clipboard?.writeText)
        throw new Error("Копирование недоступно в этом браузере. Скачайте Excel или скопируйте строку таблицы вручную.");
      const text = rows.map((row) => formatCredentialMessage(row, siteUrl, organizationName)).join("\n\n──────────\n\n");
      await navigator.clipboard.writeText(text);
    }, rows.length === 1 ? `Доступ для ${rows[0].name || rows[0].login} скопирован.` : `Скопировано доступов: ${rows.length}.`);
  }

  function print() {
    if (running.current) return;
    setError("");
    setStatus("");
    try {
      printCredentialCards(issued, credentialAccessUrl(siteUrl), organizationName);
      setStatus(`Открыто окно печати. Карточек: ${issued.length}.`);
    } catch (error) {
      setError(error instanceof Error ? error.message : "Не удалось открыть окно печати.");
    }
  }

  return (
    <section className="credential-delivery" aria-busy={Boolean(busy)}>
      <div className="credential-delivery-heading">
        <h3>{title} <span className="heading-count">{credentials.length}</span></h3>
        <span className="muted">Пароли для передачи: {issued.length}</span>
      </div>
      {issued.length > 0 ? (
        <>
          <p className="credential-delivery-hint">У каждого студента свой временный пароль. Скачайте доступы сейчас: после закрытия они не выдаются повторно. Передайте каждому только его строку или карточку.</p>
          <div className="credential-delivery-actions">
            <button type="button" className="btn secondary" disabled={Boolean(busy)} onClick={() => void action("excel", async () => { await credentialsExcel(issued); }, `Подготовлен Excel: ${issued.length} доступов.`)}><Download size={16} /> {busy === "excel" ? "Готовим файл…" : "Скачать Excel"}</button>
            <button type="button" className="btn secondary" disabled={Boolean(busy)} onClick={() => copy(issued, "all")}><Copy size={16} /> {busy === "all" ? "Копируем…" : "Скопировать все"}</button>
            <button type="button" className="btn secondary" disabled={Boolean(busy)} onClick={print}><Printer size={16} /> Печать карточек</button>
          </div>
        </>
      ) : <p className="credential-delivery-hint">Действующие пароли не отображаются повторно. Выделите нужных студентов и сбросьте пароли — появится новая таблица для передачи.</p>}
      {status && <p className="credential-delivery-status" role="status" aria-live="polite">{status}</p>}
      {error && <p className="form-error" role="alert">{error}</p>}
      <div className="table-scroll">
        <table>
          <thead><tr><th>ФИО / поток</th><th>Логин</th><th>Временный пароль</th><th><span className="visually-hidden">Передать доступ</span></th></tr></thead>
          <tbody>{credentials.map((row, index) => (
            <tr key={`${row.login}-${index}`}>
              <td><strong>{row.name || row.login}</strong>{row.group && <small className="credential-delivery-group">{row.group}</small>}</td>
              <td>{row.login}</td>
              <td>{canDeliverCredential(row) ? <code className="credential-delivery-password">{row.password}</code> : <small className="credential-delivery-unavailable">{credentialUnavailableReason(row)} Выделите студента и сбросьте пароль.</small>}</td>
              <td>{canDeliverCredential(row) && <button type="button" className="btn secondary credential-delivery-copy" disabled={Boolean(busy)} aria-label={`Скопировать доступ: ${row.name || row.login}`} onClick={() => copy([row], `row-${index}`)}><Copy size={15} /><span>{busy === `row-${index}` ? "Копируем…" : "Скопировать"}</span></button>}</td>
            </tr>
          ))}</tbody>
        </table>
      </div>
    </section>
  );
}
