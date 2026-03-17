const express = require("express");
const { pool, withTransaction } = require("../db");

const router = express.Router();

const ACCESS_ROLES = ["SUPER_ADMIN", "SALES", "FINANCE_MGMT"];
const FINANCE_ROLES = ["SUPER_ADMIN", "FINANCE_MGMT"];

function ensureRole(req, allowedRoles) {
  if (!allowedRoles.includes(req.user.roleCode)) {
    const err = new Error("Permission denied");
    err.status = 403;
    throw err;
  }
}

function ensureFinanceRole(req) {
  ensureRole(req, FINANCE_ROLES);
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

async function getReceiptSummary(dbConn, salesOrderId, orderTotalAmount) {
  const [rows] = await dbConn.query(
    `SELECT
       COALESCE(SUM(CASE WHEN status = 'CONFIRMED' AND is_void = 0 AND is_reversal = 0 THEN payment_amount ELSE 0 END), 0) AS incoming_amount,
       COALESCE(SUM(CASE WHEN status = 'CONFIRMED' AND is_void = 0 AND is_reversal = 1 THEN payment_amount ELSE 0 END), 0) AS reversed_amount
     FROM payments
     WHERE sales_order_id = ?`,
    [salesOrderId]
  );

  const incoming = toFixedNum(rows[0] && rows[0].incoming_amount, 2);
  const reversed = toFixedNum(rows[0] && rows[0].reversed_amount, 2);
  const netConfirmed = toFixedNum(incoming - reversed, 2);
  const orderTotal = toFixedNum(orderTotalAmount, 2);
  const outstandingAmount = toFixedNum(Math.max(orderTotal - netConfirmed, 0), 2);

  let receiptStatus = "UNPAID";
  if (netConfirmed > 0 && netConfirmed < orderTotal) {
    receiptStatus = "PARTIAL";
  } else if (orderTotal > 0 && netConfirmed >= orderTotal) {
    receiptStatus = "CONFIRMED";
  }

  return {
    incomingAmount: incoming,
    reversedAmount: reversed,
    netConfirmedAmount: netConfirmed,
    outstandingAmount,
    receiptStatus
  };
}

function allocateFinalQtyByPlanned(lines, finalTotalQty) {
  const finalMilli = Math.round(toNum(finalTotalQty, 0) * 1000);
  const plannedMillis = lines.map((line) => Math.round(toNum(line.planned_qty, 0) * 1000));
  const totalPlannedMilli = plannedMillis.reduce((sum, x) => sum + x, 0);

  if (totalPlannedMilli <= 0) {
    const err = new Error("Sales line planned_qty sum must be positive.");
    err.status = 400;
    throw err;
  }

  let remainingMilli = finalMilli;
  const result = [];

  lines.forEach((line, index) => {
    let allocatedMilli = 0;
    if (index === lines.length - 1) {
      allocatedMilli = remainingMilli;
    } else {
      allocatedMilli = Math.floor((finalMilli * plannedMillis[index]) / totalPlannedMilli);
      remainingMilli -= allocatedMilli;
    }
    result.push({
      lineId: line.id,
      lineNo: line.line_no,
      plannedQty: toFixedNum(line.planned_qty, 3),
      finalQty: toFixedNum(allocatedMilli / 1000, 3),
      lineUnitPrice: line.line_unit_price == null ? null : toFixedNum(line.line_unit_price, 4),
      sourceProcurementUnitCost: toFixedNum(line.source_procurement_unit_cost, 4),
      sourceExpenseUnitCost: toFixedNum(line.source_expense_unit_cost, 4)
    });
  });

  return result;
}

function calcDelta(plannedQty, finalQty) {
  return toFixedNum(toNum(finalQty, 0) - toNum(plannedQty, 0), 3);
}

function parseBool(value) {
  if (typeof value === "boolean") return value;
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    return normalized === "1" || normalized === "true" || normalized === "yes";
  }
  if (typeof value === "number") return value === 1;
  return false;
}

