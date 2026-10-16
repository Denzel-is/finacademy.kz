// Adapted from CenterTest/lib/test-proctor.ts. One departure is one event,
// even when blur, visibilitychange and fullscreenchange fire together.
import type { ProctorEvent, ProctorKind } from "./types.ts";
export const PROCTOR_LABELS: Record<ProctorKind, string> = {
  focus: "Потеря фокуса",
  hidden: "Вкладка скрыта",
  fullscreen: "Выход из полноэкранного режима",
  reload: "Открытие / обновление страницы",
  offline: "Соединение потеряно",
};
export class FocusEpisodes {
  private current: ProctorEvent | null = null;
  constructor(
    private emit: (event: ProctorEvent) => void,
    private id: () => string,
    private now: () => number,
  ) {}
  change(kind: "focus" | "hidden" | "fullscreen", inside: boolean) {
    if (!inside && !this.current) {
      this.current = {
        id: this.id(),
        kind,
        occurredAt: new Date(this.now()).toISOString(),
      };
      this.emit({ ...this.current });
    } else if (inside && this.current) {
      const event = this.current;
      this.current = null;
      this.emit({
        ...event,
        returnedAt: new Date(this.now()).toISOString(),
        durationMs: Math.max(0, this.now() - Date.parse(event.occurredAt)),
      });
    }
  }
}
export function normalizeEvent(
  value: unknown,
  now = Date.now(),
): ProctorEvent | null {
  if (!value || typeof value !== "object") return null;
  const row = value as ProctorEvent;
  if (
    typeof row.id !== "string" ||
    !/^[a-f\d-]{36}$/i.test(row.id) ||
    !Object.hasOwn(PROCTOR_LABELS, row.kind)
  )
    return null;
  const start = Date.parse(row.occurredAt);
  if (!Number.isFinite(start)) return null;
  const timestamp = Math.max(now - 86400000, Math.min(now, start));
  const end = Date.parse(row.returnedAt || "");
  return {
    id: row.id,
    kind: row.kind,
    occurredAt: new Date(timestamp).toISOString(),
    returnedAt: Number.isFinite(end)
      ? new Date(Math.max(timestamp, Math.min(now, end))).toISOString()
      : undefined,
    durationMs: Math.max(
      0,
      Math.min(86400000, Math.floor(Number(row.durationMs) || 0)),
    ),
    questionCode: String(row.questionCode || "").slice(0, 100),
  };
}
