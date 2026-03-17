const { request } = require("../utils/request");
const { getFallbackBaseUrls, setBaseUrl, isLoopbackBaseUrl } = require("../config/env");

function shouldRetryWithNextBase(error) {
  const statusCode = Number((error && error.statusCode) || 0);
  const text = String((error && (error.message || error.errMsg || "")) || "").toLowerCase();

  if ([404, 502, 503, 504].includes(statusCode)) {
    return true;
  }

  return text.includes("request:fail")
    || text.includes("timeout")
    || text.includes("econnrefused");
}

function normalizeError(error, baseUrls = []) {
  const statusCode = Number((error && error.statusCode) || 0);
  const message = String((error && (error.message || error.errMsg || "")) || "");

  if (statusCode === 404) {
    return new Error("未找到登录接口 /api/auth/login，请确认后端已使用最新代码并重启服务。");
  }

  if (/request:fail|econnrefused|timeout/i.test(message)) {
    const hasLoopback = baseUrls.some((item) => isLoopbackBaseUrl(item));
    if (hasLoopback) {
      return new Error("无法连接后端。真机调试请使用电脑局域网IP（例如 http://172.23.96.36:3000/api），不要使用127.0.0.1。");
    }
  }

  if (error && error.data && error.data.message) {
    return new Error(error.data.message);
  }
  if (error && error.message) {
    return new Error(error.message);
  }
  if (error && error.errMsg) {
    return new Error(error.errMsg);
  }
  if (error instanceof Error) {
    return error;
  }

  const attempted = baseUrls.length ? `（已尝试：${baseUrls.join(" , ")}）` : "";
  return new Error(`登录失败，请检查后端服务状态与端口${attempted}`);
}

async function login(payload) {
  const fallbackBaseUrls = getFallbackBaseUrls();
  let lastError = null;

  for (let i = 0; i < fallbackBaseUrls.length; i += 1) {
    const baseUrl = fallbackBaseUrls[i];
    try {
      const response = await request({
        url: "/auth/login",
        method: "POST",
        data: payload,
        baseUrl
      });
      setBaseUrl(baseUrl);
      return response;
    } catch (error) {
      lastError = error;
      if (i < fallbackBaseUrls.length - 1 && shouldRetryWithNextBase(error)) {
        continue;
      }
      break;
    }
  }

  throw normalizeError(lastError, fallbackBaseUrls);
}

module.exports = {
  login
};
