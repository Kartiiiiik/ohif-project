import axios from "axios";
import { useAuthStore } from "../store/authStore";

const apiClient = axios.create({
  baseURL: import.meta.env.VITE_API_URL || "/api",
  headers: { "Content-Type": "application/json" },
});

// Attach JWT token to every request
apiClient.interceptors.request.use((config) => {
  const token = useAuthStore.getState().token;
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

// Handle 401 — attempt refresh, else logout
apiClient.interceptors.response.use(
  (res) => {
    // If server returned HTML instead of JSON, convert to a clean error
    const contentType = res.headers?.["content-type"] || "";
    if (contentType.includes("text/html")) {
      return Promise.reject({
        response: {
          status: res.status,
          data: { error: "Server error. Please try again later." },
        },
      });
    }
    return res;
  },
  async (error) => {
    // If the error response is HTML (Django debug page), replace with clean message
    const contentType = error.response?.headers?.["content-type"] || "";
    if (contentType.includes("text/html")) {
      error.response.data = { error: "Server error. Please try again later." };
      return Promise.reject(error);
    }

    const original = error.config;
    if (error.response?.status === 401 && !original._retry) {
      original._retry = true;
      const { refreshToken, setTokens, logout } = useAuthStore.getState();
      if (refreshToken) {
        try {
          const { data } = await axios.post("/api/auth/token/refresh/", {
            refresh: refreshToken,
          });
          setTokens(data.access, refreshToken);
          original.headers.Authorization = `Bearer ${data.access}`;
          return apiClient(original);
        } catch {
          logout();
        }
      } else {
        logout();
      }
    }
    return Promise.reject(error);
  }
);

export default apiClient;