router.get("/orders/pending-confirm", async (req, res, next) => {
  try {
    ensureRole(req, ACCESS_ROLES);

    const keyword = String(req.query.keyword || "").trim();
    const actionFilter = String(req.query.action || "ALL").trim().toUpperCase();
    const where = [
      "so.is_void = 0",
      "so.status IN ('LOCKED_STOCK','PENDING_FINAL_QTY_CONFIRM','READY_FOR_PAYMENT_CONFIRM','COMPLETED')"
    ];
    const params = [];

    if (keyword) {
      where.push("(so.sales_order_no LIKE ? OR so.customer_name LIKE ?)");
      params.push(`%${keyword}%`, `%${keyword}%`);
    }

    const [rows] = await pool.query(
      `SELECT
         so.id,
         so.sales_order_no,
         so.customer_name,
         so.status,
         so.ar_status,
         so.planned_total_qty,
         so.final_total_qty,
         so.total_amount,
         so.qty_diff_confirmed,
         so.updated_at,
         ws.id AS latest_slip_id,
         ws.status AS latest_slip_status,
         ws.final_total_qty AS latest_slip_final_qty,
         pay.incoming_amount,
         pay.reversed_amount
       FROM sales_orders so
       LEFT JOIN (
         SELECT w1.*
         FROM weighing_slips w1
         JOIN (
           SELECT sales_order_id, MAX(id) AS max_id
           FROM weighing_slips
           WHERE is_void = 0
           GROUP BY sales_order_id
         ) w2 ON w2.max_id = w1.id
       ) ws ON ws.sales_order_id = so.id
       LEFT JOIN (
         SELECT
           sales_order_id,
           COALESCE(SUM(CASE WHEN status = 'CONFIRMED' AND is_void = 0 AND is_reversal = 0 THEN payment_amount ELSE 0 END), 0) AS incoming_amount,
           COALESCE(SUM(CASE WHEN status = 'CONFIRMED' AND is_void = 0 AND is_reversal = 1 THEN payment_amount ELSE 0 END), 0) AS reversed_amount
         FROM payments
         GROUP BY sales_order_id
       ) pay ON pay.sales_order_id = so.id
       WHERE ${where.join(" AND ")}
       ORDER BY so.updated_at DESC
       LIMIT 500`,
      params
    );

    let items = rows.map((row) => {
      const plannedTotalQty = toFixedNum(row.planned_total_qty, 3);
      const orderFinalQty = row.final_total_qty == null ? null : toFixedNum(row.final_total_qty, 3);
      const latestSlipQty = row.latest_slip_final_qty == null ? null : toFixedNum(row.latest_slip_final_qty, 3);
      const finalCandidateQty = orderFinalQty != null ? orderFinalQty : latestSlipQty;
      const deltaQty = finalCandidateQty == null ? null : calcDelta(plannedTotalQty, finalCandidateQty);
      const diffFlag = deltaQty != null ? Math.abs(deltaQty) > 0.0005 : false;

      const incoming = toFixedNum(row.incoming_amount, 2);
      const reversed = toFixedNum(row.reversed_amount, 2);
      const netReceived = toFixedNum(incoming - reversed, 2);
      const totalAmount = toFixedNum(row.total_amount, 2);
      const outstandingAmount = toFixedNum(Math.max(totalAmount - netReceived, 0), 2);

      let nextAction = "VIEW";
      let nextActionLabel = "查看详情";

      if (row.ar_status !== "FINAL_AR") {
        if (!row.latest_slip_id || row.latest_slip_status === "VOID") {
          nextAction = "ENTER_WEIGHING";
          nextActionLabel = "录入磅单";
        } else {
          nextAction = "FINANCE_CONFIRM";
          nextActionLabel = "财务确认";
        }
      } else if (outstandingAmount > 0) {
        nextAction = "CONFIRM_PAYMENT";
        nextActionLabel = "确认收款";
      } else {
        nextAction = "DONE";
        nextActionLabel = "已闭环";
      }

      return {
        id: row.id,
        salesOrderNo: row.sales_order_no,
        customerName: row.customer_name,
        status: row.status,
        arStatus: row.ar_status,
        plannedTotalQty,
        finalTotalQty: orderFinalQty,
        latestSlipQty,
        deltaQty,
        diffFlag,
        diffConfirmed: Number(row.qty_diff_confirmed || 0) === 1,
        totalAmount,
        netReceived,
        outstandingAmount,
        latestSlipId: row.latest_slip_id,
        latestSlipStatus: row.latest_slip_status || "",
        nextAction,
        nextActionLabel,
        updatedAt: row.updated_at
      };
    });

    if (actionFilter !== "ALL") {
      items = items.filter((item) => item.nextAction === actionFilter);
    }

    res.json({
      items,
      stats: {
        total: items.length,
        waitWeighing: items.filter((x) => x.nextAction === "ENTER_WEIGHING").length,
        waitFinanceConfirm: items.filter((x) => x.nextAction === "FINANCE_CONFIRM").length,
        waitPayment: items.filter((x) => x.nextAction === "CONFIRM_PAYMENT").length
      }
    });
  } catch (error) {
    next(error);
  }
});

router.post("/orders/:id/weighing-slips", async (req, res, next) => {
  try {
    ensureRole(req, ACCESS_ROLES);
    const salesOrderId = Number(req.params.id);
    const finalTotalQty = toFixedNum(req.body && req.body.finalTotalQty, 3);
    const voucherUrl = req.body && req.body.voucherUrl ? String(req.body.voucherUrl).trim() : null;
    const remark = req.body && req.body.remark ? String(req.body.remark).trim() : null;
    const customSlipNo = req.body && req.body.slipNo ? String(req.body.slipNo).trim() : "";

    if (!salesOrderId) {
      return res.status(400).json({ message: "Invalid sales order id." });
    }
    if (finalTotalQty <= 0) {
      return res.status(400).json({ message: "finalTotalQty must be positive." });
    }

    const result = await withTransaction(async (conn) => {
      const [orderRows] = await conn.query(
        `SELECT id, sales_order_no, status, ar_status, planned_total_qty
         FROM sales_orders
         WHERE id = ? AND is_void = 0
         LIMIT 1
         FOR UPDATE`,
        [salesOrderId]
      );
      if (!orderRows.length) {
        const err = new Error("Sales order not found.");
        err.status = 404;
        throw err;
      }
      const order = orderRows[0];
      if (order.ar_status === "FINAL_AR") {
        const err = new Error("Sales order already FINAL_AR, weighing slip cannot be re-uploaded.");
        err.status = 400;
        throw err;
      }
      if (order.status === "VOID") {
        const err = new Error("VOID sales order cannot upload weighing slip.");
        err.status = 400;
        throw err;
      }

      const slipNo = customSlipNo || generateNo("WS");
      const plannedQty = toFixedNum(order.planned_total_qty, 3);
      const [insertResult] = await conn.query(
        `INSERT INTO weighing_slips
          (slip_no, sales_order_id, planned_qty, final_total_qty, status, is_final, voucher_url, uploaded_by, remark,
           created_at, updated_at, created_by, updated_by, is_void)
         VALUES (?, ?, ?, ?, 'PENDING_CONFIRM', 0, ?, ?, ?, NOW(), NOW(), ?, ?, 0)`,
        [slipNo, salesOrderId, plannedQty, finalTotalQty, voucherUrl, req.user.id, remark, req.user.id, req.user.id]
      );
      const slipId = insertResult.insertId;

      await conn.query(
        `UPDATE sales_orders
            SET status = 'PENDING_FINAL_QTY_CONFIRM',
                updated_at = NOW(),
                updated_by = ?
          WHERE id = ?`,
        [req.user.id, salesOrderId]
      );

      await writeAuditLog(conn, {
        actorUserId: req.user.id,
        action: "WEIGHING_SLIP_UPLOADED",
        entityType: "WEIGHING_SLIP",
        entityId: slipId,
        afterData: {
          salesOrderId,
          salesOrderNo: order.sales_order_no,
          plannedQty,
          finalTotalQty,
          deltaQty: calcDelta(plannedQty, finalTotalQty),
          voucherUrl
        }
      });

      return {
        slipId,
        slipNo,
        plannedQty,
        finalTotalQty,
        deltaQty: calcDelta(plannedQty, finalTotalQty)
      };
    });

    res.json({
      message: "Weighing slip uploaded.",
      ...result
    });
  } catch (error) {
    next(error);
  }
});

