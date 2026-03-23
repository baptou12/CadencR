import Axios, { type AxiosRequestConfig, type AxiosError } from "axios";

const baseURL = import.meta.env.VITE_API_URL || "http://localhost:5005";

const axiosInstance = Axios.create({
  baseURL,
  timeout: 30000,
});

export async function customInstance<T>(config: AxiosRequestConfig): Promise<T> {
  const response = await axiosInstance(config);
  return response.data;
}

export type ErrorType<T> = AxiosError<T>;
