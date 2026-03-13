import Axios, { type AxiosRequestConfig, type AxiosError } from "axios";

const baseURL = (() => {
  const url = window.api?.rustBackendUrl;
  if (!url) {
    console.warn("[api-client] window.api.rustBackendUrl is undefined, falling back to http://localhost:5005");
    return "http://localhost:5005";
  }
  return url;
})();

const axiosInstance = Axios.create({
  baseURL,
  timeout: 30000,
});

export async function customInstance<T>(config: AxiosRequestConfig): Promise<T> {
  const response = await axiosInstance(config);
  return response.data;
}

export type ErrorType<T> = AxiosError<T>;
