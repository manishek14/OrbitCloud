// ============================================================================
// Drive plan activation policy — shared by /api/drive/activate (provisioning)
// and /api/drive/quota (later plan changes).
//
// A customer may only occupy a Drive quota that matches a SERVER-SIDE
// entitlement:
//   • the free "trial" plan (100 MB — the standing free entitlement), or
//   • the plan they are actually entitled to by an ACTIVE subscription
//     (largest Drive quota among active subscriptions, see entitlement.ts).
// Any other requested planCode — however it arrived — is rejected. The client
// can never obtain a higher quota by editing the request (audit fix: the
// activation endpoint previously trusted the body's planCode verbatim while
// only the quota endpoint enforced entitlement).
// ============================================================================

export type ActivationPlanDecision =
  | { ok: true; planCode: string }
  | { ok: false; reason: "not_entitled" };

/**
 * Pure decision helper (unit-tested in tests/drive-entitlement.test.ts).
 * `requested` may come from the network; `entitled` always comes from the DB.
 */
export function resolveActivatablePlan(
  requested: string,
  entitled: string | null,
): ActivationPlanDecision {
  if (requested === "trial") return { ok: true, planCode: "trial" };
  if (entitled !== null && requested === entitled) return { ok: true, planCode: requested };
  return { ok: false, reason: "not_entitled" };
}
