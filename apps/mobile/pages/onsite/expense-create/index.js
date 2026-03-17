const { listVoyageOptions, getExpenseAccess, createExpense } = require("../../../services/onsite");

const EXPENSE_TYPE_OPTIONS = [
  { label: "运费", value: "FREIGHT" },
  { label: "过驳费", value: "LIGHTERING" },
  { label: "吊机费", value: "CRANE" },
  { label: "港杂费", value: "PORT_MISC" },
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

Page({
  data: {
    loading: true,
    showError: false,
    submitting: false,
    voyageOptions: [],
    voyageIndex: -1,
    expenseTypeOptions: EXPENSE_TYPE_OPTIONS,
    expenseTypeIndex: 0,
    access: {
      canViewAmount: false,
      canSubmitExpense: false
    },
    voucherFiles: [],
    form: {
      voyageId: null,
      expenseType: "FREIGHT",
      amount: "",
      occurredAt: nowDateTime(),
      remark: ""
    }
  },

  onLoad(options) {
    const voyageId = Number(options.voyageId || 0);
    if (voyageId) {
      this.setData({ "form.voyageId": voyageId });
    }
    this.loadData();
  },

  onRetry() {
    this.loadData();
  },

  onInput(event) {
    const field = event.currentTarget.dataset.field;
    if (!field) return;
    this.setData({ [`form.${field}`]: event.detail.value });
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

  onExpenseTypeChange(event) {
    const index = Number(event.detail.value);
    const item = this.data.expenseTypeOptions[index];
    if (!item) return;
    this.setData({
      expenseTypeIndex: index,
      "form.expenseType": item.value
    });
  },

  onVoucherChange(event) {
    const files = event.detail.files || [];
    this.setData({ voucherFiles: files });
  },

  onSubmit() {
    const { form, access } = this.data;
    if (!form.voyageId) {
      wx.showToast({ title: "请选择航次", icon: "none" });
      return;
    }
    if (!access.canSubmitExpense || !access.canViewAmount) {
      wx.showToast({ title: "当前角色不可录入金额", icon: "none" });
      return;
    }

    const amount = Number(form.amount);
    if (!Number.isFinite(amount) || amount <= 0) {
      wx.showToast({ title: "请输入有效金额", icon: "none" });
      return;
    }

    this.setData({ submitting: true });
    createExpense({
      voyageId: form.voyageId,
      expenseType: form.expenseType,
      amount,
      occurredAt: form.occurredAt,
      voucherUrls: (this.data.voucherFiles || []).map((f) => f.path),
      remark: form.remark || ""
    })
      .then((res) => {
        wx.showToast({ title: res.message || "提交成功", icon: "none" });
        if (res.requiresApproval) {
          setTimeout(() => wx.navigateBack(), 600);
          return;
        }
        this.setData({
          voucherFiles: [],
          form: {
            ...this.data.form,
            amount: "",
            remark: "",
            occurredAt: nowDateTime()
          }
        });
      })
      .catch((err) => {
        wx.showToast({ title: err.message || "提交失败", icon: "none" });
      })
      .finally(() => {
        this.setData({ submitting: false });
      });
  },

  loadData() {
    this.setData({ loading: true, showError: false });
    return Promise.all([listVoyageOptions(), getExpenseAccess()])
      .then(([voyageRes, accessRes]) => {
        const voyageOptions = voyageRes.items || [];
        const access = {
          canViewAmount: Boolean(accessRes.canViewAmount),
          canSubmitExpense: Boolean(accessRes.canSubmitExpense)
        };

        let voyageIndex = this.data.voyageIndex;
        const currentVoyageId = Number(this.data.form.voyageId || 0);
        if (currentVoyageId) {
          const idx = voyageOptions.findIndex((v) => Number(v.id) === currentVoyageId);
          voyageIndex = idx >= 0 ? idx : -1;
        }

        this.setData({
          voyageOptions,
          voyageIndex,
          access,
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
