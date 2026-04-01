import * as SecureStore from "expo-secure-store";

import Constants from "expo-constants";

const host = Constants.expoConfig?.hostUri?.split(":")[0] || "localhost";
export const API_BASE = __DEV__
  ? `http://${host}:3000`
  : "https://your-production-domain.com";

let token: string | null = null;

export async function loadToken() {
  token = await SecureStore.getItemAsync("driver_token");
  return token;
}

export async function saveToken(t: string) {
  token = t;
  await SecureStore.setItemAsync("driver_token", t);
}

export async function clearToken() {
  token = null;
  await SecureStore.deleteItemAsync("driver_token");
}

export function getToken() {
  return token;
}

export async function api<T = any>(
  path: string,
  options: RequestInit = {}
): Promise<{ data?: T; error?: string }> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...(options.headers as Record<string, string>),
  };

  if (token) {
    headers["Authorization"] = `Bearer ${token}`;
  }

  try {
    const res = await fetch(`${API_BASE}${path}`, {
      ...options,
      headers,
    });

    const json = await res.json();

    if (!res.ok) {
      return { error: json.error || `Ошибка ${res.status}` };
    }

    return json;
  } catch (err) {
    return { error: "Нет подключения к серверу" };
  }
}
