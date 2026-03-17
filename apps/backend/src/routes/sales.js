const express = require("express");
const { pool, withTransaction } = require("../db");

const router = express.Router();

const ACCESS_ROLES = ["SUPER_ADMIN", "DISPATCHER", "SALES", "FINANCE_MGMT"];
const MANAGE_ROLES = ["SUPER_ADMIN", "SALES"];
const FINANCIAL_ROLES = ["SUPER_ADMIN", "FINANCE_MGMT"];
const EDITABLE_ORDER_STATUS = ["DRAFT", "LOCKED_STOCK"];

function ensureRole(req, allowedRoles) {
  if (!allowedRoles.includes(req.user.roleCode)) {
    const err = new Error("Permission denied");
    err.status = 403;
    throw err;
  }
}

function canViewFinancial(roleCode) {
  return FINANCIAL_ROLES.includes(roleCode);
}

function toNum(value, fallback = 0) {
  const num = Number(value);
  return Number.isFinite(num) ? num : fallback;
}

function toFixedNum(value, digits = 2) {
  return Number(toNum(value, 0).toFixed(digits));
}

function parseJsonArray(value) {
  if (Array.isArray(value)) return value;
  if (!value) return [];
  try {
    const parsed = typeof value === "string" ? JSON.parse(value) : value;
    return Array.isArray(parsed) ? parsed : [];
  } catch (_error) {
    return [];
  }
}

function generateNo(prefix) {
  return `${prefix}-${Date.now()}-${Math.floor(100 + Math.random() * 900)}`;
}

function buildInClause(length) {
  return new Array(length).fill("?").join(",");
}

function sanitizeText(value, maxLen = 255) {
  const text = String(value == null ? "" : value).trim();
  if (!text) return "";
  return text.slice(0, maxLen);
}

function mapStatusTag(status) {
  const code = String(status || "").toUpperCase();
  if (code === "DRAFT") return "DRAFT";
  if (code === "LOCKED_STOCK") return "LOCKED_STOCK";
  if (code === "PENDING_FINAL_QTY_CONFIRM" || code === "READY_FOR_PAYMENT_CONFIRM") return "PENDING_CONFIRM";
  if (code === "COMPLETED") return "COMPLETED";
  if (code === "VOID") return "VOID";
  return code || "UNKNOWN";
}

function evaluateBatchEligibility(row, lockQty) {
  const qualityPhotos = parseJsonArray(row.quality_photo_urls);
  const hasMiningTicket = typeof row.mining_ticket_url === "string" && row.mining_ticket_url.trim().length > 0;
  const hasQuality = qualityPhotos.length > 0;
  const stockInConfirmed = Number(row.stock_in_confirmed || 0) === 1;
  const allowedStatus = row.status === "AVAILABLE" || row.status === "PARTIALLY_ALLOCATED";
  const remainingQty = toFixedNum(toNum(row.available_qty) - toNum(row.locked_qty) - toNum(row.shipped_qty), 3);

  const reasons = [];
  if (!stockInConfirmed) reasons.push("Stock-in not confirmed");
  if (!hasMiningTicket || !hasQuality) reasons.push("Required documents incomplete");
  if (!allowedStatus) reasons.push("Batch status does not allow lock");
  if (toNum(lockQty, 0) <= 0) reasons.push("Lock quantity must be positive");
  if (toNum(lockQty, 0) > remainingQty) reasons.push(`Lock quantity exceeds remaining (${remainingQty})`);

  return {
    ok: reasons.length === 0,
    reasons,
    remainingQty
  };
}

function computeBatchStatus(stockInConfirmed, availableQty, lockedQty, shippedQty) {
  const confirmed = Number(stockInConfirmed || 0) === 1;
  if (!confirmed) {
    return "PENDING_STOCK_IN";
  }
  const remaining = toFixedNum(toNum(availableQty) - toNum(lockedQty) - toNum(shippedQty), 3);
  if (remaining <= 0) return "SOLD_OUT";
  if (toNum(lockedQty) > 0) return "PARTIALLY_ALLOCATED";
  return "AVAILABLE";
}

function normalizeSelectableBatch(row) {
  const qualityPhotos = parseJsonArray(row.quality_photo_urls);
  const hasMiningTicket = typeof row.mining_ticket_url === "string" && row.mining_ticket_url.trim().length > 0;
  const hasQualityPhotos = qualityPhotos.length > 0;
  const stockInConfirmed = Number(row.stock_in_confirmed || 0) === 1;
  const remainingQty = toFixedNum(toNum(row.available_qty) - toNum(row.locked_qty) - toNum(row.shipped_qty), 3);
  const allowedStatus = row.status === "AVAILABLE" || row.status === "PARTIALLY_ALLOCATED";

  let selectable = true;
  const reasons = [];

  if (!stockInConfirmed) {
    selectable = false;
    reasons.push("Stock-in not confirmed");
  }
  if (!hasMiningTicket || !hasQualityPhotos) {
    selectable = false;
    reasons.push("Documents incomplete");
  }
  if (!allowedStatus) {
    selectable = false;
    reasons.push("Batch status not sellable");
  }
  if (remainingQty <= 0) {
    selectable = false;
    reasons.push("Insufficient remaining quantity");
  }

  return {
    id: row.id,
    batchId: row.id,
    batchNo: row.batch_no,
    voyageId: row.voyage_id,
    sourceVoyageId: row.voyage_id,
    voyageNo: row.voyage_no,
    shipName: row.ship_name || "-",
    batchStatus: row.status,
    availableQty: toFixedNum(row.available_qty, 3),
    lockedQty: toFixedNum(row.locked_qty, 3),
    shippedQty: toFixedNum(row.shipped_qty, 3),
    remainingQty,
    stockInConfirmed,
    docsComplete: hasMiningTicket && hasQualityPhotos,
    docsCompleteText: hasMiningTicket && hasQualityPhotos ? "COMPLETE" : "INCOMPLETE",
    procurementUnitCost: toFixedNum(row.procurement_unit_cost, 4),
    expenseUnitCost: toFixedNum(row.expense_unit_cost, 4),
    sourceUnitCost: toFixedNum(toNum(row.procurement_unit_cost) + toNum(row.expense_unit_cost), 4),
    selectable,
    disabledReason: selectable ? "" : reasons.join(" / ")
  };
}

