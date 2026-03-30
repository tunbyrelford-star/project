const { listExpenses } = require("../../../services/onsite");

const STATUS_FILTERS = [
  { key: "ALL", label: "全部" },
  { key: "DRAFT", label: "草稿" },
  { key: "CONFIRMED", label: "已确认" }
];

const TYPE_OPTIONS = [
  { label: "全部类型", value: "" },
  { label: "运费", value: "FREIGHT" },
  { label: "过驳费", value: "LIGHTERING" },
  { label: "吊机费", value: "CRANE" },
  { label: "港杂费", value: "PORT_MISC" },
  { label: "其他", value: "OTHER" }
];

const STATUS_LABEL_MAP = {
  DRAFT: "草稿",
  CONFIRMED: "已确认",
  VOID: "已作废"
};

const EXPENSE_TYPE_LABEL_MAP = {
  FREIGHT: "运费",
  LIGHTERING: "过驳费",
  CRANE: "吊机费",
  PORT_MISC: "港杂费",
  OTHER: "其他"
};

function statusTone(status) {
  const code = String(status || "").toUpperCase();
  if (code === "CONFIRMED") return "success";
  if (code === "DRAFT") return "warning";
  if (code === "VOID") return "danger";
  return "info";
}

function mapStatusLabel(status) {
  const code = String(status || "").toUpperCase();
  return STATUS_LABEL_MAP[code] || (code ? "处理中" : "-");
}

function mapExpenseTypeLabel(expenseType) {
  const code = String(expenseType || "").toUpperCase();
  return EXPENSE_TYPE_LABEL_MAP[code] || (code ? "其他" : "-");
}

Page({
  data: {
    loading: true,
    showError: false,
    keyword: "",
    activeStatus: "ALL",
    filters: STATUS_FILTERS,
    typeOptions: TYPE_OPTIONS,
    typeIndex: 0,
    list: [],
    canViewAmount: false
  },

  onLoad() {
    this.loadList();
  },

  onPullDownRefresh() {
    this.loadList().finally(() => wx.stopPullDownRefresh());
  },

  onRetry() {
    this.loadList();
  },

  onSearch(event) {
    this.setData({ keyword: event.detail.keyword || "" });
    this.loadList();
  },

  onFilterChange(event) {
    this.setData({ activeStatus: event.detail.key || "ALL" });
    this.loadList();
  },

  onTypeChange(event) {
    this.setData({ typeIndex: Number(event.detail.value || 0) });
    this.loadList();
  },

  onTapDetail(event) {
    const id = Number(event.currentTarget.dataset.id || 0);
    if (!id) return;
    wx.navigateTo({ url: `/pages/onsite/expense-detail/index?id=${id}` });
  },

  onTapCreate() {
    wx.navigateTo({ url: "/pages/onsite/expense-create/index" });
  },

  loadList() {
    this.setData({ loading: true, showError: false });
    const status = this.data.activeStatus === "ALL" ? "" : this.data.activeStatus;
    const expenseType = this.data.typeOptions[this.data.typeIndex].value;
    return listExpenses({
      keyword: this.data.keyword,
      status,
      expenseType
    })
      .then((res) => {
        const list = (res.items || []).map((item) => ({
          ...item,
          statusTone: statusTone(item.status),
          statusText: mapStatusLabel(item.status),
          expenseTypeText: mapExpenseTypeLabel(item.expenseType)
        }));
        this.setData({
          loading: false,
          list,
          canViewAmount: Boolean(res.canViewAmount)
        });
      })
      .catch(() => {
        this.setData({ loading: false, showError: true });
      });
  }
});
