import axios from "axios";
import { api, getApiErrorMessage } from "./api";
import { getUser, getDeviceToken, setDeviceToken } from "./auth";
import type { LoginResponse, User } from "./types";

function extractMessage(e: unknown, fallback: string): string {
  if (axios.isAxiosError(e)) {
    return e.response?.data?.error || e.response?.data?.message || fallback;
  }
  return fallback;
}

/**
 * Carries the backend's `field` alongside the message so a form can show the error under
 * the input that actually failed, instead of a generic "couldn't create the account".
 */
export class FieldError extends Error {
  field?: string;
  code?: string;
  constructor(message: string, field?: string, code?: string) {
    super(message);
    this.name = "FieldError";
    this.field = field;
    this.code = code;
  }
}

function fieldError(e: unknown, fallback: string): FieldError {
  const data = axios.isAxiosError(e) ? e.response?.data : undefined;
  return new FieldError(extractMessage(e, fallback), data?.field, data?.code);
}

// The OTP step is bound to a server-issued `challenge_id`. The backend hands one back only
// after it has already proved something (a correct password here, a fresh account on
// register) and the verify call is addressed by that id — never by phone. Callers must
// therefore keep the id and pass it along; sending a phone + code is no longer a login.
// See backend migration 066 / security finding LS-01.

// login() now has two possible outcomes:
//  • trusted device → backend skips the OTP and returns { token, user } (logged in)
//  • otherwise      → backend sends a WhatsApp OTP and returns { otp_required, challenge_id }
export type LoginResult =
  | { otp_required: true; phone: string; challengeId: string }
  | { token: string; user: User };

export async function login(
  phone: string,
  password: string
): Promise<LoginResult> {
  try {
    const { data } = await api.post<
      Partial<LoginResponse> & { otp_required?: true; challenge_id?: string }
    >("/auth/login", {
      phone,
      password,
      device_token: getDeviceToken() || undefined,
    });
    if (data.token && data.user) {
      return { token: data.token, user: data.user };
    }
    return { otp_required: true, phone, challengeId: data.challenge_id || "" };
  } catch (e) {
    throw new Error(extractMessage(e, "بيانات الدخول غير صحيحة"));
  }
}

export async function loginVerifyOtp(
  challengeId: string,
  code: string
): Promise<LoginResponse> {
  try {
    const { data } = await api.post<LoginResponse>("/auth/login-verify", {
      challenge_id: challengeId,
      code,
    });
    // Trust this device so future logins skip the OTP.
    if (data.device_token) setDeviceToken(data.device_token);
    return data;
  } catch (e) {
    throw new Error(extractMessage(e, "رمز غير صحيح"));
  }
}

export async function fetchMe(): Promise<User> {
  try {
    const { data } = await api.get<User>("/auth/me");
    return data;
  } catch {
    const cached = getUser();
    if (cached) return cached;
    throw new Error("غير مصرح");
  }
}

// Phone-based reset: send a WhatsApp OTP, then reset with the challenge + code + new
// password. An id comes back even for an unregistered number (a decoy that matches no
// row), so the response can't be used to test whether a phone has an account.
export async function forgotPasswordByPhone(phone: string): Promise<string> {
  try {
    const { data } = await api.post<{ sent: boolean; challenge_id: string }>(
      "/auth/forgot-password-phone",
      { phone }
    );
    return data.challenge_id;
  } catch (e) {
    throw new Error(extractMessage(e, "تعذّر إرسال الرمز"));
  }
}

export async function resetPasswordByPhone(
  challengeId: string,
  code: string,
  password: string
): Promise<void> {
  try {
    await api.post("/auth/reset-password-phone", {
      challenge_id: challengeId,
      code,
      password,
    });
  } catch (e) {
    throw new Error(extractMessage(e, "تعذّر إعادة تعيين كلمة المرور"));
  }
}

// The backend refreshes the code in place, so the id that comes back is the same one that
// went in. Callers still adopt the returned value — it costs nothing and keeps them correct
// if that ever changes.
export async function resendLoginOtp(challengeId: string): Promise<string> {
  try {
    const { data } = await api.post<{ sent: boolean; challenge_id: string }>(
      "/auth/resend-otp",
      { challenge_id: challengeId }
    );
    return data.challenge_id;
  } catch (e) {
    throw new Error(extractMessage(e, "تعذّر إرسال الرمز"));
  }
}