function normalizeLineItems(rawLineItems = []) {
  if (!Array.isArray(rawLineItems) || !rawLineItems.length) {
    const err = new Error("lineItems is required.");
    err.status = 400;
    throw err;
  }

  const byBatch = new Map();
  rawLineItems.forEach((rawItem) => {
    const batchId = Number(rawItem.batchId);
    const lockQty = toFixedNum(rawItem.lockQty, 3);
    const perLineUnitPrice = rawItem.unitPrice == null || rawItem.unitPrice === ""
      ? null
      : toNum(rawItem.unitPrice, 0);

    if (!batchId || lockQty <= 0) {
      const err = new Error("Each lineItem requires valid batchId and positive lockQty.");
      err.status = 400;
      throw err;
    }

    const existing = byBatch.get(batchId);
    if (existing) {
      existing.lockQty = toFixedNum(existing.lockQty + lockQty, 3);
      if (perLineUnitPrice && perLineUnitPrice > 0) {
        existing.unitPrice = perLineUnitPrice;
      }
    } else {
      byBatch.set(batchId, {
        batchId,
        lockQty,
        unitPrice: perLineUnitPrice && perLineUnitPrice > 0 ? perLineUnitPrice : null
      });
    }
  });

  return Array.from(byBatch.values());
}

async function resolveActorUserId(conn, actorUserId) {
  if (!actorUserId) return null;
  const [rows] = await conn.query(
    `SELECT id
       FROM users
      WHERE id = ?
        AND is_void = 0
      LIMIT 1`,
    [actorUserId]
  );
  return rows.length ? actorUserId : null;
}

async function writeAuditLog(conn, payload) {
  const actorUserId = await resolveActorUserId(conn, payload.actorUserId || null);
  await conn.query(
    `INSERT INTO audit_logs
      (trace_id, actor_user_id, action, entity_type, entity_id, before_data, after_data, created_at, updated_at, created_by, updated_by, is_void)
     VALUES (?, ?, ?, ?, ?, ?, ?, NOW(), NOW(), ?, ?, 0)`,
    [
      payload.traceId || null,
      actorUserId,
      payload.action,
      payload.entityType,
      payload.entityId || null,
      payload.beforeData ? JSON.stringify(payload.beforeData) : null,
      payload.afterData ? JSON.stringify(payload.afterData) : null,
      actorUserId,
      actorUserId
    ]
  );
}
async function getVoyageCostBasis(conn, voyageIds) {
  if (!voyageIds.length) return new Map();
  const placeholders = buildInClause(voyageIds.length);
  const [rows] = await conn.query(
    `SELECT
       v.id AS voyage_id,
       COALESCE(p.unit_price, 0) AS procurement_unit_cost,
       COALESCE(exp.expense_total, 0) AS expense_total,
       COALESCE(stk.stocked_qty, 0) AS stocked_qty
     FROM voyages v
     JOIN procurements p ON p.id = v.procurement_id
     LEFT JOIN (
       SELECT voyage_id, SUM(amount) AS expense_total
       FROM expenses
       WHERE is_void = 0 AND status = 'CONFIRMED'
       GROUP BY voyage_id
     ) exp ON exp.voyage_id = v.id
     LEFT JOIN (
       SELECT voyage_id, SUM(available_qty) AS stocked_qty
       FROM inventory_batches
       WHERE is_void = 0 AND stock_in_confirmed = 1
       GROUP BY voyage_id
     ) stk ON stk.voyage_id = v.id
     WHERE v.id IN (${placeholders})
       AND v.is_void = 0`,
    voyageIds
  );

  const map = new Map();
  rows.forEach((row) => {
    const stockedQty = toNum(row.stocked_qty, 0);
    const expenseUnit = stockedQty > 0 ? toFixedNum(toNum(row.expense_total, 0) / stockedQty, 4) : 0;
    map.set(Number(row.voyage_id), {
      procurementUnitCost: toFixedNum(row.procurement_unit_cost, 4),
      expenseUnitCost: expenseUnit
    });
  });
  return map;
}

async function resolveOrderCustomer(conn, payload) {
  const parsedCustomerId = Number(payload.customerId || 0);
  let customerId = parsedCustomerId > 0 ? parsedCustomerId : null;
  let customerName = sanitizeText(payload.customerName, 128);

  if (customerId) {
    const [rows] = await conn.query(
      `SELECT id, customer_name, status
         FROM customers
        WHERE id = ?
          AND is_void = 0
        LIMIT 1
        FOR UPDATE`,
      [customerId]
    );
    if (!rows.length) {
      const err = new Error("Customer not found.");
      err.status = 400;
      throw err;
    }
    if (rows[0].status !== "ACTIVE") {
      const err = new Error("Customer is not active.");
      err.status = 400;
      throw err;
    }
    customerName = sanitizeText(rows[0].customer_name, 128);
  }

  if (!customerName) {
    const err = new Error("customerId or customerName is required.");
    err.status = 400;
    throw err;
  }

  return {
    customerId,
    customerName
  };
}

