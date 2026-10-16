import { HTTPException } from "hono/http-exception";

export const REQUEST_LIMITS = { auth: 4096, standard: 2 * 1024 * 1024, import: 8 * 1024 * 1024 };

// Count actual streamed bytes, even if Content-Length is absent or inaccurate.
// Stop reading immediately on overflow rather than allocating an unlimited text.
export async function boundedRequest(request: Request, limit: number): Promise<Request> {
  const declared = request.headers.get("Content-Length");
  if (declared !== null && (!/^\d+$/.test(declared) || Number(declared) > limit))
    throw new HTTPException(413, { message: "Слишком большой запрос. Разделите данные на меньшие части." });
  if (!request.body) return request;
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > limit) {
        void reader.cancel().catch(() => {});
        throw new HTTPException(413, { message: "Слишком большой запрос. Разделите данные на меньшие части." });
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  return new Request(request, {
    body: new ReadableStream({ start(controller) { for (const chunk of chunks) controller.enqueue(chunk); controller.close(); } }),
    duplex: "half",
  } as RequestInit);
}
