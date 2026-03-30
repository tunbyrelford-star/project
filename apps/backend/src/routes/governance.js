const express = require("express");
const { pool, withTransaction } = require("../db");

const router = express.Router();

const ACCESS_ROLES = ["SUPER_ADMIN", "DISPATCHER", "ONSITE_SPECIALIST", "SALES", "FINANCE_MGMT"];
const REVIEW_ROLES = ["SUPER_ADMIN", "FINANCE_MGMT"];

function ensureRole(req, allowedRoles) {
  if (!allowedRoles.includes(req.user.roleCode)) {
    const err = new Error("Permission denied");
    err.status = 403;
    throw err;
  }
}

function ensureReviewRole(req) {
  ensureRole(req, REVIEW_ROLES);
}

function toNum(value, fallback = 0) {
  const num = Number(value);
  return Number.isFinite(num) ? num : fallback;
}

function toFixedNum(value, digits = 2) {
  return Number(toNum(value, 0).toFixed(digits));
}

function generateNo(prefix) {
  return `${prefix}-${Date.now()}-${Math.floor(100 + Math.random() * 900)}`;
}

function parseJson(value, fallback = null) {
  if (value == null) return fallback;
  if (typeof value === "object") return value;
  try {
    return JSON.parse(value);
  } catch (_error) {
    return fallback;
  }
}

function parseJsonArray(value) {
  const parsed = parseJson(value, []);
  return Array.isArray(parsed) ? parsed : [];
}

function buildInClause(length) {
  return new Array(length).fill("?").join(",");
}

async function writeAuditLog(conn, payload) {
  await conn.query(
    `INSERT INTO audit_logs
      (trace_id, actor_user_id, action, entity_type, entity_id, before_data, after_data, created_at, updated_at, created_by, updated_by, is_void)
     VALUES (?, ?, ?, ?, ?, ?, ?, NOW(), NOW(), ?, ?, 0)`,
    [
      payload.traceId || null,
      payload.actorUserId || null,
      payload.action,
      payload.entityType,
      payload.entityId || null,
      payload.beforeData ? JSON.stringify(payload.beforeData) : null,
      payload.afterData ? JSON.stringify(payload.afterData) : null,
      payload.actorUserId || null,
      payload.actorUserId || null
    ]
  );
}

function approvalTypeImpactsFinancial(approvalType) {
  return [
    "LOCKED_CHANGE",
    "TONNAGE_FIX",
    "ALLOCATION_ADJUST",
    "STOCK_IN_ADJUST",
    "EXPENSE_ADJUST",
    "SETTLEMENT_REVISE"
  ].includes(approvalType);
}

async function resolveTargetLockState(conn, targetEntityType, targetEntityId) {
  if (targetEntityType === "VOYAGE") {
    const [rows] = await conn.query(
      `SELECT id, voyage_no, status
         FROM voyages
        WHERE id = ?
          AND is_void = 0
        LIMIT 1`,
      [targetEntityId]
    );
    if (!rows.length) {
      const err = new Error("Voyage target not found.");
      err.status = 404;
      throw err;
    }
    return {
      locked: rows[0].status === "LOCKED",
      scope: rows[0]
    };
  }

  if (targetEntityType === "SALES_ORDER") {
    const [rows] = await conn.query(
      `SELECT id, sales_order_no, status, ar_status
         FROM sales_orders
        WHERE id = ?
          AND is_void = 0
        LIMIT 1`,
      [targetEntityId]
    );
    if (!rows.length) {
      const err = new Error("Sales order target not found.");
      err.status = 404;
      throw err;
    }
    const row = rows[0];
    const lockedStates = ["LOCKED_STOCK", "PENDING_FINAL_QTY_CONFIRM", "READY_FOR_PAYMENT_CONFIRM", "COMPLETED"];
    return {
      locked: lockedStates.includes(row.status),
      scope: row
    };
  }

  if (targetEntityType === "EXPENSE") {
    const [rows] = await conn.query(
      `SELECT
         e.id, e.expense_no, e.status AS expense_status, e.voyage_id,
         v.voyage_no, v.status AS voyage_status
       FROM expenses e
       JOIN voyages v ON v.id = e.voyage_id AND v.is_void = 0
       WHERE e.id = ?
         AND e.is_void = 0
       LIMIT 1`,
      [targetEntityId]
    );
    if (!rows.length) {
      const err = new Error("Expense target not found.");
      err.status = 404;
      throw err;
    }
    return {
      locked: rows[0].voyage_status === "LOCKED",
      scope: rows[0]
    };
  }

  if (targetEntityType === "STOCK_IN") {
    const [rows] = await conn.query(
      `SELECT
         si.id, si.stock_in_no, si.status AS stock_in_status,
         b.id AS batch_id, b.batch_no, v.id AS voyage_id, v.voyage_no, v.status AS voyage_status
       FROM stock_ins si
       JOIN inventory_batches b ON b.id = si.batch_id AND b.is_void = 0
       JOIN voyages v ON v.id = b.voyage_id AND v.is_void = 0
       WHERE si.id = ?
         AND si.is_void = 0
       LIMIT 1`,
      [targetEntityId]
    );
    if (!rows.length) {
      const err = new Error("Stock-in target not found.");
      err.status = 404;
      throw err;
    }
    return {
      locked: rows[0].voyage_status === "LOCKED",
      scope: rows[0]
    };
  }

  if (targetEntityType === "SETTLEMENT_VERSION") {
    const [rows] = await conn.query(
      `SELECT sv.id, sv.voyage_id, sv.version_no, sv.status, v.voyage_no, v.status AS voyage_status
         FROM settlement_versions sv
         JOIN voyages v ON v.id = sv.voyage_id AND v.is_void = 0
        WHERE sv.id = ?
          AND sv.is_void = 0
        LIMIT 1`,
      [targetEntityId]
    );
    if (!rows.length) {
      const err = new Error("Settlement version target not found.");
      err.status = 404;
      throw err;
    }
    return {
      locked: rows[0].voyage_status === "LOCKED",
      scope: rows[0]
    };
  }

  if (targetEntityType === "ALLOCATION_VERSION") {
    const [rows] = await conn.query(
      `SELECT av.id, av.sales_order_id, av.version_no, av.status, so.sales_order_no, so.status AS order_status
         FROM allocation_versions av
         JOIN sales_orders so ON so.id = av.sales_order_id AND so.is_void = 0
        WHERE av.id = ?
          AND av.is_void = 0
        LIMIT 1`,
      [targetEntityId]
    );
    if (!rows.length) {
      const err = new Error("Allocation version target not found.");
      err.status = 404;
      throw err;
    }
    const lockedStates = ["LOCKED_STOCK", "PENDING_FINAL_QTY_CONFIRM", "READY_FOR_PAYMENT_CONFIRM", "COMPLETED"];
    return {
      locked: lockedStates.includes(rows[0].order_status),
      scope: rows[0]
    };
  }

  const err = new Error("Unsupported target entity type.");
  err.status = 400;
  throw err;
}

