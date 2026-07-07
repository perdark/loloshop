import { api } from "./api";

/**
 * Money-gate API wrappers.
 *
 * The "money gate" is a shared secret that unlocks sensitive figures
 * (prices / cost / profit) on screens that are otherwise viewable by
 * anyone — the wall-mounted TV board (no JWT, the secret is verified
 * server-side) and the admin dashboard (JWT present, but figures are
 * masked until the gate is opened).
 *
 * These wrappers are deliberately generic and dependency-light so both
 * consumers can share them. All of them fail SAFE: any error resolves to
 * "locked / not configured / not ok" rather than throwing.
 */

/**
 * Verify a candidate secret against the server.
 * Returns true only when the server confirms the secret is correct.
 * Any network / server error → false (fail closed).
 */
export async function verifyMoneyGate(secret: string): Promise<boolean> {
  try {
    const { data } = await api.post<{ ok?: boolean }>(
      "/admin/money-gate/verify",
      { secret }
    );
    return data?.ok === true;
  } catch {
    return false;
  }
}

/**
 * Set (or change) the money-gate secret. Admin-only server-side.
 * Throws on failure so the caller can surface an error.
 */
export async function setMoneyGate(secret: string): Promise<void> {
  await api.put("/admin/money-gate", { secret });
}

/**
 * Whether a money-gate secret has been configured on the server.
 * Fails safe to { configured: false } on any error.
 */
export async function getMoneyGateStatus(): Promise<{ configured: boolean }> {
  try {
    const { data } = await api.get<{ configured?: boolean }>(
      "/admin/money-gate"
    );
    return { configured: data?.configured === true };
  } catch {
    return { configured: false };
  }
}
