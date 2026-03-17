const { listProcurements } = require("./procurement");
const { listOnsiteTasks } = require("./onsite");
const { listSalesOrders } = require("./sales");
const { listPendingConfirmOrders } = require("./finance");

function toCount(value) {
  const num = Number(value);
  return Number.isFinite(num) && num >= 0 ? num : 0;
}

function countByTaskType(items, taskType) {
  return (items || []).filter((item) => String(item.taskType || "").toUpperCase() === taskType).length;
}

function sectionCount(sections, key) {
  const section = (sections || []).find(
    (item) => String(item.key || "").toUpperCase() === String(key || "").toUpperCase()
  );
  if (!section) return null;
  return toCount(section.count);
}

async function fetchOrderCenterSummary(options = {}) {
  const flags = {
    procurementEnabled: Boolean(options.procurementEnabled),
    onsiteEnabled: Boolean(options.onsiteEnabled),
    salesEnabled: Boolean(options.salesEnabled),
    financeEnabled: Boolean(options.financeEnabled)
  };

  const tasks = {
    procurement: flags.procurementEnabled ? listProcurements() : Promise.resolve(null),
    onsite: flags.onsiteEnabled ? listOnsiteTasks({ type: "ALL" }) : Promise.resolve(null),
    sales: flags.salesEnabled ? listSalesOrders() : Promise.resolve(null),
    finance: flags.financeEnabled ? listPendingConfirmOrders({ action: "ALL" }) : Promise.resolve(null)
  };

  const [procurementRes, onsiteRes, salesRes, financeRes] = await Promise.allSettled([
    tasks.procurement,
    tasks.onsite,
    tasks.sales,
    tasks.finance
  ]);

  const procurementData = procurementRes.status === "fulfilled" ? procurementRes.value : null;
  const onsiteData = onsiteRes.status === "fulfilled" ? onsiteRes.value : null;
  const salesData = salesRes.status === "fulfilled" ? salesRes.value : null;
  const financeData = financeRes.status === "fulfilled" ? financeRes.value : null;

  const procurementItems = procurementData && Array.isArray(procurementData.items)
    ? procurementData.items
    : [];
  const salesItems = salesData && Array.isArray(salesData.items) ? salesData.items : [];
  const onsiteItems = onsiteData && Array.isArray(onsiteData.items) ? onsiteData.items : [];
  const onsiteSections = onsiteData && Array.isArray(onsiteData.sections) ? onsiteData.sections : [];
  const financeStats = (financeData && financeData.stats) || {};

  const lighteringCount = sectionCount(onsiteSections, "WAIT_LIGHTERING");
  const stockInCount = sectionCount(onsiteSections, "WAIT_STOCK_IN");
  const expenseCount = sectionCount(onsiteSections, "WAIT_EXPENSE");

  return {
    counters: {
      procurement: procurementItems.length,
      voyage: procurementItems.filter((item) => String(item.voyage_no || item.voyageNo || "").trim()).length,
      lightering: lighteringCount == null ? countByTaskType(onsiteItems, "WAIT_LIGHTERING") : lighteringCount,
      stockIn: stockInCount == null ? countByTaskType(onsiteItems, "WAIT_STOCK_IN") : stockInCount,
      expense: expenseCount == null ? countByTaskType(onsiteItems, "WAIT_EXPENSE") : expenseCount,
      salesOrder: salesItems.length,
      weighingSlip: toCount(financeStats.waitWeighing),
      paymentOrder: toCount(financeStats.waitPayment)
    },
    source: {
      procurement: procurementRes.status === "fulfilled" ? "ok" : "failed",
      onsite: onsiteRes.status === "fulfilled" ? "ok" : "failed",
      sales: salesRes.status === "fulfilled" ? "ok" : "failed",
      finance: financeRes.status === "fulfilled" ? "ok" : "failed"
    },
    updatedAt: new Date().toISOString()
  };
}

module.exports = {
  fetchOrderCenterSummary
};