async function fetchBatchRowsForUpdate(conn, batchIds) {
  const placeholders = buildInClause(batchIds.length);
  const [rows] = await conn.query(
    `SELECT
       b.id,
       b.batch_no,
       b.voyage_id,
       b.status,
       b.available_qty,
       b.locked_qty,
       b.shipped_qty,
       b.stock_in_confirmed,
       b.mining_ticket_url,
       b.quality_photo_urls,
       v.voyage_no,
       COALESCE(p.unit_price, 0) AS procurement_unit_cost
     FROM inventory_batches b
     JOIN voyages v ON v.id = b.voyage_id AND v.is_void = 0
     JOIN procurements p ON p.id = v.procurement_id AND p.is_void = 0
     WHERE b.id IN (${placeholders})
       AND b.is_void = 0
     FOR UPDATE`,
    batchIds
  );
  return rows;
}

async function applyLockQuantities(conn, rowMap, normalizedItems, actorUserId) {
  for (const item of normalizedItems) {
    const row = rowMap.get(item.batchId);
    const nextLockedQty = toFixedNum(toNum(row.locked_qty) + toNum(item.lockQty), 3);
    const nextStatus = computeBatchStatus(
      row.stock_in_confirmed,
      row.available_qty,
      nextLockedQty,
      row.shipped_qty
    );
    await conn.query(
      `UPDATE inventory_batches
          SET locked_qty = ?,
              status = ?,
              updated_at = NOW(),
              updated_by = ?
        WHERE id = ?`,
      [nextLockedQty, nextStatus, actorUserId, row.id]
    );
    row.locked_qty = nextLockedQty;
    row.status = nextStatus;
  }
}

