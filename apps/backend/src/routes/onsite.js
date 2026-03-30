const express = require("express");
const { pool, withTransaction } = require("../db");

const router = express.Router();

const ACCESS_ROLES = ["SUPER_ADMIN", "DISPATCHER", "ONSITE_SPECIALIST", "FINANCE_MGMT"];
const EXPENSE_AMOUNT_VISIBLE_ROLES = ["SUPER_ADMIN", "ONSITE_SPECIALIST", "FINANCE_MGMT"];
const LIGHTERING_STATUS_SET = new Set(["DRAFT", "IN_PROGRESS", "MAIN_EMPTY_CONFIRMED", "VOID"]);
const LIGHTERING_TRANSFER_TYPE_SET = new Set(["SHIP_TO_SHIP", "SHIP_TO_SHORE"]);
const LIGHTERING_RECEIVER_TYPE_SET = new Set(["OWNED", "LEASED", "OTHER"]);

function ensureRole(req, allowedRoles) {
  if (!allowedRoles.includes(req.user.roleCode)) {
    const err = new Error("Permission denied");
    err.status = 403;
    throw err;
  }
}

function canViewExpenseAmount(roleCode) {
  return EXPENSE_AMOUNT_VISIBLE_ROLES.includes(roleCode);
}

function generateNo(prefix) {
  return `${prefix}-${Date.now()}-${Math.floor(100 + Math.random() * 900)}`;
}

function toFixedNumber(value, digits = 2) {
  const num = Number(value || 0);
  if (!Number.isFinite(num)) return 0;
  return Number(num.toFixed(digits));
}

