import type { Draft } from "../shared/exam-sync";
export type ExamCache = Draft;
// Account + attempt scoping prevents another signed-in student from restoring this data.
const key = (user: string, id: string) =>
  `finance-academy:attempt:v1:${user}:${id}`;
export function readCache(user: string, id: string): ExamCache | null {
  try {
    const value = JSON.parse(localStorage.getItem(key(user, id)) || "null");
    return value &&
      Number.isInteger(value.version) &&
      value.version >= 0 && Number.isInteger(value.epoch) &&
      value.answers && typeof value.answers === 'object' && !Array.isArray(value.answers) &&
      Object.values(value.answers).every(a=>typeof a==='string') &&
      Array.isArray(value.events) && value.events.every((e: any)=>e && typeof e.id==='string' && typeof e.kind==='string') &&
      (value.rejectedEvents===undefined||(Array.isArray(value.rejectedEvents)&&value.rejectedEvents.every((e:any)=>e&&typeof e.id==='string'&&typeof e.kind==='string'))) &&
      (value.logTruncated===undefined||typeof value.logTruncated==='boolean') &&
      (value.baseAnswers === undefined || (value.baseAnswers && typeof value.baseAnswers==='object' && !Array.isArray(value.baseAnswers) && Object.values(value.baseAnswers).every(a=>typeof a==='string')))
      ? value
      : null;
  } catch {
    return null;
  }
}
export function writeCache(
  user: string,
  id: string,
  value: ExamCache,
): boolean {
  try {
    localStorage.setItem(key(user, id), JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}
export function clearCache(user: string, id: string) {
  try {
    localStorage.removeItem(key(user, id));
  } catch {
    /* Memory state remains available. */
  }
}
