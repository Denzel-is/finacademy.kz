export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message);
  }
}
const reads = new Map<string, Promise<unknown>>();
let sessionGeneration = 0;
export function api<T = any>(
  path: string,
  data?: unknown,
  method?: string,
): Promise<T> {
  const verb = method || (data === undefined ? "GET" : "POST");
  if (verb === "GET") {
    const existing = reads.get(path);
    if (existing) return existing as Promise<T>;
    const request = send<T>(path, data, verb, sessionGeneration).finally(() => {
      if (reads.get(path) === request) reads.delete(path);
    });
    reads.set(path, request);
    return request;
  }
  // Deduplicate only overlapping reads. Never cache results or retry writes:
  // a lost response does not prove that a mutation failed on the server.
  reads.clear();
  if (["/auth/login", "/auth/logout", "/auth/password"].includes(path)) sessionGeneration++;
  return send<T>(path, data, verb, sessionGeneration).finally(() => reads.clear());
}
async function send<T>(path: string, data: unknown, method: string, generation: number): Promise<T> {
  const response = await fetch(`/api${path}`, {
    method,
    credentials: "same-origin",
    headers:
      data === undefined ? undefined : { "Content-Type": "application/json" },
    body: data === undefined ? undefined : JSON.stringify(data),
    signal: AbortSignal.timeout(30000),
  }).catch(() => {
    throw new ApiError("Нет ответа от сервера. Проверьте соединение и повторите запрос.", 0);
  });
  let value: any;
  try {
    value = await response.json();
  } catch {
    throw new ApiError("Не удалось полностью загрузить ответ сервера. Повторите запрос.", response.status);
  }
  if (!response.ok) {
    if (response.status === 401 && path !== "/auth/login" && generation === sessionGeneration)
      window.dispatchEvent(new Event("fa-session-expired"));
    throw new ApiError(
      value.error || "Не удалось выполнить запрос.",
      response.status,
    );
  }
  return value;
}
export function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
export async function downloadFile(path: string, filename: string) {
  const response = await fetch(`/api${path}`);
  if (!response.ok) {
    const value: any = await response.json();
    throw new Error(value.error || "Не удалось скачать файл.");
  }
  downloadBlob(await response.blob(), filename);
}
