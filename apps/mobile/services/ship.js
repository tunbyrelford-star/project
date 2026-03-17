const { request } = require("../utils/request");

function listShips(params = {}) {
  return request({
    url: "/ships",
    method: "GET",
    data: params
  });
}

function createShip(payload) {
  return request({
    url: "/ships",
    method: "POST",
    data: payload
  });
}

function updateShip(id, payload) {
  return request({
    url: `/ships/${id}`,
    method: "PUT",
    data: payload
  });
}

function updateShipStatus(id, status) {
  return request({
    url: `/ships/${id}/status`,
    method: "PATCH",
    data: { status }
  });
}

function getShipDetail(id) {
  return request({
    url: `/ships/${id}`,
    method: "GET"
  });
}

function getShipRealtimePosition(mmsi, options = {}) {
  return request({
    url: `/ships/mmsi/${mmsi}/realtime-position`,
    method: "GET",
    data: options
  });
}

module.exports = {
  listShips,
  createShip,
  updateShip,
  updateShipStatus,
  getShipDetail,
  getShipRealtimePosition
};
