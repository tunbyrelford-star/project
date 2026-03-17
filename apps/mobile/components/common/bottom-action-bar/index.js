Component({
  properties: {
    primaryText: { type: String, value: "确定" },
    secondaryText: { type: String, value: "" },
    primaryDisabled: { type: Boolean, value: false },
    secondaryDisabled: { type: Boolean, value: false },
    primaryLoading: { type: Boolean, value: false },
    secondaryLoading: { type: Boolean, value: false },
    tip: { type: String, value: "" },
    primaryType: { type: String, value: "primary" },
    secondaryType: { type: String, value: "secondary" },
    primarySize: { type: String, value: "large" },
    secondarySize: { type: String, value: "large" }
  },
  methods: {
    onPrimaryTap() {
      if (this.data.primaryDisabled || this.data.primaryLoading) {
        return;
      }
      this.triggerEvent("primarytap");
    },
    onSecondaryTap() {
      if (this.data.secondaryDisabled || this.data.secondaryLoading) {
        return;
      }
      this.triggerEvent("secondarytap");
    }
  }
});
