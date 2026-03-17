const {
  ROLE_CODES,
  ROLE_LABELS,
  PERMISSION_CODES,
  ROLE_PERMISSION_MATRIX,
  FIELD_PERMISSION_MAPPING
} = require("../constants/rbac");

const ROLE_STORAGE_KEY = "currentRoleCode";
const ROLE_HEADER_KEY = "roleCode";

const ROLE_CODE_ALIASES = {
  PROCUREMENT_DISPATCHER: ROLE_CODES.DISPATCHER,
  DISPATCH: ROLE_CODES.DISPATCHER,
  ONSITE: ROLE_CODES.ONSITE_SPECIALIST,
  SITE: ROLE_CODES.ONSITE_SPECIALIST,
  SALES_MANAGER: ROLE_CODES.SALES,
  SALESMAN: ROLE_CODES.SALES,
  FINANCE: ROLE_CODES.FINANCE_MGMT,
  MANAGEMENT: ROLE_CODES.FINANCE_MGMT,
  ADMIN: ROLE_CODES.SUPER_ADMIN
};

function normalizeRoleCode(roleCode) {
  const raw = String(roleCode || "").trim().toUpperCase();
  if (!raw) {
    return "";
  }
  return ROLE_CODE_ALIASES[raw] || raw;
}

function getCurrentRoleCode() {
  const stored = wx.getStorageSync(ROLE_STORAGE_KEY) || wx.getStorageSync(ROLE_HEADER_KEY) || "";
  return normalizeRoleCode(stored) || ROLE_CODES.DISPATCHER;
}

function setCurrentRoleCode(roleCode) {
  const normalized = normalizeRoleCode(roleCode) || ROLE_CODES.DISPATCHER;
  wx.setStorageSync(ROLE_STORAGE_KEY, normalized);
  wx.setStorageSync(ROLE_HEADER_KEY, normalized);
  return normalized;
}

function getRoleLabel(roleCode) {
  const normalized = normalizeRoleCode(roleCode);
  return ROLE_LABELS[normalized] || normalized || ROLE_CODES.DISPATCHER;
}

function getRolePermissions(roleCode) {
  const normalized = normalizeRoleCode(roleCode);
  return ROLE_PERMISSION_MATRIX[normalized] || [];
}

function hasPermission(permissionCode, roleCode = getCurrentRoleCode()) {
  const normalized = normalizeRoleCode(roleCode);
  if (normalized === ROLE_CODES.SUPER_ADMIN) return true;
  const permissions = getRolePermissions(normalized);
  return permissions.includes(permissionCode);
}

function canConfirmPayment(roleCode = getCurrentRoleCode()) {
  return hasPermission(PERMISSION_CODES.ACTION_PAYMENT_CONFIRM, roleCode);
}

function canSubmitLockedChangeApproval(roleCode = getCurrentRoleCode()) {
  return hasPermission(PERMISSION_CODES.ACTION_LOCKED_CHANGE_SUBMIT_APPROVAL, roleCode);
}

function getFieldVisibility(fieldKey, roleCode = getCurrentRoleCode()) {
  const permissionCode = FIELD_PERMISSION_MAPPING[fieldKey];
  if (!permissionCode) return "VISIBLE";
  return hasPermission(permissionCode, roleCode) ? "VISIBLE" : "MASKED";
}

function maskValue(value) {
  if (value === null || value === undefined || value === "") {
    return "---";
  }
  if (typeof value === "number") {
    return "***";
  }
  const text = String(value);
  if (text.length <= 2) {
    return "**";
  }
  return `${text.slice(0, 1)}***${text.slice(-1)}`;
}

function displayFieldValue(fieldKey, value, roleCode = getCurrentRoleCode()) {
  const visibility = getFieldVisibility(fieldKey, roleCode);
  if (visibility === "VISIBLE") {
    return value;
  }
  if (visibility === "HIDDEN") {
    return "---";
  }
  return maskValue(value);
}

function getAllRoleOptions() {
  return Object.keys(ROLE_LABELS).map((roleCode) => ({
    key: roleCode,
    label: ROLE_LABELS[roleCode]
  }));
}

function getRoleOptions(roleCode = getCurrentRoleCode()) {
  const normalized = normalizeRoleCode(roleCode);
  if (normalized === ROLE_CODES.SUPER_ADMIN) {
    return getAllRoleOptions();
  }
  return [{
    key: normalized || ROLE_CODES.DISPATCHER,
    label: getRoleLabel(normalized)
  }];
}

module.exports = {
  ROLE_CODES,
  normalizeRoleCode,
  getCurrentRoleCode,
  setCurrentRoleCode,
  getRoleLabel,
  getRolePermissions,
  hasPermission,
  canConfirmPayment,
  canSubmitLockedChangeApproval,
  getFieldVisibility,
  displayFieldValue,
  getAllRoleOptions,
  getRoleOptions
};
