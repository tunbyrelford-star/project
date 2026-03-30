const TYPE_MAP = {
  primary: "primary",
  secondary: "secondary",
  tertiary: "tertiary",
  ghost: "tertiary",
  danger: "danger"
};

const SIZE_MAP = {
  small: "small",
  default: "default",
  large: "large",
  icon: "icon"
};

Component({
  options: {
    addGlobalClass: true,
    multipleSlots: true
  },
  properties: {
    text: { type: String, value: "" },
    type: { type: String, value: "primary" },
    size: { type: String, value: "default" },
    block: { type: Boolean, value: false },
    disabled: { type: Boolean, value: false },
    loading: { type: Boolean, value: false },
    icon: { type: String, value: "" },
    iconPosition: { type: String, value: "left" },
    customClass: { type: String, value: "" },
    hoverClass: { type: String, value: "sl-btn--hover" },
    formType: { type: String, value: "" },
    openType: { type: String, value: "" },
    lang: { type: String, value: "zh_CN" },
    throttleMs: { type: Number, value: 500 }
  },
  data: {
    resolvedType: "primary",
    resolvedSize: "default",
    iconOnly: false,
    iconClass: "",
    iconText: ""
  },
  lifetimes: {
    attached() {
      this.resolveStyleState();
    },
    ready() {
      this.resolveStyleState();
    }
  },
  observers: {
    type() {
      this.resolveStyleState();
    },
    size() {
      this.resolveStyleState();
    },
    icon() {
      this.resolveStyleState();
    },
    text() {
      this.resolveStyleState();
    }
  },
  methods: {
    resolveStyleState() {
      const resolvedType = TYPE_MAP[this.data.type] || TYPE_MAP.primary;
      const resolvedSize = SIZE_MAP[this.data.size] || SIZE_MAP.default;
      const hasText = Boolean(String(this.data.text || "").trim());
      const normalizedIcon = String(this.data.icon || "").trim();
      const hasIcon = Boolean(normalizedIcon);
      const iconClassMatch = normalizedIcon.match(/icon-[a-z0-9-]+/i);
      const iconClass = iconClassMatch ? iconClassMatch[0] : "";
      const containsIconToken = normalizedIcon.toLowerCase().includes("icon-");
      const iconText = iconClass
        ? normalizedIcon.replace(iconClass, "").trim()
        : (containsIconToken ? "" : normalizedIcon);
      const iconOnly = !hasText && hasIcon;

      this.setData({
        resolvedType,
        resolvedSize,
        iconOnly,
        iconClass,
        iconText
      });
    },
    onTap(event) {
      if (this.data.disabled || this.data.loading) {
        return;
      }

      const now = Date.now();
      if (this._lastTapAt && now - this._lastTapAt < Number(this.data.throttleMs || 0)) {
        return;
      }
      this._lastTapAt = now;

      this.triggerEvent("tap", event.detail || {});
    }
  }
});
