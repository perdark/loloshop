import axios from "axios";
import { api, getApiErrorMessage } from "./api";
import { getUser } from "./auth";
import type { LoginResponse, User } from "./types";

function extractMessage(e: unknown, fallback: string): string {
  if (axios.isAxiosError(e)) {
    return e.response?.data?.error || e.response?.data?.message || fallback;
  }
  return fallback;
}

export async function login(
  phone: string,
  password: string
): Promise<{ otp_required: true; phone: string }> {
  try {
    const { data } = await api.post<{ otp_required: true; phone: string }>("/auth/login", {
      phone,
      password,
    });
    return data;
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

export { getApiErrorMessage };