router.post("/orders/:id/finance-confirm", async (req, res, next) => {
  try {
    ensureFinanceRole(req);
    const salesOrderId = Number(req.params.id);
    const targetSlipId = req.body && req.body.slipId ? Number(req.body.slipId) : null;
    const diffConfirm = parseBool(req.body && req.body.diffConfirm);
    const diffConfirmNote = req.body && req.body.diffConfirmNote ? String(req.body.diffConfirmNote).trim() : "";

    if (!salesOrderId) {
      return res.status(400).json({ message: "Invalid sales order id." });
    }

    const result = await withTransaction(async (conn) => {
      const [orderRows] = await conn.query(
        `SELECT
           id, sales_order_no, status, ar_status,
           planned_total_qty, final_total_qty, total_amount, unit_price
         FROM sales_orders
         WHERE id = ? AND is_void = 0
         LIMIT 1
         FOR UPDATE`,
        [salesOrderId]
      );
      if (!orderRows.length) {
        const err = new Error("Sales order not found.");
        err.status = 404;
        throw err;
      }
      const order = orderRows[0];
      if (order.ar_status === "FINAL_AR") {
        const err = new Error("Sales order is already FINAL_AR.");
        err.status = 400;
        throw err;
      }

      let slipRows = [];
      if (targetSlipId) {
        [slipRows] = await conn.query(
          `SELECT id, slip_no, planned_qty, final_total_qty, status, is_final
           FROM weighing_slips
           WHERE id = ?
             AND sales_order_id = ?
             AND is_void = 0
           LIMIT 1
           FOR UPDATE`,
          [targetSlipId, salesOrderId]
        );
      } else {
        [slipRows] = await conn.query(
          `SELECT id, slip_no, planned_qty, final_total_qty, status, is_final
           FROM weighing_slips
           WHERE sales_order_id = ?
             AND is_void = 0
             AND status IN ('UPLOADED', 'PENDING_CONFIRM')
           ORDER BY id DESC
           LIMIT 1
           FOR UPDATE`,
          [salesOrderId]
        );
      }

      if (!slipRows.length) {
        const err = new Error("No pending weighing slip found for finance confirmation.");
        err.status = 400;
        throw err;
      }
      const slip = slipRows[0];
      const plannedTotalQty = toFixedNum(order.planned_total_qty, 3);
      const finalTotalQty = toFixedNum(slip.final_total_qty, 3);
      const deltaQty = calcDelta(plannedTotalQty, finalTotalQty);
      const hasDiff = Math.abs(deltaQty) > 0.0005;

      if (hasDiff && !diffConfirm) {
        const err = new Error("Final qty differs from planned qty; manual confirmation is required.");
        err.status = 400;
        throw err;
      }
      if (hasDiff && !diffConfirmNote) {
        const err = new Error("Difference confirmation note is required.");
        err.status = 400;
        throw err;
      }

      const [lineRows] = await conn.query(
        `SELECT
           id, line_no, planned_qty, line_unit_price,
           source_procurement_unit_cost, source_expense_unit_cost
         FROM sales_line_items
         WHERE sales_order_id = ?
           AND is_void = 0
         ORDER BY line_no ASC
         FOR UPDATE`,
        [salesOrderId]
      );
      if (!lineRows.length) {
        const err = new Error("Sales order has no line items.");
        err.status = 400;
        throw err;
      }

      const allocated = allocateFinalQtyByPlanned(lineRows, finalTotalQty);
      let finalAmount = 0;

      for (const line of allocated) {
        const lineUnitPrice = line.lineUnitPrice == null
          ? toFixedNum(order.unit_price, 4)
          : toFixedNum(line.lineUnitPrice, 4);
        const sourceUnitCost = toFixedNum(line.sourceProcurementUnitCost + line.sourceExpenseUnitCost, 4);
        const lineRevenueAmount = toFixedNum(line.finalQty * lineUnitPrice, 2);
        const lineCostAmount = toFixedNum(line.finalQty * sourceUnitCost, 2);
        finalAmount = toFixedNum(finalAmount + lineRevenueAmount, 2);

        await conn.query(
          `UPDATE sales_line_items
              SET final_qty = ?,
                  line_revenue_amount = ?,
                  line_cost_amount = ?,
                  status = 'FINALIZED',
                  updated_at = NOW(),
                  updated_by = ?
            WHERE id = ?`,
          [line.finalQty, lineRevenueAmount, lineCostAmount, req.user.id, line.lineId]
        );
      }

      await conn.query(
        `UPDATE weighing_slips
            SET is_final = 0,
                status = CASE WHEN status = 'VOID' THEN 'VOID' ELSE 'VOID' END,
                updated_at = NOW(),
                updated_by = ?
          WHERE sales_order_id = ?
            AND is_void = 0
            AND id <> ?`,
        [req.user.id, salesOrderId, slip.id]
      );

      await conn.query(
        `UPDATE weighing_slips
            SET is_final = 1,
                status = 'CONFIRMED',
                confirmed_by = ?,
                confirmed_at = NOW(),
                updated_at = NOW(),
                updated_by = ?
          WHERE id = ?`,
        [req.user.id, req.user.id, slip.id]
      );

      const qtyDiffConfirmed = hasDiff ? 1 : 0;
      await conn.query(
        `UPDATE sales_orders
            SET status = 'READY_FOR_PAYMENT_CONFIRM',
                ar_status = 'FINAL_AR',
                final_total_qty = ?,
                final_weighing_slip_id = ?,
                final_qty_confirmed_by = ?,
                final_qty_confirmed_at = NOW(),
                qty_diff_confirmed = ?,
                qty_diff_confirmed_by = ?,
                qty_diff_confirmed_at = ?,
                qty_diff_confirm_note = ?,
                ar_confirmed_by = ?,
                ar_confirmed_at = NOW(),
                total_amount = ?,
                updated_at = NOW(),
                updated_by = ?
          WHERE id = ?`,
        [
          finalTotalQty,
          slip.id,
          req.user.id,
          qtyDiffConfirmed,
          qtyDiffConfirmed ? req.user.id : null,
          qtyDiffConfirmed ? new Date() : null,
          qtyDiffConfirmed ? diffConfirmNote : null,
          req.user.id,
          finalAmount,
          req.user.id,
          salesOrderId
        ]
      );

      await writeAuditLog(conn, {
        actorUserId: req.user.id,
        action: "FINANCE_CONFIRM_FINAL_QTY",
        entityType: "SALES_ORDER",
        entityId: salesOrderId,
        afterData: {
          salesOrderNo: order.sales_order_no,
          slipId: slip.id,
          slipNo: slip.slip_no,
          plannedTotalQty,
          finalTotalQty,
          deltaQty,
          diffConfirmed: hasDiff,
          diffConfirmNote: hasDiff ? diffConfirmNote : null
        }
      });

      await writeAuditLog(conn, {
        actorUserId: req.user.id,
        action: "AR_FINALIZED",
        entityType: "SALES_ORDER",
        entityId: salesOrderId,
        afterData: {
          arStatus: "FINAL_AR",
          status: "READY_FOR_PAYMENT_CONFIRM",
          finalAmount
        }
      });

      return {
        salesOrderId,
        salesOrderNo: order.sales_order_no,
        finalTotalQty,
        plannedTotalQty,
        deltaQty,
        finalAmount,
        arStatus: "FINAL_AR",
        status: "READY_FOR_PAYMENT_CONFIRM",
        finalSlipId: slip.id,
        finalSlipNo: slip.slip_no
      };
    });

    res.json({
      message: "Finance confirmation completed.",
      ...result
    });
  } catch (error) {
    next(error);
  }
});

