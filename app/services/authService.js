import axios from "axios";

// const API_URL = "https://foodpile.shop/api/v1";
// const API_URL = "http://localhost:8000/api/v1";

export async function getCsrfToken() {
  await fetch(`${process.env.NEXT_PUBLIC_API_URL}/sanctum/csrf-cookie`, {
    credentials: "include",
  });
}

export const register = async (data) =>
  axios.post(`${process.env.NEXT_PUBLIC_API_URL}/register`, data);
export const login = async (data) =>
  axios.post(`${process.env.NEXT_PUBLIC_API_URL}/login`, data);
export const logout = async (token) =>
  axios.post(
    `${process.env.NEXT_PUBLIC_API_URL}/logout`,
    {},
    {
      headers: { Authorization: `Bearer ${token}` },
    }
  );
