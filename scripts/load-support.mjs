import { readFileSync } from "node:fs";
export const base =
  process.env.BASE_URL || "https://finacademy.kz";
export function client() {
  let cookie = "";
  return async (path, data, method) => {
    const res = await fetch(`${base}/api${path}`, {
      method: method || (data === undefined ? "GET" : "POST"),
      headers: {
        ...(data === undefined ? {} : { "Content-Type": "application/json" }),
        ...(cookie ? { Cookie: cookie } : {}),
      },
      body: data === undefined ? undefined : JSON.stringify(data),
      signal: AbortSignal.timeout(60000),
    });
    const value = await res
      .json()
      .catch(() => ({ error: "Non-JSON response" }));
    if (!res.ok)
      throw new Error(`${path}: HTTP ${res.status} ${value.error || ""}`);
    const session = res.headers.get("set-cookie");
    if (session) cookie = session.split(";")[0];
    return value;
  };
}
export async function administrator() {
  const admin = client();
  const secrets = JSON.parse(readFileSync(".local/seed-state.json", "utf8"));
  await admin("/auth/login", {
    login: secrets.adminLogin || "admin",
    password: secrets.adminPassword,
  });
  return admin;
}
