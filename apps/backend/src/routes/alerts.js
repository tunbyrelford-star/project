const express = require("express");
const { withTransaction } = require("../db");

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