router.post("/orders/:id/payments/confirm", async (req, res, next) => {
  try {
    ensureFinanceRole(req);
    const salesOrderId = Number(req.params.id);
    const paymentAmount = toFixedNum(req.body && req.body.paymentAmount, 2);
    const paymentMethod = String((req.body && req.body.paymentMethod) || "BANK_TRANSFER").toUpperCase();
    const paidAtInput = req.body && req.body.paidAt ? new Date(req.body.paidAt) : new Date();
    const remark = req.body && req.body.remark ? String(req.body.remark).trim() : null;

    if (!salesOrderId) {
      return res.status(400).json({ message: "Invalid sales order id." });
    }
    if (paymentAmount <= 0) {
      return res.status(400).json({ message: "paymentAmount must be positive." });
    }
    if (!["BANK_TRANSFER", "CASH", "OTHER"].includes(paymentMethod)) {
      return res.status(400).json({ message: "Invalid paymentMethod." });
    }

    const result = await withTransaction(async (conn) => {
      const [orderRows] = await conn.query(
        `SELECT id, sales_order_no, status, ar_status, total_amount
         FROM sales_orders
         WHERE id = ? AND is_void = 0
         LIMIT 1
         FOR UPDATE`,
        [salesOrderId]
      );
      if (!orderRows.length) {
        const err = new Error("Sales order not found.");
        err.status = 404;
        throw err;
      }
      const order = orderRows[0];
      if (order.ar_status !== "FINAL_AR") {
        const err = new Error("Estimated AR cannot confirm payment. Only FINAL_AR can confirm payment.");
        err.status = 400;
        throw err;
      }
      if (order.status === "VOID") {
        const err = new Error("VOID sales order cannot confirm payment.");
        err.status = 400;
        throw err;
      }

      const paymentNo = generateNo("PMT");
      const paidAt = Number.isNaN(paidAtInput.getTime()) ? new Date() : paidAtInput;
      const [insertResult] = await conn.query(
        `INSERT INTO payments
          (payment_no, sales_order_id, payment_amount, payment_method, status, is_irreversible, is_reversal,
           reversal_of_payment_id, reversal_reason, paid_at, confirmed_by, confirmed_at, remark,
           created_at, updated_at, created_by, updated_by, is_void)
         VALUES (?, ?, ?, ?, 'CONFIRMED', 1, 0, NULL, NULL, ?, ?, NOW(), ?, NOW(), NOW(), ?, ?, 0)`,
        [paymentNo, salesOrderId, paymentAmount, paymentMethod, paidAt, req.user.id, remark, req.user.id, req.user.id]
      );

      const receipt = await getReceiptSummary(conn, salesOrderId, order.total_amount);
      const nextStatus = receipt.outstandingAmount <= 0 && toNum(order.total_amount, 0) > 0
        ? "COMPLETED"
        : "READY_FOR_PAYMENT_CONFIRM";

      await conn.query(
        `UPDATE sales_orders
            SET status = ?,
                completed_at = CASE WHEN ? = 'COMPLETED' THEN NOW() ELSE NULL END,
                updated_at = NOW(),
                updated_by = ?
          WHERE id = ?`,
        [nextStatus, nextStatus, req.user.id, salesOrderId]
      );

      await writeAuditLog(conn, {
        actorUserId: req.user.id,
        action: "PAYMENT_CONFIRMED_IRREVERSIBLE",
        entityType: "PAYMENT",
        entityId: insertResult.insertId,
        afterData: {
          salesOrderId,
          salesOrderNo: order.sales_order_no,
          paymentNo,
          paymentAmount,
          paymentMethod,
          irreversible: true,
          receiptStatus: receipt.receiptStatus,
          outstandingAmount: receipt.outstandingAmount
        }
      });

      return {
        paymentId: insertResult.insertId,
        paymentNo,
        salesOrderId,
        salesOrderNo: order.sales_order_no,
        receiptStatus: receipt.receiptStatus,
        netConfirmedAmount: receipt.netConfirmedAmount,
        outstandingAmount: receipt.outstandingAmount,
        orderStatus: nextStatus
      };
    });

    res.json({
      message: "Payment confirmed and irreversible.",
      ...result
    });
  } catch (error) {
    next(error);
  }
});

