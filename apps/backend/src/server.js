const express = require("express");
const cors = require("cors");
const { pool } = require("./db");
const authRoutes = require("./routes/auth");
const procurementRoutes = require("./routes/procurements");
const alertRoutes = require("./routes/alerts");
const shipRoutes = require("./routes/ships");
const onsiteRoutes = require("./routes/onsite");
const salesRoutes = require("./routes/sales");
const financeRoutes = require("./routes/finance");
const governanceRoutes = require("./routes/governance");
const voyageRoutes = require("./routes/voyages");

const app = express();
const port = Number(process.env.PORT || 3000);

app.use(cors());
app.use(express.json({ limit: "2mb" }));

app.use("/api/auth", authRoutes);

app.use((req, _res, next) => {
  req.user = {
    id: Number(req.header("x-user-id") || 1),
    roleCode: req.header("x-role-code") || "DISPATCHER"
  };
  next();
});

app.get("/", (_req, res) => {
  res.json({
    ok: true,
    service: "sand-logistics-backend",
    tips: [
      "Use GET /healthz to verify backend + database status.",
      "Use API routes under /api/* for business data."
    ],
    links: {
      healthz: "/healthz",
      procurements: "/api/procurements",
      ships: "/api/ships",
      onsite: "/api/onsite/tasks",
      sales: "/api/sales/orders",
      finance: "/api/finance/orders/pending-confirm",
      governance: "/api/governance/approvals"
    }
  });
});

app.get("/healthz", async (_req, res) => {
  try {
    await pool.query("SELECT 1");
    res.json({ ok: true, db: "up" });
  } catch (_error) {
    res.status(500).json({ ok: false, db: "down" });
  }
});

app.use("/api/procurements", procurementRoutes);
app.use("/api/alerts", alertRoutes);
app.use("/api/ships", shipRoutes);
app.use("/api/onsite", onsiteRoutes);
app.use("/api/sales", salesRoutes);
app.use("/api/finance", financeRoutes);
app.use("/api/governance", governanceRoutes);
app.use("/api/voyages", voyageRoutes);

app.use((error, _req, res, _next) => {
  const status = error.status || 500;
  res.status(status).json({
    message: error.message || "Internal server error."
  });
});

app.listen(port, () => {
  // eslint-disable-next-line no-console
  console.log(`Backend server running at http://127.0.0.1:${port}`);
});
