const express = require("express");
const { pool, withTransaction } = require("../db");

const router = express.Router();

const FINANCIAL_ROLES = ["SUPER_ADMIN", "FINANCE_MGMT"];
const ACCESS_ROLES = ["SUPER_ADMIN", "DISPATCHER", "ONSITE_SPECIALIST", "SALES", "FINANCE_MGMT"];
const MANAGE_ROLES = ["SUPER_ADMIN", "DISPATCHER"];

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

    const [alertRows] = await pool.query(
      `SELECT id, alert_type, stage_code, status, triggered_at, handled_at, handle_note
         FROM alerts
        WHERE related_entity_type = 'PROCUREMENT'
          AND related_entity_id = ?
          AND is_void = 0
        ORDER BY created_at DESC`,
      [id]
    );

    const [auditRows] = await pool.query(
      `SELECT id, action, event_time, actor_user_id, before_data, after_data
         FROM audit_logs
        WHERE entity_type IN ('PROCUREMENT', 'ALERT')
          AND (entity_id = ? OR entity_id IN (
                SELECT id FROM alerts WHERE related_entity_type = 'PROCUREMENT' AND related_entity_id = ? AND is_void = 0
              ))
          AND is_void = 0
        ORDER BY event_time DESC
        LIMIT 300`,
      [id, id]
    );

    const detail = detailRows[0];
    const qualityPhotos = parseJsonArray(detail.quality_photos || detail.quality_photo_urls);
    const miningTicket = detail.mining_ticket || detail.mining_ticket_url || null;
    detail.quality_photos = qualityPhotos;
    detail.quality_photo_urls = qualityPhotos;
    detail.mining_ticket = miningTicket;
    detail.mining_ticket_url = miningTicket;
    detail.supplier_name = detail.buyer_name || "";
    detail.supplier_id = detail.supplier_id || detail.buyer_account_id || null;

    res.json({
      detail,
      alerts: alertRows,
      audits: auditRows
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

module.exports = router;