function toUrgency(level) {
  if (level >= 24) return "HIGH";
  if (level >= 8) return "MEDIUM";
  return "LOW";
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

function sanitizeText(value, maxLen = 255) {
  const text = String(value == null ? "" : value).trim();
  if (!text) return "";
  return text.slice(0, maxLen);
}

function toNullableDateTime(value) {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date;
}

function toBool01(value) {
  if (value === true || value === 1 || value === "1") return 1;
  return 0;
}

function normalizeLighteringStatus(status, fallback = "DRAFT") {
  const next = String(status || "").trim().toUpperCase();
  if (LIGHTERING_STATUS_SET.has(next)) return next;
  return fallback;
}

function normalizeTransferType(value) {
  const next = String(value || "").trim().toUpperCase();
  if (LIGHTERING_TRANSFER_TYPE_SET.has(next)) return next;
  return "SHIP_TO_SHIP";
}

function normalizeReceiverType(value) {
  const next = String(value || "").trim().toUpperCase();
  if (LIGHTERING_RECEIVER_TYPE_SET.has(next)) return next;
  return "OWNED";
}

function normalizeAttachmentUrls(value) {
  return parseJsonArray(value)
    .map((x) => sanitizeText(x, 512))
    .filter(Boolean);
}

function normalizeLighteringItems(items = []) {
  return (Array.isArray(items) ? items : [])
    .map((item, index) => {
      const qty = Number(item.transferQty ?? item.transfer_qty);
      const normalizedQty = Number.isFinite(qty) && qty > 0 ? qty : 0;
      return {
        lineNo: Number(item.lineNo || item.line_no || index + 1),
        cargoName: sanitizeText(item.cargoName ?? item.cargo_name, 128) || "鐮傜煶",
        transferQty: normalizedQty,
        receiverName: sanitizeText(item.receiverName ?? item.receiver_name, 128) || null,
        receiverShipName: sanitizeText(item.receiverShipName ?? item.receiver_ship_name, 128) || null,
        remark: sanitizeText(item.remark, 255) || null
      };
    })
    .filter((item) => item.transferQty > 0)
    .map((item, index) => ({ ...item, lineNo: index + 1 }));
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

async function createApproval(conn, options) {
  const approvalNo = generateNo("APV");
  const [result] = await conn.query(
    `INSERT INTO approvals
      (approval_no, approval_type, target_entity_type, target_entity_id, status, requested_by, requested_at,
       reason, before_snapshot, after_snapshot, created_at, updated_at, created_by, updated_by, is_void)
     VALUES (?, ?, ?, ?, 'PENDING', ?, NOW(), ?, ?, ?, NOW(), NOW(), ?, ?, 0)`,
    [
      approvalNo,
      options.approvalType,
      options.targetEntityType,
      options.targetEntityId,
      options.requestedBy,
      options.reason,
      options.beforeSnapshot ? JSON.stringify(options.beforeSnapshot) : null,
      options.afterSnapshot ? JSON.stringify(options.afterSnapshot) : null,
      options.requestedBy,
      options.requestedBy
    ]
  );

  return {
    approvalId: result.insertId,
    approvalNo
  };
}

async function getProcurementCost(conn, voyageId) {
  const [rows] = await conn.query(
    `SELECT COALESCE(p.total_amount, 0) AS procurement_cost
       FROM voyages v
       JOIN procurements p ON p.id = v.procurement_id
      WHERE v.id = ? AND v.is_void = 0
      LIMIT 1`,
    [voyageId]
  );
  return rows.length ? toFixedNumber(rows[0].procurement_cost, 2) : 0;
}

async function getConfirmedExpenseTotal(conn, voyageId) {
  const [rows] = await conn.query(
    `SELECT COALESCE(SUM(amount), 0) AS expense_total
       FROM expenses
      WHERE voyage_id = ?
        AND is_void = 0
        AND status = 'CONFIRMED'`,
    [voyageId]
  );
  return rows.length ? toFixedNumber(rows[0].expense_total, 2) : 0;
}

async function ensureSettlementV1(conn, voyageId, actorUserId) {
  const [existingRows] = await conn.query(
    `SELECT id, version_no
       FROM settlement_versions
      WHERE voyage_id = ?
        AND version_no = 1
        AND is_void = 0
      LIMIT 1
      FOR UPDATE`,
    [voyageId]
  );
  if (existingRows.length) {
    return { created: false, settlementVersionId: existingRows[0].id, versionNo: 1 };
  }

  const procurementCost = await getProcurementCost(conn, voyageId);
  const expenseTotal = await getConfirmedExpenseTotal(conn, voyageId);

  const [insertResult] = await conn.query(
    `INSERT INTO settlement_versions
      (voyage_id, version_no, based_on_version_id, snapshot_type, procurement_cost, expense_total, revenue_amount,
       status, is_current, readonly_at, approved_by, approved_at, created_at, updated_at, created_by, updated_by, is_void)
     VALUES (?, 1, NULL, 'COST_SNAPSHOT', ?, ?, 0, 'EFFECTIVE', 1, NOW(), ?, NOW(), NOW(), NOW(), ?, ?, 0)`,
    [voyageId, procurementCost, expenseTotal, actorUserId, actorUserId, actorUserId]
  );

  return { created: true, settlementVersionId: insertResult.insertId, versionNo: 1 };
}

async function createSettlementRevision(conn, voyageId, actorUserId, options = {}) {
  const v1Result = await ensureSettlementV1(conn, voyageId, actorUserId);

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

  if (!latestRows.length) {
    return {
      created: false,
      settlementVersionId: v1Result.settlementVersionId,
      versionNo: 1
    };
  }

  const base = latestRows[0];
  const deltaExpense = Number(options.deltaExpense || 0);
  const nextExpenseTotal = toFixedNumber(Number(base.expense_total || 0) + deltaExpense, 2);
  const nextVersionNo = Number(base.version_no || 1) + 1;

  const [insertResult] = await conn.query(
    `INSERT INTO settlement_versions
      (voyage_id, version_no, based_on_version_id, snapshot_type, procurement_cost, expense_total, revenue_amount,
       status, is_current, readonly_at, approved_by, approved_at, created_at, updated_at, created_by, updated_by, is_void)
     VALUES (?, ?, ?, 'REVISED', ?, ?, ?, 'PENDING_APPROVAL', 0, NULL, NULL, NULL, NOW(), NOW(), ?, ?, 0)`,
    [
      voyageId,
      nextVersionNo,
      base.id,
      toFixedNumber(base.procurement_cost, 2),
      nextExpenseTotal,
      toFixedNumber(base.revenue_amount, 2),
      actorUserId,
      actorUserId
    ]
  );

  return {
    created: true,
    settlementVersionId: insertResult.insertId,
    versionNo: nextVersionNo
  };
}

router.get("/tasks", async (req, res, next) => {
  try {
    ensureRole(req, ACCESS_ROLES);

    const [lighteringRows, stockinRows, expenseRows, alertRows] = await Promise.all([
      pool.query(
        `SELECT
           l.id AS lightering_id,
           l.status AS lightering_status,
           l.is_main_ship_empty,
           l.unload_empty_confirmed,
           COALESCE(l.started_at, l.created_at) AS task_time,
           v.id AS voyage_id,
           v.voyage_no,
           s.ship_name
         FROM lighterings l
         JOIN voyages v ON v.id = l.voyage_id AND v.is_void = 0
         LEFT JOIN ships s ON s.id = v.ship_id AND s.is_void = 0
         WHERE l.is_void = 0
           AND (l.status = 'DRAFT' OR (l.status = 'IN_PROGRESS' AND COALESCE(l.unload_empty_confirmed, l.is_main_ship_empty) = 0))
         ORDER BY task_time ASC
         LIMIT 200`
      ),
      pool.query(
        `SELECT
           b.id AS batch_id,
           b.batch_no,
           b.status AS batch_status,
           b.available_qty,
           b.stock_in_confirmed,
           b.created_at AS task_time,
           v.id AS voyage_id,
           v.voyage_no,
           s.ship_name
         FROM inventory_batches b
         JOIN voyages v ON v.id = b.voyage_id AND v.is_void = 0
         LEFT JOIN ships s ON s.id = v.ship_id AND s.is_void = 0
         WHERE b.is_void = 0
           AND (b.stock_in_confirmed = 0 OR b.status = 'PENDING_STOCK_IN')
         ORDER BY b.created_at ASC
         LIMIT 200`
      ),
      pool.query(
        `SELECT
           v.id AS voyage_id,
           v.voyage_no,
           v.status AS voyage_status,
           s.ship_name,
           COALESCE(MAX(e.occurred_at), v.updated_at, v.created_at) AS task_time
         FROM voyages v
         LEFT JOIN ships s ON s.id = v.ship_id AND s.is_void = 0
         LEFT JOIN expenses e
           ON e.voyage_id = v.id
          AND e.is_void = 0
          AND e.status = 'CONFIRMED'
         WHERE v.is_void = 0
           AND v.status IN ('IN_PROGRESS', 'LOCKED')
         GROUP BY v.id, v.voyage_no, v.status, s.ship_name
         ORDER BY task_time ASC
         LIMIT 200`
      ),
      pool.query(
        `SELECT
           a.id AS alert_id,
           a.alert_type,
           a.severity,
           a.status AS alert_status,
           a.triggered_at AS task_time,
           v.id AS voyage_id,
           v.voyage_no,
           s.ship_name
         FROM alerts a
         LEFT JOIN voyages v
           ON v.id = a.related_entity_id
          AND a.related_entity_type = 'VOYAGE'
          AND v.is_void = 0
         LEFT JOIN ships s ON s.id = v.ship_id AND s.is_void = 0
         WHERE a.is_void = 0
           AND a.status IN ('OPEN', 'ACKED')
           AND a.related_entity_type = 'VOYAGE'
         ORDER BY a.triggered_at ASC
         LIMIT 200`
      )
    ]);

    const items = [];

    lighteringRows[0].forEach((row) => {
      const elapsedHour = toFixedNumber((Date.now() - new Date(row.task_time).getTime()) / 36e5, 0);
      const unloadConfirmed = Number(row.unload_empty_confirmed != null ? row.unload_empty_confirmed : row.is_main_ship_empty);
      const isEmptyConfirm = row.lightering_status === "IN_PROGRESS" && unloadConfirmed === 0;
      items.push({
        taskType: isEmptyConfirm ? "WAIT_EMPTY_CONFIRM" : "WAIT_LIGHTERING",
        taskId: row.lightering_id,
        voyageId: row.voyage_id,
        voyageNo: row.voyage_no,
        shipName: row.ship_name || "-",
        currentStep: isEmptyConfirm ? "待卸空" : "待过驳",
        statusTag: row.lightering_status,
        urgency: toUrgency(elapsedHour),
        primaryAction: isEmptyConfirm ? "确认卸空" : "处理过驳",
        taskTime: row.task_time
      });
    });

    stockinRows[0].forEach((row) => {
      const elapsedHour = toFixedNumber((Date.now() - new Date(row.task_time).getTime()) / 36e5, 0);
      items.push({
        taskType: "WAIT_STOCK_IN",
        taskId: row.batch_id,
        batchId: row.batch_id,
        batchNo: row.batch_no,
        voyageId: row.voyage_id,
        voyageNo: row.voyage_no,
        shipName: row.ship_name || "-",
        currentStep: "待入库确认",
        statusTag: row.batch_status,
        urgency: toUrgency(elapsedHour),
        primaryAction: "确认入库",
        taskTime: row.task_time,
        availableQty: Number(row.available_qty || 0),
        stockInConfirmed: Number(row.stock_in_confirmed || 0)
      });
    });

    expenseRows[0].forEach((row) => {
      const elapsedHour = toFixedNumber((Date.now() - new Date(row.task_time).getTime()) / 36e5, 0);
      const urgency = row.voyage_status === "LOCKED" ? "HIGH" : toUrgency(elapsedHour);
      items.push({
        taskType: "WAIT_EXPENSE",
        taskId: row.voyage_id,
        voyageId: row.voyage_id,
        voyageNo: row.voyage_no,
        shipName: row.ship_name || "-",
        currentStep: "寰呭綍璐圭敤",
        statusTag: row.voyage_status,
        urgency,
        primaryAction: "褰曞叆璐圭敤",
        taskTime: row.task_time
      });
    });

    alertRows[0].forEach((row) => {
      items.push({
        taskType: "WAIT_EXCEPTION",
        taskId: row.alert_id,
        alertId: row.alert_id,
        voyageId: row.voyage_id,
        voyageNo: row.voyage_no || "-",
        shipName: row.ship_name || "-",
        currentStep: "待处理异常",
        statusTag: row.alert_status,
        urgency: row.severity === "CRITICAL" || row.severity === "HIGH" ? "HIGH" : "MEDIUM",
        primaryAction: "处理异常",
        taskTime: row.task_time,
        alertType: row.alert_type
      });
    });

    const typeFilter = String(req.query.type || "ALL").toUpperCase();
    const filteredItems = typeFilter === "ALL" ? items : items.filter((item) => item.taskType === typeFilter);

    const sections = [
      { key: "WAIT_LIGHTERING", label: "待过驳", count: items.filter((i) => i.taskType === "WAIT_LIGHTERING").length },
      { key: "WAIT_EMPTY_CONFIRM", label: "待卸空", count: items.filter((i) => i.taskType === "WAIT_EMPTY_CONFIRM").length },
      { key: "WAIT_STOCK_IN", label: "待入库确认", count: items.filter((i) => i.taskType === "WAIT_STOCK_IN").length },
      { key: "WAIT_EXPENSE", label: "待录费用", count: items.filter((i) => i.taskType === "WAIT_EXPENSE").length },
      { key: "WAIT_EXCEPTION", label: "待处理异常", count: items.filter((i) => i.taskType === "WAIT_EXCEPTION").length }
    ];

    res.json({
      sections,
      items: filteredItems.sort((a, b) => new Date(a.taskTime).getTime() - new Date(b.taskTime).getTime())
    });
  } catch (error) {
    next(error);
  }
});

router.post("/lighterings/:id/confirm-empty", async (req, res, next) => {
  try {
    ensureRole(req, ACCESS_ROLES);

    const lighteringId = Number(req.params.id);
    if (!lighteringId) {
      return res.status(400).json({ message: "Invalid lightering id." });
    }

    const result = await withTransaction(async (conn) => {
      const [rows] = await conn.query(
        `SELECT
           l.id,
           l.voyage_id,
           l.status,
           l.is_main_ship_empty,
           l.unload_empty_confirmed,
           v.status AS voyage_status
         FROM lighterings l
         JOIN voyages v ON v.id = l.voyage_id AND v.is_void = 0
         WHERE l.id = ?
           AND l.is_void = 0
         LIMIT 1
         FOR UPDATE`,
        [lighteringId]
      );
      if (!rows.length) {
        const err = new Error("Lightering task not found.");
        err.status = 404;
        throw err;
      }

      const row = rows[0];
      const unloadConfirmed = Number(row.unload_empty_confirmed != null ? row.unload_empty_confirmed : row.is_main_ship_empty);
      if (unloadConfirmed === 1 || row.status === "MAIN_EMPTY_CONFIRMED") {
        if (row.voyage_status !== "LOCKED") {
          await conn.query(
            `UPDATE voyages
                SET status = 'LOCKED',
                    locked_at = COALESCE(locked_at, NOW()),
                    updated_at = NOW(),
                    updated_by = ?
              WHERE id = ?`,
            [req.user.id, row.voyage_id]
          );
        }
        const v1 = await ensureSettlementV1(conn, row.voyage_id, req.user.id);
        return {
          alreadyConfirmed: true,
          voyageId: row.voyage_id,
          settlementVersionId: v1.settlementVersionId,
          settlementVersionNo: v1.versionNo
        };
      }

      if (row.status !== "IN_PROGRESS") {
        const err = new Error("Only IN_PROGRESS lightering order can confirm main ship empty.");
        err.status = 409;
        throw err;
      }

      await conn.query(
        `UPDATE lighterings
            SET is_main_ship_empty = 1,
                unload_empty_confirmed = 1,
                status = 'MAIN_EMPTY_CONFIRMED',
                confirmed_by = ?,
                confirmed_at = NOW(),
                empty_confirm_note = ?,
                updated_at = NOW(),
                updated_by = ?
          WHERE id = ?`,
        [req.user.id, String((req.body || {}).note || "Main ship empty confirmed."), req.user.id, lighteringId]
      );

      await conn.query(
        `UPDATE voyages
            SET status = 'LOCKED',
                locked_at = COALESCE(locked_at, NOW()),
                updated_at = NOW(),
                updated_by = ?
          WHERE id = ?`,
        [req.user.id, row.voyage_id]
      );

      const v1 = await ensureSettlementV1(conn, row.voyage_id, req.user.id);

      await writeAuditLog(conn, {
        actorUserId: req.user.id,
        action: "LIGHTERING_CONFIRM_EMPTY",
        entityType: "LIGHTERING",
        entityId: lighteringId,
        beforeData: { status: row.status, unloadEmptyConfirmed: unloadConfirmed, voyageStatus: row.voyage_status },
        afterData: { status: "MAIN_EMPTY_CONFIRMED", unloadEmptyConfirmed: 1, voyageStatus: "LOCKED" }
      });

      await writeAuditLog(conn, {
        actorUserId: req.user.id,
        action: "VOYAGE_LOCK_AND_SETTLEMENT_V1",
        entityType: "VOYAGE",
        entityId: row.voyage_id,
        afterData: { voyageStatus: "LOCKED", settlementVersionNo: 1, settlementVersionId: v1.settlementVersionId }
      });

      return {
        alreadyConfirmed: false,
        voyageId: row.voyage_id,
        settlementVersionId: v1.settlementVersionId,
        settlementVersionNo: v1.versionNo
      };
    });

    res.json({
      message: result.alreadyConfirmed
        ? "Main ship empty already confirmed. Voyage remains locked."
        : "Main ship empty confirmed. Voyage locked and settlement v1 generated.",
      ...result
    });
  } catch (error) {
    next(error);
  }
});

router.get("/stockins/batches/:batchId", async (req, res, next) => {
  try {
    ensureRole(req, ACCESS_ROLES);

    const batchId = Number(req.params.batchId);
    if (!batchId) {
      return res.status(400).json({ message: "Invalid batch id." });
    }

    const [rows] = await pool.query(
      `SELECT
         b.id,
         b.batch_no,
         b.status,
         b.available_qty,
         b.locked_qty,
         b.shipped_qty AS outbound_qty,
         b.remaining_qty,
         b.stock_in_confirmed,
         b.stock_in_confirmed_at,
         b.stock_in_confirmed_by,
         b.voyage_id,
         v.voyage_no,
         v.status AS voyage_status,
         v.procurement_id,
         p.procurement_no,
         s.ship_name,
         si.confirmed_qty AS latest_confirmed_qty,
         si.stock_in_time AS latest_stock_in_time
       FROM inventory_batches b
       JOIN voyages v ON v.id = b.voyage_id AND v.is_void = 0
       LEFT JOIN procurements p ON p.id = v.procurement_id AND p.is_void = 0
       LEFT JOIN ships s ON s.id = v.ship_id AND s.is_void = 0
       LEFT JOIN (
         SELECT x.batch_id, x.confirmed_qty, x.stock_in_time
         FROM stock_ins x
         JOIN (
           SELECT batch_id, MAX(version_no) AS max_version
           FROM stock_ins
           WHERE is_void = 0
           GROUP BY batch_id
         ) mv ON mv.batch_id = x.batch_id AND mv.max_version = x.version_no
         WHERE x.is_void = 0
       ) si ON si.batch_id = b.id
       WHERE b.id = ?
         AND b.is_void = 0
       LIMIT 1`,
      [batchId]
    );

    if (!rows.length) {
      return res.status(404).json({ message: "Batch not found." });
    }

    const row = rows[0];
    res.json({
      detail: {
        id: row.id,
        batchNo: row.batch_no,
        status: row.status,
        availableQty: Number(row.available_qty || 0),
        lockedQty: Number(row.locked_qty || 0),
        outboundQty: Number(row.outbound_qty || 0),
        remainingQty: Number(row.remaining_qty || 0),
        sellable: Number(row.stock_in_confirmed || 0) === 1,
        sellableText: Number(row.stock_in_confirmed || 0) === 1 ? "可售" : "不可售",
        voyageId: row.voyage_id,
        voyageNo: row.voyage_no,
        voyageStatus: row.voyage_status,
        procurementId: row.procurement_id || null,
        procurementNo: row.procurement_no || "",
        shipName: row.ship_name || "-",
        stockInConfirmedAt: row.stock_in_confirmed_at,
        stockInConfirmedBy: row.stock_in_confirmed_by,
        latestConfirmedQty: row.latest_confirmed_qty == null ? null : Number(row.latest_confirmed_qty),
        latestStockInTime: row.latest_stock_in_time
      }
    });
  } catch (error) {
    next(error);
  }
});

router.post("/stockins/confirm", async (req, res, next) => {
  try {
    ensureRole(req, ACCESS_ROLES);

    const {
      batchId,
      confirmedQty,
      stockInTime,
      evidenceUrls = [],
      remark = "",
      operatorName = "",
      reason = "Locked voyage stock-in adjustment request"
    } = req.body || {};

    const parsedBatchId = Number(batchId);
    const parsedQty = Number(confirmedQty);
    if (!parsedBatchId || !Number.isFinite(parsedQty) || parsedQty <= 0) {
      return res.status(400).json({ message: "batchId and confirmedQty are required." });
    }

    const result = await withTransaction(async (conn) => {
      const [batchRows] = await conn.query(
        `SELECT
           b.id,
           b.batch_no,
           b.voyage_id,
           b.available_qty,
           b.locked_qty,
           b.shipped_qty,
           b.remaining_qty,
           b.stock_in_confirmed,
           b.stock_in_confirmed_at,
           b.stock_in_confirmed_by,
           v.voyage_no,
           v.status AS voyage_status,
           v.procurement_id,
           p.procurement_no
         FROM inventory_batches b
         JOIN voyages v ON v.id = b.voyage_id AND v.is_void = 0
         LEFT JOIN procurements p ON p.id = v.procurement_id AND p.is_void = 0
         WHERE b.id = ?
           AND b.is_void = 0
         LIMIT 1
         FOR UPDATE`,
        [parsedBatchId]
      );
      if (!batchRows.length) {
        const err = new Error("Batch not found.");
        err.status = 404;
        throw err;
      }

      const batch = batchRows[0];
      const [latestRows] = await conn.query(
        `SELECT id, version_no, confirmed_qty, stock_in_time, before_qty, after_qty
           FROM stock_ins
          WHERE batch_id = ?
            AND is_void = 0
          ORDER BY version_no DESC
          LIMIT 1
          FOR UPDATE`,
        [parsedBatchId]
      );

      const hasConfirmed = latestRows.length > 0;
      const latest = hasConfirmed ? latestRows[0] : null;

      if (batch.voyage_status === "LOCKED" && hasConfirmed) {
        const revision = await createSettlementRevision(conn, batch.voyage_id, req.user.id, {
          deltaExpense: 0
        });

        const approval = await createApproval(conn, {
          approvalType: "STOCK_IN_ADJUST",
          targetEntityType: "STOCK_IN",
          targetEntityId: latest.id,
          requestedBy: req.user.id,
          reason,
          beforeSnapshot: {
            batchId: parsedBatchId,
            batchNo: batch.batch_no,
            voyageId: batch.voyage_id,
            voyageNo: batch.voyage_no,
            confirmedQty: Number(latest.confirmed_qty),
            beforeQty: Number(latest.before_qty == null ? batch.available_qty : latest.before_qty),
            afterQty: Number(latest.after_qty == null ? latest.confirmed_qty : latest.after_qty),
            stockInTime: latest.stock_in_time,
            stockInConfirmed: Number(batch.stock_in_confirmed || 0) === 1
          },
          afterSnapshot: {
            batchId: parsedBatchId,
            batchNo: batch.batch_no,
            voyageId: batch.voyage_id,
            voyageNo: batch.voyage_no,
            confirmedQty: parsedQty,
            beforeQty: Number(batch.available_qty || 0),
            afterQty: toFixedNumber(parsedQty, 3),
            stockInTime: stockInTime || null,
            evidenceUrls: normalizeAttachmentUrls(evidenceUrls),
            remark: String(remark || ""),
            operatorName: sanitizeText(operatorName, 64) || `User#${req.user.id}`
          }
        });

        await writeAuditLog(conn, {
          actorUserId: req.user.id,
          action: "LOCKED_STOCKIN_ADJUST_SUBMIT_APPROVAL",
          entityType: "APPROVAL",
          entityId: approval.approvalId,
          afterData: {
            voyageId: batch.voyage_id,
            batchId: parsedBatchId,
            settlementVersionId: revision.settlementVersionId,
            settlementVersionNo: revision.versionNo
          }
        });

        return {
          requiresApproval: true,
          approvalId: approval.approvalId,
          approvalNo: approval.approvalNo,
          settlementVersionId: revision.settlementVersionId,
          settlementVersionNo: revision.versionNo
        };
      }

      const versionNo = hasConfirmed ? Number(latest.version_no) + 1 : 1;
      const stockInNo = generateNo("STI");
      const resolvedStockInTime = toNullableDateTime(stockInTime) || new Date();
      const resolvedEvidenceUrls = normalizeAttachmentUrls(evidenceUrls);
      const resolvedOperatorName = sanitizeText(operatorName, 64) || `User#${req.user.id}`;
      const beforeQty = toFixedNumber(batch.available_qty, 3);
      const afterQty = toFixedNumber(parsedQty, 3);

      const [insertResult] = await conn.query(
        `INSERT INTO stock_ins
          (stock_in_no, batch_id, voyage_id, procurement_id, version_no, confirmed_qty, before_qty, after_qty,
           stock_in_time, status, evidence_urls, voucher_attachments, remark, operator_id, operator_name,
           confirmed_by, approval_id, created_at, updated_at, created_by, updated_by, is_void)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'CONFIRMED', ?, ?, ?, ?, ?, ?, NULL, NOW(), NOW(), ?, ?, 0)`,
        [
          stockInNo,
          parsedBatchId,
          batch.voyage_id,
          batch.procurement_id || null,
          versionNo,
          parsedQty,
          beforeQty,
          afterQty,
          resolvedStockInTime,
          JSON.stringify(resolvedEvidenceUrls),
          JSON.stringify(resolvedEvidenceUrls),
          String(remark || ""),
          req.user.id || null,
          resolvedOperatorName,
          req.user.id,
          req.user.id,
          req.user.id
        ]
      );

      await conn.query(
        `UPDATE inventory_batches
            SET stock_in_confirmed_at = ?,
                stock_in_confirmed_by = ?,
                updated_at = NOW(),
                updated_by = ?
          WHERE id = ?`,
        [resolvedStockInTime, req.user.id, req.user.id, parsedBatchId]
      );

      await writeAuditLog(conn, {
        actorUserId: req.user.id,
        action: "STOCK_IN_CONFIRM",
        entityType: "STOCK_IN",
        entityId: insertResult.insertId,
        beforeData: {
          batchId: parsedBatchId,
          voyageId: batch.voyage_id,
          availableQty: beforeQty,
          stockInConfirmed: Number(batch.stock_in_confirmed || 0) === 1,
          stockInConfirmedAt: batch.stock_in_confirmed_at || null
        },
        afterData: {
          batchId: parsedBatchId,
          voyageId: batch.voyage_id,
          procurementId: batch.procurement_id || null,
          confirmedQty: parsedQty,
          beforeQty,
          afterQty
        }
      });

      const [batchAfterRows] = await conn.query(
        `SELECT available_qty, locked_qty, shipped_qty, remaining_qty, stock_in_confirmed, stock_in_confirmed_at, stock_in_confirmed_by, status
           FROM inventory_batches
          WHERE id = ?`,
        [parsedBatchId]
      );

      const after = batchAfterRows[0] || {};
      return {
        requiresApproval: false,
        stockInId: insertResult.insertId,
        stockInNo,
        batchStatus: after.status || null,
        availableQty: Number(after.available_qty || 0),
        lockedQty: Number(after.locked_qty || 0),
        outboundQty: Number(after.shipped_qty || 0),
        remainingQty: Number(after.remaining_qty || 0),
        stockInConfirmed: Number(after.stock_in_confirmed || 0),
        stockInConfirmedAt: after.stock_in_confirmed_at || null,
        stockInConfirmedBy: after.stock_in_confirmed_by || null
      };
    });

    res.json({
      message: result.requiresApproval ? "航次已锁定，入库吨数调整已提交审批并生成结算修订版本。" : "入库确认成功，可用吨数已更新。",
      ...result
    });
  } catch (error) {
    next(error);
  }
});
router.post("/lighterings", async (req, res, next) => {
  try {
    ensureRole(req, ACCESS_ROLES);

    const {
      lighteringNo,
      voyageId,
      shipId,
      transferType,
      receiverType,
      receiverShipName,
      lighteringQty,
      lighteringLocation,
      lighteringPort,
      lighteringTime,
      operatorId,
      operatorName,
      status,
      remark,
      attachments = [],
      items = []
    } = req.body || {};

    const parsedVoyageId = Number(voyageId || 0);
    if (!parsedVoyageId) {
      return res.status(400).json({ message: "voyageId is required." });
    }

    const payloadItems = normalizeLighteringItems(items);
    const fallbackQty = Number(lighteringQty || 0);
    const totalQty = payloadItems.length
      ? toFixedNumber(payloadItems.reduce((sum, item) => sum + Number(item.transferQty || 0), 0), 3)
      : (Number.isFinite(fallbackQty) && fallbackQty > 0 ? toFixedNumber(fallbackQty, 3) : 0);
    if (!(totalQty > 0)) {
      return res.status(400).json({ message: "lighteringQty must be positive." });
    }

    const result = await withTransaction(async (conn) => {
      const [voyageRows] = await conn.query(
        `SELECT id, voyage_no, ship_id, status
           FROM voyages
          WHERE id = ?
            AND is_void = 0
          LIMIT 1
          FOR UPDATE`,
        [parsedVoyageId]
      );
      if (!voyageRows.length) {
        const err = new Error("Voyage not found.");
        err.status = 404;
        throw err;
      }

      const voyage = voyageRows[0];
      if (voyage.status === "LOCKED" || voyage.status === "COMPLETED") {
        const err = new Error("Locked/Completed voyage cannot create lightering order directly.");
        err.status = 409;
        throw err;
      }

      const resolvedShipId = Number(shipId || voyage.ship_id || 0) || null;
      const resolvedStatus = normalizeLighteringStatus(status, "DRAFT");
      if (resolvedStatus === "MAIN_EMPTY_CONFIRMED") {
        const err = new Error("MAIN_EMPTY_CONFIRMED is generated by confirm-empty action only.");
        err.status = 400;
        throw err;
      }
      const resolvedLighteringNo = sanitizeText(lighteringNo, 64) || generateNo("LGT");
      const resolvedTime = toNullableDateTime(lighteringTime) || new Date();
      const resolvedAttachments = normalizeAttachmentUrls(attachments);
      const resolvedOperatorId = Number(operatorId || 0) || null;
      const resolvedOperatorName = sanitizeText(operatorName, 64) || null;
      const resolvedReceiverShipName = sanitizeText(receiverShipName, 128) || null;
      const resolvedRemark = sanitizeText(remark, 255) || null;

      const [insertResult] = await conn.query(
        `INSERT INTO lighterings
          (lightering_no, voyage_id, ship_id, transfer_type, receiver_type, receiver_ship_name, lightering_location,
           lightering_port, lightering_time, operator_id, operator_name, lightering_qty, started_at, ended_at,
           is_main_ship_empty, unload_empty_confirmed, status, confirmed_by, confirmed_at, empty_confirm_note, remark,
           attachments, created_at, updated_at, created_by, updated_by, is_void)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, 0, 0, ?, NULL, NULL, NULL, ?, ?, NOW(), NOW(), ?, ?, 0)`,
        [
          resolvedLighteringNo,
          parsedVoyageId,
          resolvedShipId,
          normalizeTransferType(transferType),
          normalizeReceiverType(receiverType),
          resolvedReceiverShipName,
          sanitizeText(lighteringLocation, 128) || null,
          sanitizeText(lighteringPort, 128) || null,
          resolvedTime,
          resolvedOperatorId,
          resolvedOperatorName,
          totalQty,
          resolvedTime,
          resolvedStatus,
          resolvedRemark,
          JSON.stringify(resolvedAttachments),
          req.user.id || null,
          req.user.id || null
        ]
      );

      const lighteringId = Number(insertResult.insertId || 0);
      for (const item of payloadItems) {
        await conn.query(
          `INSERT INTO lightering_items
            (lightering_id, line_no, cargo_name, transfer_qty, receiver_name, receiver_ship_name, status, remark,
             created_at, updated_at, created_by, updated_by, is_void)
           VALUES (?, ?, ?, ?, ?, ?, 'ACTIVE', ?, NOW(), NOW(), ?, ?, 0)`,
          [
            lighteringId,
            item.lineNo,
            item.cargoName,
            item.transferQty,
            item.receiverName,
            item.receiverShipName,
            item.remark,
            req.user.id || null,
            req.user.id || null
          ]
        );
      }

      await writeAuditLog(conn, {
        actorUserId: req.user.id,
        action: "LIGHTERING_CREATE",
        entityType: "LIGHTERING",
        entityId: lighteringId,
        afterData: {
          lighteringNo: resolvedLighteringNo,
          voyageId: parsedVoyageId,
          voyageNo: voyage.voyage_no,
          shipId: resolvedShipId,
          lighteringQty: totalQty,
          status: resolvedStatus,
          itemCount: payloadItems.length
        }
      });

      return {
        lighteringId,
        lighteringNo: resolvedLighteringNo
      };
    });

    res.json({
      message: "Lightering order created.",
      ...result
    });
  } catch (error) {
    next(error);
  }
});

router.put("/lighterings/:id", async (req, res, next) => {
  try {
    ensureRole(req, ACCESS_ROLES);
    const lighteringId = Number(req.params.id || 0);
    if (!lighteringId) {
      return res.status(400).json({ message: "Invalid lightering id." });
    }

    const {
      transferType,
      receiverType,
      receiverShipName,
      lighteringQty,
      lighteringLocation,
      lighteringPort,
      lighteringTime,
      operatorId,
      operatorName,
      status,
      remark,
      attachments = [],
      items
    } = req.body || {};

    const result = await withTransaction(async (conn) => {
      const [rows] = await conn.query(
        `SELECT
           l.*,
           v.status AS voyage_status
         FROM lighterings l
         JOIN voyages v ON v.id = l.voyage_id AND v.is_void = 0
         WHERE l.id = ?
           AND l.is_void = 0
         LIMIT 1
         FOR UPDATE`,
        [lighteringId]
      );
      if (!rows.length) {
        const err = new Error("Lightering order not found.");
        err.status = 404;
        throw err;
      }

      const row = rows[0];
      if (row.voyage_status === "LOCKED" || row.status === "MAIN_EMPTY_CONFIRMED") {
        const err = new Error("Locked lightering data cannot be directly modified.");
        err.status = 409;
        throw err;
      }

      const payloadItems = items == null ? null : normalizeLighteringItems(items);
      const qtyFromItems = payloadItems && payloadItems.length
        ? toFixedNumber(payloadItems.reduce((sum, item) => sum + Number(item.transferQty || 0), 0), 3)
        : null;
      const parsedQty = Number(lighteringQty || 0);
      const resolvedQty = qtyFromItems != null
        ? qtyFromItems
        : (Number.isFinite(parsedQty) && parsedQty > 0 ? toFixedNumber(parsedQty, 3) : Number(row.lightering_qty));
      if (!(resolvedQty > 0)) {
        const err = new Error("lighteringQty must be positive.");
        err.status = 400;
        throw err;
      }

      const resolvedStatus = normalizeLighteringStatus(status, String(row.status || "DRAFT"));
      if (resolvedStatus === "MAIN_EMPTY_CONFIRMED") {
        const err = new Error("MAIN_EMPTY_CONFIRMED is generated by confirm-empty action only.");
        err.status = 400;
        throw err;
      }
      const resolvedRemark = sanitizeText(remark, 255) || null;
      const resolvedAttachments = normalizeAttachmentUrls(attachments);

      await conn.query(
        `UPDATE lighterings
            SET transfer_type = ?,
                receiver_type = ?,
                receiver_ship_name = ?,
                lightering_location = ?,
                lightering_port = ?,
                lightering_time = ?,
                operator_id = ?,
                operator_name = ?,
                lightering_qty = ?,
                status = ?,
                remark = ?,
                attachments = ?,
                updated_at = NOW(),
                updated_by = ?
          WHERE id = ?`,
        [
          normalizeTransferType(transferType || row.transfer_type),
          normalizeReceiverType(receiverType || row.receiver_type),
          sanitizeText(receiverShipName, 128) || row.receiver_ship_name || null,
          sanitizeText(lighteringLocation, 128) || row.lightering_location || null,
          sanitizeText(lighteringPort, 128) || row.lightering_port || null,
          toNullableDateTime(lighteringTime) || row.lightering_time || row.started_at || new Date(),
          Number(operatorId || 0) || row.operator_id || null,
          sanitizeText(operatorName, 64) || row.operator_name || null,
          resolvedQty,
          resolvedStatus,
          resolvedRemark != null ? resolvedRemark : (row.remark || null),
          JSON.stringify(resolvedAttachments.length ? resolvedAttachments : parseJsonArray(row.attachments)),
          req.user.id || null,
          lighteringId
        ]
      );

      if (payloadItems) {
        await conn.query(
          `UPDATE lightering_items
              SET status = 'VOID',
                  is_void = 1,
                  void_reason = 'Replaced by lightering edit',
                  void_at = NOW(),
                  updated_at = NOW(),
                  updated_by = ?
            WHERE lightering_id = ?
              AND is_void = 0`,
          [req.user.id || null, lighteringId]
        );

        const [maxLineRows] = await conn.query(
          `SELECT COALESCE(MAX(line_no), 0) AS max_line_no
             FROM lightering_items
            WHERE lightering_id = ?
            FOR UPDATE`,
          [lighteringId]
        );
        let nextLineNo = Number((maxLineRows[0] && maxLineRows[0].max_line_no) || 0);

        for (const item of payloadItems) {
          nextLineNo += 1;
          await conn.query(
            `INSERT INTO lightering_items
              (lightering_id, line_no, cargo_name, transfer_qty, receiver_name, receiver_ship_name, status, remark,
               created_at, updated_at, created_by, updated_by, is_void)
             VALUES (?, ?, ?, ?, ?, ?, 'ACTIVE', ?, NOW(), NOW(), ?, ?, 0)`,
            [
              lighteringId,
              nextLineNo,
              item.cargoName,
              item.transferQty,
              item.receiverName,
              item.receiverShipName,
              item.remark,
              req.user.id || null,
              req.user.id || null
            ]
          );
        }
      }

      await writeAuditLog(conn, {
        actorUserId: req.user.id,
        action: "LIGHTERING_UPDATE",
        entityType: "LIGHTERING",
        entityId: lighteringId,
        beforeData: {
          status: row.status,
          lighteringQty: Number(row.lightering_qty || 0),
          transferType: row.transfer_type
        },
        afterData: {
          status: resolvedStatus,
          lighteringQty: resolvedQty,
          transferType: normalizeTransferType(transferType || row.transfer_type),
          itemCount: payloadItems ? payloadItems.length : null
        }
      });

      return { lighteringId };
    });

    res.json({
      message: "Lightering order updated.",
      ...result
    });
  } catch (error) {
    next(error);
  }
});

router.get("/lighterings", async (req, res, next) => {
  try {
    ensureRole(req, ACCESS_ROLES);

    const keyword = String(req.query.keyword || "").trim();
    const status = String(req.query.status || "").trim().toUpperCase();
    const where = ["l.is_void = 0"];
    const params = [];

    if (status) {
      where.push("l.status = ?");
      params.push(status);
    }
    if (keyword) {
      where.push("(l.lightering_no LIKE ? OR v.voyage_no LIKE ? OR COALESCE(s.ship_name, '') LIKE ?)");
      params.push(`%${keyword}%`, `%${keyword}%`, `%${keyword}%`);
    }

    const [rows] = await pool.query(
      `SELECT
         l.id,
         l.lightering_no,
         l.voyage_id,
         COALESCE(l.ship_id, v.ship_id) AS ship_id,
         l.status,
         l.is_main_ship_empty,
         l.unload_empty_confirmed,
         l.lightering_location,
         l.lightering_port,
         l.lightering_time,
         l.operator_id,
         l.operator_name,
         l.remark,
         l.attachments,
         l.started_at,
         l.confirmed_at,
         l.created_at,
         l.updated_at,
         v.voyage_no,
         v.status AS voyage_status,
         s.ship_name
       FROM lighterings l
       JOIN voyages v ON v.id = l.voyage_id AND v.is_void = 0
       LEFT JOIN ships s ON s.id = v.ship_id AND s.is_void = 0
       WHERE ${where.join(" AND ")}
       ORDER BY l.updated_at DESC
       LIMIT 300`,
      params
    );

    res.json({
      items: rows.map((row) => ({
        id: row.id,
        lighteringNo: row.lightering_no,
        voyageId: row.voyage_id,
        voyageNo: row.voyage_no,
        shipId: row.ship_id,
        voyageStatus: row.voyage_status,
        shipName: row.ship_name || "-",
        status: row.status,
        isMainShipEmpty: Number((row.unload_empty_confirmed != null ? row.unload_empty_confirmed : row.is_main_ship_empty) || 0) === 1,
        unloadEmptyConfirmed: Number((row.unload_empty_confirmed != null ? row.unload_empty_confirmed : row.is_main_ship_empty) || 0) === 1,
        canConfirmEmpty: row.status === "IN_PROGRESS"
          && Number((row.unload_empty_confirmed != null ? row.unload_empty_confirmed : row.is_main_ship_empty) || 0) === 0,
        canEdit: row.voyage_status === "IN_PROGRESS"
          && ["DRAFT", "IN_PROGRESS"].includes(row.status)
          && Number((row.unload_empty_confirmed != null ? row.unload_empty_confirmed : row.is_main_ship_empty) || 0) === 0,
        lighteringLocation: row.lightering_location || "",
        lighteringPort: row.lightering_port || "",
        lighteringTime: row.lightering_time || row.started_at || null,
        operatorId: row.operator_id || null,
        operatorName: row.operator_name || "",
        remark: row.remark || "",
        attachments: parseJsonArray(row.attachments),
        startedAt: row.started_at,
        confirmedAt: row.confirmed_at,
        createdAt: row.created_at,
        updatedAt: row.updated_at
      }))
    });
  } catch (error) {
    next(error);
  }
});

router.get("/lighterings/:id", async (req, res, next) => {
  try {
    ensureRole(req, ACCESS_ROLES);

    const lighteringId = Number(req.params.id || 0);
    if (!lighteringId) {
      return res.status(400).json({ message: "Invalid lightering id." });
    }

    const [detailRows] = await pool.query(
      `SELECT
         l.id,
         l.lightering_no,
         l.voyage_id,
         COALESCE(l.ship_id, v.ship_id) AS ship_id,
         l.status,
         l.is_main_ship_empty,
         l.unload_empty_confirmed,
         l.lightering_location,
         l.lightering_port,
         l.lightering_time,
         l.operator_id,
         l.operator_name,
         l.remark,
         l.attachments,
         l.transfer_type,
         l.receiver_type,
         l.receiver_ship_name,
         l.lightering_qty,
         l.started_at,
         l.ended_at,
         l.confirmed_by,
         l.confirmed_at,
         l.empty_confirm_note,
         l.created_at,
         l.updated_at,
         v.voyage_no,
         v.status AS voyage_status,
         s.ship_name
       FROM lighterings l
       JOIN voyages v ON v.id = l.voyage_id AND v.is_void = 0
       LEFT JOIN ships s ON s.id = COALESCE(l.ship_id, v.ship_id) AND s.is_void = 0
       WHERE l.id = ?
         AND l.is_void = 0
       LIMIT 1`,
      [lighteringId]
    );
    if (!detailRows.length) {
      return res.status(404).json({ message: "Lightering order not found." });
    }

    const [itemRows, auditRows] = await Promise.all([
      pool.query(
        `SELECT
           id, line_no, cargo_name, transfer_qty, receiver_name, receiver_ship_name, status, remark, created_at
         FROM lightering_items
         WHERE lightering_id = ?
           AND is_void = 0
         ORDER BY line_no ASC`,
        [lighteringId]
      ),
      pool.query(
        `SELECT
           id, action, actor_user_id, event_time, before_data, after_data
         FROM audit_logs
         WHERE is_void = 0
           AND entity_type = 'LIGHTERING'
           AND entity_id = ?
         ORDER BY event_time DESC
         LIMIT 200`,
        [lighteringId]
      )
    ]);

    const row = detailRows[0];
    res.json({
      detail: {
        id: row.id,
        lighteringNo: row.lightering_no,
        voyageId: row.voyage_id,
        voyageNo: row.voyage_no,
        shipId: row.ship_id,
        voyageStatus: row.voyage_status,
        shipName: row.ship_name || "-",
        status: row.status,
        isMainShipEmpty: Number((row.unload_empty_confirmed != null ? row.unload_empty_confirmed : row.is_main_ship_empty) || 0) === 1,
        unloadEmptyConfirmed: Number((row.unload_empty_confirmed != null ? row.unload_empty_confirmed : row.is_main_ship_empty) || 0) === 1,
        canConfirmEmpty: row.status === "IN_PROGRESS"
          && Number((row.unload_empty_confirmed != null ? row.unload_empty_confirmed : row.is_main_ship_empty) || 0) === 0,
        canEdit: row.voyage_status === "IN_PROGRESS"
          && ["DRAFT", "IN_PROGRESS"].includes(row.status)
          && Number((row.unload_empty_confirmed != null ? row.unload_empty_confirmed : row.is_main_ship_empty) || 0) === 0,
        transferType: row.transfer_type || "",
        receiverType: row.receiver_type || "",
        receiverShipName: row.receiver_ship_name || "",
        lighteringQty: Number(row.lightering_qty || 0),
        lighteringLocation: row.lightering_location || "",
        lighteringPort: row.lightering_port || "",
        lighteringTime: row.lightering_time || row.started_at || null,
        operatorId: row.operator_id || null,
        operatorName: row.operator_name || "",
        startedAt: row.started_at,
        endedAt: row.ended_at,
        confirmedBy: row.confirmed_by,
        confirmedAt: row.confirmed_at,
        emptyConfirmNote: row.empty_confirm_note || "",
        remark: row.remark || "",
        attachments: parseJsonArray(row.attachments),
        createdAt: row.created_at,
        updatedAt: row.updated_at
      },
      items: itemRows[0].map((item, index) => ({
        id: item.id,
        lineNo: index + 1,
        sourceLineNo: item.line_no,
        cargoName: item.cargo_name,
        transferQty: Number(item.transfer_qty || 0),
        receiverName: item.receiver_name || "",
        receiverShipName: item.receiver_ship_name || "",
        status: item.status,
        remark: item.remark || "",
        createdAt: item.created_at
      })),
      audits: auditRows[0].map((audit) => ({
        id: audit.id,
        action: audit.action,
        actorUserId: audit.actor_user_id,
        eventTime: audit.event_time,
        beforeData: audit.before_data,
        afterData: audit.after_data
      }))
    });
  } catch (error) {
    next(error);
  }
});

router.get("/stockins", async (req, res, next) => {
  try {
    ensureRole(req, ACCESS_ROLES);

    const keyword = String(req.query.keyword || "").trim();
    const status = String(req.query.status || "").trim().toUpperCase();
    const where = ["si.is_void = 0"];
    const params = [];

    if (status) {
      where.push("si.status = ?");
      params.push(status);
    }
    if (keyword) {
      where.push("(si.stock_in_no LIKE ? OR b.batch_no LIKE ? OR v.voyage_no LIKE ? OR COALESCE(s.ship_name, '') LIKE ?)");
      params.push(`%${keyword}%`, `%${keyword}%`, `%${keyword}%`, `%${keyword}%`);
    }

    const [rows] = await pool.query(
      `SELECT
         si.id,
         si.stock_in_no,
         si.batch_id,
         si.voyage_id,
         si.procurement_id,
         si.version_no,
         si.confirmed_qty,
         si.before_qty,
         si.after_qty,
         si.stock_in_time,
         si.status,
         si.voucher_attachments,
         si.evidence_urls,
         si.operator_id,
         si.operator_name,
         si.approval_id,
         si.created_at,
         si.updated_at,
         b.batch_no,
         b.available_qty,
         b.locked_qty,
         b.shipped_qty AS outbound_qty,
         b.remaining_qty,
         b.stock_in_confirmed,
         b.stock_in_confirmed_at,
         b.stock_in_confirmed_by,
         COALESCE(si.voyage_id, v.id) AS voyage_id,
         v.voyage_no,
         v.status AS voyage_status,
         p.procurement_no,
         s.ship_name
       FROM stock_ins si
       JOIN inventory_batches b ON b.id = si.batch_id AND b.is_void = 0
       JOIN voyages v ON v.id = b.voyage_id AND v.is_void = 0
       LEFT JOIN procurements p ON p.id = COALESCE(si.procurement_id, v.procurement_id) AND p.is_void = 0
       LEFT JOIN ships s ON s.id = v.ship_id AND s.is_void = 0
       WHERE ${where.join(" AND ")}
       ORDER BY si.created_at DESC
       LIMIT 300`,
      params
    );

    res.json({
      items: rows.map((row) => ({
        id: row.id,
        stockInNo: row.stock_in_no,
        batchId: row.batch_id,
        batchNo: row.batch_no,
        voyageId: row.voyage_id,
        voyageNo: row.voyage_no,
        voyageStatus: row.voyage_status,
        procurementId: row.procurement_id || null,
        procurementNo: row.procurement_no || "",
        shipName: row.ship_name || "-",
        versionNo: Number(row.version_no || 0),
        confirmedQty: Number(row.confirmed_qty || 0),
        beforeQty: Number(row.before_qty || 0),
        afterQty: Number(row.after_qty || 0),
        stockInTime: row.stock_in_time,
        status: row.status,
        voucherAttachments: parseJsonArray(row.voucher_attachments || row.evidence_urls),
        operatorId: row.operator_id || null,
        operatorName: row.operator_name || "",
        approvalId: row.approval_id,
        availableQty: Number(row.available_qty || 0),
        lockedQty: Number(row.locked_qty || 0),
        outboundQty: Number(row.outbound_qty || 0),
        remainingQty: Number(row.remaining_qty || 0),
        stockInConfirmed: Number(row.stock_in_confirmed || 0) === 1,
        stockInConfirmedAt: row.stock_in_confirmed_at,
        stockInConfirmedBy: row.stock_in_confirmed_by,
        createdAt: row.created_at,
        updatedAt: row.updated_at
      }))
    });
  } catch (error) {
    next(error);
  }
});

router.get("/stockins/:id", async (req, res, next) => {
  try {
    ensureRole(req, ACCESS_ROLES);

    const stockInId = Number(req.params.id || 0);
    if (!stockInId) {
      return res.status(400).json({ message: "Invalid stock-in id." });
    }

    const [detailRows, auditRows] = await Promise.all([
      pool.query(
        `SELECT
           si.id,
           si.stock_in_no,
           si.batch_id,
           si.voyage_id,
           si.procurement_id,
           si.version_no,
           si.confirmed_qty,
           si.before_qty,
           si.after_qty,
           si.stock_in_time,
           si.status,
           si.evidence_urls,
           si.voucher_attachments,
           si.remark,
           si.operator_id,
           si.operator_name,
           si.confirmed_by,
           si.approval_id,
           si.created_at,
           si.updated_at,
           b.batch_no,
           b.available_qty,
           b.locked_qty,
           b.shipped_qty AS outbound_qty,
           b.remaining_qty,
           b.stock_in_confirmed,
           b.stock_in_confirmed_at,
           b.stock_in_confirmed_by,
           COALESCE(si.voyage_id, v.id) AS voyage_id,
           v.voyage_no,
           v.status AS voyage_status,
           p.procurement_no,
           s.ship_name
         FROM stock_ins si
         JOIN inventory_batches b ON b.id = si.batch_id AND b.is_void = 0
         JOIN voyages v ON v.id = b.voyage_id AND v.is_void = 0
         LEFT JOIN procurements p ON p.id = COALESCE(si.procurement_id, v.procurement_id) AND p.is_void = 0
         LEFT JOIN ships s ON s.id = v.ship_id AND s.is_void = 0
         WHERE si.id = ?
           AND si.is_void = 0
         LIMIT 1`,
        [stockInId]
      ),
      pool.query(
        `SELECT
           id, action, actor_user_id, event_time, before_data, after_data
         FROM audit_logs
         WHERE is_void = 0
           AND entity_type = 'STOCK_IN'
           AND entity_id = ?
         ORDER BY event_time DESC
         LIMIT 200`,
        [stockInId]
      )
    ]);

    if (!detailRows[0].length) {
      return res.status(404).json({ message: "Stock-in order not found." });
    }

    const row = detailRows[0][0];
    res.json({
      detail: {
        id: row.id,
        stockInNo: row.stock_in_no,
        batchId: row.batch_id,
        batchNo: row.batch_no,
        voyageId: row.voyage_id,
        voyageNo: row.voyage_no,
        voyageStatus: row.voyage_status,
        procurementId: row.procurement_id || null,
        procurementNo: row.procurement_no || "",
        shipName: row.ship_name || "-",
        versionNo: Number(row.version_no || 0),
        confirmedQty: Number(row.confirmed_qty || 0),
        beforeQty: Number(row.before_qty || 0),
        afterQty: Number(row.after_qty || 0),
        stockInTime: row.stock_in_time,
        status: row.status,
        evidenceUrls: parseJsonArray(row.evidence_urls),
        voucherAttachments: parseJsonArray(row.voucher_attachments || row.evidence_urls),
        remark: row.remark || "",
        operatorId: row.operator_id || null,
        operatorName: row.operator_name || "",
        confirmedBy: row.confirmed_by,
        approvalId: row.approval_id,
        availableQty: Number(row.available_qty || 0),
        lockedQty: Number(row.locked_qty || 0),
        outboundQty: Number(row.outbound_qty || 0),
        remainingQty: Number(row.remaining_qty || 0),
        stockInConfirmed: Number(row.stock_in_confirmed || 0) === 1,
        stockInConfirmedAt: row.stock_in_confirmed_at,
        stockInConfirmedBy: row.stock_in_confirmed_by,
        createdAt: row.created_at,
        updatedAt: row.updated_at
      },
      audits: auditRows[0].map((audit) => ({
        id: audit.id,
        action: audit.action,
        actorUserId: audit.actor_user_id,
        eventTime: audit.event_time,
        beforeData: audit.before_data,
        afterData: audit.after_data
      }))
    });
  } catch (error) {
    next(error);
  }
});

router.get("/voyages/options", async (req, res, next) => {
  try {
    ensureRole(req, ACCESS_ROLES);
    const [rows] = await pool.query(
      `SELECT
         v.id,
         v.voyage_no,
         v.status,
         s.ship_name
       FROM voyages v
       LEFT JOIN ships s ON s.id = v.ship_id AND s.is_void = 0
       WHERE v.is_void = 0
         AND v.status IN ('IN_PROGRESS', 'LOCKED')
       ORDER BY v.updated_at DESC
       LIMIT 300`
    );
    res.json({
      items: rows.map((row) => ({
        id: row.id,
        voyageNo: row.voyage_no,
        status: row.status,
        shipName: row.ship_name || "-"
      }))
    });
  } catch (error) {
    next(error);
  }
});

router.get("/expense-access", async (req, res, next) => {
  try {
    ensureRole(req, ACCESS_ROLES);
    const canView = canViewExpenseAmount(req.user.roleCode);
    res.json({
      roleCode: req.user.roleCode,
      canViewAmount: canView,
      canSubmitExpense: canView
    });
  } catch (error) {
    next(error);
  }
});

router.post("/expenses", async (req, res, next) => {
  try {
    ensureRole(req, ACCESS_ROLES);

    if (!canViewExpenseAmount(req.user.roleCode)) {
      return res.status(403).json({ message: "No permission to edit expense amount." });
    }

    const {
      voyageId,
      expenseType,
      amount,
      occurredAt,
      voucherUrls = [],
      remark = "",
      reason = "锁定态费用调整申请"
    } = req.body || {};

    const parsedVoyageId = Number(voyageId);
    const parsedAmount = Number(amount);

    if (!parsedVoyageId || !expenseType || !Number.isFinite(parsedAmount) || parsedAmount <= 0) {
      return res.status(400).json({ message: "voyageId, expenseType and positive amount are required." });
    }

    const result = await withTransaction(async (conn) => {
      const [voyageRows] = await conn.query(
        `SELECT id, voyage_no, status
           FROM voyages
          WHERE id = ?
            AND is_void = 0
          LIMIT 1
          FOR UPDATE`,
        [parsedVoyageId]
      );
      if (!voyageRows.length) {
        const err = new Error("Voyage not found.");
        err.status = 404;
        throw err;
      }
      const voyage = voyageRows[0];

      const expenseNo = generateNo("EXP");
      const expenseStatus = voyage.status === "LOCKED" ? "DRAFT" : "CONFIRMED";
      const [insertResult] = await conn.query(
        `INSERT INTO expenses
          (expense_no, voyage_id, expense_type, amount, occurred_at, voucher_urls, status, source_module, entered_by,
           created_at, updated_at, created_by, updated_by, is_void)
         VALUES (?, ?, ?, ?, ?, ?, ?, 'ONSITE', ?, NOW(), NOW(), ?, ?, 0)`,
        [
          expenseNo,
          parsedVoyageId,
          expenseType,
          parsedAmount,
          occurredAt || new Date(),
          JSON.stringify(voucherUrls || []),
          expenseStatus,
          req.user.id,
          req.user.id,
          req.user.id
        ]
      );

      if (voyage.status !== "LOCKED") {
        await writeAuditLog(conn, {
          actorUserId: req.user.id,
          action: "EXPENSE_CREATE_CONFIRMED",
          entityType: "EXPENSE",
          entityId: insertResult.insertId,
          afterData: { voyageId: parsedVoyageId, amount: parsedAmount, expenseType }
        });
        return {
          requiresApproval: false,
          expenseId: insertResult.insertId,
          expenseNo
        };
      }

      const revision = await createSettlementRevision(conn, parsedVoyageId, req.user.id, {
        deltaExpense: parsedAmount
      });
      const approval = await createApproval(conn, {
        approvalType: "EXPENSE_ADJUST",
        targetEntityType: "EXPENSE",
        targetEntityId: insertResult.insertId,
        requestedBy: req.user.id,
        reason,
        beforeSnapshot: {
          voyageId: parsedVoyageId,
          voyageNo: voyage.voyage_no,
          expenseStatus: "NONE"
        },
        afterSnapshot: {
          expenseId: insertResult.insertId,
          expenseNo,
          voyageId: parsedVoyageId,
          expenseType,
          amount: parsedAmount,
          expenseStatus
        }
      });

      await writeAuditLog(conn, {
        actorUserId: req.user.id,
        action: "LOCKED_EXPENSE_ADJUST_SUBMIT_APPROVAL",
        entityType: "APPROVAL",
        entityId: approval.approvalId,
        afterData: {
          voyageId: parsedVoyageId,
          expenseId: insertResult.insertId,
          settlementVersionId: revision.settlementVersionId,
          settlementVersionNo: revision.versionNo
        }
      });

      return {
        requiresApproval: true,
        expenseId: insertResult.insertId,
        expenseNo,
        approvalId: approval.approvalId,
        approvalNo: approval.approvalNo,
        settlementVersionId: revision.settlementVersionId,
        settlementVersionNo: revision.versionNo
      };
    });

    res.json({
      message: result.requiresApproval ? "航次已锁定，入库吨数调整已提交审批并生成结算修订版本。" : "入库确认成功，可用吨数已更新。",
      ...result
    });
  } catch (error) {
    next(error);
  }
});

router.get("/expenses", async (req, res, next) => {
  try {
    ensureRole(req, ACCESS_ROLES);

    const voyageId = Number(req.query.voyageId || 0);
    const keyword = String(req.query.keyword || "").trim();
    const status = String(req.query.status || "").trim().toUpperCase();
    const expenseType = String(req.query.expenseType || "").trim().toUpperCase();
    const where = ["e.is_void = 0"];
    const params = [];

    if (voyageId) {
      where.push("e.voyage_id = ?");
      params.push(voyageId);
    }
    if (status) {
      where.push("e.status = ?");
      params.push(status);
    }
    if (expenseType) {
      where.push("e.expense_type = ?");
      params.push(expenseType);
    }
    if (keyword) {
      where.push("(e.expense_no LIKE ? OR v.voyage_no LIKE ? OR COALESCE(s.ship_name, '') LIKE ?)");
      params.push(`%${keyword}%`, `%${keyword}%`, `%${keyword}%`);
    }

    const [rows] = await pool.query(
      `SELECT
         e.id,
         e.expense_no,
         e.voyage_id,
         e.expense_type,
         e.amount,
         e.occurred_at,
         e.status,
         e.voucher_urls,
         e.source_module,
         e.entered_by,
         e.created_at,
         e.updated_at,
         v.voyage_no,
         v.status AS voyage_status,
         s.ship_name
       FROM expenses e
       LEFT JOIN voyages v ON v.id = e.voyage_id AND v.is_void = 0
       LEFT JOIN ships s ON s.id = v.ship_id AND s.is_void = 0
       WHERE ${where.join(" AND ")}
       ORDER BY e.created_at DESC
        LIMIT 200`,
      params
    );

    const canViewAmount = canViewExpenseAmount(req.user.roleCode);
    res.json({
      items: rows.map((row) => ({
        id: row.id,
        expenseNo: row.expense_no,
        voyageId: row.voyage_id,
        voyageNo: row.voyage_no || "-",
        voyageStatus: row.voyage_status || "",
        shipName: row.ship_name || "-",
        expenseType: row.expense_type,
        amount: canViewAmount ? Number(row.amount) : null,
        amountDisplay: canViewAmount ? Number(row.amount) : "***",
        occurredAt: row.occurred_at,
        status: row.status,
        voucherUrls: parseJsonArray(row.voucher_urls),
        sourceModule: row.source_module || "",
        enteredBy: row.entered_by,
        createdAt: row.created_at,
        updatedAt: row.updated_at
      })),
      canViewAmount
    });
  } catch (error) {
    next(error);
  }
});

router.get("/expenses/:id", async (req, res, next) => {
  try {
    ensureRole(req, ACCESS_ROLES);

    const expenseId = Number(req.params.id || 0);
    if (!expenseId) {
      return res.status(400).json({ message: "Invalid expense id." });
    }

    const [detailRows, auditRows] = await Promise.all([
      pool.query(
        `SELECT
           e.id,
           e.expense_no,
           e.voyage_id,
           e.expense_type,
           e.amount,
           e.occurred_at,
           e.status,
           e.voucher_urls,
           e.source_module,
           e.entered_by,
           e.created_at,
           e.updated_at,
           v.voyage_no,
           v.status AS voyage_status,
           s.ship_name
         FROM expenses e
         LEFT JOIN voyages v ON v.id = e.voyage_id AND v.is_void = 0
         LEFT JOIN ships s ON s.id = v.ship_id AND s.is_void = 0
         WHERE e.id = ?
           AND e.is_void = 0
         LIMIT 1`,
        [expenseId]
      ),
      pool.query(
        `SELECT
           id, action, actor_user_id, event_time, before_data, after_data
         FROM audit_logs
         WHERE is_void = 0
           AND entity_type = 'EXPENSE'
           AND entity_id = ?
         ORDER BY event_time DESC
         LIMIT 200`,
        [expenseId]
      )
    ]);

    if (!detailRows[0].length) {
      return res.status(404).json({ message: "Expense order not found." });
    }

    const row = detailRows[0][0];
    const canViewAmount = canViewExpenseAmount(req.user.roleCode);
    res.json({
      detail: {
        id: row.id,
        expenseNo: row.expense_no,
        voyageId: row.voyage_id,
        voyageNo: row.voyage_no || "-",
        voyageStatus: row.voyage_status || "",
        shipName: row.ship_name || "-",
        expenseType: row.expense_type,
        amount: canViewAmount ? Number(row.amount) : null,
        amountDisplay: canViewAmount ? Number(row.amount) : "***",
        occurredAt: row.occurred_at,
        status: row.status,
        voucherUrls: parseJsonArray(row.voucher_urls),
        sourceModule: row.source_module || "",
        enteredBy: row.entered_by,
        createdAt: row.created_at,
        updatedAt: row.updated_at
      },
      canViewAmount,
      audits: auditRows[0].map((audit) => ({
        id: audit.id,
        action: audit.action,
        actorUserId: audit.actor_user_id,
        eventTime: audit.event_time,
        beforeData: audit.before_data,
        afterData: audit.after_data
      }))
    });
  } catch (error) {
    next(error);
  }
});

module.exports = router;


