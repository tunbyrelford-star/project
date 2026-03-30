function toFixedNumber(value, digits = 2) {
  const num = Number(value || 0);
  if (!Number.isFinite(num)) return 0;
  return Number(num.toFixed(digits));
}

function normalizeCalcMode(value) {
  const mode = String(value || "").trim().toUpperCase();
  if (mode === "MANUAL") return "MANUAL";
  return "HOURLY_RATE";
}

function computeOvertimeMetrics(elapsedMinutes, plannedDurationMin) {
  const elapsed = Number(elapsedMinutes || 0);
  const planned = Number(plannedDurationMin || 0);
  const validElapsed = Number.isFinite(elapsed) ? elapsed : 0;
  const validPlanned = Number.isFinite(planned) ? planned : 0;
  const overtimeMinutes = Math.max(0, validElapsed - validPlanned);
  const overtimeHours = toFixedNumber(overtimeMinutes / 60, 2);

  return {
    elapsedMinutes: validElapsed,
    plannedDurationMin: validPlanned,
    overtimeMinutes,
    overtimeHours,
    isOvertime: overtimeMinutes > 0
  };
}

function calculateOvertimeExpense({
  overtimeMinutes,
  calcMode,
  ratePerHour,
  manualAmount,
  defaultRatePerHour = 150
}) {
  const metrics = computeOvertimeMetrics(overtimeMinutes, 0);
  const mode = normalizeCalcMode(calcMode);

  if (!metrics.isOvertime && mode !== "MANUAL") {
    return {
      mode,
      overtimeMinutes: metrics.overtimeMinutes,
      overtimeHours: metrics.overtimeHours,
      ratePerHour: Number(ratePerHour || defaultRatePerHour || 0),
      amount: 0,
      formula: "overtime_hours * hourly_rate",
      note: "No overtime"
    };
  }

  if (mode === "MANUAL") {
    const amount = toFixedNumber(manualAmount, 2);
    if (!Number.isFinite(amount) || amount < 0) {
      const err = new Error("manualAmount must be >= 0 for MANUAL mode.");
      err.status = 400;
      throw err;
    }
    return {
      mode,
      overtimeMinutes: metrics.overtimeMinutes,
      overtimeHours: metrics.overtimeHours,
      ratePerHour: null,
      amount,
      formula: "manual_confirmed_amount",
      note: `MANUAL amount=${amount}`
    };
  }

  const rate = toFixedNumber(ratePerHour != null ? ratePerHour : defaultRatePerHour, 2);
  if (!Number.isFinite(rate) || rate < 0) {
    const err = new Error("ratePerHour must be >= 0 for HOURLY_RATE mode.");
    err.status = 400;
    throw err;
  }

  const amount = toFixedNumber(metrics.overtimeHours * rate, 2);
  return {
    mode,
    overtimeMinutes: metrics.overtimeMinutes,
    overtimeHours: metrics.overtimeHours,
    ratePerHour: rate,
    amount,
    formula: "round(overtime_minutes / 60, 2) * rate_per_hour",
    note: `HOURLY_RATE hours=${metrics.overtimeHours}, rate=${rate}`
  };
}

module.exports = {
  toFixedNumber,
  normalizeCalcMode,
  computeOvertimeMetrics,
  calculateOvertimeExpense
};
