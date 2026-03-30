const {
  listVoyageOptions,
  getLighteringDetail,
  createLightering,
  updateLightering
} = require("../../../services/onsite");

const STATUS_OPTIONS = [
  { label: "草稿", value: "DRAFT" },
  { label: "作业中", value: "IN_PROGRESS" }
];

const TRANSFER_TYPE_OPTIONS = [
  { label: "船到船", value: "SHIP_TO_SHIP" },
  { label: "船到岸", value: "SHIP_TO_SHORE" }
];

const RECEIVER_TYPE_OPTIONS = [
  { label: "自有", value: "OWNED" },
  { label: "租赁", value: "LEASED" },
  { label: "其他", value: "OTHER" }
];

function nowDateTime() {
  const date = new Date();
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  const hh = String(date.getHours()).padStart(2, "0");
  const mm = String(date.getMinutes()).padStart(2, "0");
  const ss = String(date.getSeconds()).padStart(2, "0");
  return `${y}-${m}-${d} ${hh}:${mm}:${ss}`;
}

function findOptionIndex(options, value, fallback = 0) {
  const index = (options || []).findIndex((item) => item.value === value);
  return index >= 0 ? index : fallback;
}

Page({
  data: {
    loading: true,
    showError: false,
    saving: false,
    mode: "create",
    lighteringId: 0,
    editable: true,
    voyageOptions: [],
    voyageIndex: -1,
    statusOptions: STATUS_OPTIONS,
    transferTypeOptions: TRANSFER_TYPE_OPTIONS,
    receiverTypeOptions: RECEIVER_TYPE_OPTIONS,
    statusIndex: 0,
    transferTypeIndex: 0,
    receiverTypeIndex: 0,
    attachmentFiles: [],
    form: {
      voyageId: null,
      status: "DRAFT",
      lighteringTime: nowDateTime(),
      lighteringLocation: "",
      lighteringPort: "",
      transferType: "SHIP_TO_SHIP",
      receiverType: "OWNED",
      receiverShipName: "",
      lighteringQty: "",
      cargoName: "砂石",
      receiverName: "",
      operatorName: "",
      remark: ""
    }
  },

  onLoad(options) {
    const lighteringId = Number((options && options.id) || 0);
    const mode = lighteringId ? "edit" : "create";
    this.setData({ lighteringId, mode });
    this.loadData();
  },

  onRetry() {
    this.loadData();
  },

  onInput(event) {
    const field = String((event.currentTarget.dataset || {}).field || "");
    if (!field) return;
    this.setData({ [`form.${field}`]: event.detail.value || "" });
  },

  onVoyageChange(event) {
    const index = Number(event.detail.value);
    const item = this.data.voyageOptions[index];
    if (!item) return;
    this.setData({
      voyageIndex: index,
      "form.voyageId": item.id
    });
  },

  onStatusChange(event) {
    const index = Number(event.detail.value);
    const item = this.data.statusOptions[index];
    if (!item) return;
    this.setData({
      statusIndex: index,
      "form.status": item.value
    });
  },

  onTransferTypeChange(event) {
    const index = Number(event.detail.value);
    const item = this.data.transferTypeOptions[index];
    if (!item) return;
    this.setData({
      transferTypeIndex: index,
      "form.transferType": item.value
    });
  },

  onReceiverTypeChange(event) {
    const index = Number(event.detail.value);
    const item = this.data.receiverTypeOptions[index];
    if (!item) return;
    this.setData({
      receiverTypeIndex: index,
      "form.receiverType": item.value
    });
  },

  onAttachmentChange(event) {
    this.setData({ attachmentFiles: event.detail.files || [] });
  },

  onSaveDraft() {
    this.submit("DRAFT");
  },

  onSubmit() {
    this.submit(this.data.mode === "create" ? "IN_PROGRESS" : this.data.form.status);
  },

  submit(status) {
    if (this.data.saving) return;
    if (!this.data.editable) {
      wx.showToast({ title: "当前状态不可编辑", icon: "none" });
      return;
    }

    const form = this.data.form || {};
    const lighteringQty = Number(form.lighteringQty);
    if (!form.voyageId) {
      wx.showToast({ title: "请选择航次", icon: "none" });
      return;
    }
    if (!Number.isFinite(lighteringQty) || lighteringQty <= 0) {
      wx.showToast({ title: "请输入有效过驳吨数", icon: "none" });
      return;
    }

    const payload = {
      voyageId: Number(form.voyageId),
      status,
      lighteringTime: form.lighteringTime,
      lighteringLocation: form.lighteringLocation,
      lighteringPort: form.lighteringPort,
      transferType: form.transferType,
      receiverType: form.receiverType,
      receiverShipName: form.receiverShipName,
      lighteringQty,
      operatorName: form.operatorName,
      remark: form.remark,
      attachments: (this.data.attachmentFiles || []).map((item) => item.path),
      items: [
        {
          cargoName: form.cargoName || "砂石",
          transferQty: lighteringQty,
          receiverName: form.receiverName,
          receiverShipName: form.receiverShipName,
          remark: form.remark
        }
      ]
    };

    this.setData({ saving: true });

    const requestPromise = this.data.mode === "create"
      ? createLightering(payload)
      : updateLightering(this.data.lighteringId, payload);

    requestPromise
      .then((res) => {
        const lighteringId = Number((res && (res.lighteringId || this.data.lighteringId)) || 0);
        wx.showToast({ title: this.data.mode === "create" ? "过驳单已创建" : "过驳单已更新", icon: "none" });
        if (lighteringId) {
          setTimeout(() => {
            wx.redirectTo({ url: `/pages/onsite/lightering-detail/index?id=${lighteringId}` });
          }, 400);
        } else {
          setTimeout(() => wx.navigateBack(), 400);
        }
      })
      .catch((err) => {
        wx.showToast({ title: (err && err.message) || "提交失败", icon: "none" });
      })
      .finally(() => {
        this.setData({ saving: false });
      });
  },

  fillFromDetail(detail) {
    const nextStatus = String(detail.status || "DRAFT").toUpperCase();
    const nextTransferType = String(detail.transferType || "SHIP_TO_SHIP").toUpperCase();
    const nextReceiverType = String(detail.receiverType || "OWNED").toUpperCase();

    this.setData({
      editable: detail.canEdit !== false,
      attachmentFiles: (detail.attachments || []).map((url, index) => ({
        name: `附件${index + 1}`,
        path: url,
        size: 0
      })),
      form: {
        voyageId: detail.voyageId || null,
        status: nextStatus,
        lighteringTime: detail.lighteringTime || detail.startedAt || nowDateTime(),
        lighteringLocation: detail.lighteringLocation || "",
        lighteringPort: detail.lighteringPort || "",
        transferType: nextTransferType,
        receiverType: nextReceiverType,
        receiverShipName: detail.receiverShipName || "",
        lighteringQty: String(detail.lighteringQty || ""),
        cargoName: "砂石",
        receiverName: "",
        operatorName: detail.operatorName || "",
        remark: detail.remark || ""
      },
      statusIndex: findOptionIndex(STATUS_OPTIONS, nextStatus, 0),
      transferTypeIndex: findOptionIndex(TRANSFER_TYPE_OPTIONS, nextTransferType, 0),
      receiverTypeIndex: findOptionIndex(RECEIVER_TYPE_OPTIONS, nextReceiverType, 0)
    });
  },

  loadData() {
    this.setData({ loading: true, showError: false });

    const tasks = [listVoyageOptions()];
    if (this.data.mode === "edit") {
      tasks.push(getLighteringDetail(this.data.lighteringId));
    }

    return Promise.all(tasks)
      .then((res) => {
        const voyageRes = res[0] || { items: [] };
        const detailRes = this.data.mode === "edit" ? (res[1] || {}) : null;
        const voyageOptions = voyageRes.items || [];

        if (detailRes && detailRes.detail) {
          this.fillFromDetail(detailRes.detail || {});
        }

        const voyageId = Number(this.data.form.voyageId || 0);
        const voyageIndex = voyageId
          ? voyageOptions.findIndex((item) => Number(item.id) === voyageId)
          : -1;

        this.setData({
          voyageOptions,
          voyageIndex,
          loading: false
        });
      })
      .catch(() => {
        this.setData({
          loading: false,
          showError: true
        });
      });
  }
});
