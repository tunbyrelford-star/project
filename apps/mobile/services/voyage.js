const { request } = require("../utils/request");

function getVoyageDetail(id) {
  return request({
    url: `/voyages/${id}`,
    method: "GET"
  });
}

module.exports = {
  getVoyageDetail
};