router.post("/payments/:id/reverse", async (req, res, next) => {
  try {
    ensureFinanceRole(req);
    const paymentId = Number(req.params.id);
    const reason = String((req.body && req.body.reason) || "").trim();

    if (!paymentId) {
      return res.status(400).json({ message: "Invalid payment id." });
    }
    if (!reason) {
      return res.status(400).json({ message: "Reversal reason is required." });
    }

    const result = await withTransaction(async (conn) => {
      const [paymentRows] = await conn.query(
        `SELECT
           p.id, p.payment_no, p.sales_order_id, p.payment_amount, p.payment_method,
           p.status, p.is_irreversible, p.is_reversal,
           so.sales_order_no, so.total_amount
         FROM payments p
         JOIN sales_orders so ON so.id = p.sales_order_id
         WHERE p.id = ?
           AND p.is_void = 0
           AND so.is_void = 0
         LIMIT 1
         FOR UPDATE`,
        [paymentId]
      );
      if (!paymentRows.length) {
        const err = new Error("Payment not found.");
        err.status = 404;
        throw err;
      }
      const payment = paymentRows[0];
      if (payment.status !== "CONFIRMED" || Number(payment.is_irreversible || 0) !== 1) {
        const err = new Error("Only irreversible confirmed payment can be reversed.");
        err.status = 400;
        throw err;
      }
      if (Number(payment.is_reversal || 0) === 1) {
        const err = new Error("Reversal payment cannot be reversed again.");
        err.status = 400;
        throw err;
      }

      const [existingRows] = await conn.query(
        `SELECT id
         FROM payments
         WHERE reversal_of_payment_id = ?
           AND is_void = 0
         LIMIT 1
         FOR UPDATE`,
        [paymentId]
      );
      if (existingRows.length) {
        const err = new Error("Payment already reversed.");
        err.status = 400;
        throw err;
      }

      const reversalNo = generateNo("PMTR");
      const [insertResult] = await conn.query(
        `INSERT INTO payments
          (payment_no, sales_order_id, payment_amount, payment_method, status, is_irreversible, is_reversal,
           reversal_of_payment_id, reversal_reason, paid_at, confirmed_by, confirmed_at, remark,
           created_at, updated_at, created_by, updated_by, is_void)
         VALUES (?, ?, ?, ?, 'CONFIRMED', 1, 1, ?, ?, NOW(), ?, NOW(), ?, NOW(), NOW(), ?, ?, 0)`,
        [
          reversalNo,
          payment.sales_order_id,
          toFixedNum(payment.payment_amount, 2),
          payment.payment_method,
          payment.id,
          reason,
          req.user.id,
          `REVERSAL OF ${payment.payment_no}`,
          req.user.id,
          req.user.id
        ]
      );

      const receipt = await getReceiptSummary(conn, payment.sales_order_id, payment.total_amount);
      const nextStatus = receipt.outstandingAmount <= 0 && toNum(payment.total_amount, 0) > 0
        ? "COMPLETED"
        : "READY_FOR_PAYMENT_CONFIRM";

      await conn.query(
        `UPDATE sales_orders
            SET status = ?,
                completed_at = CASE WHEN ? = 'COMPLETED' THEN NOW() ELSE NULL END,
                updated_at = NOW(),
                updated_by = ?
          WHERE id = ?`,
        [nextStatus, nextStatus, req.user.id, payment.sales_order_id]
      );

      await writeAuditLog(conn, {
        actorUserId: req.user.id,
        action: "PAYMENT_REVERSED_BY_OFFSET",
        entityType: "PAYMENT",
        entityId: insertResult.insertId,
        afterData: {
          salesOrderId: payment.sales_order_id,
          salesOrderNo: payment.sales_order_no,
          originalPaymentId: payment.id,
          originalPaymentNo: payment.payment_no,
          reversalPaymentNo: reversalNo,
          reversalReason: reason,
          outstandingAmount: receipt.outstandingAmount
        }
      });

      return {
        reversalPaymentId: insertResult.insertId,
        reversalPaymentNo: reversalNo,
        salesOrderId: payment.sales_order_id,
        salesOrderNo: payment.sales_order_no,
        receiptStatus: receipt.receiptStatus,
        netConfirmedAmount: receipt.netConfirmedAmount,
        outstandingAmount: receipt.outstandingAmount,
        orderStatus: nextStatus
      };
    });

    res.json({
      message: "Payment reversed by offset record.",
      ...result
    });
  } catch (error) {
    next(error);
  }
});

