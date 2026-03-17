const { getBaseUrl, getFallbackBaseUrls, setBaseUrl } = require("../config/env");
const { clearLoginSession } = require("./auth");

function uniqueBaseUrls(list) {
  const result = [];
  const seen = new Set();
  (list || []).forEach((item) => {
    const value = String(item || "").trim().replace(/\/+$/, "");
    if (!value || seen.has(value)) return;
    seen.add(value);
    result.push(value);
  });
  return result;
}

function buildCandidateBaseUrls(explicitBaseUrl) {
  return uniqueBaseUrls([
    explicitBaseUrl,
    getBaseUrl(),
    ...getFallbackBaseUrls()
  ]);
}

function buildHttpMessage(statusCode, resData) {
  return (resData && resData.message)
    || (statusCode === 404
      ? "接口不存在，请确认后端已更新并重启。"
      : `HTTP ${statusCode}`);
}

function sendRequestOnce({ resolvedBaseUrl, url, method, data, header, timeout, token, roleCode, userId }) {
  return new Promise((resolve, reject) => {
    wx.request({
      url: `${resolvedBaseUrl}${url}`,
      method,
      data,
      timeout,
      header: {
        "Content-Type": "application/json",
        Authorization: token ? `Bearer ${token}` : "",
        "x-role-code": roleCode || "",
        "x-user-id": userId ? String(userId) : "",
        ...header
      },
      success: (res) => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          resolve({ ok: true, data: res.data, resolvedBaseUrl });
          return;
        }

        if (res.statusCode === 401 && url !== "/auth/login") {
          clearLoginSession();
          wx.reLaunch({ url: "/pages/auth/login/index" });
        }

        reject({
          ...res,
          resolvedBaseUrl,
          statusCode: res.statusCode,
          message: buildHttpMessage(res.statusCode, res.data)
        });
      },
      fail: (err) => {
        reject({
          ...err,
          resolvedBaseUrl,
          message: (err && err.errMsg) || "网络请求失败"
        });
      }
    });
  });
}

function isRetryableError(error) {
  const statusCode = Number(error && error.statusCode);
  if ([502, 503, 504].includes(statusCode)) return true;
  const errMsg = String((error && (error.errMsg || error.message)) || "").toLowerCase();
  return (
    errMsg.includes("timeout")
    || errMsg.includes("failed")
    || errMsg.includes("refused")
    || errMsg.includes("reset")
  );
}

async function request({ url, method = "GET", data = {}, header = {}, timeout = 15000, baseUrl = "" }) {
  const token = wx.getStorageSync("token");
  const roleCode = wx.getStorageSync("roleCode");
  const userId = wx.getStorageSync("userId");
  const explicitBaseUrl = String(baseUrl || "").trim();

  const allowFailover = url === "/auth/login";
  const candidates = allowFailover
    ? buildCandidateBaseUrls(explicitBaseUrl)
    : uniqueBaseUrls([explicitBaseUrl || getBaseUrl()]);

  let lastError = null;
  for (let i = 0; i < candidates.length; i += 1) {
    const resolvedBaseUrl = candidates[i];
    if (!resolvedBaseUrl) continue;

    try {
      const result = await sendRequestOnce({
        resolvedBaseUrl,
        url,
        method,
        data,
        header,
        timeout,
        token,
        roleCode,
        userId
      });
      if (allowFailover && resolvedBaseUrl !== getBaseUrl()) {
        setBaseUrl(resolvedBaseUrl);
      }
      return result.data;
    } catch (error) {
      lastError = error;
      if (!allowFailover || !isRetryableError(error)) {
        throw error;
      }
    }
  }

  throw lastError || { message: "网络请求失败" };
}

module.exports = {
  request
};