async function createApprovalRequest(conn, req, payload) {
  const approvalNo = generateNo("APV");
  const [insertResult] = await conn.query(
    `INSERT INTO approvals
      (approval_no, approval_type, target_entity_type, target_entity_id, status,
       requested_by, requested_at, reviewed_by, reviewed_at,
       reason, before_snapshot, after_snapshot, attachment_urls,
       review_opinion, review_comment, review_attachment_urls,
       linked_version_type, linked_version_id, resolved_at,
       created_at, updated_at, created_by, updated_by, is_void)
     VALUES (?, ?, ?, ?, 'PENDING',
       ?, NOW(), NULL, NULL,
       ?, ?, ?, ?,
       NULL, NULL, NULL,
       NULL, NULL, NULL,
       NOW(), NOW(), ?, ?, 0)`,
    [
      approvalNo,
      payload.approvalType,
      payload.targetEntityType,
      payload.targetEntityId,
      req.user.id,
      payload.reason,
      payload.beforeSnapshot ? JSON.stringify(payload.beforeSnapshot) : null,
      payload.afterSnapshot ? JSON.stringify(payload.afterSnapshot) : null,
      JSON.stringify(payload.attachmentUrls || []),
      req.user.id,
      req.user.id
    ]
  );
  return {
    approvalId: insertResult.insertId,
    approvalNo
  };
}

async function resolveVoyageIdForApproval(conn, approval) {
  if (approval.target_entity_type === "VOYAGE") {
    return Number(approval.target_entity_id);
  }
  if (approval.target_entity_type === "SETTLEMENT_VERSION") {
    const [rows] = await conn.query(
      `SELECT voyage_id
         FROM settlement_versions
        WHERE id = ?
          AND is_void = 0
        LIMIT 1`,
      [approval.target_entity_id]
    );
    return rows.length ? Number(rows[0].voyage_id) : 0;
  }
  if (approval.target_entity_type === "EXPENSE") {
    const [rows] = await conn.query(
      `SELECT voyage_id
         FROM expenses
        WHERE id = ?
          AND is_void = 0
        LIMIT 1
        FOR UPDATE`,
      [approval.target_entity_id]
    );
    return rows.length ? Number(rows[0].voyage_id) : 0;
  }
  if (approval.target_entity_type === "STOCK_IN") {
    const [rows] = await conn.query(
      `SELECT b.voyage_id
         FROM stock_ins si
         JOIN inventory_batches b ON b.id = si.batch_id AND b.is_void = 0
        WHERE si.id = ?
          AND si.is_void = 0
        LIMIT 1`,
      [approval.target_entity_id]
    );
    return rows.length ? Number(rows[0].voyage_id) : 0;
  }
  return 0;
}

async function resolveSalesOrderIdForApproval(conn, approval, afterSnapshot) {
  if (approval.target_entity_type === "SALES_ORDER") {
    return Number(approval.target_entity_id);
  }
  if (approval.target_entity_type === "ALLOCATION_VERSION") {
    const [rows] = await conn.query(
      `SELECT sales_order_id
         FROM allocation_versions
        WHERE id = ?
          AND is_void = 0
        LIMIT 1`,
      [approval.target_entity_id]
    );
    return rows.length ? Number(rows[0].sales_order_id) : 0;
  }
  return Number(afterSnapshot.salesOrderId || 0);
}

