const EXTRA_TONE_CLASS_MAP = {
  default: "card__extra--default",
  info: "card__extra--info",
  success: "card__extra--success",
  warning: "card__extra--warning",
  danger: "card__extra--danger"
};

function inferToneByExtra(extra) {
  const text = String(extra || "").toUpperCase();
  if (!text) return "default";
  if (text.includes("ERROR") || text.includes("FAIL") || text.includes("REJECT") || text.includes("VOID") || text.includes("CLOSED")) {
    return "danger";
  }
  if (text.includes("ALERT") || text.includes("WARN") || text.includes("PENDING") || text.includes("WAIT")) {
    return "warning";
  }
  if (text.includes("APPROVE") || text.includes("CONFIRM") || text.includes("COMPLETE") || text.includes("SUCCESS") || text.includes("ONLINE") || text.includes("FINAL")) {
    return "success";
  }
  if (text.includes("PROCESS") || text.includes("IN_") || text.includes("RUNNING") || text.includes("LOCK")) {
    return "info";
  }
  return "default";
}

Component({
  properties: {
    title: { type: String, value: "" },
    subtitle: { type: String, value: "" },
    extra: { type: String, value: "" },
    extraTone: { type: String, value: "auto" },
    clickable: { type: Boolean, value: false }
  },
  data: {
    extraToneClass: EXTRA_TONE_CLASS_MAP.default
  },
  observers: {
    "extraTone, extra"(nextTone, nextExtra) {
      const tone = nextTone === "auto" ? inferToneByExtra(nextExtra) : nextTone;
      this.setData({
        extraToneClass: EXTRA_TONE_CLASS_MAP[tone] || EXTRA_TONE_CLASS_MAP.default
      });
    }
  },
  methods: {
    onTap() {
      if (this.data.clickable) {
        this.triggerEvent("cardtap");
      }
    }
  }
});
