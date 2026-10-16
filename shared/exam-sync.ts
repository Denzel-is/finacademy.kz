import type { Answers, Attempt, ProctorEvent } from './types.ts';
export type Draft = {
  version: number;
  answers: Answers;
  events: ProctorEvent[];
  epoch: number;
  baseVersion?: number;
  baseAnswers?: Answers;
  rejectedEvents?: ProctorEvent[];
  logTruncated?: boolean;
};
export type AnswerConflict = { id: string; local: string; server?: string };
export function reconcileDraft(saved: Draft | null, server: Attempt) {
  const answers = {...server.answers};
  const conflicts: AnswerConflict[] = [];
  const valid = saved?.epoch === server.proctor_epoch;
  const allowed = new Map(server.questions.map(q=>[q.id,new Set(q.options.map(o=>o.id))]));
  if (valid && saved) for (const [id,local] of Object.entries(saved.answers)) {
    if (!allowed.get(id)?.has(local)) continue;
    const base = saved.baseAnswers?.[id];
    // A known acknowledged answer is not a local edit. Legacy drafts use the
    // server as baseline only if no newer server version could have diverged.
    if (saved.baseAnswers && local === base) continue;
    if (!saved.baseAnswers && saved.version <= server.version) continue;
    const remote = server.answers[id];
    if (remote === local) continue;
    if ((saved.baseAnswers && remote === base) || (!saved.baseAnswers && server.version === 0)) answers[id]=local;
    else conflicts.push({id,local,server:remote});
  }
  return {answers,conflicts,events:valid ? saved!.events : []};
}
export function draftFromServer(server: Attempt, answers: Answers, events: ProctorEvent[] = []): Draft {
  const changed = Object.entries(answers).some(([id,value])=>server.answers[id]!==value);
  return {version:server.version+Number(changed),answers,events,epoch:server.proctor_epoch,baseVersion:server.version,baseAnswers:{...server.answers}};
}
export const SAVE_DELAY_MS = 2000;
export const IDLE_HEARTBEAT_MS = 30000;
export function syncAction(dirty: boolean, hasEvents: boolean, now: number, heartbeatAt: number) {
  return dirty ? 'save' : hasEvents ? 'events' : now >= heartbeatAt ? 'lease' : null;
}
