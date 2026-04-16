import apiClient from "./client";

export const getAnnotations = (params) =>
  apiClient.get("/annotations/", { params });

export const createAnnotation = (data) =>
  apiClient.post("/annotations/", data);

export const updateAnnotation = (id, data) =>
  apiClient.patch(`/annotations/${id}/`, data);

export const deleteAnnotation = (id) =>
  apiClient.delete(`/annotations/${id}/`);
