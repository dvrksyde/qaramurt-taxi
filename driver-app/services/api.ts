import * as SecureStore from "expo-secure-store";

import Constants from "expo-constants";

// const host = "10.188.157.221"; // Ваш IP адрес компьютера (для локальных тестов)
// export const API_BASE = `http://${host}:3000`; // Локальный сервер

// БОЕВОЙ СЕРВЕР RENDER -> HETZNER
export const API_BASE = "https://taxi.azizpro.online";

const APP_VERSION: string = Constants.expoConfig?.version ?? "0.0.0";

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
    "X-App-Version": APP_VERSION,
    ...(options.headers as Record<string, string>),
  };

  if (token) {
    headers["Authorization"] = `Bearer ${token}`;
  }

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 25000); // 25s timeout (order completion involves GPS calc + DB writes)

    console.log(`[API] ${options.method || "GET"} ${API_BASE}${path}`);

    const res = await fetch(`${API_BASE}${path}`, {
      ...options,
      headers,
      signal: controller.signal,
    });

    clearTimeout(timeout);

    // Parse JSON separately — if server returned HTML (502/503 gateway error),
    // res.json() throws SyntaxError which was previously misread as "no connection".
    let json: any;
    try {
      json = await res.json();
    } catch {
      // Server is up (fetch succeeded) but returned non-JSON (HTML error page)
      return { error: `Ошибка сервера ${res.status}. Попробуйте ещё раз.` };
    }

    if (!res.ok) {
      return { error: json.error || `Ошибка ${res.status}`, ...json };
    }

    return json;
  } catch (err: any) {
    if (err?.name === "AbortError") {
      return { error: `Сервер не отвечает (таймаут). Проверьте подключение к ${API_BASE}` };
    }
    return { error: "Нет подключения к серверу" };
  }
}
