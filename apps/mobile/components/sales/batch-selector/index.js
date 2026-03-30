const { listSellableBatches } = require("../../../services/sales");

function toFixedNum(value, digits = 3) {
  const num = Number(value || 0);
  if (!Number.isFinite(num)) return 0;
  return Number(num.toFixed(digits));
}

Component({
  properties: {
    visible: {
      type: Boolean,
      value: false
    },
    value: {
      type: Array,
      value: []
    }
  },
  data: {
    loading: false,
    showError: false,
    keyword: "",
    list: [],
    selectedMap: {}
  },
  observers: {
    visible(visible) {
      if (visible) {
        this.syncSelectedMap(this.data.value || []);
        this.loadBatches();
      }
    },
    value(list) {
      this.syncSelectedMap(list || []);
      this.applySelectionState();
    }
  },
  methods: {
    noop() {},

    syncSelectedMap(list) {
      const selectedMap = {};
      (list || []).forEach((item) => {
        const id = Number(item.batchId || item.id);
        if (!id) return;
        selectedMap[id] = {
          ...item,
          batchId: id,
          lockQty: toFixedNum(item.lockQty || 0, 3)
        };
      });
      this.setData({ selectedMap });
    },

    onClose() {
      this.triggerEvent("close");
    },

    onRetry() {
      this.loadBatches();
    },

    onKeywordInput(event) {
      this.setData({ keyword: event.detail.value || "" });
    },

    onSearch() {
      this.loadBatches();
    },

    onToggleSelect(event) {
      const id = Number(event.currentTarget.dataset.id);
      if (!id) return;

      const item = this.data.list.find((x) => Number(x.id) === id);
      if (!item) return;
      if (!item.selectable) {
        wx.showToast({ title: item.disabledReason || "批次不可选", icon: "none" });
        return;
      }

      const selectedMap = { ...this.data.selectedMap };
      if (selectedMap[id]) {
        delete selectedMap[id];
      } else {
        selectedMap[id] = {
          batchId: id,
          batchNo: item.batchNo,
          voyageId: item.voyageId,
          voyageNo: item.voyageNo,
          shipName: item.shipName,
          remainingQty: item.remainingQty,
          lockQty: item.lockQtyDefault,
          sourceUnitCost: item.sourceUnitCost
        };
      }

      this.setData({ selectedMap });
      this.applySelectionState();
    },

    onQtyInput(event) {
      const id = Number(event.currentTarget.dataset.id);
      if (!id) return;
      const value = toFixedNum(event.detail.value, 3);
      const selectedMap = { ...this.data.selectedMap };
      if (!selectedMap[id]) return;
      selectedMap[id] = {
        ...selectedMap[id],
        lockQty: value
      };
      this.setData({ selectedMap });
      this.applySelectionState();
    },

    onConfirm() {
      const list = Object.values(this.data.selectedMap)
        .filter((item) => toFixedNum(item.lockQty, 3) > 0)
        .map((item) => ({
          ...item,
          lockQty: toFixedNum(item.lockQty, 3)
        }));

      if (!list.length) {
        wx.showToast({ title: "请选择至少一个批次", icon: "none" });
        return;
      }
      this.triggerEvent("confirm", { items: list });
    },

    loadBatches() {
      this.setData({ loading: true, showError: false });
      return listSellableBatches({
        keyword: this.data.keyword,
        selectable: 1
      })
        .then((res) => {
          const selectedMap = this.data.selectedMap || {};
          const list = (res.items || []).map((item) => {
            const selected = selectedMap[item.id];
            const lockQtyDefault = item.remainingQty > 0 ? Math.min(10, Number(item.remainingQty)) : 0;
            const isSelected = Boolean(selected);
            const isSelectable = Boolean(item.selectable);
            return {
              ...item,
              selected: isSelected,
              itemClass: isSelectable ? "batch-item" : "batch-item batch-item--disabled",
              selectText: isSelected ? "已选" : "选择",
              selectType: isSelected ? "primary" : "secondary",
              lockQtyDefault: selected ? toFixedNum(selected.lockQty, 3) : toFixedNum(lockQtyDefault, 3),
              qtyInput: selected ? toFixedNum(selected.lockQty, 3) : toFixedNum(lockQtyDefault, 3),
              statusType: item.selectable ? "success" : "warning"
            };
          });
          this.setData({
            list,
            loading: false
          });
        })
        .catch(() => {
          this.setData({
            loading: false,
            showError: true
          });
        });
    },

    applySelectionState() {
      const selectedMap = this.data.selectedMap || {};
      const list = (this.data.list || []).map((item) => {
        const selected = selectedMap[item.id];
        const isSelected = Boolean(selected);
        const isSelectable = Boolean(item.selectable);
        return {
          ...item,
          selected: isSelected,
          itemClass: isSelectable ? "batch-item" : "batch-item batch-item--disabled",
          selectText: isSelected ? "已选" : "选择",
          selectType: isSelected ? "primary" : "secondary",
          qtyInput: selected ? toFixedNum(selected.lockQty, 3) : item.qtyInput
        };
      });
      this.setData({ list });
    }
  }
});
