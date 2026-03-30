const { request } = require("../utils/request");

function listProcurements(params = {}) {
  return request({
    url: "/procurements",
    method: "GET",
    data: params
  });
}

function getProcurementDetail(id) {
  return request({
    url: `/procurements/${id}`,
    method: "GET"
  });
}

function createProcurement(payload) {
  return request({
    url: "/procurements",
    method: "POST",
    data: payload
  });
}

function startSanding(procurementId, payload = {}) {
  return request({
    url: `/procurements/${procurementId}/start-sanding`,
    method: "POST",
    data: payload
  });
}

function checkSandingTimeout(procurementId) {
  return request({
    url: `/procurements/${procurementId}/check-timeout`,
    method: "POST"
  });
}

function handleSandingTimeout(procurementId, payload) {
  return request({
    url: `/procurements/${procurementId}/handle-timeout`,
    method: "POST",
    data: payload || {}
  });
}

function closeAlert(alertId, handleNote) {
  return request({
    url: `/alerts/${alertId}/close`,
    method: "POST",
    data: { handleNote }
  });
}

function listShipOptions() {
  return request({
    url: "/procurements/ships/options",
    method: "GET"
  });
}

function listBuyerAccountOptions() {
  return request({
    url: "/procurements/buyer-accounts/options",
    method: "GET"
  });
}

function listSupplierOptions() {
  return request({
    url: "/procurements/suppliers/options",
    method: "GET"
  });
}

module.exports = {
  listProcurements,
  getProcurementDetail,
  createProcurement,
  startSanding,
  checkSandingTimeout,
  handleSandingTimeout,
  closeAlert,
  listShipOptions,
  listBuyerAccountOptions,
  listSupplierOptions
};
