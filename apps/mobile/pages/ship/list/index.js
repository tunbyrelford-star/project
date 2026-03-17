const { listShips } = require("../../../services/ship");

const STATUS_FILTERS = [
  { key: "ALL", label: "全部" },
  { key: "IDLE", label: "启用" },
  { key: "IN_VOYAGE", label: "作业中" },
  { key: "MAINTENANCE", label: "维修" },
  { key: "DISABLED", label: "停用" }
];

const SHIP_TYPE_OPTIONS = ["全部类型", "砂石运输船", "散货船", "驳船", "自卸船", "其他"];
const TONNAGE_OPTIONS = [
  { label: "全部载重", min: null, max: null },
  { label: "1000 吨以下", min: null, max: 999.999 },
  { label: "1000~3000 吨", min: 1000, max: 3000 },
  { label: "3000 吨以上", min: 3000.001, max: null }
];

function formatTime(value) {
  if (!value) return "暂无定位";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "暂无定位";
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  const hh = String(date.getHours()).padStart(2, "0");
  const mm = String(date.getMinutes()).padStart(2, "0");
  return `${y}-${m}-${d} ${hh}:${mm}`;
}

function toStatusTag(status) {
  switch (status) {
    case "IDLE":
      return { text: "启用", type: "success" };
    case "IN_VOYAGE":
      return { text: "作业中", type: "info" };
    case "MAINTENANCE":
      return { text: "维修", type: "warning" };
    case "DISABLED":
      return { text: "停用", type: "danger" };
    default:
      return { text: status || "未知", type: "warning" };
  }
}

function formatTonnage(value) {
  if (value == null || value === "") return "-";
  const num = Number(value);
  if (!Number.isFinite(num)) return "-";
  return `${num.toFixed(3)} 吨`;
}

Page({
  data: {
    loading: true,
    showError: false,
    errorText: "加载失败，请重试",
    keyword: "",
    statusFilters: STATUS_FILTERS,
    activeStatus: "ALL",
    shipTypeOptions: SHIP_TYPE_OPTIONS,
    shipTypeIndex: 0,
    tonnageOptions: TONNAGE_OPTIONS,
    tonnageIndex: 0,
    list: []
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

  onShipTypeChange(event) {
    const index = Number(event.detail.value || 0);
    this.setData({ shipTypeIndex: index });
    this.loadList();
  },

  onTonnageChange(event) {
    const index = Number(event.detail.value || 0);
    this.setData({ tonnageIndex: index });
    this.loadList();
  },

  onCreate() {
    wx.navigateTo({ url: "/pages/ship/form/index" });
  },

  onTapDetail(event) {
    const id = Number(event.currentTarget.dataset.id || 0);
    if (!id) return;
    wx.navigateTo({ url: `/pages/ship/detail/index?id=${id}` });
  },

  onTapEdit(event) {
    const id = Number(event.currentTarget.dataset.id || 0);
    if (!id) return;
    wx.navigateTo({ url: `/pages/ship/form/index?id=${id}` });
  },

  buildQuery() {
    const query = {
      keyword: this.data.keyword || ""
    };
    if (this.data.activeStatus && this.data.activeStatus !== "ALL") {
      query.status = this.data.activeStatus;
    }

    const shipType = this.data.shipTypeOptions[this.data.shipTypeIndex];
    if (shipType && shipType !== "全部类型") {
      query.shipType = shipType;
    }

    const tonnageFilter = this.data.tonnageOptions[this.data.tonnageIndex];
    if (tonnageFilter) {
      if (tonnageFilter.min != null) query.minTonnage = tonnageFilter.min;
      if (tonnageFilter.max != null) query.maxTonnage = tonnageFilter.max;
    }
    return query;
  },

  loadList() {
    this.setData({ loading: true, showError: false });
    return listShips(this.buildQuery())
      .then((res) => {
        const list = (res.items || []).map((item) => {
          const statusTag = toStatusTag(item.status);
          return {
            ...item,
            statusText: statusTag.text,
            statusType: statusTag.type,
            lastPositionText: formatTime(item.lastPositionTime),
            tonnageText: formatTonnage(item.tonnage),
            shipTypeText: item.shipType || "-",
            onlineText:
              item.onlineStatus === "ONLINE"
                ? "在线"
                : item.onlineStatus === "OFFLINE"
                ? "离线"
                : "未知",
            onlineType:
              item.onlineStatus === "ONLINE"
                ? "success"
                : item.onlineStatus === "OFFLINE"
                ? "danger"
                : "warning"
          };
        });
        this.setData({
          list,
          loading: false
        });
      })
      .catch((error) => {
        const statusCode = Number((error && error.statusCode) || 0);
        const message = statusCode === 403
          ? "当前角色无权限访问船只管理"
          : ((error && error.message) || "加载失败，请重试");
        this.setData({
          showError: true,
          errorText: message,
          loading: false
        });
      });
  }
});
