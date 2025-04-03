import axios from "axios";

const getAuthToken = () => localStorage.getItem("hclink_token");

const axiosInstance = axios.create({
  baseURL: process.env.NEXT_PUBLIC_API_URL + "/links",
  headers: {
    "Content-Type": "application/json",
  },
});

axiosInstance.interceptors.request.use((config) => {
  const token = getAuthToken();
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

export const createLink = async (data) => axiosInstance.post("", data);
export const getLinks = async () => axiosInstance.get("");
export const getLink = async (id) => axiosInstance.get(`/${id}`);
export const updateLink = async (id, data) => axiosInstance.put(`/${id}`, data);
export const deleteLink = async (id) => axiosInstance.delete(`/${id}`);
