import axios from "axios";
import { api, getApiErrorMessage } from "./api";
import { getUser } from "./auth";
import type { LoginResponse, User } from "./types";

const DEV_MOCK_PASSWORD = "123456";

const DEV_MOCK_USERS: Record<string, LoginResponse> = {
  "07700000001": {
    token: "mock-admin-token",
    user: {
      id: "mock-admin",
      name: "مدير تجريبي",
      phone: "07700000001",
      role: "admin",
    },
  },
  "07700000002": {
    token: "mock-wholesaler-token",
    user: {
      id: "mock-wholesaler",
      name: "ممثل تجريبي",
      phone: "07700000002",
      role: "wholesaler",
    },
  },
  "07700000003": {
    token: "mock-staff-token",
    user: {
      id: "mock-staff",
      name: "موظف تجريبي",
      phone: "07700000003",
      role: "staff",
    },
  },
};

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
    const mock = DEV_MOCK_USERS[phone];
    if (mock && password === DEV_MOCK_PASSWORD) return mock;
    throw new Error(extractMessage(e, "بيانات الدخول غير صحيحة"));
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

export { getApiErrorMessage };
