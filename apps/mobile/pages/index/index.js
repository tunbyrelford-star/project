const { fetchWorkbenchAggregate } = require("../../services/workbench");
const {
  ROLE_CODES,
  getCurrentRoleCode,
  getRoleOptions,
  getRoleLabel,
  setCurrentRoleCode
} = require("../../utils/rbac");
const { getLoginSession, clearLoginSession, hasLoginSession } = require("../../utils/auth");
const { navigateByUrl } = require("../../utils/navigation");

function resolveQuickEntryMeta(entry = {}) {
  const path = String(entry.path || "").toLowerCase();
  const title = String(entry.title || "").toLowerCase();
  const source = `${path} ${title}`;

  if (source.includes("/orders")) return { iconText: "OD", iconType: "order" };
  if (source.includes("/procurement")) return { iconText: "PR", iconType: "procurement" };
  if (source.includes("/ship")) return { iconText: "SP", iconType: "ship" };
  if (source.includes("/onsite") || source.includes("/alerts")) return { iconText: "OS", iconType: "onsite" };
  if (source.includes("/sales")) return { iconText: "SA", iconType: "sales" };
  if (source.includes("/finance")) return { iconText: "FN", iconType: "finance" };
  if (source.includes("/governance") || source.includes("/ui-kit")) return { iconText: "GV", iconType: "governance" };
  return { iconText: "GO", iconType: "default" };
}

function withQuickEntryMeta(list = []) {
  return (list || []).map((entry) => ({
    ...entry,
    ...resolveQuickEntryMeta(entry)
  }));
}

Page({
  data: {
    loading: true,
    showError: false,
    roleCode: "",
    roleName: "",
    roleOptions: [],
    title: "工作台",
    todo: [],
    alerts: [],
    stats: [],
    quickEntries: [],
    permissions: {
      canConfirmPayment: false,
      lockedChangeRequiresApproval: true,
      auditLogDeletable: false
    },
    serverTime: "",
    currentUser: {
      username: "",
      displayName: "",
      isSuperAdmin: false
    }
  },

  onLoad() {
    if (!hasLoginSession()) {
      wx.reLaunch({ url: "/pages/auth/login/index" });
      return;
    }

    const session = getLoginSession();
    const roleCode = session.roleCode || getCurrentRoleCode();
    const roleOptions = getRoleOptions(roleCode);

    this.setData({
      roleOptions,
      roleCode,
      roleName: getRoleLabel(roleCode),
      currentUser: {
        username: session.username || "",
        displayName: session.displayName || "",
        isSuperAdmin: roleCode === ROLE_CODES.SUPER_ADMIN
      }
    });

    this.loadWorkbench(roleCode);
  },

  onShow() {
    if (!hasLoginSession()) {
      wx.reLaunch({ url: "/pages/auth/login/index" });
    }
  },

  onPullDownRefresh() {
    this.loadWorkbench(this.data.roleCode).finally(() => {
      wx.stopPullDownRefresh();
    });
  },

  onRoleChange(event) {
    const roleCode = String(event.detail.key || "");
    const isAllowed = this.data.roleOptions.some((item) => item.key === roleCode);
    if (!isAllowed) return;

    setCurrentRoleCode(roleCode);
    this.setData({
      roleCode,
      roleName: getRoleLabel(roleCode)
    });
    this.loadWorkbench(roleCode);
  },

  onQuickTap(event) {
    const path = event.currentTarget.dataset.path;
    if (!path) return;
    navigateByUrl(path);
  },

  onLogout() {
    wx.showModal({
      title: "退出登录",
      content: "确认退出当前账号？",
      success: (res) => {
        if (!res.confirm) return;
        clearLoginSession();
        wx.reLaunch({ url: "/pages/auth/login/index" });
      }
    });
  },

  onRetry() {
    this.loadWorkbench(this.data.roleCode);
  },

  loadWorkbench(roleCode) {
    this.setData({ loading: true, showError: false });
    return fetchWorkbenchAggregate(roleCode)
      .then((data) => {
        this.setData({
          loading: false,
          showError: false,
          title: data.title || "工作台",
          todo: data.todo || [],
          alerts: data.alerts || [],
          stats: data.stats || [],
          quickEntries: withQuickEntryMeta(data.quickEntries || []),
          permissions: data.permissions || this.data.permissions,
          serverTime: data.serverTime || ""
        });
      })
      .catch(() => {
        this.setData({ loading: false, showError: true });
      });
  }
});
