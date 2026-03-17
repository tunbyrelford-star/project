Component({
  properties: {
    title: { type: String, value: "" },
    subtitle: { type: String, value: "" },
    loading: { type: Boolean, value: false },
    showEmpty: { type: Boolean, value: false },
    showError: { type: Boolean, value: false },
    emptyText: { type: String, value: "暂无数据" },
    errorText: { type: String, value: "加载失败，请重试" }
  },
  methods: {
    onRetry() {
      this.triggerEvent("retry");
    }
  }
});
