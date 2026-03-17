# Backend (Phase 10)

This backend provides APIs for procurement-dispatch, ship positioning, onsite workflow, sales attribution, finance closure, and governance.

## Start

```powershell
cd D:\项目汇总\projects\apps\backend
npm install
npm start
```

Default port: `3000`

## Database env

- `DB_HOST` (default `127.0.0.1`)
- `DB_PORT` (default `3306`)
- `DB_USER` (default `root`)
- `DB_PASSWORD` (if missing, local fallback is `123456`)
- `DB_NAME` (default `sand_logistics`)

## Ship Positioning env

- `SHIP_POSITION_PROVIDER_NAME`: provider label for logs (default `SIM_PROVIDER`)
- `SHIP_POSITION_PROVIDER_URL`: provider endpoint, backend sends `?mmsi=...`
- `SHIP_POSITION_PROVIDER_TIMEOUT_MS`: request timeout (default `4000`)
- `SHIP_POSITION_TTL_MS`: fresh cache TTL in ms (default `60000`)
- `SHIP_POSITION_FALLBACK_TTL_MS`: failure fallback cache TTL in ms (default `1800000`)

## Headers for role simulation

- `x-user-id`: numeric user id, default `1`
- `x-role-code`: role code, default `DISPATCHER`

## Health check

`GET /healthz`

Expected response:

```json
{"ok":true,"db":"up"}
```

## Login API

`POST /api/auth/login`

Request body:

```json
{
  "username": "admin",
  "password": "admin123",
  "roleCode": "SUPER_ADMIN"
}
```

Response includes `token` and `user.roleCode`.

Built-in demo accounts (fallback when DB user is missing):

- `admin / admin123` -> `SUPER_ADMIN`
- `dispatcher / 123456` -> `DISPATCHER`
- `onsite / 123456` -> `ONSITE_SPECIALIST`
- `sales / 123456` -> `SALES`
- `finance / 123456` -> `FINANCE_MGMT`

## Endpoints

- `POST /api/auth/login`
- `GET /api/procurements/ships/options`
- `GET /api/procurements/buyer-accounts/options`
- `POST /api/procurements`
- `GET /api/procurements`
- `GET /api/procurements/:id`
- `POST /api/procurements/:id/start-sanding`
- `POST /api/procurements/:id/check-timeout`
- `POST /api/alerts/:id/close`
- `GET /api/ships`
- `GET /api/ships/:id`
- `GET /api/ships/mmsi/:mmsi/realtime-position`
- `GET /api/onsite/tasks`
- `POST /api/onsite/lighterings/:id/confirm-empty`
- `GET /api/onsite/stockins/batches/:batchId`
- `POST /api/onsite/stockins/confirm`
- `GET /api/onsite/voyages/options`
- `GET /api/onsite/expense-access`
- `POST /api/onsite/expenses`
- `GET /api/onsite/expenses`
- `GET /api/sales/batches/sellable`
- `POST /api/sales/orders`
- `GET /api/sales/orders`
- `GET /api/sales/orders/:id`
- `GET /api/finance/orders/pending-confirm`
- `POST /api/finance/orders/:id/weighing-slips`
- `POST /api/finance/orders/:id/finance-confirm`
- `POST /api/finance/orders/:id/payments/confirm`
- `POST /api/finance/payments/:id/reverse`
- `GET /api/finance/orders/:id/finance-summary`
- `GET /api/governance/approvals`
- `POST /api/governance/approvals`
- `GET /api/governance/approvals/:id`
- `POST /api/governance/approvals/:id/review`
- `GET /api/governance/versions`
- `GET /api/governance/audits`
- `GET /api/governance/reports/profit-trace`
