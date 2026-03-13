import Axios, { type AxiosRequestConfig, type AxiosError } from "axios";

const axiosInstance = Axios.create({
  baseURL: window.api.rustBackendUrl,
});

export async function customInstance<T>(config: AxiosRequestConfig): Promise<T> {
  const response = await axiosInstance(config);
  return response.data;
}

export type ErrorType<T> = AxiosError<T>;
