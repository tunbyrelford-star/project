const { request } = require("../utils/request");

function listOnsiteTasks(params = {}) {
  return request({
    url: "/onsite/tasks",
    method: "GET",
    data: params
  });
}

function confirmLighteringEmpty(lighteringId, payload = {}) {
  return request({
    url: `/onsite/lighterings/${lighteringId}/confirm-empty`,
    method: "POST",
    data: payload
  });
}

function getStockinBatchDetail(batchId) {
  return request({
    url: `/onsite/stockins/batches/${batchId}`,
    method: "GET"
  });
}

function confirmStockin(payload) {
  return request({
    url: "/onsite/stockins/confirm",
    method: "POST",
    data: payload
  });
}

function listVoyageOptions() {
  return request({
    url: "/onsite/voyages/options",
    method: "GET"
  });
}

function getExpenseAccess() {
  return request({
    url: "/onsite/expense-access",
    method: "GET"
  });
}

function createExpense(payload) {
  return request({
    url: "/onsite/expenses",
    method: "POST",
    data: payload
  });
}

function listLighterings(params = {}) {
  return request({
    url: "/onsite/lighterings",
    method: "GET",
    data: params
  });
}

function getLighteringDetail(id) {
  return request({
    url: `/onsite/lighterings/${id}`,
    method: "GET"
  });
}

function listStockIns(params = {}) {
  return request({
    url: "/onsite/stockins",
    method: "GET",
    data: params
  });
}

function getStockInDetail(id) {
  return request({
    url: `/onsite/stockins/${id}`,
    method: "GET"
  });
}

function listExpenses(params = {}) {
  return request({
    url: "/onsite/expenses",
    method: "GET",
    data: params
  });
}

function getExpenseDetail(id) {
  return request({
    url: `/onsite/expenses/${id}`,
    method: "GET"
  });
}

module.exports = {
  listOnsiteTasks,
  confirmLighteringEmpty,
  getStockinBatchDetail,
  confirmStockin,
  listVoyageOptions,
  getExpenseAccess,
  createExpense,
  listLighterings,
  getLighteringDetail,
  listStockIns,
  getStockInDetail,
  listExpenses,
  getExpenseDetail
};
