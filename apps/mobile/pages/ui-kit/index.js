Page({
  data: {
    loading: false,
    activeFilter: "all",
    demoLoading: false,
    filters: [
      { key: "all", label: "全部" },
      { key: "open", label: "待处理" },
      { key: "closed", label: "已处理" }
    ],
    attachments: [],
    timeline: [
      { action: "提交审批", actor: "调度员-张三", time: "2026-03-16 09:12", note: "申请修改入库吨数" },
      { action: "审批通过", actor: "财务-李四", time: "2026-03-16 09:40", note: "版本升级为 v2" }
    ],
    diffRows: [
      { field: "available_qty", label: "可售吨数", before: "980.00", after: "960.00", changed: true },
      { field: "expense_total", label: "费用合计", before: "12500.00", after: "12500.00", changed: false }
    ]
  },
  onFilterChange(event) {
    this.setData({ activeFilter: event.detail.key });
  },
  onSearch(event) {
    wx.showToast({ title: `搜索: ${event.detail.keyword || "-"}`, icon: "none" });
  },
  onAttachmentChange(event) {
    this.setData({ attachments: event.detail.files || [] });
  },
  onRetry() {
    wx.showToast({ title: "已触发重试", icon: "none" });
  },
  onPrimaryTap() {
    wx.showToast({ title: "主操作", icon: "none" });
  },
  onSecondaryTap() {
    wx.showToast({ title: "次操作", icon: "none" });
  },
  onDemoTap(event) {
    const text = String(event.currentTarget.dataset.text || "按钮点击");
    wx.showToast({ title: text, icon: "none" });
  },
  onToggleDemoLoading() {
    this.setData({ demoLoading: true });
    setTimeout(() => {
      this.setData({ demoLoading: false });
    }, 1200);
  }
});