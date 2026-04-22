import Axios, {
  type AxiosError,
  type AxiosRequestConfig,
  type InternalAxiosRequestConfig,
} from "axios";
import { invoke } from "@tauri-apps/api/core";

export interface RuntimeConfig {
  baseUrl: string;
  authToken: string | null;
}

const DEFAULT_DEV_BASE_URL = "http://127.0.0.1:5005";

let runtimeConfig: RuntimeConfig | null = null;
let runtimeConfigPromise: Promise<RuntimeConfig> | null = null;

function envFallback(): RuntimeConfig {
  const baseUrl = import.meta.env.VITE_API_URL;
  const authToken = import.meta.env.VITE_API_TOKEN;
  return {
    baseUrl:
      typeof baseUrl === "string" && baseUrl.length > 0
        ? baseUrl.replace(/\/$/, "")
        : DEFAULT_DEV_BASE_URL,
    authToken:
      typeof authToken === "string" && authToken.length > 0
        ? authToken
        : null,
  };
}

async function loadRuntimeConfig(): Promise<RuntimeConfig> {
  const fallback = envFallback();
  try {
    const result = await invoke<RuntimeConfig>("get_runtime_config");
    if (result && typeof result.baseUrl === "string") {
      return {
        baseUrl: result.baseUrl,
        authToken: result.authToken ?? fallback.authToken,
      };
    }
  } catch (err) {
    console.warn("[runtime-config] get_runtime_config unavailable:", err);
  }
  return fallback;
}

/** Call once at boot before mounting so sync accessors see a populated cache. */
export async function preloadRuntimeConfig(): Promise<RuntimeConfig> {
  if (runtimeConfig) return runtimeConfig;
  if (!runtimeConfigPromise) {
    runtimeConfigPromise = loadRuntimeConfig().then((cfg) => {
      runtimeConfig = cfg;
      return cfg;
    });
  }
  return runtimeConfigPromise;
}

export function getRuntimeConfigSync(): RuntimeConfig {
  return runtimeConfig ?? envFallback();
}

export function resolveApiBaseUrlSync(): string {
  return getRuntimeConfigSync().baseUrl;
}

export function getAuthTokenSync(): string | null {
  return getRuntimeConfigSync().authToken;
}

/** Reset cached runtime config. Tests only. */
export function __resetRuntimeConfigForTests(): void {
  runtimeConfig = null;
  runtimeConfigPromise = null;
}

const axiosInstance = Axios.create({ timeout: 30000 });

// `main.tsx` awaits preload before mounting, so sync accessors are always
// populated by the time a request fires.
axiosInstance.interceptors.request.use((config: InternalAxiosRequestConfig) => {
  if (!config.baseURL) {
    config.baseURL = resolveApiBaseUrlSync();
  }
  const token = getAuthTokenSync();
  if (token) {
    config.headers.set("X-Cadence-Token", token);
  }
  return config;
});

export async function customInstance<T>(
  config: AxiosRequestConfig,
): Promise<T> {
  const response = await axiosInstance(config);
  return response.data;
}

export type ErrorType<T> = AxiosError<T>;
