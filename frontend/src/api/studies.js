import apiClient from "./client";

export const getStudies = (params) =>
  apiClient.get("/studies/", { params });

export const getStudy = (orthancId) =>
  apiClient.get(`/studies/${orthancId}/`);

export const getOrthancStudies = () =>
  apiClient.get("/studies/orthanc/all/");

export const getOrthancStudy = (orthancId) =>
  apiClient.get(`/studies/orthanc/${orthancId}/`);

export const getOrthancSeries = (studyId) =>
  apiClient.get(`/studies/orthanc/${studyId}/series/`);

export const syncStudies = () =>
  apiClient.post("/studies/orthanc/sync/");
