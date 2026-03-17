const {
  getShipDetail,
  getShipRealtimePosition,
  updateShipStatus
} = require("../../../services/ship");

function formatTime(value) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  const hh = String(date.getHours()).padStart(2, "0");
  const mm = String(date.getMinutes()).padStart(2, "0");
  const ss = String(date.getSeconds()).padStart(2, "0");
  return `${y}-${m}-${d} ${hh}:${mm}:${ss}`;
}

function statusMeta(status) {
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

function onlineMeta(status) {
  if (status === "ONLINE") return { text: "在线", type: "success" };
  if (status === "OFFLINE") return { text: "离线", type: "danger" };
  return { text: "未知", type: "warning" };
}

function formatTonnage(value) {
  if (value == null || value === "") return "-";
  const num = Number(value);
  if (!Number.isFinite(num)) return "-";
  return `${num.toFixed(3)} 吨`;
}

function formatStayDuration(minutes) {
  const value = Number(minutes || 0);
  if (!value) return "未停港";
  if (value < 60) return `${value} 分钟`;
  const h = Math.floor(value / 60);
  const m = value % 60;
  return m ? `${h} 小时 ${m} 分钟` : `${h} 小时`;
}

Page({
  data: {
    id: null,
    mmsi: "",
    loading: true,
    showError: false,
    refreshing: false,
    actionLoading: false,
    positionError: false,
    detail: {},
    frequentPorts: [],
    position: null,
    markers: [],
    mapLatitude: 38.35,
    mapLongitude: 117.42,
    refreshTip: "点击刷新获取最新位置",
    primaryActionText: "刷新定位",
    secondaryActionText: "停用船只"
  },

  onLoad(options) {
    const id = Number(options.id || 0);
    if (!id) {
      this.setData({
        loading: false,
        showError: true
      });
      return;
    }
    this.setData({
      id,
      mmsi: (options.mmsi || "").trim()
    });
    this.loadPage(false);
  },

  onShow() {
    if (!this.data.id) return;
    this.loadDetailOnly();
  },

  onPullDownRefresh() {
    this.loadPage(true).finally(() => wx.stopPullDownRefresh());
  },

  onRetry() {
    this.loadPage(false);
  },

  onRetryPosition() {
    this.fetchRealtimePosition(true);
  },

  onRefreshPosition() {
    this.fetchRealtimePosition(true, { manual: true });
  },

  onEditShip() {
    if (!this.data.id) return;
    wx.navigateTo({ url: `/pages/ship/form/index?id=${this.data.id}` });
  },

  onToggleStatus() {
    const detail = this.data.detail;
    if (!detail || !detail.id) return;

    const nextStatus = detail.status === "DISABLED" ? "IDLE" : "DISABLED";
    const actionText = nextStatus === "DISABLED" ? "停用" : "启用";

    wx.showModal({
      title: `${actionText}船只`,
      content: `确认${actionText}当前船只吗？`,
      success: (res) => {
        if (!res.confirm) return;
        this.setData({ actionLoading: true });
        updateShipStatus(detail.id, nextStatus)
          .then(() => {
            wx.showToast({
              title: `${actionText}成功`,
              icon: "success"
            });
            return this.loadDetailOnly();
          })
          .catch((err) => {
            wx.showToast({
              title: err.message || `${actionText}失败`,
              icon: "none"
            });
          })
          .finally(() => {
            this.setData({ actionLoading: false });
          });
      }
    });
  },

  loadPage(forceRefresh) {
    this.setData({
      loading: true,
      showError: false
    });
    return this.loadDetailOnly()
      .then(() => this.fetchRealtimePosition(forceRefresh))
      .then(() => {
        this.setData({
          loading: false,
          showError: false
        });
      })
      .catch((error) => {
        if (this.data.position) {
          this.setData({
            loading: false,
            positionError: true
          });
          wx.showToast({ title: error.message || "定位刷新失败", icon: "none" });
          return;
        }
        this.setData({
          loading: false,
          showError: true
        });
      });
  },

  loadDetailOnly() {
    return getShipDetail(this.data.id).then((res) => {
      const detail = res.detail || null;
      if (!detail) {
        throw new Error("船只不存在");
      }

      const status = statusMeta(detail.status);
      const online = onlineMeta(detail.onlineStatus);
      this.setData({
        detail: {
          ...detail,
          statusText: status.text,
          statusType: status.type,
          onlineText: online.text,
          onlineType: online.type,
          tonnageText: formatTonnage(detail.tonnage),
          lastPositionText: formatTime(detail.lastPositionTime),
          updatedAtText: formatTime(detail.updatedAt),
          createdAtText: formatTime(detail.createdAt),
          commonPortsText: detail.commonPorts || "-"
        },
        frequentPorts: res.frequentPorts || [],
        mmsi: detail.mmsi || this.data.mmsi || "",
        secondaryActionText: detail.status === "DISABLED" ? "启用船只" : "停用船只"
      });
    });
  },

  fetchRealtimePosition(forceRefresh, options = {}) {
    const { manual = false } = options;
    const { mmsi } = this.data;
    if (!mmsi) return Promise.reject(new Error("MMSI 无效"));

    this.setData({
      refreshing: true,
      positionError: false
    });

    return getShipRealtimePosition(mmsi, {
      forceRefresh: forceRefresh ? "1" : "0"
    })
      .then((res) => {
        const ship = res.ship || {};
        const p = res.position || {};
        if (p.latitude == null || p.longitude == null) {
          throw new Error("暂无定位数据");
        }

        const cache = res.cache || {};
        const noticeText = cache.fromFallback
          ? "已展示最近一次位置"
          : cache.mode === "HIT_TTL"
          ? "已是最新"
          : "定位已更新";

        const online = onlineMeta(p.onlineStatus);
        const position = {
          latitude: Number(p.latitude),
          longitude: Number(p.longitude),
          speedText: p.speedKnots == null ? "-" : `${Number(p.speedKnots).toFixed(1)} kn`,
          courseText: p.courseDeg == null ? "-" : `${Number(p.courseDeg).toFixed(0)}°`,
          positionTimeText: formatTime(p.positionTime),
          coordText: `${Number(p.latitude).toFixed(6)}, ${Number(p.longitude).toFixed(6)}`,
          onlineText: online.text,
          onlineType: online.type,
          portName: p.portName || "-",
          portStayText: formatStayDuration(p.portStayMinutes || 0),
          sourceText: cache.fromFallback
            ? `回退缓存(${cache.mode || "-"})`
            : cache.mode === "HIT_TTL"
            ? "缓存命中（已是最新）"
            : `实时更新(${cache.mode || "-"})`
        };

        const markers = [
          {
            id: 1,
            latitude: position.latitude,
            longitude: position.longitude,
            width: 30,
            height: 30,
            callout: {
              content: `${ship.shipName || (this.data.detail && this.data.detail.shipName) || "船只"}\n${position.onlineText}`,
              color: "#1f2937",
              fontSize: 12,
              borderRadius: 8,
              borderWidth: 1,
              borderColor: "#d1d5db",
              bgColor: "#ffffff",
              padding: 8,
              display: "ALWAYS"
            }
          }
        ];

        const detail = this.data.detail
          ? {
              ...this.data.detail,
              onlineText: position.onlineText,
              onlineType: position.onlineType,
              lastPositionText: formatTime(ship.lastPositionTime || p.positionTime)
            }
          : this.data.detail;

        this.setData({
          detail,
          position,
          markers,
          mapLatitude: position.latitude,
          mapLongitude: position.longitude,
          refreshing: false,
          positionError: false,
          refreshTip: noticeText
        });

        if (manual) {
          wx.showToast({
            title: noticeText,
            icon: "none"
          });
        }
      })
      .catch((error) => {
        this.setData({
          refreshing: false,
          positionError: true
        });
        throw new Error(error.message || "定位刷新失败");
      });
  }
});
