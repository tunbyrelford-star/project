function statusMeta(status) {
  const code = String(status || "").toUpperCase();
  if (code === "LOCKED") {
    return { statusLabel: "已锁定", statusType: "warning", statusTone: "warning" };
  }
  if (code === "COMPLETED") {
    return { statusLabel: "已完成", statusType: "success", statusTone: "success" };
  }
  return { statusLabel: "进行中", statusType: "info", statusTone: "info" };
}

Page({
  data: {
    voyages: [
      { no: "VY-202603-001", ship: "Long River 8", procurementNo: "PR-202603-001", batchNo: "BATCH-202603-001", status: "IN_PROGRESS" },
      { no: "VY-202603-002", ship: "Hai Xing 12", procurementNo: "PR-202603-002", batchNo: "BATCH-202603-002", status: "LOCKED" }
    ]
  },

  onLoad() {
    this.setData({
      voyages: (this.data.voyages || []).map((item) => ({
        ...item,
        ...statusMeta(item.status)
      }))
    });
  }
});
