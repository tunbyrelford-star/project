function levelMeta(level) {
  const code = String(level || "").toUpperCase();
  if (code === "HIGH") {
    return { levelLabel: "高", levelType: "danger", levelTone: "danger" };
  }
  if (code === "MEDIUM") {
    return { levelLabel: "中", levelType: "warning", levelTone: "warning" };
  }
  return { levelLabel: "低", levelType: "info", levelTone: "info" };
}

function statusMeta(status) {
  const code = String(status || "").toUpperCase();
  if (code === "CLOSED") {
    return { statusLabel: "已闭环", statusType: "success" };
  }
  return { statusLabel: "待处理", statusType: "warning" };
}

Page({
  data: {
    alerts: [
      {
        id: "ALT-001",
        level: "HIGH",
        message: "Voyage VY-202603-001 打沙超时",
        entityRef: "VOYAGE#VY-202603-001",
        triggeredAt: "2026-03-16 09:22:10",
        status: "OPEN"
      },
      {
        id: "ALT-002",
        level: "MEDIUM",
        message: "Ship Long River 8 停港超过 120 分钟",
        entityRef: "SHIP#Long River 8",
        triggeredAt: "2026-03-16 08:40:35",
        status: "OPEN"
      }
    ]
  },

  onLoad() {
    this.setData({
      alerts: (this.data.alerts || []).map((item) => ({
        ...item,
        ...levelMeta(item.level),
        ...statusMeta(item.status)
      }))
    });
  }
});
