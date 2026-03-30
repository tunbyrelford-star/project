const express = require("express");
const { pool, withTransaction } = require("../db");
const {
  toFixedNumber,
  normalizeCalcMode,
  computeOvertimeMetrics,
  calculateOvertimeExpense
} = require("../services/sanding-timeout");

const router = express.Router();

const FINANCIAL_ROLES = ["SUPER_ADMIN", "FINANCE_MGMT"];
const ACCESS_ROLES = ["SUPER_ADMIN", "DISPATCHER", "ONSITE_SPECIALIST", "SALES", "FINANCE_MGMT"];
const MANAGE_ROLES = ["SUPER_ADMIN", "DISPATCHER"];
const TIMEOUT_HANDLE_ROLES = ["SUPER_ADMIN", "DISPATCHER", "ONSITE_SPECIALIST", "FINANCE_MGMT"];
const DEFAULT_SANDING_OVERTIME_RATE = Number(process.env.SANDING_OVERTIME_RATE_PER_HOUR || 150);

function ensureRole(req, allowedRoles) {
  if (!allowedRoles.includes(req.user.roleCode)) {
    const err = new Error("Permission denied");
    err.status = 403;
    throw err;
  }
}

async function generateVoyageNo(conn) {
  await conn.query(
    "INSERT INTO voyage_no_sequences (seq_date, seq_no) VALUES (CURDATE(), 0) ON DUPLICATE KEY UPDATE seq_no = seq_no"
  );
  await conn.query(
    "UPDATE voyage_no_sequences SET seq_no = LAST_INSERT_ID(seq_no + 1) WHERE seq_date = CURDATE()"
  );
  const [seqRows] = await conn.query("SELECT LAST_INSERT_ID() AS seqNo, DATE_FORMAT(CURDATE(), '%Y%m%d') AS dateStr");
  const seqNo = seqRows[0].seqNo;
  const dateStr = seqRows[0].dateStr;
  return `VY${dateStr}-${String(seqNo).padStart(4, "0")}`;
}

