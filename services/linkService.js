import axios from "axios";

const API_URL = "http://127.0.0.1:8000/api/links";

export const createLink = async (data) => axios.post(API_URL, data);
export const getLinks = async () => axios.get(API_URL);
export const getLink = async (id) => axios.get(`${API_URL}/${id}`);
export const updateLink = async (id, data) =>
  axios.put(`${API_URL}/${id}`, data);
export const deleteLink = async (id) => axios.delete(`${API_URL}/${id}`);
