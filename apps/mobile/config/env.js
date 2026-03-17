const ENV = "dev";
const STORAGE_KEY = "backendBaseUrl";

const endpoints = {
  dev: [
    "http://127.0.0.1:3000/api",
    "http://127.0.0.1:3011/api",
    "http://172.23.96.36:3000/api",
    "http://172.23.96.36:3011/api"
  ],
  prod: ["https://api.example.com/api"]
};

function normalizeBaseUrl(baseUrl) {
  return String(baseUrl || "").trim().replace(/\/+$/, "");
}

function uniqueBaseUrls(baseUrls) {
  const result = [];
  const visited = new Set();
  (baseUrls || []).forEach((item) => {
    const normalized = normalizeBaseUrl(item);
    if (!normalized || visited.has(normalized)) {
      return;
    }
    visited.add(normalized);
    result.push(normalized);
  });
  return result;
}

function isLoopbackBaseUrl(baseUrl) {
  const normalized = normalizeBaseUrl(baseUrl);
  return /:\/\/(127\.0\.0\.1|localhost)(:\d+)?(\/|$)/i.test(normalized);
}

function getDefaultBaseUrls() {
  const value = endpoints[ENV];
  if (Array.isArray(value)) {
    return uniqueBaseUrls(value);
  }
  return uniqueBaseUrls([value]);
}

function getSavedBaseUrl() {
  try {
    return normalizeBaseUrl(wx.getStorageSync(STORAGE_KEY));
  } catch (_error) {
    return "";
  }
}

function setBaseUrl(baseUrl) {
  const normalized = normalizeBaseUrl(baseUrl);
  if (!normalized) {
    return;
  }
  try {
    wx.setStorageSync(STORAGE_KEY, normalized);
  } catch (_error) {
    // Ignore storage write failures and keep in-memory defaults.
  }
}

function getFallbackBaseUrls() {
  return uniqueBaseUrls([getSavedBaseUrl(), ...getDefaultBaseUrls()]);
}

function findPreferredBaseUrlForRuntime(baseUrls, isRealDevice) {
  if (!isRealDevice) {
    return baseUrls[0] || "";
  }

  const nonLoopback = (baseUrls || []).find((item) => !isLoopbackBaseUrl(item));
  return nonLoopback || baseUrls[0] || "";
}

function getBaseUrl() {
  const baseUrls = getFallbackBaseUrls();
  return baseUrls.length ? baseUrls[0] : "http://127.0.0.1:3000/api";
}

module.exports = {
  ENV,
  STORAGE_KEY,
  BASE_URL: getBaseUrl(),
  normalizeBaseUrl,
  isLoopbackBaseUrl,
  getBaseUrl,
  setBaseUrl,
  getFallbackBaseUrls,
  findPreferredBaseUrlForRuntime
};
