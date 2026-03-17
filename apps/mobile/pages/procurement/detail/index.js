const {
  getProcurementDetail,
  startSanding,
  checkSandingTimeout,
  closeAlert
} = require("../../../services/procurement");

function parseArray(value) {
  if (Array.isArray(value)) return value;
  if (!value) return [];
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value);
      return Array.isArray(parsed) ? parsed : [];
    } catch (_error) {
      return [];
    }
  }
  return [];
}

function toAuditText(value) {
  if (value == null) return "";
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value);
  } catch (_error) {
    return String(value);
  }
}

function toFiles(paths, prefix) {
  return (paths || [])
    .map((path) => String(path || "").trim())
    .filter(Boolean)
    .map((path, idx) => ({
      name: `${prefix}_${idx + 1}`,
      path,
      size: 0
    }));
}

Page({
  data: {
    id: 0,
    loading: true,
    showError: false,
    detail: null,
    alerts: [],
    audits: [],
    miningTicketFiles: [],
    qualityPhotoFiles: [],
    startSandingLoading: false,
    checkTimeoutLoading: false,
    closingAlertId: 0
  },

  onLoad(options) {
    const id = Number(options.id || 0);
    if (!id) {
      wx.showToast({ title: "参数错误", icon: "none" });
      return;
    }
    this.setData({ id });
    this.loadDetail();
  },

  onPullDownRefresh() {
    this.loadDetail().finally(() => {
      wx.stopPullDownRefresh();
    });
  },

  onRetry() {
    this.loadDetail();
  },

  onPrimaryAction() {
    const status = String((this.data.detail && this.data.detail.status) || "").toUpperCase();
    if (status === "DISPATCHED") {
      this.onStartSanding();
      return;
    }
    if (status === "SANDING") {
      this.onCheckTimeout();
      return;
    }
    this.loadDetail();
  },

  onSecondaryAction() {
    const voyageId = Number((this.data.detail && this.data.detail.voyage_id) || 0);
    if (!voyageId) {
      wx.showToast({ title: "暂无关联航次", icon: "none" });
      return;
    }
    wx.navigateTo({ url: `/pages/voyage/detail/index?id=${voyageId}` });
  },

  onViewVoyage() {
    this.onSecondaryAction();
  },

  onMiningTicketChange(event) {
    const files = ((event.detail || {}).files || []).slice(0, 1);
    this.setData({ miningTicketFiles: files });
  },

  onQualityPhotoChange(event) {
    const files = ((event.detail || {}).files || []).slice(0, 8);
    this.setData({ qualityPhotoFiles: files });
  },

  onStartSanding() {
    if (this.data.startSandingLoading) return;

    const miningTicket = String((((this.data.miningTicketFiles || [])[0] || {}).path) || "").trim();
    const qualityPhotos = (this.data.qualityPhotoFiles || [])
      .map((item) => String(item.path || "").trim())
      .filter(Boolean);

    if (!miningTicket || !qualityPhotos.length) {
      wx.showToast({ title: "请先上传采砂单和质量照片", icon: "none" });
      return;
    }

    this.setData({ startSandingLoading: true });
    startSanding(this.data.id, {
      miningTicket,
      miningTicketUrl: miningTicket,
      qualityPhotos,
      qualityPhotoUrls: qualityPhotos
    })
      .then((res) => {
        wx.showToast({
          title: (res && res.message) || "已开始打砂",
          icon: "none"
        });
        this.loadDetail();
      })
      .catch((err) => {
        wx.showToast({
          title: (err && err.message) || "操作失败",
          icon: "none"
        });
      })
      .finally(() => {
        this.setData({ startSandingLoading: false });
      });
  },

  onCheckTimeout() {
    if (this.data.checkTimeoutLoading) return;
    this.setData({ checkTimeoutLoading: true });
    checkSandingTimeout(this.data.id)
      .then((res) => {
        const toast =
          res && res.triggered
            ? res.createdNew
              ? "已触发超时预警"
              : "超时预警已存在"
            : "当前未超时";
        wx.showToast({ title: toast, icon: "none" });
        this.loadDetail();
      })
      .catch((err) => {
        wx.showToast({
          title: (err && err.message) || "检测失败",
          icon: "none"
        });
      })
      .finally(() => {
        this.setData({ checkTimeoutLoading: false });
      });
  },

  onCloseAlert(event) {
    const alertId = Number(event.currentTarget.dataset.id || 0);
    if (!alertId || this.data.closingAlertId) return;

    wx.showModal({
      title: "关闭预警",
      content: "确认关闭当前预警并写入处理记录？",
      success: (result) => {
        if (!result.confirm) return;
        this.setData({ closingAlertId: alertId });
        closeAlert(alertId, "采购详情页关闭预警")
          .then((res) => {
            wx.showToast({
              title: (res && res.message) || "预警已关闭",
              icon: "none"
            });
            this.loadDetail();
          })
          .catch((err) => {
            wx.showToast({
              title: (err && err.message) || "关闭失败",
              icon: "none"
            });
          })
          .finally(() => {
            this.setData({ closingAlertId: 0 });
          });
      }
    });
  },

  loadDetail() {
    this.setData({ loading: true, showError: false });
    return getProcurementDetail(this.data.id)
      .then((res) => {
        const detail = res.detail || {};
        const qualityPhotos = parseArray(detail.quality_photos || detail.quality_photo_urls);
        const miningTicket = String(detail.mining_ticket || detail.mining_ticket_url || "").trim();
        const miningTicketFiles = miningTicket
          ? [{ name: "mining_ticket_1", path: miningTicket, size: 0 }]
          : [];
        const qualityPhotoFiles = toFiles(qualityPhotos, "quality_photo");

        const audits = (res.audits || []).map((item) => ({
          action: item.action,
          actor: item.actor_user_id ? `用户#${item.actor_user_id}` : "系统",
          time: item.event_time,
          note: toAuditText(item.after_data || item.before_data || "")
        }));

        this.setData({
          detail: {
            ...detail,
            unitPriceDisplay:
              detail.unit_price == null ? "***" : String(detail.unit_price),
            totalAmountDisplay:
              detail.total_amount == null ? "***" : String(detail.total_amount)
          },
          alerts: res.alerts || [],
          audits,
          miningTicketFiles,
          qualityPhotoFiles,
          loading: false
        });
      })
      .catch(() => {
        this.setData({ loading: false, showError: true });
      });
  }
});