async function createSettlementVersionFromApproval(conn, approval, actorUserId) {
  const afterSnapshot = parseJson(approval.after_snapshot, {}) || {};
  const voyageId = await resolveVoyageIdForApproval(conn, approval);
  if (!voyageId) {
    const err = new Error("Unable to resolve voyage for settlement version generation.");
    err.status = 400;
    throw err;
  }

  if (approval.target_entity_type === "EXPENSE") {
    await conn.query(
      `UPDATE expenses
          SET status = 'CONFIRMED',
              updated_at = NOW(),
              updated_by = ?
        WHERE id = ?
          AND is_void = 0`,
      [actorUserId, approval.target_entity_id]
    );
  }

  if (approval.target_entity_type === "STOCK_IN") {
    const [stockRows] = await conn.query(
      `SELECT
         si.id,
         si.batch_id,
         si.version_no,
         si.confirmed_qty,
         si.stock_in_time,
         COALESCE(si.voyage_id, b.voyage_id) AS voyage_id,
         COALESCE(si.procurement_id, v.procurement_id) AS procurement_id,
         b.available_qty AS batch_available_qty
       FROM stock_ins si
       JOIN inventory_batches b ON b.id = si.batch_id AND b.is_void = 0
       JOIN voyages v ON v.id = b.voyage_id AND v.is_void = 0
      WHERE si.id = ?
        AND si.is_void = 0
      LIMIT 1
      FOR UPDATE`,
      [approval.target_entity_id]
    );
    if (stockRows.length) {
      const baseStock = stockRows[0];
      const nextQty = afterSnapshot.confirmedQty != null
        ? toFixedNum(afterSnapshot.confirmedQty, 3)
        : toFixedNum(baseStock.confirmed_qty, 3);
      const nextTime = afterSnapshot.stockInTime || baseStock.stock_in_time || new Date();
      const nextVersionNo = Number(baseStock.version_no) + 1;
      const stockInNo = generateNo("STI");
      const evidenceUrls = parseJsonArray(afterSnapshot.evidenceUrls);
      const remark = afterSnapshot.remark ? String(afterSnapshot.remark) : "APPROVED_ADJUST";
      const beforeQty = afterSnapshot.beforeQty != null
        ? toFixedNum(afterSnapshot.beforeQty, 3)
        : toFixedNum(baseStock.batch_available_qty, 3);
      const afterQty = afterSnapshot.afterQty != null
        ? toFixedNum(afterSnapshot.afterQty, 3)
        : nextQty;
      const operatorName = afterSnapshot.operatorName
        ? String(afterSnapshot.operatorName)
        : `User#${actorUserId}`;

      await conn.query(
        `INSERT INTO stock_ins
          (stock_in_no, batch_id, voyage_id, procurement_id, version_no, confirmed_qty, before_qty, after_qty,
           stock_in_time, status, evidence_urls, voucher_attachments, remark, operator_id, operator_name,
           confirmed_by, approval_id, created_at, updated_at, created_by, updated_by, is_void)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'CONFIRMED', ?, ?, ?, ?, ?, ?, ?, NOW(), NOW(), ?, ?, 0)`,
        [
          stockInNo,
          baseStock.batch_id,
          baseStock.voyage_id,
          baseStock.procurement_id,
          nextVersionNo,
          nextQty,
          beforeQty,
          afterQty,
          nextTime,
          JSON.stringify(evidenceUrls),
          JSON.stringify(evidenceUrls),
          remark,
          actorUserId,
          operatorName,
          actorUserId,
          approval.id,
          actorUserId,
          actorUserId
        ]
      );

      await conn.query(
        `UPDATE inventory_batches
            SET stock_in_confirmed_at = ?,
                stock_in_confirmed_by = ?,
                updated_at = NOW(),
                updated_by = ?
          WHERE id = ?`,
        [nextTime, actorUserId, actorUserId, baseStock.batch_id]
      );
    }
  }

  const [latestRows] = await conn.query(
    `SELECT id, version_no, procurement_cost, expense_total, revenue_amount
       FROM settlement_versions
      WHERE voyage_id = ?
        AND is_void = 0
      ORDER BY version_no DESC
      LIMIT 1
      FOR UPDATE`,
    [voyageId]
  );
  const latest = latestRows[0] || null;

  let procurementCost = latest ? toFixedNum(latest.procurement_cost, 2) : 0;
  let revenueAmount = latest ? toFixedNum(latest.revenue_amount, 2) : 0;

  if (afterSnapshot.procurementCost != null) {
    procurementCost = toFixedNum(afterSnapshot.procurementCost, 2);
  }
  if (afterSnapshot.revenueAmount != null) {
    revenueAmount = toFixedNum(afterSnapshot.revenueAmount, 2);
  }

  let expenseTotal;
  if (afterSnapshot.expenseTotal != null) {
    expenseTotal = toFixedNum(afterSnapshot.expenseTotal, 2);
  } else {
    const [expenseRows] = await conn.query(
      `SELECT COALESCE(SUM(amount), 0) AS expense_total
         FROM expenses
        WHERE voyage_id = ?
          AND status = 'CONFIRMED'
          AND is_void = 0`,
      [voyageId]
    );
    expenseTotal = toFixedNum(expenseRows[0] && expenseRows[0].expense_total, 2);
    if (afterSnapshot.deltaExpense != null) {
      expenseTotal = toFixedNum(expenseTotal + toNum(afterSnapshot.deltaExpense, 0), 2);
    }
  }

  const versionNo = latest ? Number(latest.version_no) + 1 : 1;
  const [insertResult] = await conn.query(
    `INSERT INTO settlement_versions
      (voyage_id, version_no, based_on_version_id, snapshot_type, procurement_cost, expense_total, revenue_amount,
       status, is_current, readonly_at, approved_by, approved_at, created_at, updated_at, created_by, updated_by, is_void)
     VALUES (?, ?, ?, ?, ?, ?, ?, 'EFFECTIVE', 1, NOW(), ?, NOW(), NOW(), NOW(), ?, ?, 0)`,
    [
      voyageId,
      versionNo,
      latest ? latest.id : null,
      latest ? "REVISED" : "COST_SNAPSHOT",
      procurementCost,
      expenseTotal,
      revenueAmount,
      actorUserId,
      actorUserId,
      actorUserId
    ]
  );

  return {
    versionType: "SETTLEMENT_VERSION",
    versionId: insertResult.insertId,
    versionNo,
    voyageId
  };
}

async function updateInventoryBatchLockedQty(conn, batchId, deltaQty, actorUserId) {
  if (!deltaQty) return;
  const [rows] = await conn.query(
    `SELECT id, status, available_qty, locked_qty, shipped_qty, stock_in_confirmed
       FROM inventory_batches
      WHERE id = ?
        AND is_void = 0
      LIMIT 1
      FOR UPDATE`,
    [batchId]
  );
  if (!rows.length) {
    const err = new Error(`Batch ${batchId} not found.`);
    err.status = 400;
    throw err;
  }
  const row = rows[0];
  const nextLockedQty = toFixedNum(toNum(row.locked_qty, 0) + toNum(deltaQty, 0), 3);
  const maxLocked = toFixedNum(toNum(row.available_qty, 0) - toNum(row.shipped_qty, 0), 3);
  if (nextLockedQty < 0 || nextLockedQty > maxLocked) {
    const err = new Error(`Batch ${batchId} locked_qty out of range after adjustment.`);
    err.status = 400;
    throw err;
  }

  const remaining = toFixedNum(toNum(row.available_qty, 0) - nextLockedQty - toNum(row.shipped_qty, 0), 3);
  let nextStatus = row.status;
  if (remaining <= 0) {
    nextStatus = "SOLD_OUT";
  } else if (nextLockedQty > 0) {
    nextStatus = "PARTIALLY_ALLOCATED";
  } else if (Number(row.stock_in_confirmed || 0) === 1) {
    nextStatus = "AVAILABLE";
  } else {
    nextStatus = "PENDING_STOCK_IN";
  }

  await conn.query(
    `UPDATE inventory_batches
        SET locked_qty = ?,
            status = ?,
            updated_at = NOW(),
            updated_by = ?
      WHERE id = ?`,
    [nextLockedQty, nextStatus, actorUserId, batchId]
  );
}

