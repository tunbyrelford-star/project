const express = require("express");
const { pool } = require("../db");

const router = express.Router();

const ACCESS_ROLES = ["SUPER_ADMIN", "DISPATCHER", "ONSITE_SPECIALIST", "SALES", "FINANCE_MGMT"];

function ensureRole(req, allowedRoles) {
  if (!allowedRoles.includes(req.user.roleCode)) {
    const err = new Error("Permission denied");
    err.status = 403;
    throw err;
  }
}

function toNum(value, fallback = 0) {
  const num = Number(value);
  return Number.isFinite(num) ? num : fallback;
}

router.get("/:id", async (req, res, next) => {
  try {
    ensureRole(req, ACCESS_ROLES);

    const voyageId = Number(req.params.id || 0);
    if (!voyageId) {
      return res.status(400).json({ message: "Invalid voyage id." });
    }

    const [rows] = await pool.query(
      `SELECT
         v.id,
         v.voyage_no,
         v.procurement_id,
         v.ship_id,
         v.status,
         v.started_at,
         v.locked_at,
         v.completed_at,
         v.created_at,
         v.updated_at,
         p.procurement_no,
         p.status AS procurement_status,
         p.supplier_id,
         p.buyer_name AS supplier_name,
         p.planned_qty,
         p.planned_duration_min,
         s.ship_name,
         s.mmsi,
         s.ship_type,
         s.tonnage
       FROM voyages v
       LEFT JOIN procurements p ON p.id = v.procurement_id AND p.is_void = 0
       LEFT JOIN ships s ON s.id = v.ship_id AND s.is_void = 0
      WHERE v.id = ?
        AND v.is_void = 0
      LIMIT 1`,
      [voyageId]
    );

    if (!rows.length) {
      return res.status(404).json({ message: "Voyage not found." });
    }

    const [expenseRows, batchRows] = await Promise.all([
      pool.query(
        `SELECT
           COALESCE(SUM(amount), 0) AS total_expense,
           COUNT(*) AS expense_count
         FROM expenses
        WHERE voyage_id = ?
          AND is_void = 0
          AND status = 'CONFIRMED'`,
        [voyageId]
      ),
      pool.query(
        `SELECT
           COUNT(*) AS batch_count,
           COALESCE(SUM(available_qty), 0) AS total_available_qty
         FROM inventory_batches
        WHERE voyage_id = ?
          AND is_void = 0`,
        [voyageId]
      )
    ]);

    const row = rows[0];
    res.json({
      detail: {
        id: row.id,
        voyageNo: row.voyage_no,
        procurementId: row.procurement_id,
        procurementNo: row.procurement_no || "",
        procurementStatus: row.procurement_status || "",
        shipId: row.ship_id,
        shipName: row.ship_name || "",
        mmsi: row.mmsi || "",
        shipType: row.ship_type || "",
        tonnage: row.tonnage == null ? null : toNum(row.tonnage),
        supplierId: row.supplier_id || null,
        supplierName: row.supplier_name || "",
        plannedQty: row.planned_qty == null ? null : toNum(row.planned_qty),
        plannedDurationMin: row.planned_duration_min == null ? null : toNum(row.planned_duration_min),
        status: row.status,
        startedAt: row.started_at,
        lockedAt: row.locked_at,
        completedAt: row.completed_at,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
        totalExpense: toNum(expenseRows[0][0].total_expense, 0),
        expenseCount: Number(expenseRows[0][0].expense_count || 0),
        batchCount: Number(batchRows[0][0].batch_count || 0),
        totalAvailableQty: toNum(batchRows[0][0].total_available_qty, 0)
      }
    });
  } catch (error) {
    next(error);
  }
});

module.exports = router;
