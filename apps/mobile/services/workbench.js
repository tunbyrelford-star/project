const { request } = require("../utils/request");
const { getWorkbenchAggregateByRole } = require("../mock/workbench");

function fetchWorkbenchAggregate(roleCode) {
  return request({
    url: "/workbench/aggregate",
    method: "GET",
    data: { roleCode }
  })
    .then((res) => {
      if (res && typeof res === "object") {
        return res;
      }
      return getWorkbenchAggregateByRole(roleCode);
    })
    .catch(() => getWorkbenchAggregateByRole(roleCode));
}

module.exports = {
  fetchWorkbenchAggregate
};

