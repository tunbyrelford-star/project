Component({
  properties: {
    filters: {
      type: Array,
      value: []
    },
    activeKey: {
      type: String,
      value: ""
    },
    showSearch: {
      type: Boolean,
      value: true
    },
    searchPlaceholder: {
      type: String,
      value: "请输入关键词"
    }
  },
  data: {
    keyword: ""
  },
  methods: {
    onTapFilter(event) {
      const { key } = event.currentTarget.dataset;
      this.triggerEvent("change", { key });
    },
    onInput(event) {
      this.setData({ keyword: event.detail.value || "" });
    },
    onSearch() {
      this.triggerEvent("search", { keyword: this.data.keyword });
    },
    onClear() {
      this.setData({ keyword: "" });
      this.triggerEvent("search", { keyword: "" });
    }
  }
});