async function releaseExistingOrderLocks(conn, orderId, actorUserId) {
  const [lineRows] = await conn.query(
    `SELECT id, batch_id, planned_qty
       FROM sales_line_items
      WHERE sales_order_id = ?
        AND is_void = 0
      FOR UPDATE`,
    [orderId]
  );
  if (!lineRows.length) {
    return [];
  }

  const releaseMap = new Map();
  lineRows.forEach((line) => {
    const batchId = Number(line.batch_id);
    const current = releaseMap.get(batchId) || 0;
    releaseMap.set(batchId, toFixedNum(current + toNum(line.planned_qty), 3));
  });

  const batchIds = Array.from(releaseMap.keys());
  const rows = await fetchBatchRowsForUpdate(conn, batchIds);
  const rowMap = new Map(rows.map((row) => [Number(row.id), row]));

  for (const [batchId, releaseQty] of releaseMap.entries()) {
    const row = rowMap.get(batchId);
    if (!row) continue;
    const nextLockedQty = toFixedNum(Math.max(toNum(row.locked_qty) - releaseQty, 0), 3);
    const nextStatus = computeBatchStatus(
      row.stock_in_confirmed,
      row.available_qty,
      nextLockedQty,
      row.shipped_qty
    );
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

  await conn.query(
    `UPDATE sales_line_items
        SET status = 'VOID',
            is_void = 1,
            void_reason = 'ORDER_EDIT_REPLACED',
            void_at = NOW(),
            updated_at = NOW(),
            updated_by = ?
      WHERE sales_order_id = ?
        AND is_void = 0`,
    [actorUserId, orderId]
  );

  return lineRows;
}
async function buildOrderComputation(conn, normalizedItems, defaultUnitPrice) {
  const batchIds = normalizedItems.map((x) => x.batchId);
  const rows = await fetchBatchRowsForUpdate(conn, batchIds);
  if (rows.length !== batchIds.length) {
    const foundIds = new Set(rows.map((x) => Number(x.id)));
    const missingIds = batchIds.filter((id) => !foundIds.has(id));
    const err = new Error(`Batch not found: ${missingIds.join(", ")}`);
    err.status = 400;
    throw err;
  }

  const rowMap = new Map(rows.map((row) => [Number(row.id), row]));
  const eligibilityErrors = [];
  const voyageIds = [];
  normalizedItems.forEach((item) => {
    const row = rowMap.get(item.batchId);
    const check = evaluateBatchEligibility(row, item.lockQty);
    if (!check.ok) {
      eligibilityErrors.push(`${row.batch_no}: ${check.reasons.join(" / ")}`);
    } else {
      voyageIds.push(Number(row.voyage_id));
    }
  });
  if (eligibilityErrors.length) {
    const err = new Error(eligibilityErrors.join("; "));
    err.status = 400;
    throw err;
  }

  const voyageCostBasis = await getVoyageCostBasis(conn, [...new Set(voyageIds)]);
  const hasLineUnitPrice = normalizedItems.some((x) => x.unitPrice && x.unitPrice > 0);
  const pricingMode = hasLineUnitPrice ? "PER_LINE_UNIT_PRICE" : "PER_ORDER_UNIT_PRICE";

  const linePayloads = [];
  let plannedTotalQty = 0;
  let totalRevenue = 0;

  normalizedItems.forEach((item, index) => {
    const row = rowMap.get(item.batchId);
    const costBasis = voyageCostBasis.get(Number(row.voyage_id)) || {
      procurementUnitCost: toFixedNum(row.procurement_unit_cost, 4),
      expenseUnitCost: 0
    };

    const lineUnitPrice = item.unitPrice && item.unitPrice > 0 ? item.unitPrice : toNum(defaultUnitPrice, 0);
    if (!lineUnitPrice || lineUnitPrice <= 0) {
      const err = new Error(`Line unit price invalid for batch ${row.batch_no}.`);
      err.status = 400;
      throw err;
    }

    const lineRevenueAmount = toFixedNum(item.lockQty * lineUnitPrice, 2);
    const lineCostUnit = toFixedNum(
      toNum(costBasis.procurementUnitCost) + toNum(costBasis.expenseUnitCost),
      4
    );
    const lineCostAmount = toFixedNum(item.lockQty * lineCostUnit, 2);

    plannedTotalQty = toFixedNum(plannedTotalQty + item.lockQty, 3);
    totalRevenue = toFixedNum(totalRevenue + lineRevenueAmount, 2);

    linePayloads.push({
      lineNo: index + 1,
      batchId: Number(row.id),
      batchNo: row.batch_no,
      voyageId: Number(row.voyage_id),
      sourceVoyageId: Number(row.voyage_id),
      voyageNo: row.voyage_no,
      plannedQty: item.lockQty,
      lockedQty: item.lockQty,
      sourceProcurementUnitCost: toFixedNum(costBasis.procurementUnitCost, 4),
      sourceExpenseUnitCost: toFixedNum(costBasis.expenseUnitCost, 4),
      lineUnitPrice: toFixedNum(lineUnitPrice, 4),
      lineRevenueAmount,
      lineCostAmount,
      lineSourceNote: `Batch ${row.batch_no} / Voyage ${row.voyage_no}`
    });
  });

  return {
    rowMap,
    linePayloads,
    plannedTotalQty,
    totalRevenue,
    pricingMode
  };
}

async function insertAllocationVersion(conn, orderId, versionNo, linePayloads, actorUserId, reason) {
  const allocationPayload = {
    lines: linePayloads.map((line) => ({
      lineNo: line.lineNo,
      batchId: line.batchId,
      batchNo: line.batchNo,
      voyageId: line.voyageId,
      sourceVoyageId: line.sourceVoyageId,
      voyageNo: line.voyageNo,
      plannedQty: line.plannedQty,
      lockedQty: line.lockedQty,
      lineUnitPrice: line.lineUnitPrice
    }))
  };

  const [result] = await conn.query(
    `INSERT INTO allocation_versions
      (sales_order_id, version_no, reason, allocation_payload, status, is_current,
       requested_by, approved_by, approved_at, created_at, updated_at, created_by, updated_by, is_void)
     VALUES (?, ?, ?, ?, 'EFFECTIVE', 1, ?, ?, NOW(), NOW(), NOW(), ?, ?, 0)`,
    [
      orderId,
      versionNo,
      reason,
      JSON.stringify(allocationPayload),
      actorUserId,
      actorUserId,
      actorUserId,
      actorUserId
    ]
  );
  return result.insertId;
}

async function insertSalesLines(conn, orderId, allocationVersionId, linePayloads, actorUserId, lineNoBase = 0) {
  for (const line of linePayloads) {
    await conn.query(
      `INSERT INTO sales_line_items
        (sales_order_id, line_no, batch_id, voyage_id, source_voyage_id,
         planned_qty, locked_qty, final_qty, allocated_final_qty, allocation_version_id,
         source_procurement_unit_cost, source_expense_unit_cost, line_unit_price,
         line_revenue_amount, revenue_amount, line_cost_amount, cost_amount, line_source_note, status,
         created_at, updated_at, created_by, updated_by, is_void)
       VALUES (?, ?, ?, ?, ?, ?, ?, NULL, NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'LOCKED', NOW(), NOW(), ?, ?, 0)`,
      [
        orderId,
        line.lineNo + lineNoBase,
        line.batchId,
        line.voyageId,
        line.sourceVoyageId,
        line.plannedQty,
        line.lockedQty,
        allocationVersionId,
        line.sourceProcurementUnitCost,
        line.sourceExpenseUnitCost,
        line.lineUnitPrice,
        line.lineRevenueAmount,
        line.lineRevenueAmount,
        line.lineCostAmount,
        line.lineCostAmount,
        line.lineSourceNote,
        actorUserId,
        actorUserId
      ]
    );
  }
}

router.get("/batches/sellable", async (req, res, next) => {
  try {
    ensureRole(req, ACCESS_ROLES);

    const { keyword = "", batchStatus = "", docStatus = "", selectable = "" } = req.query || {};
    const where = ["b.is_void = 0"];
    const params = [];

    if (keyword) {
      where.push("(b.batch_no LIKE ? OR v.voyage_no LIKE ? OR s.ship_name LIKE ?)");
      params.push(`%${keyword}%`, `%${keyword}%`, `%${keyword}%`);
    }
    if (batchStatus) {
      where.push("b.status = ?");
      params.push(batchStatus);
    }
    if (docStatus === "COMPLETE") {
      where.push("COALESCE(NULLIF(TRIM(b.mining_ticket_url), ''), '') <> '' AND COALESCE(JSON_LENGTH(b.quality_photo_urls), 0) > 0");
    } else if (docStatus === "INCOMPLETE") {
      where.push("(COALESCE(NULLIF(TRIM(b.mining_ticket_url), ''), '') = '' OR COALESCE(JSON_LENGTH(b.quality_photo_urls), 0) = 0)");
    }
    if (String(selectable) === "1") {
      where.push(`
        b.stock_in_confirmed = 1
        AND b.status IN ('AVAILABLE', 'PARTIALLY_ALLOCATED')
        AND (b.available_qty - b.locked_qty - b.shipped_qty) > 0
        AND COALESCE(NULLIF(TRIM(b.mining_ticket_url), ''), '') <> ''
        AND COALESCE(JSON_LENGTH(b.quality_photo_urls), 0) > 0
      `);
    }

    const [rows] = await pool.query(
      `SELECT
         b.id,
         b.batch_no,
         b.voyage_id,
         b.status,
         b.available_qty,
         b.locked_qty,
         b.shipped_qty,
         b.stock_in_confirmed,
         b.mining_ticket_url,
         b.quality_photo_urls,
         v.voyage_no,
         s.ship_name,
         COALESCE(p.unit_price, 0) AS procurement_unit_cost,
         COALESCE(exp.expense_total / NULLIF(stk.stocked_qty, 0), 0) AS expense_unit_cost
       FROM inventory_batches b
       JOIN voyages v ON v.id = b.voyage_id AND v.is_void = 0
       JOIN procurements p ON p.id = v.procurement_id AND p.is_void = 0
       LEFT JOIN ships s ON s.id = v.ship_id AND s.is_void = 0
       LEFT JOIN (
         SELECT voyage_id, SUM(amount) AS expense_total
         FROM expenses
         WHERE is_void = 0 AND status = 'CONFIRMED'
         GROUP BY voyage_id
       ) exp ON exp.voyage_id = b.voyage_id
       LEFT JOIN (
         SELECT voyage_id, SUM(available_qty) AS stocked_qty
         FROM inventory_batches
         WHERE is_void = 0 AND stock_in_confirmed = 1
         GROUP BY voyage_id
       ) stk ON stk.voyage_id = b.voyage_id
       WHERE ${where.join(" AND ")}
       ORDER BY b.updated_at DESC
       LIMIT 500`,
      params
    );

    const costVisible = canViewFinancial(req.user.roleCode);
    const items = rows.map((row) => {
      const item = normalizeSelectableBatch(row);
      if (!costVisible) {
        item.procurementUnitCost = null;
        item.expenseUnitCost = null;
        item.sourceUnitCost = null;
        item.sourceUnitCostDisplay = "***";
      } else {
        item.sourceUnitCostDisplay = item.sourceUnitCost;
      }
      return item;
    });

    res.json({
      items,
      stats: {
        total: items.length,
        selectable: items.filter((x) => x.selectable).length,
        unselectable: items.filter((x) => !x.selectable).length
      },
      costVisible
    });
  } catch (error) {
    next(error);
  }
});

router.get("/customers/options", async (req, res, next) => {
  try {
    ensureRole(req, ACCESS_ROLES);
    const keyword = sanitizeText((req.query || {}).keyword, 128);
    const where = ["is_void = 0", "status = 'ACTIVE'"];
    const params = [];
    if (keyword) {
      where.push("(customer_no LIKE ? OR customer_name LIKE ? OR COALESCE(contact_phone, '') LIKE ?)");
      params.push(`%${keyword}%`, `%${keyword}%`, `%${keyword}%`);
    }

    const [rows] = await pool.query(
      `SELECT
         id, customer_no, customer_name, contact_person, contact_phone, status
       FROM customers
       WHERE ${where.join(" AND ")}
       ORDER BY updated_at DESC
       LIMIT 300`,
      params
    );

    res.json({
      items: rows.map((row) => ({
        id: row.id,
        customerNo: row.customer_no,
        customerName: row.customer_name,
        contactPerson: row.contact_person || "",
        contactPhone: row.contact_phone || "",
        status: row.status
      }))
    });
  } catch (error) {
    next(error);
  }
});
router.post("/orders", async (req, res, next) => {
  try {
    ensureRole(req, MANAGE_ROLES);

    const {
      customerId,
      customerName,
      unitPrice,
      lineItems = [],
      pricingMode = "PER_ORDER_UNIT_PRICE"
    } = req.body || {};

    const normalizedItems = normalizeLineItems(lineItems);
    const hasLineUnitPrice = normalizedItems.some((x) => x.unitPrice && x.unitPrice > 0);
    if (!hasLineUnitPrice && toNum(unitPrice, 0) <= 0) {
      return res.status(400).json({ message: "unitPrice is required when line unit price is absent." });
    }

    const result = await withTransaction(async (conn) => {
      const actorUserId = await resolveActorUserId(conn, req.user.id);
      const customer = await resolveOrderCustomer(conn, { customerId, customerName });
      const computed = await buildOrderComputation(conn, normalizedItems, unitPrice);
      const orderPricingMode = hasLineUnitPrice || pricingMode === "PER_LINE_UNIT_PRICE"
        ? "PER_LINE_UNIT_PRICE"
        : "PER_ORDER_UNIT_PRICE";

      const salesOrderNo = generateNo("SO");
      const [orderResult] = await conn.query(
        `INSERT INTO sales_orders
          (sales_order_no, order_no, customer_name, customer_id, sales_user_id, status, ar_status,
           planned_total_qty, unit_price, pricing_mode, total_amount, locked_stock_at,
           created_at, updated_at, created_by, updated_by, is_void)
         VALUES (?, ?, ?, ?, ?, 'LOCKED_STOCK', 'ESTIMATED_AR', ?, ?, ?, ?, NOW(), NOW(), NOW(), ?, ?, 0)`,
        [
          salesOrderNo,
          salesOrderNo,
          customer.customerName,
          customer.customerId,
          actorUserId,
          computed.plannedTotalQty,
          orderPricingMode === "PER_ORDER_UNIT_PRICE" ? toFixedNum(unitPrice, 4) : null,
          orderPricingMode,
          computed.totalRevenue,
          actorUserId,
          actorUserId
        ]
      );
      const salesOrderId = orderResult.insertId;

      const allocationVersionId = await insertAllocationVersion(
        conn,
        salesOrderId,
        1,
        computed.linePayloads,
        actorUserId,
        "INITIAL_LOCK"
      );

      await insertSalesLines(
        conn,
        salesOrderId,
        allocationVersionId,
        computed.linePayloads,
        actorUserId
      );
      await applyLockQuantities(conn, computed.rowMap, normalizedItems, actorUserId);

      await writeAuditLog(conn, {
        actorUserId,
        action: "SALES_ORDER_CREATE_LOCK_STOCK",
        entityType: "SALES_ORDER",
        entityId: salesOrderId,
        afterData: {
          salesOrderNo,
          orderNo: salesOrderNo,
          customerId: customer.customerId,
          customerName: customer.customerName,
          plannedTotalQty: computed.plannedTotalQty,
          totalAmount: computed.totalRevenue,
          pricingMode: orderPricingMode,
          lineCount: computed.linePayloads.length
        }
      });

      return {
        salesOrderId,
        salesOrderNo,
        orderNo: salesOrderNo,
        customerId: customer.customerId,
        customerName: customer.customerName,
        plannedTotalQty: computed.plannedTotalQty,
        totalAmount: computed.totalRevenue,
        lineCount: computed.linePayloads.length,
        allocationVersionId
      };
    });

    res.json({
      message: "Sales order created and stock locked.",
      ...result
    });
  } catch (error) {
    next(error);
  }
});

router.put("/orders/:id", async (req, res, next) => {
  try {
    ensureRole(req, MANAGE_ROLES);

    const orderId = Number(req.params.id);
    if (!orderId) {
      return res.status(400).json({ message: "Invalid sales order id." });
    }

    const {
      customerId,
      customerName,
      unitPrice,
      lineItems = [],
      pricingMode = "PER_ORDER_UNIT_PRICE"
    } = req.body || {};

    const normalizedItems = normalizeLineItems(lineItems);
    const hasLineUnitPrice = normalizedItems.some((x) => x.unitPrice && x.unitPrice > 0);
    if (!hasLineUnitPrice && toNum(unitPrice, 0) <= 0) {
      return res.status(400).json({ message: "unitPrice is required when line unit price is absent." });
    }

    const result = await withTransaction(async (conn) => {
      const actorUserId = await resolveActorUserId(conn, req.user.id);

      const [orderRows] = await conn.query(
        `SELECT *
           FROM sales_orders
          WHERE id = ?
            AND is_void = 0
          LIMIT 1
          FOR UPDATE`,
        [orderId]
      );
      if (!orderRows.length) {
        const err = new Error("Sales order not found.");
        err.status = 404;
        throw err;
      }

      const order = orderRows[0];
      if (!EDITABLE_ORDER_STATUS.includes(order.status)) {
        const err = new Error("Current order status does not allow editing.");
        err.status = 400;
        throw err;
      }

      const customer = await resolveOrderCustomer(conn, { customerId, customerName });
      const beforeSnapshot = {
        status: order.status,
        customerName: order.customer_name,
        plannedTotalQty: order.planned_total_qty,
        totalAmount: order.total_amount
      };

      await releaseExistingOrderLocks(conn, orderId, actorUserId);
      const computed = await buildOrderComputation(conn, normalizedItems, unitPrice);

      const orderPricingMode = hasLineUnitPrice || pricingMode === "PER_LINE_UNIT_PRICE"
        ? "PER_LINE_UNIT_PRICE"
        : "PER_ORDER_UNIT_PRICE";

      const [versionRows] = await conn.query(
        `SELECT COALESCE(MAX(version_no), 0) AS maxVersion
           FROM allocation_versions
          WHERE sales_order_id = ?
            AND is_void = 0
          FOR UPDATE`,
        [orderId]
      );
      const nextVersionNo = Number(versionRows[0].maxVersion || 0) + 1;
      const allocationVersionId = await insertAllocationVersion(
        conn,
        orderId,
        nextVersionNo,
        computed.linePayloads,
        actorUserId,
        "ORDER_EDIT_LOCK_RESET"
      );

      const [maxLineRows] = await conn.query(
        `SELECT COALESCE(MAX(line_no), 0) AS maxLineNo
           FROM sales_line_items
          WHERE sales_order_id = ?
          FOR UPDATE`,
        [orderId]
      );
      const lineNoBase = Number(maxLineRows[0].maxLineNo || 0);

      await insertSalesLines(
        conn,
        orderId,
        allocationVersionId,
        computed.linePayloads,
        actorUserId,
        lineNoBase
      );
      await applyLockQuantities(conn, computed.rowMap, normalizedItems, actorUserId);

      await conn.query(
        `UPDATE sales_orders
            SET customer_id = ?,
                customer_name = ?,
                sales_user_id = ?,
                status = 'LOCKED_STOCK',
                ar_status = 'ESTIMATED_AR',
                planned_total_qty = ?,
                final_total_qty = NULL,
                unit_price = ?,
                pricing_mode = ?,
                total_amount = ?,
                locked_stock_at = NOW(),
                updated_at = NOW(),
                updated_by = ?,
                qty_diff_confirmed = 0,
                qty_diff_confirmed_by = NULL,
                qty_diff_confirmed_at = NULL,
                qty_diff_confirm_note = NULL,
                final_qty_confirmed_by = NULL,
                final_qty_confirmed_at = NULL,
                ar_confirmed_by = NULL,
                ar_confirmed_at = NULL,
                completed_at = NULL
          WHERE id = ?`,
        [
          customer.customerId,
          customer.customerName,
          actorUserId,
          computed.plannedTotalQty,
          orderPricingMode === "PER_ORDER_UNIT_PRICE" ? toFixedNum(unitPrice, 4) : null,
          orderPricingMode,
          computed.totalRevenue,
          actorUserId,
          orderId
        ]
      );

      await writeAuditLog(conn, {
        actorUserId,
        action: "SALES_ORDER_EDIT_RELOCK_STOCK",
        entityType: "SALES_ORDER",
        entityId: orderId,
        beforeData: beforeSnapshot,
        afterData: {
          customerId: customer.customerId,
          customerName: customer.customerName,
          plannedTotalQty: computed.plannedTotalQty,
          totalAmount: computed.totalRevenue,
          pricingMode: orderPricingMode,
          lineCount: computed.linePayloads.length,
          allocationVersionId
        }
      });

      return {
        salesOrderId: orderId,
        salesOrderNo: order.sales_order_no,
        orderNo: order.order_no || order.sales_order_no,
        plannedTotalQty: computed.plannedTotalQty,
        totalAmount: computed.totalRevenue,
        lineCount: computed.linePayloads.length,
        allocationVersionId
      };
    });

    res.json({
      message: "Sales order updated and stock re-locked.",
      ...result
    });
  } catch (error) {
    next(error);
  }
});
router.get("/orders", async (req, res, next) => {
  try {
    ensureRole(req, ACCESS_ROLES);

    const { keyword = "", status = "" } = req.query || {};
    const where = ["so.is_void = 0"];
    const params = [];

    if (keyword) {
      where.push("(so.sales_order_no LIKE ? OR so.order_no LIKE ? OR so.customer_name LIKE ? OR COALESCE(c.customer_no, '') LIKE ?)");
      params.push(`%${keyword}%`, `%${keyword}%`, `%${keyword}%`, `%${keyword}%`);
    }
    if (status) {
      where.push("so.status = ?");
      params.push(status);
    }

    const [rows] = await pool.query(
      `SELECT
         so.id,
         so.sales_order_no,
         so.order_no,
         so.customer_id,
         so.customer_name,
         c.customer_no,
         so.status,
         so.ar_status,
         so.planned_total_qty,
         so.final_total_qty,
         so.unit_price,
         so.total_amount,
         so.created_at,
         so.updated_at
       FROM sales_orders so
       LEFT JOIN customers c ON c.id = so.customer_id
       WHERE ${where.join(" AND ")}
       ORDER BY so.created_at DESC
       LIMIT 300`,
      params
    );

    res.json({
      items: rows.map((row) => ({
        id: row.id,
        salesOrderNo: row.sales_order_no,
        orderNo: row.order_no || row.sales_order_no,
        customerId: row.customer_id || null,
        customerNo: row.customer_no || "",
        customerName: row.customer_name,
        status: row.status,
        statusTag: mapStatusTag(row.status),
        arStatus: row.ar_status,
        plannedTotalQty: toFixedNum(row.planned_total_qty, 3),
        finalTotalQty: row.final_total_qty == null ? null : toFixedNum(row.final_total_qty, 3),
        unitPrice: row.unit_price == null ? null : toFixedNum(row.unit_price, 4),
        totalAmount: toFixedNum(row.total_amount, 2),
        editable: EDITABLE_ORDER_STATUS.includes(row.status),
        createdAt: row.created_at,
        updatedAt: row.updated_at
      }))
    });
  } catch (error) {
    next(error);
  }
});

router.get("/orders/:id", async (req, res, next) => {
  try {
    ensureRole(req, ACCESS_ROLES);

    const orderId = Number(req.params.id);
    if (!orderId) {
      return res.status(400).json({ message: "Invalid sales order id." });
    }

    const [orderRows] = await pool.query(
      `SELECT
         so.*,
         c.customer_no,
         u.display_name AS sales_user_name
       FROM sales_orders so
       LEFT JOIN customers c ON c.id = so.customer_id
       LEFT JOIN users u ON u.id = so.sales_user_id
       WHERE so.id = ?
         AND so.is_void = 0
       LIMIT 1`,
      [orderId]
    );
    if (!orderRows.length) {
      return res.status(404).json({ message: "Sales order not found." });
    }

    const [lineRows, slipRows, paymentRows, auditRows] = await Promise.all([
      pool.query(
        `SELECT
           li.id,
           li.line_no,
           li.batch_id,
           li.voyage_id,
           li.source_voyage_id,
           li.planned_qty,
           li.locked_qty,
           li.final_qty,
           li.allocated_final_qty,
           li.status,
           li.source_procurement_unit_cost,
           li.source_expense_unit_cost,
           li.line_unit_price,
           li.line_revenue_amount,
           li.revenue_amount,
           li.line_cost_amount,
           li.cost_amount,
           li.line_profit_amount,
           li.gross_profit,
           li.line_source_note,
           b.batch_no,
           v.voyage_no
         FROM sales_line_items li
         JOIN inventory_batches b ON b.id = li.batch_id
         JOIN voyages v ON v.id = li.voyage_id
         WHERE li.sales_order_id = ?
           AND li.is_void = 0
         ORDER BY li.line_no ASC`,
        [orderId]
      ),
      pool.query(
        `SELECT
           id, slip_no, planned_qty, final_total_qty, delta_qty, status, is_final,
           confirmed_at, voucher_url, created_at
         FROM weighing_slips
         WHERE sales_order_id = ?
           AND is_void = 0
         ORDER BY created_at DESC`,
        [orderId]
      ),
      pool.query(
        `SELECT
           id, payment_no, payment_amount, payment_method, status, paid_at, confirmed_at, is_irreversible
         FROM payments
         WHERE sales_order_id = ?
           AND is_void = 0
         ORDER BY created_at DESC`,
        [orderId]
      ),
      pool.query(
        `SELECT id, action, event_time, actor_user_id, before_data, after_data
           FROM audit_logs
          WHERE is_void = 0
            AND (
              (entity_type = 'SALES_ORDER' AND entity_id = ?)
              OR (entity_type = 'ALLOCATION_VERSION' AND entity_id IN (
                SELECT id FROM allocation_versions WHERE sales_order_id = ? AND is_void = 0
              ))
              OR (entity_type = 'SALES_LINE_ITEM' AND entity_id IN (
                SELECT id FROM sales_line_items WHERE sales_order_id = ? AND is_void = 0
              ))
            )
          ORDER BY event_time DESC
          LIMIT 400`,
        [orderId, orderId, orderId]
      )
    ]);

    const canViewCostProfit = canViewFinancial(req.user.roleCode);
    const lines = lineRows[0].map((line) => {
      const lockedQty = line.locked_qty == null ? line.planned_qty : line.locked_qty;
      const allocatedFinalQty = line.allocated_final_qty == null ? line.final_qty : line.allocated_final_qty;
      const costAmount = line.cost_amount == null ? line.line_cost_amount : line.cost_amount;
      const revenueAmount = line.revenue_amount == null ? line.line_revenue_amount : line.revenue_amount;
      const grossProfit = line.gross_profit == null ? line.line_profit_amount : line.gross_profit;

      return {
        id: line.id,
        lineNo: line.line_no,
        batchId: line.batch_id,
        batchNo: line.batch_no,
        voyageId: line.voyage_id,
        sourceVoyageId: line.source_voyage_id || line.voyage_id,
        voyageNo: line.voyage_no,
        plannedQty: toFixedNum(line.planned_qty, 3),
        lockedQty: toFixedNum(lockedQty, 3),
        finalQty: line.final_qty == null ? null : toFixedNum(line.final_qty, 3),
        allocatedFinalQty: allocatedFinalQty == null ? null : toFixedNum(allocatedFinalQty, 3),
        status: line.status,
        lineUnitPrice: toFixedNum(line.line_unit_price, 4),
        lineRevenueAmount: toFixedNum(line.line_revenue_amount, 2),
        revenueAmount: toFixedNum(revenueAmount, 2),
        sourceProcurementUnitCost: canViewCostProfit ? toFixedNum(line.source_procurement_unit_cost, 4) : null,
        sourceExpenseUnitCost: canViewCostProfit ? toFixedNum(line.source_expense_unit_cost, 4) : null,
        lineCostAmount: canViewCostProfit ? toFixedNum(line.line_cost_amount, 2) : null,
        costAmount: canViewCostProfit ? toFixedNum(costAmount, 2) : null,
        lineProfitAmount: canViewCostProfit ? toFixedNum(line.line_profit_amount, 2) : null,
        grossProfit: canViewCostProfit ? toFixedNum(grossProfit, 2) : null,
        lineCostDisplay: canViewCostProfit ? toFixedNum(costAmount, 2) : "***",
        lineProfitDisplay: canViewCostProfit ? toFixedNum(grossProfit, 2) : "***",
        lineSourceNote: line.line_source_note || ""
      };
    });

    const confirmedPayment = paymentRows[0]
      .filter((x) => x.status === "CONFIRMED")
      .reduce((sum, x) => sum + toNum(x.payment_amount, 0), 0);
    const orderTotalAmount = toNum(orderRows[0].total_amount, 0);

    let receiptStatus = "UNPAID";
    if (confirmedPayment > 0 && confirmedPayment < orderTotalAmount) {
      receiptStatus = "PARTIAL";
    } else if (confirmedPayment >= orderTotalAmount && orderTotalAmount > 0) {
      receiptStatus = "CONFIRMED";
    }

    res.json({
      order: {
        id: orderRows[0].id,
        salesOrderNo: orderRows[0].sales_order_no,
        orderNo: orderRows[0].order_no || orderRows[0].sales_order_no,
        customerId: orderRows[0].customer_id || null,
        customerNo: orderRows[0].customer_no || "",
        customerName: orderRows[0].customer_name,
        salesUserId: orderRows[0].sales_user_id,
        salesUserName: orderRows[0].sales_user_name || "",
        status: orderRows[0].status,
        statusTag: mapStatusTag(orderRows[0].status),
        arStatus: orderRows[0].ar_status,
        pricingMode: orderRows[0].pricing_mode || "PER_ORDER_UNIT_PRICE",
        plannedTotalQty: toFixedNum(orderRows[0].planned_total_qty, 3),
        finalTotalQty: orderRows[0].final_total_qty == null ? null : toFixedNum(orderRows[0].final_total_qty, 3),
        unitPrice: orderRows[0].unit_price == null ? null : toFixedNum(orderRows[0].unit_price, 4),
        totalAmount: toFixedNum(orderRows[0].total_amount, 2),
        lockedStockAt: orderRows[0].locked_stock_at,
        receiptStatus,
        confirmedReceiptAmount: toFixedNum(confirmedPayment, 2),
        outstandingAmount: toFixedNum(Math.max(orderTotalAmount - confirmedPayment, 0), 2),
        createdAt: orderRows[0].created_at,
        updatedAt: orderRows[0].updated_at,
        editable: EDITABLE_ORDER_STATUS.includes(orderRows[0].status)
      },
      lineItems: lines,
      weighingSlips: slipRows[0].map((slip) => ({
        id: slip.id,
        slipNo: slip.slip_no,
        plannedQty: toFixedNum(slip.planned_qty, 3),
        finalTotalQty: toFixedNum(slip.final_total_qty, 3),
        deltaQty: toFixedNum(slip.delta_qty, 3),
        status: slip.status,
        isFinal: Number(slip.is_final) === 1,
        confirmedAt: slip.confirmed_at,
        voucherUrl: slip.voucher_url || ""
      })),
      payments: paymentRows[0].map((pay) => ({
        id: pay.id,
        paymentNo: pay.payment_no,
        paymentAmount: toFixedNum(pay.payment_amount, 2),
        paymentMethod: pay.payment_method,
        status: pay.status,
        paidAt: pay.paid_at,
        confirmedAt: pay.confirmed_at,
        isIrreversible: Number(pay.is_irreversible) === 1
      })),
      audits: auditRows[0].map((audit) => ({
        id: audit.id,
        action: audit.action,
        actorUserId: audit.actor_user_id,
        eventTime: audit.event_time,
        beforeData: audit.before_data,
        afterData: audit.after_data
      })),
      costVisible: canViewCostProfit
    });
  } catch (error) {
    next(error);
  }
});

module.exports = router;
