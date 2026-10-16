import { test, mock } from "node:test";
import assert from "node:assert/strict";
import { api, ApiError } from "../src/api.ts";

test("truncated successful responses reject instead of becoming application data", async () => {
  const fetchMock = mock.method(globalThis, "fetch", async () => new Response('{"id":', { status: 201 }));
  try {
    await assert.rejects(api("/student/start", { test_id: "test" }), (error: unknown) => error instanceof ApiError && error.status === 201 && error.message.includes("полностью загрузить"));
  } finally { fetchMock.mock.restore(); }
});

test("network failures retain a readable error for retry and local recovery", async () => {
  const fetchMock = mock.method(globalThis, "fetch", async () => { throw new DOMException("Timeout", "TimeoutError"); });
  try {
    await assert.rejects(api("/student/attempts/test/save", {}), (error: unknown) => error instanceof ApiError && error.status === 0 && error.message.includes("соединение"));
  } finally { fetchMock.mock.restore(); }
});
