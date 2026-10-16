import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildFlowAssignmentPlans,
  sendFlowAssignmentPlans,
} from "../src/flow-assignment-plan.ts";

test("Flow preparation preserves each test duration and converts the common organization schedule", () => {
  const plans = buildFlowAssignmentPlans(
    "flow",
    [
      { test_id: "msfo-ru", minutes: 60, max_attempts: 1 },
      { test_id: "msfoos-ru", minutes: 90, max_attempts: 2 },
    ],
    "2026-11-01T10:00",
    "2026-11-01T14:00",
    "Asia/Almaty",
  );
  assert.deepEqual(plans.map((plan) => [plan.minutes, plan.max_attempts]), [[60, 1], [90, 2]]);
  for (const plan of plans) {
    assert.equal(plan.starts_at, "2026-11-01T05:00:00.000Z");
    assert.equal(plan.ends_at, "2026-11-01T09:00:00.000Z");
    assert.deepEqual(plan.group_ids, ["flow"]);
    assert.deepEqual(plan.user_ids, []);
  }
  assert.throws(() => buildFlowAssignmentPlans("flow", [], "", "", "Asia/Almaty"));
  assert.throws(() => buildFlowAssignmentPlans("flow", [{ test_id: "t", minutes: 0, max_attempts: 1 }], "", "", "Asia/Almaty"));
  assert.throws(() => buildFlowAssignmentPlans("flow", [{ test_id: "t", minutes: 60, max_attempts: 1 }], "2026-11-01T14:00", "2026-11-01T10:00", "Asia/Almaty"));
});

test("Partial assignment failure leaves successful tests acknowledged and retries only the failed test", async () => {
  const plans = buildFlowAssignmentPlans("flow", ["a", "b", "c"].map((test_id) => ({ test_id, minutes: 60, max_attempts: 1 })), "", "", "Asia/Almaty");
  const statuses = new Map<string, string>();
  const calls: string[] = [];
  let active = 0;
  let maximumActive = 0;
  const update = (id: string, status: string) => { statuses.set(id, status); };
  const result = await sendFlowAssignmentPlans(plans, async (plan) => {
    active++;
    maximumActive = Math.max(maximumActive, active);
    calls.push(plan.test_id);
    await Promise.resolve();
    active--;
    if (plan.test_id === "b") throw new Error("Connection interrupted");
  }, update);
  assert.deepEqual(result, { saved: 2, failed: 1 });
  assert.equal(maximumActive, 1, "the wizard must not burst concurrent writes");
  assert.deepEqual([...statuses], [["a", "saved"], ["b", "error"], ["c", "saved"]]);
  const retry = await sendFlowAssignmentPlans(plans.filter((plan) => statuses.get(plan.test_id) !== "saved"), async (plan) => { calls.push(plan.test_id); }, update);
  assert.deepEqual(retry, { saved: 1, failed: 0 });
  assert.deepEqual(calls, ["a", "b", "c", "b"]);
  assert.ok([...statuses.values()].every((status) => status === "saved"));
});