async function createAllocationVersionFromApproval(conn, approval, actorUserId) {
  const afterSnapshot = parseJson(approval.after_snapshot, {}) || {};
  const salesOrderId = await resolveSalesOrderIdForApproval(conn, approval, afterSnapshot);
  if (!salesOrderId) {
    const err = new Error("Unable to resolve sales order for allocation version generation.");
    err.status = 400;
    throw err;
  }

  const [orderRows] = await conn.query(
    `SELECT id, sales_order_no, status, pricing_mode, unit_price
       FROM sales_orders
      WHERE id = ?
        AND is_void = 0
      LIMIT 1
      FOR UPDATE`,
    [salesOrderId]
  );
  if (!orderRows.length) {
    const err = new Error("Sales order target not found.");
    err.status = 404;
    throw err;
  }

  const [latestVersionRows] = await conn.query(
    `SELECT id, version_no, allocation_payload
       FROM allocation_versions
      WHERE sales_order_id = ?
        AND is_void = 0
      ORDER BY version_no DESC
      LIMIT 1
      FOR UPDATE`,
    [salesOrderId]
  );
  const latestVersion = latestVersionRows[0] || null;

  const linePatches = parseJsonArray(afterSnapshot.linePatches || afterSnapshot.lines);
  const salesOrderPatch = parseJson(afterSnapshot.salesOrderPatch, {}) || {};

  if (linePatches.length) {
    const [lineRows] = await conn.query(
      `SELECT
         id, line_no, batch_id, voyage_id, planned_qty, line_unit_price,
         source_procurement_unit_cost, source_expense_unit_cost, line_source_note
       FROM sales_line_items
       WHERE sales_order_id = ?
         AND is_void = 0
       ORDER BY line_no ASC
       FOR UPDATE`,
      [salesOrderId]
    );
    const byId = new Map(lineRows.map((x) => [Number(x.id), x]));
    const byLineNo = new Map(lineRows.map((x) => [Number(x.line_no), x]));
    const batchDelta = new Map();

    for (const patch of linePatches) {
      const lineId = Number(patch.lineId || 0);
      const lineNo = Number(patch.lineNo || 0);
      const row = lineId ? byId.get(lineId) : byLineNo.get(lineNo);
      if (!row) {
        const err = new Error(`Sales line not found for patch lineId=${lineId} lineNo=${lineNo}.`);
        err.status = 400;
        throw err;
      }

      const oldQty = toFixedNum(row.planned_qty, 3);
      const oldBatchId = Number(row.batch_id);
      const newQty = patch.plannedQty != null ? toFixedNum(patch.plannedQty, 3) : oldQty;
      const newBatchId = patch.batchId != null ? Number(patch.batchId) : oldBatchId;
      const newVoyageId = patch.voyageId != null ? Number(patch.voyageId) : Number(row.voyage_id);
      const newLineUnitPrice = patch.lineUnitPrice != null
        ? toFixedNum(patch.lineUnitPrice, 4)
        : toFixedNum(row.line_unit_price, 4);
      const sourceUnitCost = toFixedNum(toNum(row.source_procurement_unit_cost, 0) + toNum(row.source_expense_unit_cost, 0), 4);
      const nextRevenue = toFixedNum(newQty * newLineUnitPrice, 2);
      const nextCost = toFixedNum(newQty * sourceUnitCost, 2);
      const nextSourceNote = patch.lineSourceNote != null ? String(patch.lineSourceNote) : row.line_source_note;

      if (newQty <= 0) {
        const err = new Error("Allocation line plannedQty must be positive.");
        err.status = 400;
        throw err;
      }
      if (!newBatchId || !newVoyageId) {
        const err = new Error("Allocation line batchId and voyageId are required.");
        err.status = 400;
        throw err;
      }

      await conn.query(
        `UPDATE sales_line_items
            SET batch_id = ?,
                voyage_id = ?,
                planned_qty = ?,
                line_unit_price = ?,
                line_revenue_amount = ?,
                line_cost_amount = ?,
                line_source_note = ?,
                updated_at = NOW(),
                updated_by = ?
          WHERE id = ?`,
        [newBatchId, newVoyageId, newQty, newLineUnitPrice, nextRevenue, nextCost, nextSourceNote, actorUserId, row.id]
      );

      if (newBatchId === oldBatchId) {
        const delta = toFixedNum(newQty - oldQty, 3);
        batchDelta.set(newBatchId, toFixedNum(toNum(batchDelta.get(newBatchId), 0) + delta, 3));
      } else {
        batchDelta.set(oldBatchId, toFixedNum(toNum(batchDelta.get(oldBatchId), 0) - oldQty, 3));
        batchDelta.set(newBatchId, toFixedNum(toNum(batchDelta.get(newBatchId), 0) + newQty, 3));
      }
    }

    for (const [batchId, delta] of batchDelta.entries()) {
      if (Math.abs(delta) < 0.0005) continue;
      await updateInventoryBatchLockedQty(conn, batchId, delta, actorUserId);
    }
  }

  const [sumRows] = await conn.query(
    `SELECT
       COALESCE(SUM(planned_qty), 0) AS planned_total_qty,
       COALESCE(SUM(line_revenue_amount), 0) AS order_total_revenue
     FROM sales_line_items
     WHERE sales_order_id = ?
       AND is_void = 0`,
    [salesOrderId]
  );
  const plannedTotalQty = toFixedNum(sumRows[0] && sumRows[0].planned_total_qty, 3);
  const orderTotalRevenue = toFixedNum(sumRows[0] && sumRows[0].order_total_revenue, 2);

  await conn.query(
    `UPDATE sales_orders
        SET customer_name = COALESCE(?, customer_name),
            unit_price = CASE WHEN ? IS NULL THEN unit_price ELSE ? END,
            pricing_mode = CASE WHEN ? IS NULL THEN pricing_mode ELSE ? END,
            planned_total_qty = ?,
            total_amount = ?,
            updated_at = NOW(),
            updated_by = ?
      WHERE id = ?`,
    [
      salesOrderPatch.customerName ? String(salesOrderPatch.customerName) : null,
      salesOrderPatch.unitPrice == null ? null : toFixedNum(salesOrderPatch.unitPrice, 4),
      salesOrderPatch.unitPrice == null ? null : toFixedNum(salesOrderPatch.unitPrice, 4),
      salesOrderPatch.pricingMode ? String(salesOrderPatch.pricingMode) : null,
      salesOrderPatch.pricingMode ? String(salesOrderPatch.pricingMode) : null,
      plannedTotalQty,
      orderTotalRevenue,
      actorUserId,
      salesOrderId
    ]
  );

  const allocationPayload = afterSnapshot.allocationPayload
    ? afterSnapshot.allocationPayload
    : {
        linePatches,
        salesOrderPatch
      };
  const versionNo = latestVersion ? Number(latestVersion.version_no) + 1 : 1;

  const [insertResult] = await conn.query(
    `INSERT INTO allocation_versions
      (sales_order_id, version_no, reason, allocation_payload, status, is_current,
       requested_by, approved_by, approved_at, created_at, updated_at, created_by, updated_by, is_void)
     VALUES (?, ?, ?, ?, 'EFFECTIVE', 1, ?, ?, NOW(), NOW(), NOW(), ?, ?, 0)`,
    [
      salesOrderId,
      versionNo,
      approval.reason,
      JSON.stringify(allocationPayload || {}),
      approval.requested_by,
      actorUserId,
      actorUserId,
      actorUserId
    ]
  );

  return {
    versionType: "ALLOCATION_VERSION",
    versionId: insertResult.insertId,
    versionNo,
    salesOrderId
  };
}

async function applyApprovalVersion(conn, approval, actorUserId) {
  if (
    approval.approval_type === "SETTLEMENT_REVISE"
    || approval.approval_type === "EXPENSE_ADJUST"
    || approval.approval_type === "STOCK_IN_ADJUST"
    || (approval.approval_type === "LOCKED_CHANGE" && ["VOYAGE", "SETTLEMENT_VERSION", "EXPENSE", "STOCK_IN"].includes(approval.target_entity_type))
  ) {
    return createSettlementVersionFromApproval(conn, approval, actorUserId);
  }

  if (
    approval.approval_type === "ALLOCATION_ADJUST"
    || (approval.approval_type === "TONNAGE_FIX" && ["SALES_ORDER", "ALLOCATION_VERSION"].includes(approval.target_entity_type))
    || (approval.approval_type === "LOCKED_CHANGE" && ["SALES_ORDER", "ALLOCATION_VERSION"].includes(approval.target_entity_type))
  ) {
    return createAllocationVersionFromApproval(conn, approval, actorUserId);
  }

  return null;
}

