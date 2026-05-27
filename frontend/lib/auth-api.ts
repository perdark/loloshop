import axios from "axios";
import { api, getApiErrorMessage } from "./api";
import { getUser, setToken, setUser } from "./auth";
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
): Promise<LoginResponse> {
  try {
    const { data } = await api.post<LoginResponse>("/auth/login", {
      phone,
      password,
    });
    return data;
  } catch (e) {
    throw new Error(extractMessage(e, "بيانات الدخول غير صحيحة"));
  }
}

export async function register(
  name: string,
  phone: string,
  password: string,
  email?: string
): Promise<{ user_id: string }> {
  try {
    const { data } = await api.post<{ data: { user_id: string } }>("/auth/register", {
      name,
      phone,
      password,
      email: email || undefined,
    });
    return data.data;
  } catch (e) {
    throw new Error(extractMessage(e, "تعذر إنشاء الحساب"));
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

export async function verifyOtp(
  phone: string,
  code: string
): Promise<{ token: string; user: User } | null> {
  const { data } = await api.post<{
    verified: boolean;
    token: string;
    user: User;
  }>("/auth/verify-otp", { phone, code });
  if (data.token && data.user) {
    setToken(data.token);
    setUser(data.user);
    return { token: data.token, user: data.user };
  }
  return null;
}

export async function resendOtp(phone: string): Promise<void> {
  await api.post("/auth/resend-otp", { phone });
}

export { getApiErrorMessage };