router.get("/orders/:id/finance-summary", async (req, res, next) => {
  try {
    ensureRole(req, ACCESS_ROLES);
    const salesOrderId = Number(req.params.id);
    if (!salesOrderId) {
      return res.status(400).json({ message: "Invalid sales order id." });
    }

    const [orderRows] = await pool.query(
      `SELECT
         so.id, so.sales_order_no, so.customer_name, so.status, so.ar_status,
         so.planned_total_qty, so.final_total_qty, so.total_amount, so.final_weighing_slip_id,
         so.final_qty_confirmed_at, so.qty_diff_confirmed, so.qty_diff_confirm_note,
         so.ar_confirmed_at, so.created_at
       FROM sales_orders so
       WHERE so.id = ?
         AND so.is_void = 0
       LIMIT 1`,
      [salesOrderId]
    );
    if (!orderRows.length) {
      return res.status(404).json({ message: "Sales order not found." });
    }
    const order = orderRows[0];

    const [lineResult, slipResult, paymentResult, auditResult] = await Promise.all([
      pool.query(
        `SELECT
           li.id, li.line_no, li.batch_id, li.voyage_id,
           li.planned_qty, li.final_qty, li.status,
           li.line_unit_price, li.line_revenue_amount, li.line_cost_amount, li.line_profit_amount,
           li.source_procurement_unit_cost, li.source_expense_unit_cost,
           b.batch_no, v.voyage_no
         FROM sales_line_items li
         JOIN inventory_batches b ON b.id = li.batch_id
         JOIN voyages v ON v.id = li.voyage_id
         WHERE li.sales_order_id = ?
           AND li.is_void = 0
         ORDER BY li.line_no ASC`,
        [salesOrderId]
      ),
      pool.query(
        `SELECT
           id, slip_no, planned_qty, final_total_qty, delta_qty, status, is_final,
           voucher_url, remark, confirmed_by, confirmed_at, created_at
         FROM weighing_slips
         WHERE sales_order_id = ?
           AND is_void = 0
         ORDER BY created_at DESC`,
        [salesOrderId]
      ),
      pool.query(
        `SELECT
           id, payment_no, payment_amount, payment_method, status, is_irreversible,
           is_reversal, reversal_of_payment_id, reversal_reason, paid_at, confirmed_at, remark, created_at
         FROM payments
         WHERE sales_order_id = ?
           AND is_void = 0
         ORDER BY created_at DESC`,
        [salesOrderId]
      ),
      pool.query(
        `SELECT id, action, actor_user_id, event_time, before_data, after_data
         FROM audit_logs
         WHERE is_void = 0
           AND (
             (entity_type = 'SALES_ORDER' AND entity_id = ?)
             OR (entity_type = 'WEIGHING_SLIP' AND entity_id IN (
               SELECT id FROM weighing_slips WHERE sales_order_id = ? AND is_void = 0
             ))
             OR (entity_type = 'PAYMENT' AND entity_id IN (
               SELECT id FROM payments WHERE sales_order_id = ? AND is_void = 0
             ))
           )
         ORDER BY event_time DESC
         LIMIT 400`,
        [salesOrderId, salesOrderId, salesOrderId]
      )
    ]);

    const slips = slipResult[0];
    const latestSlip = slips.length ? slips[0] : null;
    const finalSlip = slips.find((x) => Number(x.is_final || 0) === 1) || null;
    const effectiveSlip = finalSlip || latestSlip;

    const receipt = await getReceiptSummary(pool, salesOrderId, order.total_amount);
    const isFinance = FINANCE_ROLES.includes(req.user.roleCode);
    const hasPendingSlip = slips.some((x) => ["UPLOADED", "PENDING_CONFIRM"].includes(x.status));
    const canFinanceConfirm = isFinance && order.ar_status !== "FINAL_AR" && hasPendingSlip;
    const canConfirmPayment = isFinance && order.ar_status === "FINAL_AR" && receipt.outstandingAmount > 0;

    const reversalOfSet = new Set(
      paymentResult[0]
        .filter((x) => Number(x.is_reversal || 0) === 1 && x.reversal_of_payment_id)
        .map((x) => Number(x.reversal_of_payment_id))
    );

    const lineItems = lineResult[0].map((line) => ({
      id: line.id,
      lineNo: line.line_no,
      batchId: line.batch_id,
      batchNo: line.batch_no,
      voyageId: line.voyage_id,
      voyageNo: line.voyage_no,
      plannedQty: toFixedNum(line.planned_qty, 3),
      finalQty: line.final_qty == null ? null : toFixedNum(line.final_qty, 3),
      status: line.status,
      lineUnitPrice: toFixedNum(line.line_unit_price, 4),
      lineRevenueAmount: toFixedNum(line.line_revenue_amount, 2),
      sourceProcurementUnitCost: isFinance ? toFixedNum(line.source_procurement_unit_cost, 4) : null,
      sourceExpenseUnitCost: isFinance ? toFixedNum(line.source_expense_unit_cost, 4) : null,
      lineCostAmount: isFinance ? toFixedNum(line.line_cost_amount, 2) : null,
      lineProfitAmount: isFinance ? toFixedNum(line.line_profit_amount, 2) : null,
      lineCostDisplay: isFinance ? toFixedNum(line.line_cost_amount, 2) : "***",
      lineProfitDisplay: isFinance ? toFixedNum(line.line_profit_amount, 2) : "***"
    }));

    res.json({
      order: {
        id: order.id,
        salesOrderNo: order.sales_order_no,
        customerName: order.customer_name,
        status: order.status,
        arStatus: order.ar_status,
        plannedTotalQty: toFixedNum(order.planned_total_qty, 3),
        finalTotalQty: order.final_total_qty == null ? null : toFixedNum(order.final_total_qty, 3),
        totalAmount: toFixedNum(order.total_amount, 2),
        qtyDiffConfirmed: Number(order.qty_diff_confirmed || 0) === 1,
        qtyDiffConfirmNote: order.qty_diff_confirm_note || "",
        finalQtyConfirmedAt: order.final_qty_confirmed_at,
        arConfirmedAt: order.ar_confirmed_at,
        createdAt: order.created_at
      },
      effectiveSlip: effectiveSlip
        ? {
            id: effectiveSlip.id,
            slipNo: effectiveSlip.slip_no,
            plannedQty: toFixedNum(effectiveSlip.planned_qty, 3),
            finalTotalQty: toFixedNum(effectiveSlip.final_total_qty, 3),
            deltaQty: toFixedNum(effectiveSlip.delta_qty, 3),
            status: effectiveSlip.status,
            isFinal: Number(effectiveSlip.is_final || 0) === 1,
            voucherUrl: effectiveSlip.voucher_url || "",
            remark: effectiveSlip.remark || "",
            confirmedAt: effectiveSlip.confirmed_at
          }
        : null,
      slips: slips.map((slip) => ({
        id: slip.id,
        slipNo: slip.slip_no,
        plannedQty: toFixedNum(slip.planned_qty, 3),
        finalTotalQty: toFixedNum(slip.final_total_qty, 3),
        deltaQty: toFixedNum(slip.delta_qty, 3),
        status: slip.status,
        isFinal: Number(slip.is_final || 0) === 1,
        voucherUrl: slip.voucher_url || "",
        remark: slip.remark || "",
        confirmedAt: slip.confirmed_at
      })),
      lineItems,
      payments: paymentResult[0].map((pay) => ({
        id: pay.id,
        paymentNo: pay.payment_no,
        paymentAmount: toFixedNum(pay.payment_amount, 2),
        paymentMethod: pay.payment_method,
        status: pay.status,
        isIrreversible: Number(pay.is_irreversible || 0) === 1,
        isReversal: Number(pay.is_reversal || 0) === 1,
        reversalOfPaymentId: pay.reversal_of_payment_id,
        reversalReason: pay.reversal_reason || "",
        paidAt: pay.paid_at,
        confirmedAt: pay.confirmed_at,
        canReverse: isFinance
          && pay.status === "CONFIRMED"
          && Number(pay.is_reversal || 0) === 0
          && !reversalOfSet.has(Number(pay.id))
      })),
      audits: auditResult[0].map((audit) => ({
        id: audit.id,
        action: audit.action,
        actorUserId: audit.actor_user_id,
        eventTime: audit.event_time,
        beforeData: audit.before_data,
        afterData: audit.after_data
      })),
      receipt,
      actions: {
        canUploadWeighing: order.ar_status !== "FINAL_AR",
        canFinanceConfirm,
        financeConfirmDisabledReason: canFinanceConfirm
          ? ""
          : !isFinance
            ? "Only finance/management can confirm final AR."
            : !hasPendingSlip
              ? "No pending weighing slip to confirm."
              : "Already FINAL_AR.",
        canConfirmPayment,
        paymentDisabledReason: canConfirmPayment
          ? ""
          : !isFinance
            ? "Only finance/management can confirm payment."
            : order.ar_status !== "FINAL_AR"
              ? "Current AR status is ESTIMATED_AR; payment confirmation is forbidden."
              : "No outstanding amount."
      },
      costVisible: isFinance
    });
  } catch (error) {
    next(error);
  }
});

