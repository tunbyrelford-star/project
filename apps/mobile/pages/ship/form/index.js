const { createShip, updateShip, getShipDetail } = require("../../../services/ship");

const STATUS_OPTIONS = [
  { key: "IDLE", label: "启用" },
  { key: "IN_VOYAGE", label: "作业中" },
  { key: "MAINTENANCE", label: "维修" },
  { key: "DISABLED", label: "停用" }
];

function indexByStatus(status) {
  const idx = STATUS_OPTIONS.findIndex((item) => item.key === status);
  return idx >= 0 ? idx : 0;
}

Page({
  data: {
    id: null,
    isEdit: false,
    loading: false,
    showError: false,
    submitLoading: false,
    statusOptions: STATUS_OPTIONS,
    statusIndex: 0,
    form: {
      shipName: "",
      mmsi: "",
      shipType: "",
      tonnage: "",
      ownerName: "",
      contactPhone: "",
      commonPorts: "",
      status: "IDLE",
      remark: ""
    },
    submitText: "创建船只"
  },

  onLoad(options) {
    const id = Number(options.id || 0);
    const isEdit = Boolean(id);
    this.setData({
      id: isEdit ? id : null,
      isEdit,
      submitText: isEdit ? "保存修改" : "创建船只"
    });
    if (isEdit) {
      this.loadDetail();
    }
  },

  onRetry() {
    if (this.data.isEdit) {
      this.loadDetail();
    }
  },

  onInput(event) {
    const field = event.currentTarget.dataset.field;
    if (!field) return;
    this.setData({
      [`form.${field}`]: event.detail.value
    });
  },

  onStatusChange(event) {
    const index = Number(event.detail.value || 0);
    const option = this.data.statusOptions[index];
    this.setData({
      statusIndex: index,
      "form.status": option ? option.key : "IDLE"
    });
  },

  loadDetail() {
    this.setData({
      loading: true,
      showError: false
    });
    return getShipDetail(this.data.id)
      .then((res) => {
        const detail = res.detail || {};
        this.setData({
          loading: false,
          showError: false,
          form: {
            shipName: detail.shipName || "",
            mmsi: detail.mmsi || "",
            shipType: detail.shipType || "",
            tonnage: detail.tonnage == null ? "" : String(detail.tonnage),
            ownerName: detail.ownerName || "",
            contactPhone: detail.contactPhone || "",
            commonPorts: detail.commonPorts || "",
            status: detail.status || "IDLE",
            remark: detail.remark || ""
          },
          statusIndex: indexByStatus(detail.status)
        });
      })
      .catch(() => {
        this.setData({
          loading: false,
          showError: true
        });
      });
  },

  validateForm() {
    const form = this.data.form;
    if (!String(form.shipName || "").trim()) {
      return "请填写船名";
    }
    if (!String(form.mmsi || "").trim()) {
      return "请填写 MMSI";
    }
    if (form.tonnage !== "" && (!Number.isFinite(Number(form.tonnage)) || Number(form.tonnage) <= 0)) {
      return "载重必须为正数";
    }
    if (!form.status) {
      return "请选择状态";
    }
    return "";
  },

  onSubmit() {
    const errorMessage = this.validateForm();
    if (errorMessage) {
      wx.showToast({ title: errorMessage, icon: "none" });
      return;
    }

    const form = this.data.form;
    const payload = {
      shipName: String(form.shipName || "").trim(),
      mmsi: String(form.mmsi || "").trim(),
      shipType: String(form.shipType || "").trim(),
      tonnage: form.tonnage === "" ? null : Number(form.tonnage),
      ownerName: String(form.ownerName || "").trim(),
      contactPhone: String(form.contactPhone || "").trim(),
      commonPorts: String(form.commonPorts || "").trim(),
      status: form.status,
      remark: String(form.remark || "").trim()
    };

    this.setData({ submitLoading: true });
    const action = this.data.isEdit
      ? updateShip(this.data.id, payload)
      : createShip(payload);

    action
      .then((res) => {
        wx.showToast({
          title: this.data.isEdit ? "保存成功" : "创建成功",
          icon: "success"
        });

        if (this.data.isEdit) {
          wx.navigateBack();
          return;
        }

        if (res.shipId) {
          wx.redirectTo({ url: `/pages/ship/detail/index?id=${res.shipId}` });
          return;
        }
        wx.navigateBack();
      })
      .catch((err) => {
        wx.showToast({
          title: err.message || "提交失败",
          icon: "none"
        });
      })
      .finally(() => {
        this.setData({ submitLoading: false });
      });
  }
});
