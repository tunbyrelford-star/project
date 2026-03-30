const { getLighteringDetail, confirmLighteringEmpty } = require("../../../services/onsite");

function safeJsonText(value) {
  if (value == null) return "";
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value);
      return JSON.stringify(parsed);
    } catch (_error) {
      return value;
    }
  }
  try {
    return JSON.stringify(value);
  } catch (_error) {
    return String(value);
  }
}

function statusTone(status) {
  const code = String(status || "").toUpperCase();
  if (code === "MAIN_EMPTY_CONFIRMED") return "success";
  if (code === "IN_PROGRESS") return "warning";
  if (code === "VOID") return "danger";
  return "default";
}

function statusText(status) {
  const code = String(status || "").toUpperCase();
  if (code === "DRAFT") return "草稿";
  if (code === "IN_PROGRESS") return "作业中";
  if (code === "MAIN_EMPTY_CONFIRMED") return "已卸空";
  if (code === "VOID") return "作废";
  return code || "-";
}

function auditActionText(action) {
  const code = String(action || "").toUpperCase();
  if (code === "LIGHTERING_CONFIRM_EMPTY") return "确认主船已卸空";
  if (code === "LIGHTERING_CREATED") return "过驳单已创建";
  if (code === "LIGHTERING_UPDATED") return "过驳单已更新";
  return action || "-";
}

Page({
  data: {
    id: 0,
    loading: true,
    showError: false,
    confirming: false,
    detail: null,
    items: [],
    audits: [],
    attachments: []
  },

  onLoad(options) {
    const id = Number((options && options.id) || 0);
    if (!id) {
      wx.showToast({ title: "参数错误", icon: "none" });
      return;
    }
    this.setData({ id });
    this.loadDetail();
  },

  onPullDownRefresh() {
    this.loadDetail().finally(() => wx.stopPullDownRefresh());
  },

  onRetry() {
    this.loadDetail();
  },

  onToList() {
    wx.navigateTo({ url: "/pages/onsite/lightering-list/index" });
  },

  onTapEdit() {
    const detail = this.data.detail || {};
    if (!detail.canEdit) {
      wx.showToast({ title: "当前状态不可编辑", icon: "none" });
      return;
    }
    wx.navigateTo({ url: `/pages/onsite/lightering-form/index?id=${this.data.id}` });
  },

  onGoVoyage() {
    const voyageId = Number((this.data.detail && this.data.detail.voyageId) || 0);
    if (!voyageId) {
      wx.showToast({ title: "暂无航次信息", icon: "none" });
      return;
    }
    wx.navigateTo({ url: `/pages/voyage/detail/index?id=${voyageId}` });
  },

  onConfirmEmpty() {
    if (this.data.confirming) return;
    const detail = this.data.detail || {};
    if (!detail.canConfirmEmpty) {
      wx.showToast({ title: "当前状态不可确认卸空", icon: "none" });
      return;
    }

    wx.showModal({
      title: "确认主船已卸空",
      content: "确认后将锁定航次并自动生成结算版本 v1，仅固化成本。",
      confirmColor: "#0B3B66",
      success: (modalRes) => {
        if (!modalRes.confirm) return;

        this.setData({ confirming: true });
        confirmLighteringEmpty(this.data.id, { note: "由过驳详情页确认卸空。" })
          .then(() => {
            wx.showToast({ title: "已确认卸空，航次已锁定", icon: "none" });
            this.loadDetail();
          })
          .catch((err) => {
            wx.showToast({ title: (err && err.message) || "操作失败", icon: "none" });
          })
          .finally(() => {
            this.setData({ confirming: false });
          });
      }
    });
  },

  onPrimaryAction() {
    const detail = this.data.detail || {};
    if (detail.canConfirmEmpty) {
      this.onConfirmEmpty();
      return;
    }
    if (detail.canEdit) {
      this.onTapEdit();
      return;
    }
    this.onGoVoyage();
  },

  loadDetail() {
    this.setData({ loading: true, showError: false });
    return getLighteringDetail(this.data.id)
      .then((res) => {
        const detail = res.detail || {};
        this.setData({
          loading: false,
          detail: {
            ...detail,
            statusText: statusText(detail.status),
            statusTone: statusTone(detail.status),
            unloadText: detail.unloadEmptyConfirmed ? "已卸空" : "未卸空"
          },
          items: res.items || [],
          attachments: (detail.attachments || []).map((url, index) => ({
            name: `附件${index + 1}`,
            path: url,
            size: 0
          })),
          audits: (res.audits || []).map((item) => ({
            action: auditActionText(item.action),
            actor: item.actorUserId ? `用户#${item.actorUserId}` : "系统",
            time: item.eventTime,
            note: safeJsonText(item.afterData || item.beforeData || "")
          }))
        });
      })
      .catch(() => {
        this.setData({ loading: false, showError: true });
      });
  }
});
