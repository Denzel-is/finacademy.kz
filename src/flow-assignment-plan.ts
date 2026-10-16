import { organizationInstant } from "../shared/time.ts";

export type FlowTestSelection = {
  test_id: string;
  minutes: number;
  max_attempts: number;
};
export type FlowAssignmentPlan = FlowTestSelection & {
  group_ids: string[];
  user_ids: string[];
  starts_at: string | null;
  ends_at: string | null;
};

export function buildFlowAssignmentPlans(
  groupId: string,
  selected: FlowTestSelection[],
  start: string,
  end: string,
  timeZone: string,
): FlowAssignmentPlan[] {
  if (!groupId || !selected.length)
    throw new Error("Выберите хотя бы один тест для потока.");
  const startsAt = start ? organizationInstant(start, timeZone) : null;
  const endsAt = end ? organizationInstant(end, timeZone) : null;
  if (startsAt && endsAt && endsAt <= startsAt)
    throw new Error("Окончание доступа должно быть позже начала.");
  const unique = new Set<string>();
  return selected.map((row) => {
    if (!row.test_id || unique.has(row.test_id))
      throw new Error("Каждый тест можно выбрать только один раз.");
    unique.add(row.test_id);
    if (!Number.isInteger(row.minutes) || row.minutes < 1 || row.minutes > 240)
      throw new Error("Время каждого теста: целое число от 1 до 240 минут.");
    if (
      !Number.isInteger(row.max_attempts) ||
      row.max_attempts < 1 ||
      row.max_attempts > 20
    )
      throw new Error("Количество попыток: целое число от 1 до 20.");
    return {
      ...row,
      group_ids: [groupId],
      user_ids: [],
      starts_at: startsAt,
      ends_at: endsAt,
    };
  });
}

export async function sendFlowAssignmentPlans(
  plans: FlowAssignmentPlan[],
  send: (plan: FlowAssignmentPlan) => Promise<unknown>,
  update: (testId: string, status: "saving" | "saved" | "error", error?: string) => void,
) {
  let saved = 0;
  let failed = 0;
  for (const plan of plans) {
    update(plan.test_id, "saving");
    try {
      await send(plan);
      saved++;
      update(plan.test_id, "saved");
    } catch (error) {
      failed++;
      update(
        plan.test_id,
        "error",
        error instanceof Error ? error.message : "Не удалось выдать доступ.",
      );
    }
  }
  return { saved, failed };
}
