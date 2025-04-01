import axios from "axios";

const API_URL = "http://127.0.0.1:8000/api";

export const register = async (data) => axios.post(`${API_URL}/register`, data);
export const login = async (data) => axios.post(`${API_URL}/login`, data);
export const logout = async (token) =>
  axios.post(
    `${API_URL}/logout`,
    {},
    {
      headers: { Authorization: `Bearer ${token}` },
    }
  );
