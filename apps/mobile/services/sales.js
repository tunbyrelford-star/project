const { request } = require("../utils/request");

function listSellableBatches(params = {}) {
  return request({
    url: "/sales/batches/sellable",
    method: "GET",
    data: params
  });
}

function listCustomerOptions(params = {}) {
  return request({
    url: "/sales/customers/options",
    method: "GET",
    data: params
  });
}

function createSalesOrder(payload) {
  return request({
    url: "/sales/orders",
    method: "POST",
    data: payload
  });
}

function updateSalesOrder(id, payload) {
  return request({
    url: `/sales/orders/${id}`,
    method: "PUT",
    data: payload
  });
}

function listSalesOrders(params = {}) {
  return request({
    url: "/sales/orders",
    method: "GET",
    data: params
  });
}

function getSalesOrderDetail(id) {
  return request({
    url: `/sales/orders/${id}`,
    method: "GET"
  });
}

module.exports = {
  listSellableBatches,
  listCustomerOptions,
  createSalesOrder,
  updateSalesOrder,
  listSalesOrders,
  getSalesOrderDetail
};
