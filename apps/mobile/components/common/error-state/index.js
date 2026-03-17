Component({
  properties: {
    message: { type: String, value: "网络异常，请稍后重试" },
    buttonText: { type: String, value: "重试" }
  },
  methods: {
    onRetry() {
      this.triggerEvent("retry");
    }
  }
});
