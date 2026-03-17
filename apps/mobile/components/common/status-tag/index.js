const STATUS_CLASS_MAP = {
  default: "status--default",
  success: "status--success",
  warning: "status--warning",
  danger: "status--danger",
  info: "status--info"
};

Component({
  properties: {
    text: { type: String, value: "" },
    type: { type: String, value: "default" },
    dot: { type: Boolean, value: false }
  },
  data: {
    className: STATUS_CLASS_MAP.default
  },
  observers: {
    type(type) {
      this.setData({
        className: STATUS_CLASS_MAP[type] || STATUS_CLASS_MAP.default
      });
    }
  }
});
