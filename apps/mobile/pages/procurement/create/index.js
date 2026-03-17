const {
  createProcurement,
  listShipOptions,
  listSupplierOptions,
  listBuyerAccountOptions
} = require("../../../services/procurement");

function toNumber(value) {
  const num = Number(value);
  return Number.isFinite(num) ? num : 0;
}

Page({
  data: {
    loading: false,
    shipModalVisible: false,
    shipOptions: [],
    supplierOptions: [],
    supplierIndex: -1,
    form: {
      procurementNo: "",
      supplierId: null,
      supplierName: "",
      plannedQty: "",
      unitPrice: "",
      plannedDurationMin: "",
      shipId: null,
      shipName: "",
      miningTicket: "",
      qualityPhotos: []
    },
    miningTicketFiles: [],
    qualityPhotoFiles: []
  },

  onLoad() {
    this.loadOptions();
  },

  onInput(event) {
    const field = event.currentTarget.dataset.field;
    if (!field) return;
    this.setData({ [`form.${field}`]: event.detail.value });
  },

  onSupplierChange(event) {
    const index = Number(event.detail.value || -1);
    const supplier = this.data.supplierOptions[index];
    if (!supplier) return;
    this.setData({
      supplierIndex: index,
      "form.supplierId": supplier.id,
      "form.supplierName": supplier.supplier_name || supplier.buyer_name || ""
    });
  },

  openShipModal() {
    this.setData({ shipModalVisible: true });
  },

  closeShipModal() {
    this.setData({ shipModalVisible: false });
  },

  onSelectShip(event) {
    const shipId = Number(event.currentTarget.dataset.id || 0);
    const shipName = String(event.currentTarget.dataset.name || "");
    if (!shipId) return;
    this.setData({
      "form.shipId": shipId,
      "form.shipName": shipName,
      shipModalVisible: false
    });
  },

  onMiningTicketChange(event) {
    const files = event.detail.files || [];
    this.setData({
      miningTicketFiles: files,
      "form.miningTicket": files[0] ? files[0].path : ""
    });
  },

  onQualityPhotoChange(event) {
    const files = event.detail.files || [];
    this.setData({
      qualityPhotoFiles: files,
      "form.qualityPhotos": files.map((file) => file.path)
    });
  },

  onSubmit() {
    const form = this.data.form;
    if (
      !form.supplierId ||
      !form.shipId ||
      !form.plannedQty ||
      !form.unitPrice ||
      !form.plannedDurationMin
    ) {
      wx.showToast({ title: "请完整填写必填项", icon: "none" });
      return;
    }

    const payload = {
      procurementNo: form.procurementNo || undefined,
      supplierId: form.supplierId,
      supplierName: form.supplierName,
      buyerAccountId: form.supplierId,
      buyerName: form.supplierName,
      plannedQty: toNumber(form.plannedQty),
      unitPrice: toNumber(form.unitPrice),
      plannedDurationMin: toNumber(form.plannedDurationMin),
      shipId: form.shipId,
      miningTicket: form.miningTicket || null,
      miningTicketUrl: form.miningTicket || null,
      qualityPhotos: form.qualityPhotos || [],
      qualityPhotoUrls: form.qualityPhotos || []
    };

    this.setData({ loading: true });
    createProcurement(payload)
      .then((res) => {
        wx.showToast({ title: "采购单已创建", icon: "success" });
        const procurementId = Number(res.procurementId || 0);
        if (procurementId) {
          wx.redirectTo({
            url: `/pages/procurement/detail/index?id=${procurementId}`
          });
          return;
        }
        wx.navigateBack({ delta: 1 });
      })
      .catch((err) => {
        wx.showToast({
          title: (err && err.message) || "提交失败",
          icon: "none"
        });
      })
      .finally(() => {
        this.setData({ loading: false });
      });
  },

  loadOptions() {
    Promise.all([listShipOptions(), this.loadSuppliersWithFallback()])
      .then(([shipRes, supplierRes]) => {
        const shipOptions = shipRes.items || [];
        const supplierOptions = supplierRes.items || [];
        this.setData({
          shipOptions,
          supplierOptions
        });
        if (!shipOptions.length) {
          wx.showToast({
            title: "请先在船只管理新增可用船只",
            icon: "none"
          });
        } else if (!supplierOptions.length) {
          wx.showToast({
            title: "暂无可用供应商，请先初始化",
            icon: "none"
          });
        }
      })
      .catch(() => {
        wx.showToast({ title: "选项加载失败", icon: "none" });
      });
  },

  async loadSuppliersWithFallback() {
    try {
      return await listSupplierOptions();
    } catch (_error) {
      const legacyRes = await listBuyerAccountOptions();
      return {
        items: (legacyRes.items || []).map((item) => ({
          id: item.id,
          supplier_name: item.buyer_name,
          available_balance: item.available_balance,
          frozen_balance: item.frozen_balance,
          status: item.status
        }))
      };
    }
  },

  noop() {}
});