router.get("/approvals", async (req, res, next) => {
  try {
    ensureRole(req, ACCESS_ROLES);

    const where = ["a.is_void = 0"];
    const params = [];

    if (req.query.status) {
      where.push("a.status = ?");
      params.push(String(req.query.status));
    }
    if (req.query.approvalType) {
      where.push("a.approval_type = ?");
      params.push(String(req.query.approvalType));
    }
    if (req.query.targetEntityType) {
      where.push("a.target_entity_type = ?");
      params.push(String(req.query.targetEntityType));
    }
    if (String(req.query.mine || "") === "1") {
      where.push("a.requested_by = ?");
      params.push(req.user.id);
    }
    const keyword = String(req.query.keyword || "").trim();
    if (keyword) {
      where.push("(a.approval_no LIKE ? OR a.reason LIKE ?)");
      params.push(`%${keyword}%`, `%${keyword}%`);
    }

    const limit = Math.min(500, Math.max(1, Number(req.query.limit || 200)));
    const [rows] = await pool.query(
      `SELECT
         a.id, a.approval_no, a.approval_type, a.target_entity_type, a.target_entity_id,
         a.status, a.reason, a.requested_at, a.reviewed_at, a.review_comment,
         a.linked_version_type, a.linked_version_id,
         a.requested_by, a.reviewed_by,
         u1.display_name AS requested_by_name,
         u2.display_name AS reviewed_by_name
       FROM approvals a
       LEFT JOIN users u1 ON u1.id = a.requested_by
       LEFT JOIN users u2 ON u2.id = a.reviewed_by
       WHERE ${where.join(" AND ")}
       ORDER BY
         CASE WHEN a.status = 'PENDING' THEN 0 ELSE 1 END ASC,
         a.requested_at DESC
       LIMIT ${limit}`,
      params
    );

    res.json({
      items: rows.map((row) => ({
        id: row.id,
        approvalNo: row.approval_no,
        approvalType: row.approval_type,
        targetEntityType: row.target_entity_type,
        targetEntityId: row.target_entity_id,
        status: row.status,
        reason: row.reason,
        requestedAt: row.requested_at,
        reviewedAt: row.reviewed_at,
        reviewComment: row.review_comment || "",
        linkedVersionType: row.linked_version_type,
        linkedVersionId: row.linked_version_id,
        requestedBy: row.requested_by,
        requestedByName: row.requested_by_name || "",
        reviewedBy: row.reviewed_by,
        reviewedByName: row.reviewed_by_name || "",
        canReview: REVIEW_ROLES.includes(req.user.roleCode) && row.status === "PENDING"
      }))
    });
  } catch (error) {
    next(error);
  }
});

router.post("/approvals", async (req, res, next) => {
  try {
    ensureRole(req, ACCESS_ROLES);

    const {
      approvalType,
      targetEntityType,
      targetEntityId,
      reason,
      beforeSnapshot = null,
      afterSnapshot = null,
      attachmentUrls = []
    } = req.body || {};

    if (!approvalType || !targetEntityType || !targetEntityId || !reason) {
      return res.status(400).json({
        message: "approvalType, targetEntityType, targetEntityId, reason are required."
      });
    }

    const parsedTargetEntityId = Number(targetEntityId);
    if (!parsedTargetEntityId) {
      return res.status(400).json({ message: "targetEntityId must be valid number." });
    }

    const result = await withTransaction(async (conn) => {
      const lockState = await resolveTargetLockState(conn, String(targetEntityType), parsedTargetEntityId);
      if (approvalTypeImpactsFinancial(String(approvalType)) && !lockState.locked) {
        const err = new Error("Locked-state financial/tonnage/profit changes must use approval on locked target.");
        err.status = 400;
        throw err;
      }

      const created = await createApprovalRequest(conn, req, {
        approvalType: String(approvalType),
        targetEntityType: String(targetEntityType),
        targetEntityId: parsedTargetEntityId,
        reason: String(reason),
        beforeSnapshot,
        afterSnapshot,
        attachmentUrls: Array.isArray(attachmentUrls) ? attachmentUrls : []
      });

      await writeAuditLog(conn, {
        actorUserId: req.user.id,
        action: "APPROVAL_SUBMIT",
        entityType: "APPROVAL",
        entityId: created.approvalId,
        afterData: {
          approvalNo: created.approvalNo,
          approvalType: String(approvalType),
          targetEntityType: String(targetEntityType),
          targetEntityId: parsedTargetEntityId
        }
      });

      return {
        ...created,
        lockState: lockState.scope
      };
    });

    res.json({
      message: "Approval submitted.",
      ...result
    });
  } catch (error) {
    next(error);
  }
});

