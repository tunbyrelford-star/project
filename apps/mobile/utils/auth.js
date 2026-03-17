const { setCurrentRoleCode, getCurrentRoleCode, normalizeRoleCode } = require("./rbac");

const STORAGE_KEYS = {
  TOKEN: "token",
  USER_ID: "userId",
  USERNAME: "username",
  DISPLAY_NAME: "displayName",
  ROLE_CODE: "roleCode",
  ROLE_CODES: "roleCodes"
};

function normalizeRoleCodes(roleCodes) {
  const list = Array.isArray(roleCodes) ? roleCodes : [];
  const result = [];
  const visited = new Set();

  list.forEach((item) => {
    const normalized = normalizeRoleCode(item);
    if (!normalized || visited.has(normalized)) {
      return;
    }
    visited.add(normalized);
    result.push(normalized);
  });

  return result;
}

function saveLoginSession(payload = {}) {
  const token = String(payload.token || "");
  const user = payload.user || {};

  const fallbackRole = normalizeRoleCode(getCurrentRoleCode()) || "DISPATCHER";
  const loginRoleCode = normalizeRoleCode(user.roleCode || fallbackRole) || fallbackRole;
  const loginRoleCodes = normalizeRoleCodes(user.roleCodes);
  const finalRoleCodes = loginRoleCodes.length ? loginRoleCodes : [loginRoleCode];

  wx.setStorageSync(STORAGE_KEYS.TOKEN, token);
  wx.setStorageSync(STORAGE_KEYS.USER_ID, Number(user.id || 0));
  wx.setStorageSync(STORAGE_KEYS.USERNAME, String(user.username || ""));
  wx.setStorageSync(STORAGE_KEYS.DISPLAY_NAME, String(user.displayName || ""));
  wx.setStorageSync(STORAGE_KEYS.ROLE_CODES, finalRoleCodes);

  setCurrentRoleCode(loginRoleCode);
}

function clearLoginSession() {
  Object.keys(STORAGE_KEYS).forEach((key) => {
    wx.removeStorageSync(STORAGE_KEYS[key]);
  });
  wx.removeStorageSync("currentRoleCode");
}

function hasLoginSession() {
  return Boolean(wx.getStorageSync(STORAGE_KEYS.TOKEN) && wx.getStorageSync(STORAGE_KEYS.ROLE_CODE));
}

function getLoginSession() {
  return {
    token: wx.getStorageSync(STORAGE_KEYS.TOKEN) || "",
    userId: Number(wx.getStorageSync(STORAGE_KEYS.USER_ID) || 0),
    username: wx.getStorageSync(STORAGE_KEYS.USERNAME) || "",
    displayName: wx.getStorageSync(STORAGE_KEYS.DISPLAY_NAME) || "",
    roleCode: wx.getStorageSync(STORAGE_KEYS.ROLE_CODE) || "",
    roleCodes: wx.getStorageSync(STORAGE_KEYS.ROLE_CODES) || []
  };
}

module.exports = {
  STORAGE_KEYS,
  saveLoginSession,
  clearLoginSession,
  hasLoginSession,
  getLoginSession
};
