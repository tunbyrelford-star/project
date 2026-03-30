const express = require("express");
const { pool, withTransaction } = require("../db");

const router = express.Router();

function ensureRole(req, allowedRoles) {
  if (!allowedRoles.includes(req.user.roleCode)) {
    const err = new Error("Permission denied");
    err.status = 403;
    throw err;
  }
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

router.get("/", async (req, res, next) => {
  try {
    ensureRole(req, ["SUPER_ADMIN", "DISPATCHER", "ONSITE_SPECIALIST", "FINANCE_MGMT"]);

    const status = String((req.query || {}).status || "").trim().toUpperCase();
    const alertType = String((req.query || {}).alertType || "").trim().toUpperCase();
    const relatedEntityType = String((req.query || {}).relatedEntityType || "").trim().toUpperCase();
    const relatedEntityId = Number((req.query || {}).relatedEntityId || 0);
    const where = ["a.is_void = 0"];
    const params = [];

    if (status) {
      where.push("a.status = ?");
      params.push(status);
    }
    if (alertType) {
      where.push("a.alert_type = ?");
      params.push(alertType);
    }
    if (relatedEntityType) {
      where.push("a.related_entity_type = ?");
      params.push(relatedEntityType);
    }
    if (relatedEntityId) {
      where.push("a.related_entity_id = ?");
      params.push(relatedEntityId);
    }

    const [rows] = await pool.query(
      `SELECT
         a.id,
         a.alert_no,
         a.alert_type,
         a.stage_code,
         a.related_entity_type,
         a.related_entity_id,
         a.severity,
         a.status,
         a.triggered_at,
         a.handled_by,
         a.handled_at,
         a.handle_note,
         a.closed_at,
         p.procurement_no,
         v.id AS voyage_id,
         v.voyage_no,
         s.ship_name,
         e.id AS overtime_expense_id,
         e.expense_no AS overtime_expense_no,
         e.amount AS overtime_expense_amount,
         e.status AS overtime_expense_status,
         e.overtime_minutes,
         e.overtime_hours,
         e.overtime_rate,
         e.calculation_formula,
         e.calculation_note,
         e.remark AS overtime_remark
       FROM alerts a
       LEFT JOIN procurements p
         ON a.related_entity_type = 'PROCUREMENT'
        AND p.id = a.related_entity_id
        AND p.is_void = 0
       LEFT JOIN voyages v
         ON (
              (a.related_entity_type = 'VOYAGE' AND v.id = a.related_entity_id)
              OR
              (a.related_entity_type = 'PROCUREMENT' AND v.procurement_id = p.id)
            )
        AND v.is_void = 0
       LEFT JOIN ships s ON s.id = v.ship_id AND s.is_void = 0
       LEFT JOIN expenses e
         ON e.source_alert_id = a.id
        AND e.expense_type = 'SANDING_OVERTIME'
        AND e.is_void = 0
      WHERE ${where.join(" AND ")}
      ORDER BY a.created_at DESC
      LIMIT 300`,
      params
    );

    res.json({
      items: rows.map((row) => ({
        id: row.id,
        alertNo: row.alert_no,
        alertType: row.alert_type,
        stageCode: row.stage_code || "",
        relatedEntityType: row.related_entity_type,
        relatedEntityId: row.related_entity_id,
        severity: row.severity,
        status: row.status,
        triggeredAt: row.triggered_at,
        handledBy: row.handled_by,
        handledAt: row.handled_at,
        handleNote: row.handle_note || "",
        closedAt: row.closed_at,
        procurementNo: row.procurement_no || "",
        voyageId: row.voyage_id || null,
        voyageNo: row.voyage_no || "",
        shipName: row.ship_name || "",
        overtimeExpense: row.overtime_expense_id ? {
          id: row.overtime_expense_id,
          expenseNo: row.overtime_expense_no,
          amount: Number(row.overtime_expense_amount || 0),
          status: row.overtime_expense_status || "",
          overtimeMinutes: Number(row.overtime_minutes || 0),
          overtimeHours: Number(row.overtime_hours || 0),
          overtimeRate: row.overtime_rate == null ? null : Number(row.overtime_rate),
          calculationFormula: row.calculation_formula || "",
          calculationNote: row.calculation_note || "",
          remark: row.overtime_remark || ""
        } : null
      }))
    });
  } catch (error) {
    next(error);
  }
});

router.post("/:id/close", async (req, res, next) => {
  try {
    ensureRole(req, ["SUPER_ADMIN", "DISPATCHER", "ONSITE_SPECIALIST", "FINANCE_MGMT"]);

    const alertId = Number(req.params.id);
    const { handleNote } = req.body || {};
    if (!alertId || !handleNote) {
      return res.status(400).json({ message: "alert id and handleNote are required." });
    }

    const result = await withTransaction(async (conn) => {
      const [rows] = await conn.query(
        `SELECT id, status, handle_note
           FROM alerts
          WHERE id = ? AND is_void = 0
          FOR UPDATE`,
        [alertId]
      );
      if (!rows.length) {
        const err = new Error("Alert not found.");
        err.status = 404;
        throw err;
      }
      const old = rows[0];
      if (old.status === "CLOSED") {
        return { alreadyClosed: true };
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
        [req.user.id, req.user.id, handleNote, req.user.id, alertId]
      );

      await writeAuditLog(conn, {
        actorUserId: req.user.id,
        action: "ALERT_CLOSE",
        entityType: "ALERT",
        entityId: alertId,
        beforeData: { status: old.status, handleNote: old.handle_note },
        afterData: { status: "CLOSED", handleNote }
      });

      return { alreadyClosed: false };
    });

    res.json({ message: result.alreadyClosed ? "Alert already closed." : "Alert closed." });
  } catch (error) {
    next(error);
  }
});

module.exports = router;
