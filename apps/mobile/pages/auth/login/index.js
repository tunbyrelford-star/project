const { login } = require("../../../services/auth");
const { ROLE_CODES, getAllRoleOptions } = require("../../../utils/rbac");
const { saveLoginSession, hasLoginSession } = require("../../../utils/auth");
const {
  getBaseUrl,
  getFallbackBaseUrls,
  setBaseUrl,
  normalizeBaseUrl,
  isLoopbackBaseUrl,
  findPreferredBaseUrlForRuntime
} = require("../../../config/env");

function normalizeBackendInput(rawInput) {
  let nextUrl = normalizeBaseUrl(rawInput || "");
  if (!nextUrl) {
    return "";
  }
  if (!/^https?:\/\//i.test(nextUrl)) {
    nextUrl = `http://${nextUrl}`;
  }
  const match = nextUrl.match(/^(https?):\/\/([^\/?#]+)(?:[\/?#].*)?$/i);
  if (!match) {
    throw new Error("INVALID_BASE_URL");
  }
  const protocol = String(match[1] || "http").toLowerCase();
  const host = String(match[2] || "").trim();
  if (!host) {
    throw new Error("INVALID_BASE_URL");
  }
  return `${protocol}://${host}/api`;
}

Page({
  data: {
    submitting: false,
    roleOptions: [],
    roleIndex: 0,
    form: {
      username: "",
      password: ""
    },
    canSubmit: false,
    isRealDevice: false,
    backendBaseUrl: "",
    backendInput: "",
    backendCandidates: [],
    backendCandidatesText: "",
    demoUsers: [
      { username: "admin", password: "admin123", role: "超级管理员（全权限）" },
      { username: "dispatcher", password: "123456", role: "采购/调度员" },
      { username: "onsite", password: "123456", role: "现场/过驳专员" },
      { username: "sales", password: "123456", role: "销售经理/销售员" },
      { username: "finance", password: "123456", role: "财务/管理层" }
    ]
  },

  onLoad() {
    if (hasLoginSession()) {
      wx.switchTab({ url: "/pages/index/index" });
      return;
    }

    const roleOptions = getAllRoleOptions();
    const roleIndex = Math.max(
      0,
      roleOptions.findIndex((x) => x.key === ROLE_CODES.DISPATCHER)
    );

    let isRealDevice = false;
    try {
      const systemInfo = wx.getSystemInfoSync();
      isRealDevice = String(systemInfo.platform || "").toLowerCase() !== "devtools";
    } catch (_error) {
      isRealDevice = false;
    }

    this.setData({ roleOptions, roleIndex, isRealDevice });
    this.ensureRuntimeBaseUrl();
    this.refreshBackendInfo();
  },

  onShow() {
    this.refreshBackendInfo();
  },

  ensureRuntimeBaseUrl() {
    const baseUrls = getFallbackBaseUrls();
    const preferred = findPreferredBaseUrlForRuntime(baseUrls, this.data.isRealDevice);
    if (!preferred) return;
    if (preferred !== getBaseUrl()) {
      setBaseUrl(preferred);
    }
  },

  refreshBackendInfo() {
    const backendBaseUrl = getBaseUrl();
    const backendCandidates = getFallbackBaseUrls();
    const backendCandidatesText = backendCandidates.join("  |  ");
    this.setData({
      backendBaseUrl,
      backendInput: backendBaseUrl,
      backendCandidates,
      backendCandidatesText
    });
  },

  onInput(event) {
    const field = event.currentTarget.dataset.field;
    if (!field) return;

    this.setData({ [`form.${field}`]: event.detail.value || "" });
    this.refreshCanSubmit();
  },

  onRoleChange(event) {
    this.setData({ roleIndex: Number(event.detail.value || 0) });
  },

  onQuickFill(event) {
    const username = String(event.currentTarget.dataset.username || "");
    const password = String(event.currentTarget.dataset.password || "");

    this.setData({
      "form.username": username,
      "form.password": password
    });
    this.refreshCanSubmit();
  },

  onBackendInput(event) {
    this.setData({ backendInput: String(event.detail.value || "") });
  },

  onUseCandidate(event) {
    const baseUrl = String(event.currentTarget.dataset.url || "");
    if (!baseUrl) return;
    this.setData({ backendInput: baseUrl });
    this.onSaveBackend();
  },

  onSaveBackend() {
    let nextUrl = "";
    try {
      nextUrl = normalizeBackendInput(this.data.backendInput || "");
    } catch (_error) {
      wx.showToast({ title: "后端地址格式错误", icon: "none" });
      return;
    }

    if (!nextUrl) {
      wx.showToast({ title: "后端地址不能为空", icon: "none" });
      return;
    }

    if (this.data.isRealDevice && isLoopbackBaseUrl(nextUrl)) {
      wx.showToast({ title: "真机不能使用127.0.0.1", icon: "none" });
      return;
    }

    setBaseUrl(nextUrl);
    this.refreshBackendInfo();
    wx.showToast({ title: "后端地址已保存", icon: "success" });
  },

  refreshCanSubmit() {
    const username = String(this.data.form.username || "").trim();
    const password = String(this.data.form.password || "").trim();
    this.setData({ canSubmit: Boolean(username && password) });
  },

  onSubmit() {
    if (this.data.submitting || !this.data.canSubmit) {
      return;
    }

    const roleCode = this.data.roleOptions[this.data.roleIndex]
      ? this.data.roleOptions[this.data.roleIndex].key
      : ROLE_CODES.DISPATCHER;

    const payload = {
      username: String(this.data.form.username || "").trim(),
      password: String(this.data.form.password || "").trim(),
      roleCode
    };

    this.setData({ submitting: true });

    login(payload)
      .then((res) => {
        saveLoginSession(res || {});
        this.refreshBackendInfo();
        wx.showToast({ title: "登录成功", icon: "success" });
        setTimeout(() => {
          wx.switchTab({ url: "/pages/index/index" });
        }, 120);
      })
      .catch((error) => {
        wx.showToast({
          title: (error && error.message) || "登录失败",
          icon: "none"
        });
      })
      .finally(() => {
        this.setData({ submitting: false });
      });
  }
});
