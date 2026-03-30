const {
  listProcurements,
  startSanding,
  checkSandingTimeout
} = require("../../../services/procurement");

const ACTION_CODES = {
  START_SANDING: "START_SANDING",
  CHECK_TIMEOUT: "CHECK_TIMEOUT",
  HANDLE_TIMEOUT: "HANDLE_TIMEOUT",
  VIEW_DETAIL: "VIEW_DETAIL"
};

function toStatusMeta(status) {
  const code = String(status || "").toUpperCase();
  switch (code) {
    case "DISPATCHED":
      return { text: "已派船", type: "info" };
    case "SANDING":
      return { text: "打砂中", type: "warning" };
    case "IN_TRANSIT":
      return { text: "运输中", type: "info" };
    case "WAIT_LIGHTERING":
      return { text: "待过驳", type: "warning" };
    case "COMPLETED":
      return { text: "已完成", type: "success" };
    case "VOID":
      return { text: "作废", type: "danger" };
    default:
      return { text: code || "未知", type: "warning" };
  }
}

function inferActionCode(status, hasOpenAlert) {
  const code = String(status || "").toUpperCase();
  if (code === "DISPATCHED") return ACTION_CODES.START_SANDING;
  if (code === "SANDING") {
    return hasOpenAlert ? ACTION_CODES.HANDLE_TIMEOUT : ACTION_CODES.CHECK_TIMEOUT;
  }
  return ACTION_CODES.VIEW_DETAIL;
}

function actionLabel(actionCode) {
  if (actionCode === ACTION_CODES.START_SANDING) return "开始打砂";
  if (actionCode === ACTION_CODES.CHECK_TIMEOUT) return "检测超时";
  if (actionCode === ACTION_CODES.HANDLE_TIMEOUT) return "去处理超时";
  return "查看详情";
}

function toDurationText(durationMin) {
  const value = Number(durationMin || 0);
  if (!value) return "-";
  return `${value} 分钟`;
}

Page({
  data: {
    loading: true,
    showError: false,
    keyword: "",
    statusFilters: [
      { key: "ALL", label: "全部" },
      { key: "DISPATCHED", label: "已派船" },
      { key: "SANDING", label: "打砂中" },
      { key: "IN_TRANSIT", label: "运输中" },
      { key: "WAIT_LIGHTERING", label: "待过驳" },
      { key: "COMPLETED", label: "已完成" }
    ],
    activeStatus: "ALL",
    list: [],
    actionLoadingId: 0
  },

  onLoad() {
    this.loadList();
  },

  onShow() {
    this.loadList();
  },

  onPullDownRefresh() {
    this.loadList().finally(() => wx.stopPullDownRefresh());
  },

  onFilterChange(event) {
    this.setData({ activeStatus: event.detail.key || "ALL" });
    this.loadList();
  },

  onSearch(event) {
    this.setData({ keyword: event.detail.keyword || "" });
    this.loadList();
  },

  onRetry() {
    this.loadList();
  },

  onTapCreate() {
    wx.navigateTo({ url: "/pages/procurement/create/index" });
  },

  onTapDetail(event) {
    const id = Number(event.currentTarget.dataset.id || 0);
    if (!id) return;
    wx.navigateTo({ url: `/pages/procurement/detail/index?id=${id}` });
  },

  onTapAction(event) {
    const id = Number(event.currentTarget.dataset.id || 0);
    const actionCode = String(
      event.currentTarget.dataset.actionCode || ACTION_CODES.VIEW_DETAIL
    );
    if (!id) return;

    if (actionCode === ACTION_CODES.VIEW_DETAIL) {
      this.onTapDetail(event);
      return;
    }

    if (actionCode === ACTION_CODES.HANDLE_TIMEOUT) {
      wx.navigateTo({ url: `/pages/procurement/detail/index?id=${id}&openTimeout=1` });
      return;
    }

    if (this.data.actionLoadingId) return;
    this.setData({ actionLoadingId: id });

    const actionTask =
      actionCode === ACTION_CODES.START_SANDING
        ? startSanding(id)
        : checkSandingTimeout(id);

    actionTask
      .then((res) => {
        if (actionCode === ACTION_CODES.START_SANDING) {
          wx.showToast({
            title: (res && res.message) || "已开始打砂",
            icon: "none"
          });
        } else {
          const toast =
            res && res.triggered
              ? res.createdNew
                ? "已触发超时预警"
                : "超时预警已存在"
              : "当前未超时";
          wx.showToast({ title: toast, icon: "none" });

          if (res && res.triggered) {
            setTimeout(() => {
              wx.navigateTo({ url: `/pages/procurement/detail/index?id=${id}&openTimeout=1` });
            }, 300);
          }
        }
        this.loadList();
      })
      .catch((err) => {
        wx.showToast({
          title: (err && err.message) || "操作失败",
          icon: "none"
        });
      })
      .finally(() => {
        this.setData({ actionLoadingId: 0 });
      });
  },

  loadList() {
    const status = this.data.activeStatus === "ALL" ? "" : this.data.activeStatus;
    this.setData({ loading: true, showError: false });
    return listProcurements({
      keyword: this.data.keyword,
      status
    })
      .then((res) => {
        const list = (res.items || []).map((item) => {
          const statusMeta = toStatusMeta(item.status);
          const hasOpenAlert = Boolean(item.alert_id && item.alert_status !== "CLOSED");
          const actionCode = inferActionCode(item.status, hasOpenAlert);
          return {
            ...item,
            procurementNo: item.procurement_no || item.procurementNo || "-",
            shipName: item.ship_name || item.shipName || "-",
            voyageNo: item.voyage_no || item.voyageNo || "-",
            plannedQty: item.planned_qty == null ? "-" : item.planned_qty,
            statusText: statusMeta.text,
            statusType: statusMeta.type,
            abnormalText: hasOpenAlert ? "异常" : "正常",
            abnormalType: hasOpenAlert ? "danger" : "success",
            durationText: toDurationText(item.work_duration_min),
            nextActionCode: actionCode,
            nextActionText: actionLabel(actionCode)
          };
        });
        this.setData({ list, loading: false });
      })
      .catch(() => {
        this.setData({ loading: false, showError: true });
      });
  }
});
