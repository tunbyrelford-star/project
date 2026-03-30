const { getBaseUrl, getFallbackBaseUrls, setBaseUrl } = require("../config/env");

function normalizeBaseUrl(baseUrl) {
  return String(baseUrl || "").trim().replace(/\/+$/, "");
}

function uniqueBaseUrls(list) {
  const result = [];
  const seen = new Set();
  (list || []).forEach((item) => {
    const value = normalizeBaseUrl(item);
    if (!value || seen.has(value)) return;
    seen.add(value);
    result.push(value);
  });
  return result;
}

function parseUploadResponse(rawData) {
  if (rawData == null) return {};
  if (typeof rawData === "object") return rawData;
  try {
    return JSON.parse(rawData);
  } catch (_error) {
    return {};
  }
}

function buildUploadUrlCandidates(baseUrl) {
  const base = normalizeBaseUrl(baseUrl);
  if (!base) return [];
  const hasApiSuffix = /\/api$/i.test(base);
  return uniqueBaseUrls([
    hasApiSuffix ? `${base}/files/upload` : `${base}/api/files/upload`,
    `${base}/files/upload`
  ]);
}

function buildDeleteUrlCandidates(baseUrl, key) {
  const safeKey = encodeURIComponent(String(key || "").trim());
  if (!safeKey) return [];
  const base = normalizeBaseUrl(baseUrl);
  if (!base) return [];
  const hasApiSuffix = /\/api$/i.test(base);
  return uniqueBaseUrls([
    hasApiSuffix ? `${base}/files/upload/${safeKey}` : `${base}/api/files/upload/${safeKey}`,
    `${base}/files/upload/${safeKey}`
  ]);
}

function isRetryableUploadError(error) {
  const statusCode = Number(error && error.statusCode);
  if ([404, 405, 408, 429, 502, 503, 504].includes(statusCode)) return true;

  const message = String((error && (error.errMsg || error.message)) || "").toLowerCase();
  return (
    message.includes("timeout")
    || message.includes("failed")
    || message.includes("refused")
    || message.includes("reset")
    || message.includes("abort")
    || message.includes("not found")
  );
}

function buildHeaders() {
  const token = wx.getStorageSync("token");
  const roleCode = wx.getStorageSync("roleCode");
  const userId = wx.getStorageSync("userId");

  return {
    Authorization: token ? `Bearer ${token}` : "",
    "x-role-code": roleCode || "",
    "x-user-id": userId ? String(userId) : ""
  };
}

function uploadOnceByUrl(url, payload) {
  return new Promise((resolve, reject) => {
    const task = wx.uploadFile({
      url,
      filePath: payload.filePath,
      name: "file",
      formData: {
        category: payload.category || "general",
        fileName: payload.fileName || ""
      },
      header: buildHeaders(),
      success: (res) => {
        const body = parseUploadResponse(res.data);
        if (res.statusCode >= 200 && res.statusCode < 300 && body.url) {
          resolve(body);
          return;
        }

        reject({
          ...res,
          statusCode: res.statusCode,
          message: body.message || `HTTP ${res.statusCode || 500}`,
          body,
          requestUrl: url
        });
      },
      fail: (error) => {
        reject({
          ...error,
          message: (error && error.errMsg) || "上传失败",
          requestUrl: url
        });
      }
    });

    if (typeof payload.onProgress === "function" && task && typeof task.onProgressUpdate === "function") {
      task.onProgressUpdate((res) => {
        payload.onProgress(Number(res.progress || 0));
      });
    }
  });
}

async function uploadByBaseUrl(baseUrl, payload) {
  const urls = buildUploadUrlCandidates(baseUrl);
  let lastError = null;

  for (let i = 0; i < urls.length; i += 1) {
    const url = urls[i];
    try {
      const data = await uploadOnceByUrl(url, payload);
      return {
        ...data,
        resolvedBaseUrl: normalizeBaseUrl(baseUrl),
        requestUrl: url
      };
    } catch (error) {
      lastError = error;
      if (!isRetryableUploadError(error)) {
        throw error;
      }
    }
  }

  throw lastError || { message: "上传失败", resolvedBaseUrl: normalizeBaseUrl(baseUrl) };
}

async function uploadAttachment({ filePath, fileName = "", category = "general", onProgress }) {
  const candidates = uniqueBaseUrls([getBaseUrl(), ...getFallbackBaseUrls()]);
  let lastError = null;

  for (let i = 0; i < candidates.length; i += 1) {
    const base = candidates[i];
    if (!base) continue;

    try {
      const result = await uploadByBaseUrl(base, {
        filePath,
        fileName,
        category,
        onProgress
      });
      if (normalizeBaseUrl(base) !== normalizeBaseUrl(getBaseUrl())) {
        setBaseUrl(base);
      }
      return result;
    } catch (error) {
      lastError = error;
      if (!isRetryableUploadError(error)) {
        throw error;
      }
    }
  }

  throw lastError || { message: "上传失败" };
}

function deleteOnceByUrl(url) {
  return new Promise((resolve, reject) => {
    wx.request({
      url,
      method: "DELETE",
      timeout: 15000,
      header: {
        "Content-Type": "application/json",
        ...buildHeaders()
      },
      success: (res) => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          resolve(res.data || { ok: true });
          return;
        }
        reject({
          ...res,
          statusCode: res.statusCode,
          message: (res.data && res.data.message) || `HTTP ${res.statusCode || 500}`,
          requestUrl: url
        });
      },
      fail: (error) => {
        reject({
          ...error,
          message: (error && error.errMsg) || "删除失败",
          requestUrl: url
        });
      }
    });
  });
}

async function deleteUploadedAttachment(key) {
  const rawKey = String(key || "").trim();
  if (!rawKey) {
    return { ok: true };
  }

  const candidates = uniqueBaseUrls([getBaseUrl(), ...getFallbackBaseUrls()]);
  let lastError = null;

  for (let i = 0; i < candidates.length; i += 1) {
    const base = candidates[i];
    const urls = buildDeleteUrlCandidates(base, rawKey);

    for (let j = 0; j < urls.length; j += 1) {
      const url = urls[j];
      try {
        const data = await deleteOnceByUrl(url);
        return data;
      } catch (error) {
        lastError = error;
        if (!isRetryableUploadError(error)) {
          throw error;
        }
      }
    }
  }

  throw lastError || { message: "删除失败" };
}

module.exports = {
  uploadAttachment,
  deleteUploadedAttachment
};