router.get("/approvals/:id", async (req, res, next) => {
  try {
    ensureRole(req, ACCESS_ROLES);

    const approvalId = Number(req.params.id);
    if (!approvalId) {
      return res.status(400).json({ message: "Invalid approval id." });
    }

    const [rows] = await pool.query(
      `SELECT
         a.*,
         u1.display_name AS requested_by_name,
         u2.display_name AS reviewed_by_name
       FROM approvals a
       LEFT JOIN users u1 ON u1.id = a.requested_by
       LEFT JOIN users u2 ON u2.id = a.reviewed_by
       WHERE a.id = ?
         AND a.is_void = 0
       LIMIT 1`,
      [approvalId]
    );
    if (!rows.length) {
      return res.status(404).json({ message: "Approval not found." });
    }
    const approval = rows[0];

    let linkedVersion = null;
    if (approval.linked_version_type === "SETTLEMENT_VERSION" && approval.linked_version_id) {
      const [versionRows] = await pool.query(
        `SELECT
           sv.id, sv.voyage_id, v.voyage_no, sv.version_no, sv.snapshot_type,
           sv.procurement_cost, sv.expense_total, sv.revenue_amount, sv.profit_amount,
           sv.status, sv.created_at
         FROM settlement_versions sv
         JOIN voyages v ON v.id = sv.voyage_id
         WHERE sv.id = ?
           AND sv.is_void = 0
         LIMIT 1`,
        [approval.linked_version_id]
      );
      linkedVersion = versionRows[0] || null;
    } else if (approval.linked_version_type === "ALLOCATION_VERSION" && approval.linked_version_id) {
      const [versionRows] = await pool.query(
        `SELECT
           av.id, av.sales_order_id, so.sales_order_no, av.version_no, av.reason,
           av.allocation_payload, av.status, av.created_at
         FROM allocation_versions av
         JOIN sales_orders so ON so.id = av.sales_order_id
         WHERE av.id = ?
           AND av.is_void = 0
         LIMIT 1`,
        [approval.linked_version_id]
      );
      linkedVersion = versionRows[0]
        ? {
            ...versionRows[0],
            allocation_payload: parseJson(versionRows[0].allocation_payload, {})
          }
        : null;
    }

    const [auditRows] = await pool.query(
      `SELECT id, action, actor_user_id, event_time, before_data, after_data
       FROM audit_logs
       WHERE is_void = 0
         AND entity_type = 'APPROVAL'
         AND entity_id = ?
       ORDER BY event_time DESC
       LIMIT 100`,
      [approvalId]
    );

    res.json({
      approval: {
        id: approval.id,
        approvalNo: approval.approval_no,
        approvalType: approval.approval_type,
        targetEntityType: approval.target_entity_type,
        targetEntityId: approval.target_entity_id,
        status: approval.status,
        requestedBy: approval.requested_by,
        requestedByName: approval.requested_by_name || "",
        requestedAt: approval.requested_at,
        reviewedBy: approval.reviewed_by,
        reviewedByName: approval.reviewed_by_name || "",
        reviewedAt: approval.reviewed_at,
        reason: approval.reason,
        beforeSnapshot: parseJson(approval.before_snapshot, {}),
        afterSnapshot: parseJson(approval.after_snapshot, {}),
        attachmentUrls: parseJsonArray(approval.attachment_urls),
        reviewOpinion: approval.review_opinion || "",
        reviewComment: approval.review_comment || "",
        reviewAttachmentUrls: parseJsonArray(approval.review_attachment_urls),
        linkedVersionType: approval.linked_version_type,
        linkedVersionId: approval.linked_version_id,
        resolvedAt: approval.resolved_at
      },
      linkedVersion,
      audits: auditRows.map((row) => ({
        id: row.id,
        action: row.action,
        actorUserId: row.actor_user_id,
        eventTime: row.event_time,
        beforeData: row.before_data,
        afterData: row.after_data
      })),
      canReview: REVIEW_ROLES.includes(req.user.roleCode) && approval.status === "PENDING"
    });
  } catch (error) {
    next(error);
  }
});

router.post("/approvals/:id/review", async (req, res, next) => {
  try {
    ensureReviewRole(req);

    const approvalId = Number(req.params.id);
    const decision = String((req.body || {}).decision || "").toUpperCase();
    const reviewComment = String((req.body || {}).reviewComment || "").trim();
    const reviewAttachmentUrls = Array.isArray((req.body || {}).reviewAttachmentUrls)
      ? (req.body || {}).reviewAttachmentUrls
      : [];

    if (!approvalId) {
      return res.status(400).json({ message: "Invalid approval id." });
    }
    if (!["APPROVE", "REJECT"].includes(decision)) {
      return res.status(400).json({ message: "decision must be APPROVE or REJECT." });
    }
    if (!reviewComment) {
      return res.status(400).json({ message: "reviewComment is required." });
    }

    const result = await withTransaction(async (conn) => {
      const [rows] = await conn.query(
        `SELECT *
         FROM approvals
         WHERE id = ?
           AND is_void = 0
         LIMIT 1
         FOR UPDATE`,
        [approvalId]
      );
      if (!rows.length) {
        const err = new Error("Approval not found.");
        err.status = 404;
        throw err;
      }
      const approval = rows[0];
      if (approval.status !== "PENDING") {
        const err = new Error("Approval is already reviewed.");
        err.status = 400;
        throw err;
      }

      let linkedVersion = null;
      if (decision === "APPROVE") {
        linkedVersion = await applyApprovalVersion(conn, approval, req.user.id);
      } else if (approval.target_entity_type === "EXPENSE") {
        await conn.query(
          `UPDATE expenses
              SET status = 'VOID',
                  updated_at = NOW(),
                  updated_by = ?
            WHERE id = ?
              AND is_void = 0
              AND status = 'DRAFT'`,
          [req.user.id, approval.target_entity_id]
        );
      }

      await conn.query(
        `UPDATE approvals
            SET status = ?,
                reviewed_by = ?,
                reviewed_at = NOW(),
                review_opinion = ?,
                review_comment = ?,
                review_attachment_urls = ?,
                linked_version_type = ?,
                linked_version_id = ?,
                resolved_at = NOW(),
                updated_at = NOW(),
                updated_by = ?
          WHERE id = ?`,
        [
          decision === "APPROVE" ? "APPROVED" : "REJECTED",
          req.user.id,
          decision,
          reviewComment,
          JSON.stringify(reviewAttachmentUrls),
          linkedVersion ? linkedVersion.versionType : null,
          linkedVersion ? linkedVersion.versionId : null,
          req.user.id,
          approvalId
        ]
      );

      await writeAuditLog(conn, {
        actorUserId: req.user.id,
        action: decision === "APPROVE" ? "APPROVAL_APPROVED" : "APPROVAL_REJECTED",
        entityType: "APPROVAL",
        entityId: approvalId,
        beforeData: {
          status: approval.status
        },
        afterData: {
          status: decision === "APPROVE" ? "APPROVED" : "REJECTED",
          reviewComment,
          linkedVersion
        }
      });

      return {
        approvalId,
        approvalNo: approval.approval_no,
        status: decision === "APPROVE" ? "APPROVED" : "REJECTED",
        linkedVersion
      };
    });

    res.json({
      message: decision === "APPROVE" ? "Approval approved." : "Approval rejected.",
      ...result
    });
  } catch (error) {
    next(error);
  }
});

