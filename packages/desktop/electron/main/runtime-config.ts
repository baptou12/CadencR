export interface RuntimeConfig {
  baseUrl: string;
  authToken: string | null;
}

let runtimeConfig: RuntimeConfig = {
  baseUrl: "http://127.0.0.1:5005",
  authToken: null,
};

export function setRuntimeConfig(nextConfig: RuntimeConfig): void {
  runtimeConfig = nextConfig;
}

export function getRuntimeConfig(): RuntimeConfig {
  return runtimeConfig;
}
