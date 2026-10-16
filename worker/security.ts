const encoder = new TextEncoder();
export const PASSWORD_ITERATIONS = 600000;
export const passwordNeedsUpgrade = (stored: string) => stored.startsWith("pbkdf2$100000$");
const hex = (bytes: ArrayBuffer | Uint8Array) =>
  Array.from(
    bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes),
  )
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
export async function digest(value: string) {
  return hex(await crypto.subtle.digest("SHA-256", encoder.encode(value)));
}
export async function hashPassword(
  password: string,
  salt: string = crypto.randomUUID(),
) {
  return derivePassword(password, salt, PASSWORD_ITERATIONS);
}
async function derivePassword(password: string, salt: string, iterations: number) {
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(password),
    "PBKDF2",
    false,
    ["deriveBits"],
  );
  const bits = await crypto.subtle.deriveBits(
    {
      name: "PBKDF2",
      hash: "SHA-256",
      salt: encoder.encode(salt),
      iterations,
    },
    key,
    256,
  );
  return `pbkdf2$${iterations}$${salt}$${hex(bits)}`;
}
export async function verifyPassword(password: string, stored: string) {
  const [algorithm, iterations, salt, expected, extra] = stored.split("$");
  // Only supported work factors may come from storage; never run attacker-sized work.
  if (algorithm !== "pbkdf2" || !["100000", String(PASSWORD_ITERATIONS)].includes(iterations) || !salt || salt.length > 64 || !/^[a-f\d]{64}$/.test(expected || "") || extra !== undefined)
    return false;
  const actual = (await derivePassword(password, salt, Number(iterations))).split("$")[3];
  if (actual.length !== expected.length) return false;
  let diff = 0;
  for (let i = 0; i < actual.length; i++)
    diff |= actual.charCodeAt(i) ^ expected.charCodeAt(i);
  return diff === 0;
}
export function randomPassword() {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789";
  const cutoff = 256 - (256 % alphabet.length);
  let result = "";
  while (result.length < 16) {
    for (const byte of crypto.getRandomValues(new Uint8Array(32))) {
      if (byte < cutoff) result += alphabet[byte % alphabet.length];
      if (result.length === 16) break;
    }
  }
  return result;
}
export function uniquePassword(issued: Set<string>) {
  let password: string;
  do { password = randomPassword(); } while (issued.has(password));
  issued.add(password);
  return password;
}
export async function mapConcurrent<T, R>(rows: T[], task: (row: T) => Promise<R>, concurrency = 4): Promise<R[]> {
  const result = new Array<R>(rows.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(concurrency, rows.length) }, async () => {
    while (next < rows.length) {
      const index = next++;
      result[index] = await task(rows[index]);
    }
  }));
  return result;
}
export async function temporaryCredentials<T extends object>(rows: T[]) {
  const issued = new Set<string>();
  return mapConcurrent(rows.map(row => ({ ...row, password: uniquePassword(issued) })), async row => ({ ...row, hash: await hashPassword(row.password) }));
}
export function randomToken() {
  return hex(crypto.getRandomValues(new Uint8Array(32)));
}
