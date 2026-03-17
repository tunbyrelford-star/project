const {
  createSalesOrder,
  updateSalesOrder,
  getSalesOrderDetail,
  listCustomerOptions
} = require("../../../services/sales");

function toNum(value, fallback = 0) {
  const num = Number(value);
  return Number.isFinite(num) ? num : fallback;
}

function toFixedNum(value, digits = 2) {
  return Number(toNum(value).toFixed(digits));
}

function mergeSelected(oldList, newList) {
  const map = new Map();
  (oldList || []).forEach((item) => {
    map.set(Number(item.batchId), { ...item });
  });
  (newList || []).forEach((item) => {
    map.set(Number(item.batchId), { ...item });
  });
  return Array.from(map.values());
}

Page({
  data: {
    submitting: false,
    selectorVisible: false,
    customerOptions: [],
    customerIndex: -1,
    mode: "CREATE",
    orderId: 0,
    orderStatus: "",
    editable: true,
    form: {
      customerId: null,
      customerName: "",
      unitPrice: ""
    },
    selectedBatches: [],
    previewLines: [],
    previewTotals: {
      totalQty: 0,
      totalRevenue: 0,
      totalCost: null,
      totalProfit: null
    }
  },

  onLoad(options) {
    const orderId = Number((options && options.id) || 0);
    this.loadCustomerOptions().then(() => {
      if (orderId) {
        this.setData({
          mode: "EDIT",
          orderId
        });
        this.loadOrderForEdit(orderId);
      } else {
        this.tryLoadPrefillBatches();
      }
    });
  },

  onShow() {
    if (this.data.mode === "EDIT") return;
    this.tryLoadPrefillBatches();
  },

  onPullDownRefresh() {
    const task = this.data.mode === "EDIT"
      ? this.loadOrderForEdit(this.data.orderId, true)
      : Promise.resolve();
    task.finally(() => wx.stopPullDownRefresh());
  },

  onInput(event) {
    const field = event.currentTarget.dataset.field;
    if (!field) return;
    this.setData({ [`form.${field}`]: event.detail.value });
    if (field === "unitPrice") {
      this.rebuildPreview();
    }
  },

  onCustomerChange(event) {
    const index = Number(event.detail.value || -1);
    const selected = this.data.customerOptions[index];
    if (!selected) {
      this.setData({
        customerIndex: -1,
        "form.customerId": null
      });
      return;
    }

    this.setData({
      customerIndex: index,
      "form.customerId": selected.id,
      "form.customerName": selected.customerName || ""
    });
    this.rebuildPreview();
  },

  onOpenSelector() {
    if (!this.data.editable) return;
    this.setData({ selectorVisible: true });
  },

  onCloseSelector() {
    this.setData({ selectorVisible: false });
  },

  onSelectorConfirm(event) {
    if (!this.data.editable) return;
    const items = (event.detail || {}).items || [];
    this.setData({
      selectedBatches: mergeSelected(this.data.selectedBatches, items),
      selectorVisible: false
    });
    this.rebuildPreview();
  },

  onQtyInput(event) {
    if (!this.data.editable) return;
    const batchId = Number(event.currentTarget.dataset.id);
    const value = toFixedNum(event.detail.value, 3);
    const selectedBatches = (this.data.selectedBatches || []).map((item) =>
      Number(item.batchId) === batchId
        ? {
            ...item,
            lockQty: value
          }
        : item
    );
    this.setData({ selectedBatches });
    this.rebuildPreview();
  },

  onRemoveBatch(event) {
    if (!this.data.editable) return;
    const batchId = Number(event.currentTarget.dataset.id);
    const selectedBatches = (this.data.selectedBatches || []).filter(
      (item) => Number(item.batchId) !== batchId
    );
    this.setData({ selectedBatches });
    this.rebuildPreview();
  },

  onGoBatchPage() {
    wx.navigateTo({ url: "/pages/sales/batches/index" });
  },

  onSubmit() {
    if (!this.data.editable) {
      wx.showToast({ title: "当前状态不允许编辑", icon: "none" });
      return;
    }

    const customerName = String(this.data.form.customerName || "").trim();
    const unitPrice = toNum(this.data.form.unitPrice, 0);
    const selected = (this.data.selectedBatches || []).filter(
      (item) => toNum(item.lockQty, 0) > 0
    );

    if (!customerName) {
      wx.showToast({ title: "请输入客户名称", icon: "none" });
      return;
    }
    if (unitPrice <= 0) {
      wx.showToast({ title: "请输入有效销售单价", icon: "none" });
      return;
    }
    if (!selected.length) {
      wx.showToast({ title: "请至少选择一个批次", icon: "none" });
      return;
    }

    const payload = {
      customerId: this.data.form.customerId || null,
      customerName,
      unitPrice,
      pricingMode: "PER_ORDER_UNIT_PRICE",
      lineItems: selected.map((item) => ({
        batchId: item.batchId,
        lockQty: toFixedNum(item.lockQty, 3)
      }))
    };

    this.setData({ submitting: true });
    const task = this.data.mode === "EDIT"
      ? updateSalesOrder(this.data.orderId, payload)
      : createSalesOrder(payload);

    task
      .then((res) => {
        wx.showToast({
          title: this.data.mode === "EDIT" ? "订单已更新" : "开单成功",
          icon: "success"
        });
        const targetId = Number(res.salesOrderId || this.data.orderId || 0);
        if (targetId) {
          wx.redirectTo({ url: `/pages/sales/detail/index?id=${targetId}` });
        }
      })
      .catch((err) => {
        wx.showToast({ title: err.message || "提交失败", icon: "none" });
      })
      .finally(() => {
        this.setData({ submitting: false });
      });
  },

  rebuildPreview() {
    const unitPrice = toNum(this.data.form.unitPrice, 0);
    const lines = (this.data.selectedBatches || [])
      .filter((item) => toNum(item.lockQty, 0) > 0)
      .map((item, index) => {
        const qty = toFixedNum(item.lockQty, 3);
        const revenue = toFixedNum(qty * unitPrice, 2);
        const sourceUnitCost = item.sourceUnitCost == null ? null : toNum(item.sourceUnitCost, 0);
        const cost = sourceUnitCost == null ? null : toFixedNum(qty * sourceUnitCost, 2);
        const profit = cost == null ? null : toFixedNum(revenue - cost, 2);
        return {
          lineNo: index + 1,
          batchId: item.batchId,
          batchNo: item.batchNo,
          voyageNo: item.voyageNo,
          lockQty: qty,
          revenue,
          cost,
          profit,
          costDisplay: cost == null ? "***" : cost,
          profitDisplay: profit == null ? "***" : profit
        };
      });

    const totalQty = lines.reduce((sum, x) => sum + toNum(x.lockQty, 0), 0);
    const totalRevenue = lines.reduce((sum, x) => sum + toNum(x.revenue, 0), 0);
    const hasMaskedCost = lines.some((x) => x.cost == null);
    const totalCost = hasMaskedCost
      ? null
      : lines.reduce((sum, x) => sum + toNum(x.cost, 0), 0);
    const totalProfit = totalCost == null ? null : toFixedNum(totalRevenue - totalCost, 2);

    this.setData({
      previewLines: lines,
      previewTotals: {
        totalQty: toFixedNum(totalQty, 3),
        totalRevenue: toFixedNum(totalRevenue, 2),
        totalCost: totalCost == null ? null : toFixedNum(totalCost, 2),
        totalProfit
      }
    });
  },

  async loadOrderForEdit(orderId, silent = false) {
    try {
      const res = await getSalesOrderDetail(orderId);
      const order = res.order || {};
      const lineItems = res.lineItems || [];
      const editable = Boolean(order.editable);

      const selectedBatches = lineItems.map((line) => ({
        batchId: line.batchId,
        batchNo: line.batchNo,
        voyageId: line.sourceVoyageId || line.voyageId,
        voyageNo: line.voyageNo,
        remainingQty: line.lockedQty || line.plannedQty || 0,
        lockQty: line.lockedQty || line.plannedQty || 0,
        sourceUnitCost: line.costAmount && line.lockedQty
          ? toFixedNum(toNum(line.costAmount) / Math.max(toNum(line.lockedQty), 1), 4)
          : null
      }));

      const customerIndex = (this.data.customerOptions || []).findIndex(
        (item) => Number(item.id) === Number(order.customerId || 0)
      );

      this.setData({
        orderStatus: order.status || "",
        editable,
        customerIndex,
        form: {
          customerId: order.customerId || null,
          customerName: order.customerName || "",
          unitPrice: order.unitPrice == null ? "" : String(order.unitPrice)
        },
        selectedBatches
      });

      this.rebuildPreview();

      if (!editable && !silent) {
        wx.showToast({ title: "该订单状态不可编辑", icon: "none" });
      }
    } catch (_error) {
      wx.showToast({ title: "订单加载失败", icon: "none" });
    }
  },

  loadCustomerOptions() {
    return listCustomerOptions()
      .then((res) => {
        this.setData({
          customerOptions: res.items || []
        });
      })
      .catch(() => {
        this.setData({
          customerOptions: []
        });
      });
  },

  tryLoadPrefillBatches() {
    const prefill = wx.getStorageSync("sales.prefill_batches");
    if (Array.isArray(prefill) && prefill.length) {
      this.setData({
        selectedBatches: mergeSelected(this.data.selectedBatches, prefill)
      });
      wx.removeStorageSync("sales.prefill_batches");
      this.rebuildPreview();
    }
  }
});
