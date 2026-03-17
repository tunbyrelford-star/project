const { getApprovalDetail, reviewApproval } = require("../../../services/governance");

function toText(value) {
  if (value == null) return "-";
  if (typeof value === "object") {
    try {
      return JSON.stringify(value);
    } catch (_error) {
      return "[object]";
    }
  }
  return String(value);
}

function buildDiffRows(beforeSnapshot, afterSnapshot) {
  const beforeObj = beforeSnapshot || {};
  const afterObj = afterSnapshot || {};
  const keys = Array.from(new Set([].concat(Object.keys(beforeObj), Object.keys(afterObj))));
  return keys.map((key) => {
    const beforeValue = toText(beforeObj[key]);
    const afterValue = toText(afterObj[key]);
    return {
      field: key,
      label: key,
      before: beforeValue,
      after: afterValue,
      changed: beforeValue !== afterValue
    };
  });
}

Page({
  data: {
    id: 0,
    loading: true,
    showError: false,
    submitting: false,
    approval: null,
    linkedVersion: null,
    diffRows: [],
    auditItems: [],
    attachmentFiles: [],
    reviewAttachmentFiles: [],
    canReview: false,
    form: {
      reviewComment: "",
      reviewAttachmentFiles: []
    }
  },

  onLoad(options) {
    const id = Number(options.id || 0);
    if (!id) {
      wx.showToast({ title: "审批参数错误", icon: "none" });
      return;
    }
    this.setData({ id });
    this.loadDetail();
  },

  onPullDownRefresh() {
    this.loadDetail().finally(() => wx.stopPullDownRefresh());
  },

  onRetry() {
    this.loadDetail();
  },

  onCommentInput(event) {
    this.setData({ "form.reviewComment": event.detail.value || "" });
  },

  onAttachmentChange(event) {
    const files = (event.detail || {}).files || [];
    this.setData({ "form.reviewAttachmentFiles": files });
  },

  onApprove() {
    this.submitReview("APPROVE");
  },

  onReject() {
    this.submitReview("REJECT");
  },

  submitReview(decision) {
    if (!this.data.canReview) {
      wx.showToast({ title: "当前无审批权限", icon: "none" });
      return;
    }
    const comment = String(this.data.form.reviewComment || "").trim();
    if (!comment) {
      wx.showToast({ title: "请填写审批意见", icon: "none" });
      return;
    }
    const content = decision === "APPROVE"
      ? "确认通过后将生成新版本并写入审计记录，是否继续？"
      : "确认驳回该审批请求？";

    wx.showModal({
      title: decision === "APPROVE" ? "审批通过" : "审批驳回",
      content,
      success: (modalRes) => {
        if (!modalRes.confirm) return;
        this.setData({ submitting: true });
        reviewApproval(this.data.id, {
          decision,
          reviewComment: comment,
          reviewAttachmentUrls: (this.data.form.reviewAttachmentFiles || []).map((x) => x.path || x.url || "")
        })
          .then(() => {
            wx.showToast({ title: decision === "APPROVE" ? "已审批通过" : "已驳回", icon: "success" });
            this.loadDetail();
          })
          .catch((err) => {
            wx.showToast({ title: (err && err.message) || "审批失败", icon: "none" });
          })
          .finally(() => {
            this.setData({ submitting: false });
          });
      }
    });
  },

  loadDetail() {
    this.setData({ loading: true, showError: false });
    return getApprovalDetail(this.data.id)
      .then((res) => {
        const approval = res.approval || {};
        const attachmentFiles = (approval.attachmentUrls || []).map((url, index) => ({
          name: `附件${index + 1}`,
          path: url,
          size: 0
        }));
        const reviewAttachmentFiles = (approval.reviewAttachmentUrls || []).map((url, index) => ({
          name: `审批附件${index + 1}`,
          path: url,
          size: 0
        }));
        const diffRows = buildDiffRows(approval.beforeSnapshot, approval.afterSnapshot);
        const auditItems = (res.audits || []).map((item) => ({
          action: item.action,
          actor: item.actorUserId ? `用户#${item.actorUserId}` : "系统",
          time: item.eventTime,
          note: item.afterData || item.beforeData || ""
        }));
        this.setData({
          loading: false,
          approval,
          attachmentFiles,
          reviewAttachmentFiles,
          linkedVersion: res.linkedVersion || null,
          diffRows,
          auditItems,
          canReview: Boolean(res.canReview)
        });
      })
      .catch(() => {
        this.setData({ loading: false, showError: true });
      });
  }
});