function generateNo(prefix) {
  return `${prefix}-${Date.now()}-${Math.floor(100 + Math.random() * 900)}`;
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

function canViewFinancial(roleCode) {
  return FINANCIAL_ROLES.includes(roleCode);
}

function sanitizeText(value, maxLen = 255) {
  const text = String(value == null ? "" : value).trim();
  if (!text) return "";
  return text.slice(0, maxLen);
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

function buildAttachmentPayload({
  miningTicket = null,
  miningTicketUrl = null,
  qualityPhotos = [],
  qualityPhotoUrls = []
}) {
  const normalizedMiningTicket = sanitizeText(miningTicket || miningTicketUrl, 512) || null;
  const photos = Array.from(new Set([
    ...parseJsonArray(qualityPhotos),
    ...parseJsonArray(qualityPhotoUrls)
  ].map((x) => sanitizeText(x, 512)).filter(Boolean)));
  return {
    miningTicket: normalizedMiningTicket,
    qualityPhotos: photos
  };
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

async function resolveRequiredActorUserId(conn, actorUserId) {
  const resolved = await resolveActorUserId(conn, actorUserId);
  if (resolved) return resolved;

  const [rows] = await conn.query(
    `SELECT id
       FROM users
      WHERE is_void = 0
      ORDER BY id ASC
      LIMIT 1`
  );
  if (!rows.length) {
    const err = new Error("No available user record for approval operation.");
    err.status = 500;
    throw err;
  }
  return Number(rows[0].id);
}

async function getProcurementCost(conn, voyageId) {
  const [rows] = await conn.query(
    `SELECT COALESCE(p.total_amount, 0) AS procurement_cost
       FROM voyages v
       JOIN procurements p ON p.id = v.procurement_id
      WHERE v.id = ?
        AND v.is_void = 0
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
    `SELECT id
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

async function getSandingTimeoutContext(conn, procurementId, withLock = false) {
  const [rows] = await conn.query(
    `SELECT
       p.id,
       p.procurement_no,
       p.status AS procurement_status,
       p.sand_start_time,
       p.planned_duration_min,
       p.unit_price,
       p.total_amount,
       v.id AS voyage_id,
       v.voyage_no,
       v.status AS voyage_status
     FROM procurements p
     LEFT JOIN voyages v ON v.procurement_id = p.id AND v.is_void = 0
    WHERE p.id = ?
      AND p.is_void = 0
    ${withLock ? "FOR UPDATE" : ""}
    `,
    [procurementId]
  );
  if (!rows.length) {
    const err = new Error("Procurement not found.");
    err.status = 404;
    throw err;
  }

  const row = rows[0];
  if (!row.sand_start_time || !row.planned_duration_min) {
    const err = new Error("Sanding has not started or planned duration is missing.");
    err.status = 400;
    throw err;
  }

  const [durationRows] = await conn.query(
    "SELECT TIMESTAMPDIFF(MINUTE, ?, NOW()) AS elapsed_min",
    [row.sand_start_time]
  );
  const elapsedMinutes = Number((durationRows[0] && durationRows[0].elapsed_min) || 0);
  const overtime = computeOvertimeMetrics(elapsedMinutes, row.planned_duration_min);

  return {
    ...row,
    elapsedMinutes: overtime.elapsedMinutes,
    overtimeMinutes: overtime.overtimeMinutes,
    overtimeHours: overtime.overtimeHours,
    isOvertime: overtime.isOvertime
  };
}

async function getLatestSandingTimeoutAlert(conn, procurementId, withLock = false) {
  const [rows] = await conn.query(
    `SELECT id, alert_no, status, triggered_at, handled_at, handle_note
       FROM alerts
      WHERE related_entity_type = 'PROCUREMENT'
        AND related_entity_id = ?
        AND alert_type = 'SANDING_TIMEOUT'
        AND is_void = 0
      ORDER BY created_at DESC
      LIMIT 1
      ${withLock ? "FOR UPDATE" : ""}`,
    [procurementId]
  );
  return rows.length ? rows[0] : null;
}

async function triggerSandingTimeoutAlert(conn, procurementId, actorUserId) {
  const [rows] = await conn.query(
    `SELECT id, sand_start_time, planned_duration_min
       FROM procurements
      WHERE id = ? AND is_void = 0
      FOR UPDATE`,
    [procurementId]
  );

  if (!rows.length) {
    return { triggered: false, reason: "Procurement not found." };
  }

  const row = rows[0];
  if (!row.sand_start_time || !row.planned_duration_min) {
    return { triggered: false, reason: "Sanding not started or planned_duration_min missing." };
  }

  const [durationRows] = await conn.query(
    "SELECT TIMESTAMPDIFF(MINUTE, ?, NOW()) AS elapsed_min",
    [row.sand_start_time]
  );
  const elapsed = Number(durationRows[0].elapsed_min || 0);
  if (elapsed <= Number(row.planned_duration_min)) {
    return { triggered: false, reason: "Not overtime yet.", elapsed };
  }

  const [insertAlert] = await conn.query(
    `INSERT INTO alerts
      (alert_no, alert_type, stage_code, related_entity_type, related_entity_id, severity, status, closure_required,
       triggered_at, created_at, updated_at, created_by, updated_by, is_void)
     VALUES (?, 'SANDING_TIMEOUT', 'SANDING', 'PROCUREMENT', ?, 'HIGH', 'OPEN', 1,
             NOW(), NOW(), NOW(), ?, ?, 0)
     ON DUPLICATE KEY UPDATE
       id = LAST_INSERT_ID(id),
       updated_at = updated_at`,
    [`ALT-${Date.now()}-${procurementId}`, procurementId, actorUserId || null, actorUserId || null]
  );

  const [alertIdRows] = await conn.query("SELECT LAST_INSERT_ID() AS alert_id");
  const alertId = Number(alertIdRows[0].alert_id || 0);
  const createdNew = insertAlert.affectedRows === 1;

  if (createdNew) {
    await conn.query(
      `UPDATE procurements
          SET alert_sanding_timeout_at = NOW(),
              updated_at = NOW(),
              updated_by = ?
        WHERE id = ?`,
      [actorUserId || null, procurementId]
    );

    await writeAuditLog(conn, {
      actorUserId,
      action: "ALERT_TRIGGER_SANDING_TIMEOUT",
      entityType: "ALERT",
      entityId: alertId,
      afterData: {
        procurementId,
        elapsed,
        plannedDuration: row.planned_duration_min,
        triggerMode: "AUTO_OR_MANUAL_CHECK"
      }
    });
  }

  return { triggered: true, createdNew, alertId, elapsed };
}

router.get("/ships/options", async (_req, res, next) => {
  try {
    const [rows] = await pool.query(
      `SELECT id, ship_name, mmsi, status
         FROM ships
        WHERE is_void = 0 AND status <> 'DISABLED'
        ORDER BY ship_name ASC
        LIMIT 200`
    );
    res.json({ items: rows });
  } catch (error) {
    next(error);
  }
});

router.get("/buyer-accounts/options", async (_req, res, next) => {
  try {
    const [rows] = await pool.query(
      `SELECT id, buyer_name, available_balance, frozen_balance, status
         FROM buyer_accounts
        WHERE is_void = 0 AND status = 'ACTIVE'
        ORDER BY buyer_name ASC
        LIMIT 200`
    );
    res.json({ items: rows });
  } catch (error) {
    next(error);
  }
});

router.get("/suppliers/options", async (_req, res, next) => {
  try {
    const [rows] = await pool.query(
      `SELECT id, buyer_name, available_balance, frozen_balance, status
         FROM buyer_accounts
        WHERE is_void = 0
          AND status = 'ACTIVE'
        ORDER BY buyer_name ASC
        LIMIT 200`
    );
    res.json({
      items: rows.map((row) => ({
        id: row.id,
        supplier_name: row.buyer_name,
        available_balance: row.available_balance,
        frozen_balance: row.frozen_balance,
        status: row.status
      }))
    });
  } catch (error) {
    next(error);
  }
});

router.post("/", async (req, res, next) => {
  try {
    ensureRole(req, MANAGE_ROLES);

    const {
      procurementNo,
      supplierId,
      buyerAccountId,
      supplierName,
      buyerName,
      plannedQty,
      unitPrice,
      plannedDurationMin,
      shipId,
      miningTicket,
      miningTicketUrl = null,
      qualityPhotos = [],
      qualityPhotoUrls = []
    } = req.body || {};

    const resolvedSupplierId = Number(supplierId || buyerAccountId || 0);
    if (!resolvedSupplierId || !shipId || !plannedQty || !unitPrice || !plannedDurationMin) {
      return res.status(400).json({ message: "Missing required fields." });
    }

    const totalAmount = Number(plannedQty) * Number(unitPrice);
    if (Number.isNaN(totalAmount) || totalAmount <= 0) {
      return res.status(400).json({ message: "Invalid amount." });
    }

    const plannedQtyNum = Number(plannedQty);
    const plannedDurationNum = Number(plannedDurationMin);
    const unitPriceNum = Number(unitPrice);
    if (!Number.isFinite(plannedQtyNum) || plannedQtyNum <= 0) {
      return res.status(400).json({ message: "planned_qty must be positive." });
    }
    if (!Number.isFinite(plannedDurationNum) || plannedDurationNum <= 0) {
      return res.status(400).json({ message: "planned_duration_min must be positive." });
    }

    const attachments = buildAttachmentPayload({
      miningTicket,
      miningTicketUrl,
      qualityPhotos,
      qualityPhotoUrls
    });

    const result = await withTransaction(async (conn) => {
      const actorUserId = await resolveActorUserId(conn, req.user.id);

      const [accountRows] = await conn.query(
        `SELECT id, buyer_name, available_balance, frozen_balance
           FROM buyer_accounts
          WHERE id = ? AND is_void = 0 AND status = 'ACTIVE'
          FOR UPDATE`,
        [resolvedSupplierId]
      );
      if (!accountRows.length) {
        const err = new Error("Supplier account not found.");
        err.status = 400;
        throw err;
      }

      const account = accountRows[0];
      if (Number(account.available_balance) < totalAmount) {
        const err = new Error("Insufficient balance.");
        err.status = 400;
        throw err;
      }

      const [shipRows] = await conn.query(
        `SELECT id, ship_name
           FROM ships
          WHERE id = ?
            AND is_void = 0
            AND status <> 'DISABLED'
          LIMIT 1
          FOR UPDATE`,
        [shipId]
      );
      if (!shipRows.length) {
        const err = new Error("Ship not found or disabled.");
        err.status = 400;
        throw err;
      }

      const purchaseNo = sanitizeText(procurementNo, 64) || `PR-${Date.now()}`;
      const finalSupplierName = sanitizeText(supplierName || buyerName || account.buyer_name, 128) || account.buyer_name;
      const [insertProc] = await conn.query(
        `INSERT INTO procurements
          (procurement_no, buyer_account_id, supplier_id, buyer_name, ship_id, dispatcher_user_id, planned_qty, unit_price, total_amount,
           mining_ticket, quality_photos, planned_duration_min, mining_ticket_url, quality_photo_urls, status, submitted_at,
           created_at, updated_at, created_by, updated_by, is_void)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'DISPATCHED', NOW(), NOW(), NOW(), ?, ?, 0)`,
        [
          purchaseNo,
          resolvedSupplierId,
          resolvedSupplierId,
          finalSupplierName,
          shipId,
          actorUserId,
          plannedQtyNum,
          unitPriceNum,
          totalAmount,
          attachments.miningTicket,
          JSON.stringify(attachments.qualityPhotos),
          plannedDurationNum,
          attachments.miningTicket,
          JSON.stringify(attachments.qualityPhotos),
          actorUserId,
          actorUserId
        ]
      );

      const procurementId = insertProc.insertId;
      const voyageNo = await generateVoyageNo(conn);

      await conn.query(
        `INSERT INTO voyages
          (voyage_no, ship_id, procurement_id, status, started_at, created_at, updated_at, created_by, updated_by, is_void)
         VALUES (?, ?, ?, 'IN_PROGRESS', NOW(), NOW(), NOW(), ?, ?, 0)`,
        [voyageNo, shipId, procurementId, actorUserId, actorUserId]
      );

      await conn.query(
        `UPDATE buyer_accounts
            SET available_balance = available_balance - ?,
                frozen_balance = frozen_balance + ?,
                updated_at = NOW(),
                updated_by = ?
          WHERE id = ?`,
        [totalAmount, totalAmount, actorUserId, resolvedSupplierId]
      );

      await writeAuditLog(conn, {
        actorUserId,
        action: "PROCUREMENT_CREATE_AND_DISPATCH",
        entityType: "PROCUREMENT",
        entityId: procurementId,
        afterData: {
          voyageNo,
          shipId,
          supplierId: resolvedSupplierId,
          supplierName: finalSupplierName,
          totalAmount
        }
      });

      return { procurementId, voyageNo, shipId, supplierId: resolvedSupplierId };
    });

    res.json({
      message: "Procurement created and voyage auto-generated.",
      procurementId: result.procurementId,
      voyageNo: result.voyageNo,
      shipId: result.shipId,
      supplierId: result.supplierId
    });
  } catch (error) {
    next(error);
  }
});

router.get("/", async (req, res, next) => {
  try {
    ensureRole(req, ACCESS_ROLES);

    // Auto trigger sanding-timeout alerts before list query.
    await withTransaction(async (conn) => {
      const [overtimeRows] = await conn.query(
        `SELECT id
           FROM procurements
          WHERE is_void = 0
            AND status = 'SANDING'
            AND sand_start_time IS NOT NULL
            AND planned_duration_min IS NOT NULL
            AND TIMESTAMPDIFF(MINUTE, sand_start_time, NOW()) > planned_duration_min
          LIMIT 200
          FOR UPDATE`
      );

      for (const row of overtimeRows) {
        await triggerSandingTimeoutAlert(conn, row.id, req.user.id);
      }
    });

    const { keyword = "", status = "" } = req.query || {};
    const params = [];
    const where = ["p.is_void = 0"];

    if (keyword) {
      where.push("(p.procurement_no LIKE ? OR s.ship_name LIKE ? OR v.voyage_no LIKE ?)");
      params.push(`%${keyword}%`, `%${keyword}%`, `%${keyword}%`);
    }
    if (status) {
      where.push("p.status = ?");
      params.push(status);
    }

    const [rows] = await pool.query(
      `SELECT
         p.id,
         p.procurement_no,
         p.ship_id,
         p.supplier_id,
         p.buyer_name AS supplier_name,
         p.planned_qty,
         p.planned_duration_min,
         p.status,
         p.sand_start_time,
         p.created_at,
         p.updated_at,
         s.ship_name,
         v.voyage_no,
         CASE
           WHEN p.sand_start_time IS NULL THEN 0
           ELSE TIMESTAMPDIFF(MINUTE, p.sand_start_time, NOW())
         END AS work_duration_min,
         a.id AS alert_id,
         a.status AS alert_status,
         CASE
           WHEN p.status = 'DISPATCHED' THEN '开始打沙'
           WHEN p.status = 'SANDING' AND a.id IS NOT NULL AND a.status <> 'CLOSED' THEN '处理预警'
           WHEN p.status = 'SANDING' THEN '检测超时'
           ELSE '查看详情'
         END AS next_action
       FROM procurements p
       LEFT JOIN voyages v ON v.procurement_id = p.id AND v.is_void = 0
       LEFT JOIN ships s ON s.id = COALESCE(p.ship_id, v.ship_id) AND s.is_void = 0
       LEFT JOIN alerts a
         ON a.related_entity_type = 'PROCUREMENT'
        AND a.related_entity_id = p.id
        AND a.alert_type = 'SANDING_TIMEOUT'
        AND a.is_void = 0
       WHERE ${where.join(" AND ")}
       ORDER BY p.created_at DESC
       LIMIT 200`,
      params
    );

    res.json({
      items: rows.map((row) => ({
        ...row,
        procurementId: row.id,
        procurementNo: row.procurement_no,
        shipId: row.ship_id,
        supplierId: row.supplier_id,
        supplierName: row.supplier_name,
        plannedQty: row.planned_qty,
        plannedDurationMin: row.planned_duration_min,
        shipName: row.ship_name || "",
        voyageNo: row.voyage_no || ""
      }))
    });
  } catch (error) {
    next(error);
  }
});

router.get("/:id", async (req, res, next) => {
  try {
    ensureRole(req, ACCESS_ROLES);
    const id = Number(req.params.id);
    if (!id) {
      return res.status(400).json({ message: "Invalid id." });
    }

    // Auto trigger timeout alert on detail view if already overtime.
    await withTransaction(async (conn) => {
      await triggerSandingTimeoutAlert(conn, id, req.user.id);
    });

    const [detailRows] = await pool.query(
      `SELECT
         p.*,
         v.id AS voyage_id,
         v.voyage_no,
         v.status AS voyage_status,
         v.locked_at AS voyage_locked_at,
         v.started_at AS voyage_started_at,
         s.ship_name,
         s.mmsi
       FROM procurements p
       LEFT JOIN voyages v ON v.procurement_id = p.id AND v.is_void = 0
       LEFT JOIN ships s ON s.id = COALESCE(p.ship_id, v.ship_id) AND s.is_void = 0
      WHERE p.id = ? AND p.is_void = 0`,
      [id]
    );
    if (!detailRows.length) {
      return res.status(404).json({ message: "Procurement not found." });
    }
    if (!canViewFinancial(req.user.roleCode)) {
      detailRows[0].unit_price = null;
      detailRows[0].total_amount = null;
    }

    const [alertRows, auditRows, timeoutExpenseRows] = await Promise.all([
      pool.query(
        `SELECT id, alert_type, stage_code, status, triggered_at, handled_at, handle_note
           FROM alerts
          WHERE related_entity_type = 'PROCUREMENT'
            AND related_entity_id = ?
            AND is_void = 0
          ORDER BY created_at DESC`,
        [id]
      ),
      pool.query(
        `SELECT id, action, event_time, actor_user_id, before_data, after_data
           FROM audit_logs
          WHERE entity_type IN ('PROCUREMENT', 'ALERT', 'EXPENSE')
            AND (entity_id = ? OR entity_id IN (
                  SELECT id FROM alerts WHERE related_entity_type = 'PROCUREMENT' AND related_entity_id = ? AND is_void = 0
                ) OR entity_id IN (
                  SELECT id FROM expenses
                   WHERE is_void = 0
                     AND (procurement_id = ?
                          OR source_alert_id IN (
                            SELECT id FROM alerts
                             WHERE related_entity_type = 'PROCUREMENT'
                               AND related_entity_id = ?
                               AND is_void = 0
                          ))
                ))
            AND is_void = 0
          ORDER BY event_time DESC
          LIMIT 300`,
        [id, id, id, id]
      ),
      pool.query(
        `SELECT
           e.id,
           e.expense_no,
           e.voyage_id,
           e.procurement_id,
           e.source_alert_id,
           e.expense_type,
           e.amount,
           e.status,
           e.overtime_minutes,
           e.overtime_hours,
           e.overtime_rate,
           e.calculation_formula,
           e.calculation_note,
           e.remark,
           e.occurred_at,
           e.created_at,
           e.updated_at
         FROM expenses e
         WHERE e.is_void = 0
           AND e.expense_type = 'SANDING_OVERTIME'
           AND (e.procurement_id = ?
                OR e.source_alert_id IN (
                  SELECT id FROM alerts
                  WHERE related_entity_type = 'PROCUREMENT'
                    AND related_entity_id = ?
                    AND alert_type = 'SANDING_TIMEOUT'
                    AND is_void = 0
                ))
         ORDER BY e.created_at DESC
         LIMIT 50`,
        [id, id]
      )
    ]);

    const detail = detailRows[0];
    const qualityPhotos = parseJsonArray(detail.quality_photos || detail.quality_photo_urls);
    const miningTicket = detail.mining_ticket || detail.mining_ticket_url || null;
    detail.quality_photos = qualityPhotos;
    detail.quality_photo_urls = qualityPhotos;
    detail.mining_ticket = miningTicket;
    detail.mining_ticket_url = miningTicket;
    detail.supplier_name = detail.buyer_name || "";
    detail.supplier_id = detail.supplier_id || detail.buyer_account_id || null;

    const alerts = alertRows[0] || [];
    const timeoutExpenses = (timeoutExpenseRows[0] || []).map((row) => ({
      id: row.id,
      expenseNo: row.expense_no,
      voyageId: row.voyage_id,
      procurementId: row.procurement_id,
      sourceAlertId: row.source_alert_id,
      expenseType: row.expense_type,
      amount: Number(row.amount || 0),
      status: row.status,
      overtimeMinutes: Number(row.overtime_minutes || 0),
      overtimeHours: Number(row.overtime_hours || 0),
      overtimeRate: row.overtime_rate == null ? null : Number(row.overtime_rate),
      calculationFormula: row.calculation_formula || "",
      calculationNote: row.calculation_note || "",
      remark: row.remark || "",
      occurredAt: row.occurred_at,
      createdAt: row.created_at,
      updatedAt: row.updated_at
    }));

    const latestTimeoutAlert = alerts.find((x) => x.alert_type === "SANDING_TIMEOUT") || null;
    const latestTimeoutExpense = timeoutExpenses.length ? timeoutExpenses[0] : null;
    const elapsedMinutes = detail.sand_start_time
      ? Math.max(0, Math.floor((Date.now() - new Date(detail.sand_start_time).getTime()) / 60000))
      : 0;
    const overtime = computeOvertimeMetrics(elapsedMinutes, Number(detail.planned_duration_min || 0));

    res.json({
      detail,
      alerts,
      audits: auditRows[0] || [],
      timeout: {
        isOvertime: overtime.isOvertime,
        plannedDurationMin: overtime.plannedDurationMin,
        elapsedMinutes: overtime.elapsedMinutes,
        overtimeMinutes: overtime.overtimeMinutes,
        overtimeHours: overtime.overtimeHours,
        hasOpenAlert: Boolean(latestTimeoutAlert && latestTimeoutAlert.status !== "CLOSED"),
        alertId: latestTimeoutAlert ? latestTimeoutAlert.id : null,
        alertStatus: latestTimeoutAlert ? latestTimeoutAlert.status : "",
        alertTriggeredAt: latestTimeoutAlert ? latestTimeoutAlert.triggered_at : null,
        handledAt: latestTimeoutAlert ? latestTimeoutAlert.handled_at : null,
        handleNote: latestTimeoutAlert ? latestTimeoutAlert.handle_note : "",
        hasOvertimeExpense: Boolean(latestTimeoutExpense),
        latestExpense: latestTimeoutExpense
      },
      timeoutExpenses
    });
  } catch (error) {
    next(error);
  }
});

router.post("/:id/start-sanding", async (req, res, next) => {
  try {
    ensureRole(req, MANAGE_ROLES);
    const procurementId = Number(req.params.id);
    if (!procurementId) {
      return res.status(400).json({ message: "Invalid id." });
    }

    const result = await withTransaction(async (conn) => {
      const actorUserId = await resolveActorUserId(conn, req.user.id);
      const [rows] = await conn.query(
        `SELECT id, procurement_no, status, mining_ticket, quality_photos, mining_ticket_url, quality_photo_urls, sand_start_time
           FROM procurements
          WHERE id = ? AND is_void = 0
          FOR UPDATE`,
        [procurementId]
      );
      if (!rows.length) {
        const err = new Error("Procurement not found.");
        err.status = 404;
        throw err;
      }
      const row = rows[0];

      const incomingAttachments = buildAttachmentPayload(req.body || {});
      const mergedQualityPhotos = Array.from(new Set([
        ...parseJsonArray(row.quality_photos || row.quality_photo_urls),
        ...parseJsonArray(incomingAttachments.qualityPhotos)
      ].map((x) => sanitizeText(x, 512)).filter(Boolean)));
      const mergedMiningTicket = sanitizeText(
        incomingAttachments.miningTicket || row.mining_ticket || row.mining_ticket_url,
        512
      ) || null;

      if (!mergedMiningTicket || !mergedQualityPhotos.length) {
        const err = new Error("开始打砂前请先上传采砂单和至少1张质量照片。");
        err.status = 400;
        throw err;
      }

      if (row.sand_start_time) {
        return { alreadyStarted: true, sandStartTime: row.sand_start_time };
      }

      await conn.query(
        `UPDATE procurements
            SET status = 'SANDING',
                sand_start_time = NOW(),
                sand_started_by = ?,
                mining_ticket = ?,
                quality_photos = ?,
                mining_ticket_url = ?,
                quality_photo_urls = ?,
                updated_at = NOW(),
                updated_by = ?
          WHERE id = ?`,
        [
          actorUserId,
          mergedMiningTicket,
          JSON.stringify(mergedQualityPhotos),
          mergedMiningTicket,
          JSON.stringify(mergedQualityPhotos),
          actorUserId,
          procurementId
        ]
      );

      await writeAuditLog(conn, {
        actorUserId,
        action: "PROCUREMENT_START_SANDING",
        entityType: "PROCUREMENT",
        entityId: procurementId,
        afterData: {
          status: "SANDING",
          miningTicket: mergedMiningTicket,
          qualityPhotoCount: mergedQualityPhotos.length
        }
      });

      return { alreadyStarted: false };
    });

    res.json({
      message: result.alreadyStarted ? "Sanding already started." : "Sanding started.",
      ...result
    });
  } catch (error) {
    next(error);
  }
});

router.post("/:id/check-timeout", async (req, res, next) => {
  try {
    ensureRole(req, ["SUPER_ADMIN", "DISPATCHER", "ONSITE_SPECIALIST"]);
    const procurementId = Number(req.params.id);
    if (!procurementId) {
      return res.status(400).json({ message: "Invalid id." });
    }

    const result = await withTransaction(async (conn) => {
      const actorUserId = await resolveActorUserId(conn, req.user.id);
      return triggerSandingTimeoutAlert(conn, procurementId, actorUserId);
    });
    if (result.reason === "Procurement not found.") {
      return res.status(404).json({ message: "Procurement not found." });
    }

    res.json(result);
  } catch (error) {
    next(error);
  }
});

router.post("/:id/handle-timeout", async (req, res, next) => {
  try {
    ensureRole(req, TIMEOUT_HANDLE_ROLES);
    const procurementId = Number(req.params.id || 0);
    if (!procurementId) {
      return res.status(400).json({ message: "Invalid id." });
    }

    const handlingNote = sanitizeText((req.body || {}).handlingNote, 500);
    if (!handlingNote) {
      return res.status(400).json({ message: "handlingNote is required." });
    }

    const calcMode = normalizeCalcMode((req.body || {}).calcMode);
    const ratePerHourInput = (req.body || {}).ratePerHour;
    const manualAmountInput = (req.body || {}).manualAmount;
    const calculationNoteInput = sanitizeText((req.body || {}).calculationNote, 500);
    const voucherUrls = parseJsonArray((req.body || {}).voucherUrls).map((x) => sanitizeText(x, 512)).filter(Boolean);
    const occurredAtRaw = (req.body || {}).occurredAt;
    const occurredAt = occurredAtRaw ? new Date(occurredAtRaw) : new Date();
    const effectiveOccurredAt = Number.isNaN(occurredAt.getTime()) ? new Date() : occurredAt;

    const result = await withTransaction(async (conn) => {
      const actorUserId = await resolveRequiredActorUserId(conn, req.user.id);
      const requesterUserId = actorUserId;
      const timeoutContext = await getSandingTimeoutContext(conn, procurementId, true);
      if (!timeoutContext.isOvertime) {
        const err = new Error("Current sanding process is not overtime.");
        err.status = 409;
        throw err;
      }

      await triggerSandingTimeoutAlert(conn, procurementId, actorUserId);
      const alert = await getLatestSandingTimeoutAlert(conn, procurementId, true);
      if (!alert) {
        const err = new Error("Sanding timeout alert not found.");
        err.status = 404;
        throw err;
      }

      const [existingExpenseRows] = await conn.query(
        `SELECT
           id,
           expense_no,
           status,
           amount,
           overtime_minutes,
           overtime_hours,
           overtime_rate,
           calculation_formula,
           calculation_note,
           occurred_at
         FROM expenses
         WHERE source_alert_id = ?
           AND expense_type = 'SANDING_OVERTIME'
           AND is_void = 0
         LIMIT 1
         FOR UPDATE`,
        [alert.id]
      );

      if (existingExpenseRows.length) {
        const existing = existingExpenseRows[0];
        if (alert.status !== "CLOSED") {
          await conn.query(
            `UPDATE alerts
                SET status = 'CLOSED',
                    handled_by = ?,
                    closed_by = ?,
                    handled_at = COALESCE(handled_at, NOW()),
                    closed_at = COALESCE(closed_at, NOW()),
                    handle_note = ?,
                    updated_at = NOW(),
                    updated_by = ?
              WHERE id = ?`,
            [actorUserId, actorUserId, handlingNote, actorUserId, alert.id]
          );
        }
        return {
          alreadyHandled: true,
          alertId: alert.id,
          expense: {
            id: existing.id,
            expenseNo: existing.expense_no,
            status: existing.status,
            amount: Number(existing.amount || 0),
            overtimeMinutes: Number(existing.overtime_minutes || 0),
            overtimeHours: Number(existing.overtime_hours || 0),
            overtimeRate: existing.overtime_rate == null ? null : Number(existing.overtime_rate),
            calculationFormula: existing.calculation_formula || "",
            calculationNote: existing.calculation_note || "",
            occurredAt: existing.occurred_at
          }
        };
      }

      const calc = calculateOvertimeExpense({
        overtimeMinutes: timeoutContext.overtimeMinutes,
        calcMode,
        ratePerHour: ratePerHourInput,
        manualAmount: manualAmountInput,
        defaultRatePerHour: DEFAULT_SANDING_OVERTIME_RATE
      });

      if (calcMode !== "MANUAL" && calc.amount <= 0) {
        const err = new Error("Calculated overtime amount must be greater than zero.");
        err.status = 400;
        throw err;
      }

      const expenseNo = generateNo("EXP");
      const expenseStatus = timeoutContext.voyage_status === "LOCKED" ? "DRAFT" : "CONFIRMED";
      const effectiveCalculationNote = calculationNoteInput || calc.note || "";

      const [insertResult] = await conn.query(
        `INSERT INTO expenses
          (expense_no, voyage_id, procurement_id, source_alert_id, expense_type, amount,
           overtime_minutes, overtime_hours, overtime_rate, calculation_formula, calculation_note, remark,
           occurred_at, voucher_urls, status, source_module, entered_by, created_at, updated_at, created_by, updated_by, is_void)
         VALUES (?, ?, ?, ?, 'SANDING_OVERTIME', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'PROCUREMENT_TIMEOUT', ?, NOW(), NOW(), ?, ?, 0)`,
        [
          expenseNo,
          timeoutContext.voyage_id,
          procurementId,
          alert.id,
          calc.amount,
          calc.overtimeMinutes,
          calc.overtimeHours,
          calc.ratePerHour,
          calc.formula,
          effectiveCalculationNote,
          handlingNote,
          effectiveOccurredAt,
          JSON.stringify(voucherUrls),
          expenseStatus,
          actorUserId,
          actorUserId,
          actorUserId
        ]
      );

      const expenseId = insertResult.insertId;
      let approval = null;
      let revision = null;

      await writeAuditLog(conn, {
        actorUserId,
        action: "SANDING_TIMEOUT_EXPENSE_CREATED",
        entityType: "EXPENSE",
        entityId: expenseId,
        afterData: {
          procurementId,
          voyageId: timeoutContext.voyage_id,
          alertId: alert.id,
          overtimeMinutes: calc.overtimeMinutes,
          overtimeHours: calc.overtimeHours,
          amount: calc.amount,
          expenseNo
        }
      });

      if (timeoutContext.voyage_status === "LOCKED") {
        revision = await createSettlementRevision(conn, timeoutContext.voyage_id, actorUserId, {
          deltaExpense: calc.amount
        });
        approval = await createApproval(conn, {
          approvalType: "EXPENSE_ADJUST",
          targetEntityType: "EXPENSE",
          targetEntityId: expenseId,
          requestedBy: requesterUserId,
          reason: handlingNote,
          beforeSnapshot: {
            voyageId: timeoutContext.voyage_id,
            voyageNo: timeoutContext.voyage_no,
            procurementId,
            procurementNo: timeoutContext.procurement_no,
            expenseStatus: "NONE"
          },
          afterSnapshot: {
            expenseId,
            expenseNo,
            voyageId: timeoutContext.voyage_id,
            voyageNo: timeoutContext.voyage_no,
            procurementId,
            overtimeMinutes: calc.overtimeMinutes,
            overtimeHours: calc.overtimeHours,
            amount: calc.amount,
            expenseType: "SANDING_OVERTIME",
            expenseStatus
          }
        });

        await writeAuditLog(conn, {
          actorUserId,
          action: "LOCKED_SANDING_TIMEOUT_EXPENSE_SUBMIT_APPROVAL",
          entityType: "APPROVAL",
          entityId: approval.approvalId,
          afterData: {
            procurementId,
            voyageId: timeoutContext.voyage_id,
            expenseId,
            settlementVersionId: revision.settlementVersionId,
            settlementVersionNo: revision.versionNo
          }
        });
      }

      await conn.query(
        `UPDATE alerts
            SET status = 'CLOSED',
                handled_by = ?,
                closed_by = ?,
                handled_at = NOW(),
                closed_at = NOW(),
                handle_note = ?,
                updated_at = NOW(),
                updated_by = ?
          WHERE id = ?`,
        [actorUserId, actorUserId, handlingNote, actorUserId, alert.id]
      );

      await writeAuditLog(conn, {
        actorUserId,
        action: "ALERT_CLOSE_WITH_TIMEOUT_EXPENSE",
        entityType: "ALERT",
        entityId: alert.id,
        beforeData: { status: alert.status },
        afterData: {
          status: "CLOSED",
          procurementId,
          expenseId,
          handleNote: handlingNote
        }
      });

      await writeAuditLog(conn, {
        actorUserId,
        action: "PROCUREMENT_TIMEOUT_HANDLED",
        entityType: "PROCUREMENT",
        entityId: procurementId,
        afterData: {
          alertId: alert.id,
          expenseId,
          overtimeMinutes: calc.overtimeMinutes,
          overtimeHours: calc.overtimeHours,
          amount: calc.amount
        }
      });

      return {
        alreadyHandled: false,
        alertId: alert.id,
        overtimeMinutes: calc.overtimeMinutes,
        overtimeHours: calc.overtimeHours,
        expense: {
          id: expenseId,
          expenseNo,
          status: expenseStatus,
          amount: calc.amount,
          overtimeRate: calc.ratePerHour,
          calculationFormula: calc.formula,
          calculationNote: effectiveCalculationNote
        },
        approval,
        revision
      };
    });

    res.json({
      message: result.alreadyHandled
        ? "Overtime handling already exists."
        : (result.approval
          ? "Overtime expense saved and submitted for approval."
          : "Overtime expense saved and alert closed."),
      ...result
    });
  } catch (error) {
    next(error);
  }
});

module.exports = router;