router.get("/weighing-slips", async (req, res, next) => {
  try {
    ensureRole(req, ACCESS_ROLES);

    const keyword = String(req.query.keyword || "").trim();
    const status = String(req.query.status || "").trim().toUpperCase();
    const orderId = Number(req.query.orderId || 0);
    const where = ["ws.is_void = 0"];
    const params = [];

    if (status) {
      where.push("ws.status = ?");
      params.push(status);
    }
    if (orderId) {
      where.push("ws.sales_order_id = ?");
      params.push(orderId);
    }
    if (keyword) {
      where.push("(ws.slip_no LIKE ? OR so.sales_order_no LIKE ? OR so.customer_name LIKE ?)");
      params.push(`%${keyword}%`, `%${keyword}%`, `%${keyword}%`);
    }

    const [rows] = await pool.query(
      `SELECT
         ws.id,
         ws.slip_no,
         ws.sales_order_id,
         ws.planned_qty,
         ws.final_total_qty,
         ws.delta_qty,
         ws.status,
         ws.is_final,
         ws.voucher_url,
         ws.remark,
         ws.confirmed_at,
         ws.created_at,
         ws.updated_at,
         so.sales_order_no,
         so.customer_name,
         so.status AS order_status,
         so.ar_status
       FROM weighing_slips ws
       JOIN sales_orders so ON so.id = ws.sales_order_id AND so.is_void = 0
       WHERE ${where.join(" AND ")}
       ORDER BY ws.created_at DESC
       LIMIT 400`,
      params
    );

    res.json({
      items: rows.map((row) => ({
        id: row.id,
        slipNo: row.slip_no,
        salesOrderId: row.sales_order_id,
        salesOrderNo: row.sales_order_no,
        customerName: row.customer_name,
        orderStatus: row.order_status,
        arStatus: row.ar_status,
        plannedQty: toFixedNum(row.planned_qty, 3),
        finalTotalQty: toFixedNum(row.final_total_qty, 3),
        deltaQty: toFixedNum(row.delta_qty, 3),
        status: row.status,
        isFinal: Number(row.is_final || 0) === 1,
        voucherUrl: row.voucher_url || "",
        remark: row.remark || "",
        confirmedAt: row.confirmed_at,
        createdAt: row.created_at,
        updatedAt: row.updated_at
      }))
    });
  } catch (error) {
    next(error);
  }
});