router.get("/versions", async (req, res, next) => {
  try {
    ensureRole(req, ACCESS_ROLES);

    const targetType = String(req.query.targetType || "").toUpperCase();
    const targetId = Number(req.query.targetId || 0);
    const voyageIdQuery = Number(req.query.voyageId || 0);
    const salesOrderIdQuery = Number(req.query.salesOrderId || 0);

    let voyageIds = [];
    let salesOrderIds = [];

    if (targetType === "VOYAGE" && targetId) {
      voyageIds = [targetId];
    } else if (targetType === "SALES_ORDER" && targetId) {
      salesOrderIds = [targetId];
    }

    if (voyageIdQuery) {
      voyageIds.push(voyageIdQuery);
    }
    if (salesOrderIdQuery) {
      salesOrderIds.push(salesOrderIdQuery);
    }

    voyageIds = [...new Set(voyageIds.filter((x) => x > 0))];
    salesOrderIds = [...new Set(salesOrderIds.filter((x) => x > 0))];

    if (!voyageIds.length && !salesOrderIds.length) {
      return res.status(400).json({ message: "targetType/targetId or voyageId/salesOrderId is required." });
    }

    if (voyageIds.length && !salesOrderIds.length) {
      const placeholders = buildInClause(voyageIds.length);
      const [rows] = await pool.query(
        `SELECT DISTINCT li.sales_order_id
           FROM sales_line_items li
          WHERE li.voyage_id IN (${placeholders})
            AND li.is_void = 0`,
        voyageIds
      );
      salesOrderIds = rows.map((x) => Number(x.sales_order_id)).filter((x) => x > 0);
    }

    if (salesOrderIds.length && !voyageIds.length) {
      const placeholders = buildInClause(salesOrderIds.length);
      const [rows] = await pool.query(
        `SELECT DISTINCT li.voyage_id
           FROM sales_line_items li
          WHERE li.sales_order_id IN (${placeholders})
            AND li.is_void = 0`,
        salesOrderIds
      );
      voyageIds = rows.map((x) => Number(x.voyage_id)).filter((x) => x > 0);
    }

    let settlementVersions = [];
    if (voyageIds.length) {
      const placeholders = buildInClause(voyageIds.length);
      const [rows] = await pool.query(
        `SELECT
           sv.id, sv.voyage_id, v.voyage_no, sv.version_no, sv.snapshot_type,
           sv.procurement_cost, sv.expense_total, sv.revenue_amount, sv.profit_amount,
           sv.status, sv.readonly_at, sv.approved_by, sv.approved_at, sv.created_at
         FROM settlement_versions sv
         JOIN voyages v ON v.id = sv.voyage_id
         WHERE sv.is_void = 0
           AND sv.voyage_id IN (${placeholders})
         ORDER BY sv.voyage_id ASC, sv.version_no DESC`,
        voyageIds
      );
      settlementVersions = rows;
    }

    let allocationVersions = [];
    if (salesOrderIds.length) {
      const placeholders = buildInClause(salesOrderIds.length);
      const [rows] = await pool.query(
        `SELECT
           av.id, av.sales_order_id, so.sales_order_no, av.version_no, av.reason,
           av.allocation_payload, av.status, av.requested_by, av.approved_by, av.approved_at, av.created_at
         FROM allocation_versions av
         JOIN sales_orders so ON so.id = av.sales_order_id
         WHERE av.is_void = 0
           AND av.sales_order_id IN (${placeholders})
         ORDER BY av.sales_order_id ASC, av.version_no DESC`,
        salesOrderIds
      );
      allocationVersions = rows.map((row) => ({
        ...row,
        allocation_payload: parseJson(row.allocation_payload, {})
      }));
    }

    const timeline = []
      .concat(
        settlementVersions.map((row) => ({
          type: "SETTLEMENT_VERSION",
          id: row.id,
          targetId: row.voyage_id,
          targetNo: row.voyage_no,
          versionNo: row.version_no,
          status: row.status,
          createdAt: row.created_at
        }))
      )
      .concat(
        allocationVersions.map((row) => ({
          type: "ALLOCATION_VERSION",
          id: row.id,
          targetId: row.sales_order_id,
          targetNo: row.sales_order_no,
          versionNo: row.version_no,
          status: row.status,
          createdAt: row.created_at
        }))
      )
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

    res.json({
      settlementVersions,
      allocationVersions,
      timeline
    });
  } catch (error) {
    next(error);
  }
});

router.get("/audits", async (req, res, next) => {
  try {
    ensureRole(req, ACCESS_ROLES);

    const where = ["a.is_void = 0"];
    const params = [];
    if (req.query.entityType) {
      where.push("a.entity_type = ?");
      params.push(String(req.query.entityType));
    }
    if (req.query.entityId) {
      where.push("a.entity_id = ?");
      params.push(Number(req.query.entityId));
    }
    const keyword = String(req.query.keyword || "").trim();
    if (keyword) {
      where.push("(a.action LIKE ? OR CAST(a.before_data AS CHAR) LIKE ? OR CAST(a.after_data AS CHAR) LIKE ?)");
      params.push(`%${keyword}%`, `%${keyword}%`, `%${keyword}%`);
    }
    const limit = Math.min(500, Math.max(1, Number(req.query.limit || 200)));

    const [rows] = await pool.query(
      `SELECT
         a.id, a.trace_id, a.actor_user_id, u.display_name AS actor_name,
         a.action, a.entity_type, a.entity_id, a.event_time, a.before_data, a.after_data
       FROM audit_logs a
       LEFT JOIN users u ON u.id = a.actor_user_id
       WHERE ${where.join(" AND ")}
       ORDER BY a.event_time DESC
       LIMIT ${limit}`,
      params
    );

    res.json({
      items: rows.map((row) => ({
        id: row.id,
        traceId: row.trace_id,
        actorUserId: row.actor_user_id,
        actorName: row.actor_name || "",
        action: row.action,
        entityType: row.entity_type,
        entityId: row.entity_id,
        eventTime: row.event_time,
        beforeData: row.before_data,
        afterData: row.after_data
      }))
    });
  } catch (error) {
    next(error);
  }
});

