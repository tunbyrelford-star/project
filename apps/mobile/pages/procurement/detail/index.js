const {
  getProcurementDetail,
  startSanding,
  checkSandingTimeout,
  handleSandingTimeout,
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

function toNumber(value, fallback = 0) {
  const num = Number(value);
  return Number.isFinite(num) ? num : fallback;
}

Page({
  data: {
    id: 0,
    pendingOpenTimeout: false,
    loading: true,
    showError: false,
    detail: {},
    alerts: [],
    audits: [],
    miningTicketFiles: [],
    qualityPhotoFiles: [],
    startSandingLoading: false,
    checkTimeoutLoading: false,
    closingAlertId: 0,
    timeoutInfo: null,
    timeoutExpenses: [],
    timeoutFormVisible: false,
    timeoutSubmitting: false,
    timeoutForm: {
      calcMode: "HOURLY_RATE",
      handlingNote: "",
      ratePerHour: "150",
      manualAmount: "",
      calculationNote: ""
    }
  },

  onLoad(options) {
    const id = Number(options.id || 0);
    const pendingOpenTimeout = String(options.openTimeout || "") === "1";
    if (!id) {
      wx.showToast({ title: "参数错误", icon: "none" });
      return;
    }
    this.setData({ id, pendingOpenTimeout });
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

  onToggleTimeoutForm() {
    this.setData({ timeoutFormVisible: !this.data.timeoutFormVisible });
  },

  onTimeoutInput(event) {
    const field = String((event.currentTarget.dataset || {}).field || "").trim();
    if (!field) return;
    this.setData({ [`timeoutForm.${field}`]: event.detail.value || "" });
  },

  onTimeoutModeChange(event) {
    const value = Number((event.detail || {}).value || 0);
    this.setData({ "timeoutForm.calcMode": value === 1 ? "MANUAL" : "HOURLY_RATE" });
  },

  onHandleTimeout() {
    if (this.data.timeoutSubmitting) return;

    const timeoutInfo = this.data.timeoutInfo || {};
    if (!timeoutInfo.isOvertime) {
      wx.showToast({ title: "当前未超时", icon: "none" });
      return;
    }

    const form = this.data.timeoutForm || {};
    const calcMode = String(form.calcMode || "HOURLY_RATE").toUpperCase();
    const handlingNote = String(form.handlingNote || "").trim();
    const calculationNote = String(form.calculationNote || "").trim();
    const ratePerHour = toNumber(form.ratePerHour, 0);
    const manualAmount = toNumber(form.manualAmount, 0);

    if (!handlingNote) {
      wx.showToast({ title: "请填写处理说明", icon: "none" });
      return;
    }
    if (calcMode === "HOURLY_RATE" && ratePerHour <= 0) {
      wx.showToast({ title: "请填写有效费率", icon: "none" });
      return;
    }
    if (calcMode === "MANUAL" && manualAmount < 0) {
      wx.showToast({ title: "请填写有效金额", icon: "none" });
      return;
    }

    this.setData({ timeoutSubmitting: true });
    handleSandingTimeout(this.data.id, {
      calcMode,
      handlingNote,
      calculationNote,
      ratePerHour: calcMode === "HOURLY_RATE" ? ratePerHour : null,
      manualAmount: calcMode === "MANUAL" ? manualAmount : null
    })
      .then((res) => {
        wx.showToast({
          title: (res && res.message) || "超时处理完成",
          icon: "none"
        });
        this.setData({
          timeoutFormVisible: false,
          timeoutForm: {
            ...this.data.timeoutForm,
            handlingNote: "",
            calculationNote: "",
            manualAmount: ""
          }
        });
        this.loadDetail();
      })
      .catch((err) => {
        wx.showToast({
          title: (err && err.message) || "处理失败",
          icon: "none"
        });
      })
      .finally(() => {
        this.setData({ timeoutSubmitting: false });
      });
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
        let toast = "当前未超时";
        if (res && res.triggered) {
          toast = res.createdNew ? "已触发超时预警" : "超时预警已存在";
        }
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
    const alertId = Number((event.currentTarget.dataset || {}).id || 0);
    if (!alertId || this.data.closingAlertId) return;

    wx.showModal({
      title: "关闭预警",
      content: "确认关闭当前预警并写入处理记录？",
      success: (result) => {
        if (!result.confirm) return;

        this.setData({ closingAlertId: alertId });
        closeAlert(alertId, "采购详情页手动关闭预警")
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
        const requestOpenTimeout = Boolean(this.data.pendingOpenTimeout);
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

        const currentRate = toNumber(
          res.timeout && res.timeout.latestExpense && res.timeout.latestExpense.overtimeRate,
          toNumber(this.data.timeoutForm.ratePerHour, 150)
        );

        const nextData = {
          detail: {
            ...detail,
            unitPriceDisplay:
              detail.unit_price == null ? "***" : String(detail.unit_price),
            totalAmountDisplay:
              detail.total_amount == null ? "***" : String(detail.total_amount)
          },
          alerts: res.alerts || [],
          audits,
          timeoutInfo: res.timeout || null,
          timeoutExpenses: res.timeoutExpenses || [],
          miningTicketFiles,
          qualityPhotoFiles,
          pendingOpenTimeout: false,
          timeoutForm: {
            ...this.data.timeoutForm,
            ratePerHour: String(currentRate)
          },
          loading: false
        };

        if (requestOpenTimeout) {
          const timeout = res.timeout || null;
          nextData.timeoutFormVisible = Boolean(
            timeout && timeout.isOvertime && !timeout.hasOvertimeExpense
          );
        }

        this.setData(nextData, () => {
          if (!requestOpenTimeout) return;
          const timeout = res.timeout || null;
          if (!timeout || !timeout.isOvertime) {
            wx.showToast({ title: "当前无可处理超时", icon: "none" });
            return;
          }
          if (timeout.hasOvertimeExpense) {
            wx.showToast({ title: "该超时已处理，可查看费用记录", icon: "none" });
          }
        });
      })
      .catch(() => {
        this.setData({ loading: false, showError: true });
      });
  }
});
