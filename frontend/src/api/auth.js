import apiClient from "./client";

export const login = (email, password) =>
  apiClient.post("/auth/login/", { email, password });

export const register = (data) =>
  apiClient.post("/auth/register/", data);

export const getMe = () =>
  apiClient.get("/auth/me/");

export const changePassword = (old_password, new_password) =>
  apiClient.post("/auth/change-password/", { old_password, new_password });