router.get("/reports/profit-trace", async (req, res, next) => {
  try {
    ensureRole(req, ACCESS_ROLES);

    const where = ["li.is_void = 0", "so.is_void = 0", "b.is_void = 0", "v.is_void = 0"];
    const params = [];

    if (req.query.voyageId) {
      where.push("v.id = ?");
      params.push(Number(req.query.voyageId));
    }
    if (req.query.salesOrderId) {
      where.push("so.id = ?");
      params.push(Number(req.query.salesOrderId));
    }
    if (req.query.batchId) {
      where.push("b.id = ?");
      params.push(Number(req.query.batchId));
    }

    const keyword = String(req.query.keyword || "").trim();
    if (keyword) {
      where.push("(v.voyage_no LIKE ? OR b.batch_no LIKE ? OR so.sales_order_no LIKE ? OR so.customer_name LIKE ?)");
      params.push(`%${keyword}%`, `%${keyword}%`, `%${keyword}%`, `%${keyword}%`);
    }

    const [rows] = await pool.query(
      `SELECT
         li.id AS line_id,
         li.line_no,
         li.planned_qty,
         li.final_qty,
         li.line_unit_price,
         li.line_revenue_amount,
         li.line_cost_amount,
         li.line_profit_amount,
         li.status AS line_status,
         b.id AS batch_id,
         b.batch_no,
         v.id AS voyage_id,
         v.voyage_no,
         so.id AS sales_order_id,
         so.sales_order_no,
         so.customer_name,
         so.status AS sales_order_status,
         so.ar_status,
         so.total_amount AS sales_order_total_amount,
         so.final_total_qty AS sales_order_final_qty,
         COALESCE(pay.incoming_amount, 0) AS incoming_amount,
         COALESCE(pay.reversed_amount, 0) AS reversed_amount,
         COALESCE(pay.net_confirmed_amount, 0) AS net_confirmed_amount,
         COALESCE(sv.latest_settlement_version_no, 0) AS latest_settlement_version_no,
         COALESCE(av.latest_allocation_version_no, 0) AS latest_allocation_version_no
       FROM sales_line_items li
       JOIN sales_orders so ON so.id = li.sales_order_id
       JOIN inventory_batches b ON b.id = li.batch_id
       JOIN voyages v ON v.id = li.voyage_id
       LEFT JOIN (
         SELECT
           sales_order_id,
           COALESCE(SUM(CASE WHEN status = 'CONFIRMED' AND is_void = 0 AND is_reversal = 0 THEN payment_amount ELSE 0 END), 0) AS incoming_amount,
           COALESCE(SUM(CASE WHEN status = 'CONFIRMED' AND is_void = 0 AND is_reversal = 1 THEN payment_amount ELSE 0 END), 0) AS reversed_amount,
           COALESCE(SUM(CASE WHEN status = 'CONFIRMED' AND is_void = 0 AND is_reversal = 0 THEN payment_amount ELSE 0 END), 0)
             - COALESCE(SUM(CASE WHEN status = 'CONFIRMED' AND is_void = 0 AND is_reversal = 1 THEN payment_amount ELSE 0 END), 0) AS net_confirmed_amount
         FROM payments
         GROUP BY sales_order_id
       ) pay ON pay.sales_order_id = so.id
       LEFT JOIN (
         SELECT voyage_id, MAX(version_no) AS latest_settlement_version_no
         FROM settlement_versions
         WHERE is_void = 0
         GROUP BY voyage_id
       ) sv ON sv.voyage_id = v.id
       LEFT JOIN (
         SELECT sales_order_id, MAX(version_no) AS latest_allocation_version_no
         FROM allocation_versions
         WHERE is_void = 0
         GROUP BY sales_order_id
       ) av ON av.sales_order_id = so.id
       WHERE ${where.join(" AND ")}
       ORDER BY v.voyage_no DESC, so.sales_order_no DESC, li.line_no ASC
       LIMIT 2000`,
      params
    );

    const items = rows.map((row) => {
      const lineRevenue = toFixedNum(row.line_revenue_amount, 2);
      const lineCost = toFixedNum(row.line_cost_amount, 2);
      const lineProfit = toFixedNum(row.line_profit_amount, 2);
      const netConfirmedAmount = toFixedNum(row.net_confirmed_amount, 2);
      const orderTotalAmount = toFixedNum(row.sales_order_total_amount, 2);
      return {
        lineId: row.line_id,
        lineNo: row.line_no,
        lineStatus: row.line_status,
        plannedQty: toFixedNum(row.planned_qty, 3),
        finalQty: row.final_qty == null ? null : toFixedNum(row.final_qty, 3),
        lineUnitPrice: toFixedNum(row.line_unit_price, 4),
        lineRevenueAmount: lineRevenue,
        lineCostAmount: lineCost,
        lineProfitAmount: lineProfit,
        voyageId: row.voyage_id,
        voyageNo: row.voyage_no,
        batchId: row.batch_id,
        batchNo: row.batch_no,
        salesOrderId: row.sales_order_id,
        salesOrderNo: row.sales_order_no,
        customerName: row.customer_name,
        salesOrderStatus: row.sales_order_status,
        arStatus: row.ar_status,
        salesOrderTotalAmount: orderTotalAmount,
        salesOrderFinalQty: row.sales_order_final_qty == null ? null : toFixedNum(row.sales_order_final_qty, 3),
        incomingAmount: toFixedNum(row.incoming_amount, 2),
        reversedAmount: toFixedNum(row.reversed_amount, 2),
        netConfirmedAmount,
        outstandingAmount: toFixedNum(Math.max(orderTotalAmount - netConfirmedAmount, 0), 2),
        latestSettlementVersionNo: Number(row.latest_settlement_version_no || 0),
        latestAllocationVersionNo: Number(row.latest_allocation_version_no || 0)
      };
    });

    const summary = {
      totalLines: items.length,
      totalRevenue: toFixedNum(items.reduce((sum, x) => sum + toNum(x.lineRevenueAmount, 0), 0), 2),
      totalCost: toFixedNum(items.reduce((sum, x) => sum + toNum(x.lineCostAmount, 0), 0), 2),
      totalProfit: toFixedNum(items.reduce((sum, x) => sum + toNum(x.lineProfitAmount, 0), 0), 2)
    };

    const orderMap = new Map();
    for (const item of items) {
      if (!orderMap.has(item.salesOrderId)) {
        orderMap.set(item.salesOrderId, {
          salesOrderId: item.salesOrderId,
          salesOrderNo: item.salesOrderNo,
          voyageNo: item.voyageNo,
          totalAmount: item.salesOrderTotalAmount,
          netConfirmedAmount: item.netConfirmedAmount,
          outstandingAmount: item.outstandingAmount,
          arStatus: item.arStatus,
          salesOrderStatus: item.salesOrderStatus
        });
      }
    }
    const paymentSummary = {
      totalOrders: orderMap.size,
      totalOrderAmount: toFixedNum(Array.from(orderMap.values()).reduce((sum, x) => sum + toNum(x.totalAmount, 0), 0), 2),
      totalNetConfirmed: toFixedNum(Array.from(orderMap.values()).reduce((sum, x) => sum + toNum(x.netConfirmedAmount, 0), 0), 2),
      totalOutstanding: toFixedNum(Array.from(orderMap.values()).reduce((sum, x) => sum + toNum(x.outstandingAmount, 0), 0), 2)
    };

    const voyageMap = new Map();
    for (const item of items) {
      const existing = voyageMap.get(item.voyageId) || {
        voyageId: item.voyageId,
        voyageNo: item.voyageNo,
        lineCount: 0,
        revenueAmount: 0,
        costAmount: 0,
        profitAmount: 0
      };
      existing.lineCount += 1;
      existing.revenueAmount = toFixedNum(existing.revenueAmount + toNum(item.lineRevenueAmount, 0), 2);
      existing.costAmount = toFixedNum(existing.costAmount + toNum(item.lineCostAmount, 0), 2);
      existing.profitAmount = toFixedNum(existing.profitAmount + toNum(item.lineProfitAmount, 0), 2);
      voyageMap.set(item.voyageId, existing);
    }

    res.json({
      summary,
      paymentSummary,
      voyageSummary: Array.from(voyageMap.values()).sort((a, b) => String(b.voyageNo).localeCompare(String(a.voyageNo))),
      items
    });
  } catch (error) {
    next(error);
  }
});

module.exports = router;