router.get("/weighing-slips/:id", async (req, res, next) => {
  try {
    ensureRole(req, ACCESS_ROLES);

    const slipId = Number(req.params.id || 0);
    if (!slipId) {
      return res.status(400).json({ message: "Invalid weighing slip id." });
    }

    const [detailRows, itemRows, auditRows] = await Promise.all([
      pool.query(
        `SELECT
           ws.id,
           ws.slip_no,
           ws.sales_order_id,
           ws.planned_qty,
           ws.final_total_qty,
           ws.delta_qty,
           ws.status,
           ws.is_final,
           ws.voucher_url,
           ws.remark,
           ws.uploaded_by,
           ws.confirmed_by,
           ws.confirmed_at,
           ws.created_at,
           ws.updated_at,
           so.sales_order_no,
           so.customer_name,
           so.status AS order_status,
           so.ar_status
         FROM weighing_slips ws
         JOIN sales_orders so ON so.id = ws.sales_order_id AND so.is_void = 0
         WHERE ws.id = ?
           AND ws.is_void = 0
         LIMIT 1`,
        [slipId]
      ),
      pool.query(
        `SELECT
           id, line_no, truck_no, gross_qty, tare_qty, net_qty, status, remark, created_at
         FROM weighing_slip_items
         WHERE weighing_slip_id = ?
           AND is_void = 0
         ORDER BY line_no ASC`,
        [slipId]
      ),
      pool.query(
        `SELECT
           id, action, actor_user_id, event_time, before_data, after_data
         FROM audit_logs
         WHERE is_void = 0
           AND entity_type = 'WEIGHING_SLIP'
           AND entity_id = ?
         ORDER BY event_time DESC
         LIMIT 200`,
        [slipId]
      )
    ]);

    if (!detailRows[0].length) {
      return res.status(404).json({ message: "Weighing slip not found." });
    }

    const row = detailRows[0][0];
    res.json({
      detail: {
        id: row.id,
        slipNo: row.slip_no,
        salesOrderId: row.sales_order_id,
        salesOrderNo: row.sales_order_no,
        customerName: row.customer_name,
        orderStatus: row.order_status,
        arStatus: row.ar_status,
        plannedQty: toFixedNum(row.planned_qty, 3),
        finalTotalQty: toFixedNum(row.final_total_qty, 3),
        deltaQty: toFixedNum(row.delta_qty, 3),
        status: row.status,
        isFinal: Number(row.is_final || 0) === 1,
        voucherUrl: row.voucher_url || "",
        remark: row.remark || "",
        uploadedBy: row.uploaded_by,
        confirmedBy: row.confirmed_by,
        confirmedAt: row.confirmed_at,
        createdAt: row.created_at,
        updatedAt: row.updated_at
      },
      items: itemRows[0].map((item) => ({
        id: item.id,
        lineNo: item.line_no,
        truckNo: item.truck_no || "",
        grossQty: toFixedNum(item.gross_qty, 3),
        tareQty: toFixedNum(item.tare_qty, 3),
        netQty: toFixedNum(item.net_qty, 3),
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

router.get("/payments", async (req, res, next) => {
  try {
    ensureRole(req, ACCESS_ROLES);

    const keyword = String(req.query.keyword || "").trim();
    const status = String(req.query.status || "").trim().toUpperCase();
    const orderId = Number(req.query.orderId || 0);
    const paymentType = String(req.query.paymentType || "ALL").trim().toUpperCase();
    const where = ["p.is_void = 0"];
    const params = [];

    if (status) {
      where.push("p.status = ?");
      params.push(status);
    }
    if (orderId) {
      where.push("p.sales_order_id = ?");
      params.push(orderId);
    }
    if (paymentType === "NORMAL") {
      where.push("p.is_reversal = 0");
    } else if (paymentType === "REVERSAL") {
      where.push("p.is_reversal = 1");
    }
    if (keyword) {
      where.push("(p.payment_no LIKE ? OR so.sales_order_no LIKE ? OR so.customer_name LIKE ?)");
      params.push(`%${keyword}%`, `%${keyword}%`, `%${keyword}%`);
    }

    const [rows] = await pool.query(
      `SELECT
         p.id,
         p.payment_no,
         p.sales_order_id,
         p.payment_amount,
         p.payment_method,
         p.status,
         p.is_irreversible,
         p.is_reversal,
         p.reversal_of_payment_id,
         p.reversal_reason,
         p.paid_at,
         p.confirmed_at,
         p.remark,
         p.created_at,
         p.updated_at,
         so.sales_order_no,
         so.customer_name,
         so.status AS order_status,
         so.ar_status,
         rev.id AS reversed_by_payment_id
       FROM payments p
       JOIN sales_orders so ON so.id = p.sales_order_id AND so.is_void = 0
       LEFT JOIN payments rev ON rev.reversal_of_payment_id = p.id AND rev.is_void = 0
       WHERE ${where.join(" AND ")}
       ORDER BY p.created_at DESC
       LIMIT 400`,
      params
    );

    const isFinance = FINANCE_ROLES.includes(req.user.roleCode);
    res.json({
      items: rows.map((row) => ({
        id: row.id,
        paymentNo: row.payment_no,
        salesOrderId: row.sales_order_id,
        salesOrderNo: row.sales_order_no,
        customerName: row.customer_name,
        orderStatus: row.order_status,
        arStatus: row.ar_status,
        paymentAmount: toFixedNum(row.payment_amount, 2),
        paymentMethod: row.payment_method,
        status: row.status,
        isIrreversible: Number(row.is_irreversible || 0) === 1,
        isReversal: Number(row.is_reversal || 0) === 1,
        reversalOfPaymentId: row.reversal_of_payment_id,
        reversalReason: row.reversal_reason || "",
        paidAt: row.paid_at,
        confirmedAt: row.confirmed_at,
        remark: row.remark || "",
        createdAt: row.created_at,
        updatedAt: row.updated_at,
        canReverse:
          isFinance
          && row.status === "CONFIRMED"
          && Number(row.is_reversal || 0) === 0
          && !row.reversed_by_payment_id
      }))
    });
  } catch (error) {
    next(error);
  }
});

router.get("/payments/:id", async (req, res, next) => {
  try {
    ensureRole(req, ACCESS_ROLES);

    const paymentId = Number(req.params.id || 0);
    if (!paymentId) {
      return res.status(400).json({ message: "Invalid payment id." });
    }

    const [detailRows, auditRows] = await Promise.all([
      pool.query(
        `SELECT
           p.id,
           p.payment_no,
           p.sales_order_id,
           p.payment_amount,
           p.payment_method,
           p.status,
           p.is_irreversible,
           p.is_reversal,
           p.reversal_of_payment_id,
           p.reversal_reason,
           p.paid_at,
           p.confirmed_by,
           p.confirmed_at,
           p.remark,
           p.created_at,
           p.updated_at,
           so.sales_order_no,
           so.customer_name,
           so.status AS order_status,
           so.ar_status,
           so.total_amount,
           rev.id AS reversed_by_payment_id
         FROM payments p
         JOIN sales_orders so ON so.id = p.sales_order_id AND so.is_void = 0
         LEFT JOIN payments rev ON rev.reversal_of_payment_id = p.id AND rev.is_void = 0
         WHERE p.id = ?
           AND p.is_void = 0
         LIMIT 1`,
        [paymentId]
      ),
      pool.query(
        `SELECT
           id, action, actor_user_id, event_time, before_data, after_data
         FROM audit_logs
         WHERE is_void = 0
           AND entity_type = 'PAYMENT'
           AND entity_id = ?
         ORDER BY event_time DESC
         LIMIT 200`,
        [paymentId]
      )
    ]);

    if (!detailRows[0].length) {
      return res.status(404).json({ message: "Payment order not found." });
    }

    const row = detailRows[0][0];
    const receipt = await getReceiptSummary(pool, row.sales_order_id, row.total_amount);
    const isFinance = FINANCE_ROLES.includes(req.user.roleCode);
    res.json({
      detail: {
        id: row.id,
        paymentNo: row.payment_no,
        salesOrderId: row.sales_order_id,
        salesOrderNo: row.sales_order_no,
        customerName: row.customer_name,
        orderStatus: row.order_status,
        arStatus: row.ar_status,
        paymentAmount: toFixedNum(row.payment_amount, 2),
        paymentMethod: row.payment_method,
        status: row.status,
        isIrreversible: Number(row.is_irreversible || 0) === 1,
        isReversal: Number(row.is_reversal || 0) === 1,
        reversalOfPaymentId: row.reversal_of_payment_id,
        reversalReason: row.reversal_reason || "",
        paidAt: row.paid_at,
        confirmedBy: row.confirmed_by,
        confirmedAt: row.confirmed_at,
        remark: row.remark || "",
        createdAt: row.created_at,
        updatedAt: row.updated_at,
        canReverse:
          isFinance
          && row.status === "CONFIRMED"
          && Number(row.is_reversal || 0) === 0
          && !row.reversed_by_payment_id
      },
      receipt,
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