// Open retail sign-up: creates a pre-approved student and sends a WhatsApp
// verify OTP. Returns the new user id; caller then verifies the OTP.
export async function register(body: {
  name: string;
  phone: string;
  password: string;
  gender?: "male" | "female";
  university_name: string;
  department: string;
  study_type: "morning" | "evening";
  instagram_username: string;
}): Promise<{ user_id: string; otp_required: boolean; challenge_id: string }> {
  try {
    const { data } = await api.post<{
      data: { user_id: string; otp_required: boolean; challenge_id: string };
    }>("/auth/register", body);
    return data.data;
  } catch (e) {
    // Keep the backend's `field` so the form can point at the offending input rather than
    // showing a blanket "couldn't create the account".
    throw fieldError(e, "تعذّر إنشاء الحساب");
  }
}

// Confirms the post-register OTP (purpose 'verify') and returns the auth token so the
// caller can auto-login. The challenge is pinned to the account register() just created,
// so this path can only ever finish that signup.
export async function verifyRegistrationOtp(
  challengeId: string,
  code: string
): Promise<{ token: string }> {
  try {
    const { data } = await api.post<{ verified: boolean; token: string; device_token?: string }>(
      "/auth/verify-otp",
      { challenge_id: challengeId, code }
    );
    // Trust this device so the first real login skips the OTP.
    if (data.device_token) setDeviceToken(data.device_token);
    return { token: data.token };
  } catch (e) {
    throw new Error(extractMessage(e, "رمز غير صحيح"));
  }
}

// See resendLoginOtp — refreshed in place, same id back.
export async function resendVerifyOtp(challengeId: string): Promise<string> {
  try {
    const { data } = await api.post<{ sent: boolean; challenge_id: string }>(
      "/auth/resend-otp",
      { challenge_id: challengeId }
    );
    return data.challenge_id;
  } catch (e) {
    throw new Error(extractMessage(e, "تعذّر إرسال الرمز"));
  }
}

// ── Private staff portal (phoneless staff: pick name + password, no OTP) ──────
export interface StaffPortalMember {
  id: string;
  name: string;
}

// Returns the staff name list for the dropdown. The secret key must be in the URL;
// a wrong/missing key returns 404 (caller treats it as "page not found").
export async function getStaffPortalMembers(
  key: string
): Promise<StaffPortalMember[]> {
  const { data } = await api.get<{ data: StaffPortalMember[] }>(
    "/auth/staff-portal/members",
    { params: { key } }
  );
  return data.data || [];
}

export async function staffPortalLogin(
  key: string,
  staffId: string,
  password: string
): Promise<LoginResponse> {
  try {
    const { data } = await api.post<LoginResponse>("/auth/staff-portal-login", {
      key,
      staff_id: staffId,
      password,
    });
    return data;
  } catch (e) {
    throw new Error(extractMessage(e, "بيانات الدخول غير صحيحة"));
  }
}

// ---------------------------------------------------------------------------
// Account deletion (Apple App Store guideline 5.1.1(v))
// ---------------------------------------------------------------------------

export type DeletionPreview = {
  eligible: boolean;
  /** Present only when eligible is false — why this account is admin-managed. */
  reason_ar?: string;
  /** Orders the shop is still working on. Deleting does NOT cancel them. */
  active_orders: number;
  total_orders: number;
};

export async function getDeletionPreview(): Promise<DeletionPreview> {
  const { data } = await api.get<DeletionPreview>("/auth/account/deletion-preview");
  return data;
}

/**
 * Erases the account for good. The backend bumps token_version, so the JWT this
 * call was made with is dead the moment it returns — the caller must clear local
 * storage and leave the authenticated area rather than making another request.
 */
export async function deleteAccount(password: string): Promise<{ retained_orders: number }> {
  try {
    const { data } = await api.post<{
      data: { deleted: boolean; retained_orders: number };
    }>("/auth/account/delete", { password });
    return { retained_orders: data.data.retained_orders };
  } catch (e) {
    throw fieldError(e, "تعذر حذف الحساب");
  }
}

export { getApiErrorMessage };
