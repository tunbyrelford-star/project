const { listOnsiteTasks, confirmLighteringEmpty } = require("../../../services/onsite");

const FILTER_TEMPLATE = [
  { key: "ALL", label: "全部" },
  { key: "WAIT_LIGHTERING", label: "待过驳" },
  { key: "WAIT_EMPTY_CONFIRM", label: "待卸空" },
  { key: "WAIT_STOCK_IN", label: "待入库确认" },
  { key: "WAIT_EXPENSE", label: "待录费用" },
  { key: "WAIT_EXCEPTION", label: "待处理异常" }
];

function urgencyTagType(level) {
  if (level === "HIGH") return "danger";
  if (level === "MEDIUM") return "warning";
  return "success";
}

function stepTagType(step) {
  if (step === "待处理异常") return "danger";
  if (step === "待卸空") return "warning";
  if (step === "待入库确认") return "info";
  return "default";
}

function toUrgencyText(level) {
  if (level === "HIGH") return "高";
  if (level === "MEDIUM") return "中";
  return "低";
}

Page({
  data: {
    loading: true,
    showError: false,
    errorText: "加载失败，请重试",
    activeType: "ALL",
    filters: FILTER_TEMPLATE,
    list: [],
    actionTaskKey: ""
  },

  onLoad(options) {
    const type = String((options && options.type) || "").trim().toUpperCase();
    const supported = FILTER_TEMPLATE.some((item) => item.key === type);
    if (supported) {
      this.setData({ activeType: type });
    }
    this.loadTasks();
  },

  onPullDownRefresh() {
    this.loadTasks().finally(() => wx.stopPullDownRefresh());
  },

  onFilterChange(event) {
    this.setData({ activeType: event.detail.key || "ALL" });
    this.loadTasks();
  },

  onRetry() {
    this.loadTasks();
  },
  onTapAction(event) {
    const dataset = event.currentTarget.dataset || {};
    const taskType = String(dataset.taskType || "");
    const taskId = Number(dataset.taskId || 0);
    const batchId = Number(dataset.batchId || 0);
    const voyageId = Number(dataset.voyageId || 0);
    const taskKey = String(dataset.taskKey || "");
    if (!taskType) return;

    if (taskType === "WAIT_EMPTY_CONFIRM") {
      if (!taskId) {
        wx.showToast({ title: "Missing task params", icon: "none" });
        return;
      }
      if (this.data.actionTaskKey) return;

      this.setData({ actionTaskKey: taskKey || `${taskType}-${taskId}` });
      confirmLighteringEmpty(taskId, { note: "Mobile confirm empty" })
        .then((res) => {
          wx.showToast({ title: res.message || "Confirmed", icon: "none" });
          this.loadTasks();
        })
        .catch((err) => {
          wx.showToast({ title: err.message || "Operation failed", icon: "none" });
        })
        .finally(() => {
          this.setData({ actionTaskKey: "" });
        });
      return;
    }

    if (taskType === "WAIT_STOCK_IN") {
      if (!batchId) {
        wx.showToast({ title: "Missing batchId", icon: "none" });
        return;
      }
      wx.navigateTo({ url: `/pages/onsite/stockin-confirm/index?batchId=${batchId}` });
      return;
    }

    if (taskType === "WAIT_EXPENSE") {
      if (!voyageId) {
        wx.showToast({ title: "Missing voyageId", icon: "none" });
        return;
      }
      wx.navigateTo({ url: `/pages/onsite/expense-create/index?voyageId=${voyageId}` });
      return;
    }

    if (taskType === "WAIT_EXCEPTION") {
      wx.navigateTo({ url: "/pages/alerts/alerts" });
      return;
    }

    wx.showToast({ title: "Please handle onsite lightering", icon: "none" });
  },

  loadTasks() {
    this.setData({ loading: true, showError: false });
    return listOnsiteTasks({
      type: this.data.activeType
    })
      .then((res) => {
        const sections = res.sections || [];
        const sectionMap = {};
        sections.forEach((section) => {
          sectionMap[section.key] = section.count;
        });

        const filters = FILTER_TEMPLATE.map((f) => {
          if (f.key === "ALL") {
            const total = sections.reduce((sum, s) => sum + Number(s.count || 0), 0);
            return { ...f, label: `全部(${total})` };
          }
          const count = Number(sectionMap[f.key] || 0);
          return { ...f, label: `${f.label}(${count})` };
        });

        const list = (res.items || []).map((item) => ({
          ...item,
          taskKey: `${item.taskType || "TASK"}-${item.taskId || Math.random()}`,
          urgencyText: toUrgencyText(item.urgency),
          urgencyType: urgencyTagType(item.urgency),
          stepType: stepTagType(item.currentStep),
          statusText: item.statusTag || "-"
        }));

        this.setData({
          filters,
          list,
          loading: false
        });
      })
      .catch((error) => {
        const statusCode = Number((error && error.statusCode) || 0);
        const message = statusCode === 403
          ? "当前角色无权限访问现场待办"
          : ((error && error.message) || "加载失败，请重试");
        this.setData({
          loading: false,
          showError: true,
          errorText: message
        });
      });
  }
});
