const { request } = require("../utils/request");

function listApprovals(params = {}) {
  return request({
    url: "/governance/approvals",
    method: "GET",
    data: params
  });
}

function submitApproval(payload) {
  return request({
    url: "/governance/approvals",
    method: "POST",
    data: payload
  });
}

function getApprovalDetail(id) {
  return request({
    url: `/governance/approvals/${id}`,
    method: "GET"
  });
}

function reviewApproval(id, payload) {
  return request({
    url: `/governance/approvals/${id}/review`,
    method: "POST",
    data: payload
  });
}

function getVersionHistory(params = {}) {
  return request({
    url: "/governance/versions",
    method: "GET",
    data: params
  });
}

function getAuditLogs(params = {}) {
  return request({
    url: "/governance/audits",
    method: "GET",
    data: params
  });
}

function getProfitTraceReport(params = {}) {
  return request({
    url: "/governance/reports/profit-trace",
    method: "GET",
    data: params
  });
}

module.exports = {
  listApprovals,
  submitApproval,
  getApprovalDetail,
  reviewApproval,
  getVersionHistory,
  getAuditLogs,
  getProfitTraceReport
};
