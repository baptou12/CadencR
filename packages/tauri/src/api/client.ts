import Axios, {
  type AxiosError,
  type AxiosRequestConfig,
  type InternalAxiosRequestConfig,
} from "axios";
import { invoke } from "@tauri-apps/api/core";

export interface RuntimeConfig {
  port: number;
  authToken: string | null;
}

const DEFAULT_DEV_PORT = 5005;

let runtimeConfig: RuntimeConfig | null = null;
let runtimeConfigPromise: Promise<RuntimeConfig> | null = null;

function envFallback(): RuntimeConfig {
  const portOverride = import.meta.env.VITE_API_PORT;
  const port = typeof portOverride === "string" ? Number(portOverride) : NaN;
  const tokenOverride = import.meta.env.VITE_API_TOKEN;
  return {
    port: Number.isFinite(port) ? port : DEFAULT_DEV_PORT,
    authToken:
      typeof tokenOverride === "string" && tokenOverride.length > 0
        ? tokenOverride
        : null,
  };
}

async function loadRuntimeConfig(): Promise<RuntimeConfig> {
  const fallback = envFallback();
  try {
    const result = await invoke<RuntimeConfig>("get_runtime_config");
    if (result && typeof result.port === "number") {
      // VITE_API_TOKEN mirrors CADENCE_AUTH_TOKEN; coalesce so dev keeps
      // working even if the Rust dotenvy load missed `.env`.
      return {
        port: result.port,
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
  const override = import.meta.env.VITE_API_URL;
  if (typeof override === "string" && override.length > 0) {
    return override;
  }
  return `http://127.0.0.1:${getRuntimeConfigSync().port}`;
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
