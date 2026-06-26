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

// login() now has two possible outcomes:
//  • trusted device → backend skips the OTP and returns { token, user } (logged in)
//  • otherwise      → backend sends a WhatsApp OTP and returns { otp_required, phone }
export type LoginResult =
  | { otp_required: true; phone: string }
  | { token: string; user: User };

export async function login(
  phone: string,
  password: string
): Promise<LoginResult> {
  try {
    const { data } = await api.post<Partial<LoginResponse> & { otp_required?: true }>(
      "/auth/login",
      { phone, password, device_token: getDeviceToken() || undefined }
    );
    if (data.token && data.user) {
      return { token: data.token, user: data.user };
    }
    return { otp_required: true, phone };
  } catch (e) {
    throw new Error(extractMessage(e, "بيانات الدخول غير صحيحة"));
  }
}

export async function loginVerifyOtp(
  phone: string,
  code: string
): Promise<LoginResponse> {
  try {
    const { data } = await api.post<LoginResponse>("/auth/login-verify", {
      phone,
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

export async function forgotPassword(email: string): Promise<void> {
  await api.post("/auth/forgot-password", { email });
}

export async function resetPassword(
  token: string,
  password: string
): Promise<void> {
  await api.post("/auth/reset-password", { token, password });
}

// Phone-based reset: send a WhatsApp OTP, then reset with phone + code + new password.
export async function forgotPasswordByPhone(phone: string): Promise<void> {
  try {
    await api.post("/auth/forgot-password-phone", { phone });
  } catch (e) {
    throw new Error(extractMessage(e, "تعذّر إرسال الرمز"));
  }
}

export async function resetPasswordByPhone(
  phone: string,
  code: string,
  password: string
): Promise<void> {
  try {
    await api.post("/auth/reset-password-phone", { phone, code, password });
  } catch (e) {
    throw new Error(extractMessage(e, "تعذّر إعادة تعيين كلمة المرور"));
  }
}

export async function verifyOtp(phone: string, code: string): Promise<void> {
  await api.post("/auth/verify-otp", { phone, code });
}

export async function resendLoginOtp(phone: string): Promise<void> {
  try {
    await api.post("/auth/resend-otp", { phone, purpose: "login" });
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
  email?: string;
  gender?: "male" | "female";
  university_name: string;
  department: string;
  study_type: "morning" | "evening";
  instagram_username: string;
}): Promise<{ user_id: string; otp_required: boolean }> {
  try {
    const { data } = await api.post<{
      data: { user_id: string; otp_required: boolean };
    }>("/auth/register", body);
    return data.data;
  } catch (e) {
    throw new Error(extractMessage(e, "تعذّر إنشاء الحساب"));
  }
}

// Confirms the post-register OTP (purpose 'verify') and returns the auth token
// so the caller can auto-login. Mirrors verifyOtp but surfaces the token.
export async function verifyRegistrationOtp(
  phone: string,
  code: string
): Promise<{ token: string }> {
  try {
    const { data } = await api.post<{ verified: boolean; token: string; device_token?: string }>(
      "/auth/verify-otp",
      { phone, code }
    );
    // Trust this device so the first real login skips the OTP.
    if (data.device_token) setDeviceToken(data.device_token);
    return { token: data.token };
  } catch (e) {
    throw new Error(extractMessage(e, "رمز غير صحيح"));
  }
}

export async function resendVerifyOtp(phone: string): Promise<void> {
  try {
    await api.post("/auth/resend-otp", { phone, purpose: "verify" });
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

export { getApiErrorMessage };
