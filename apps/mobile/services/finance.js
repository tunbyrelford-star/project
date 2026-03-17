const { request } = require("../utils/request");

function listPendingConfirmOrders(params = {}) {
  return request({
    url: "/finance/orders/pending-confirm",
    method: "GET",
    data: params
  });
}

function createWeighingSlip(orderId, payload) {
  return request({
    url: `/finance/orders/${orderId}/weighing-slips`,
    method: "POST",
    data: payload
  });
}

function financeConfirmOrder(orderId, payload) {
  return request({
    url: `/finance/orders/${orderId}/finance-confirm`,
    method: "POST",
    data: payload
  });
}

function confirmOrderPayment(orderId, payload) {
  return request({
    url: `/finance/orders/${orderId}/payments/confirm`,
    method: "POST",
    data: payload
  });
}

function reversePayment(paymentId, payload) {
  return request({
    url: `/finance/payments/${paymentId}/reverse`,
    method: "POST",
    data: payload
  });
}

function getFinanceSummary(orderId) {
  return request({
    url: `/finance/orders/${orderId}/finance-summary`,
    method: "GET"
  });
}

function listWeighingSlips(params = {}) {
  return request({
    url: "/finance/weighing-slips",
    method: "GET",
    data: params
  });
}

function getWeighingSlipDetail(id) {
  return request({
    url: `/finance/weighing-slips/${id}`,
    method: "GET"
  });
}

function listPayments(params = {}) {
  return request({
    url: "/finance/payments",
    method: "GET",
    data: params
  });
}

function getPaymentDetail(id) {
  return request({
    url: `/finance/payments/${id}`,
    method: "GET"
  });
}

module.exports = {
  listPendingConfirmOrders,
  createWeighingSlip,
  financeConfirmOrder,
  confirmOrderPayment,
  reversePayment,
  getFinanceSummary,
  listWeighingSlips,
  getWeighingSlipDetail,
  listPayments,
  getPaymentDetail
};
