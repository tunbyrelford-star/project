# Sand Logistics WeChat Mini Program

This is a native WeChat Mini Program scaffold for the sand logistics project.

## Prerequisites

- Node.js 18+ (current machine has Node.js 24)
- WeChat Developer Tools

## Quick start

1. Install dependencies:

```powershell
cd D:\项目汇总\projects\apps\mobile
npm install
```

2. Open WeChat Developer Tools and import this folder:

`D:\项目汇总\projects\apps\mobile`

3. Update `appid` in `project.config.json` with your real mini program AppID.
4. Update backend API URL in `config/env.js` if needed.
5. For local development, disable domain validation in Developer Tools.

## Local backend link (recommended)

Default API base URL:

`http://127.0.0.1:3000/api`

Before opening business pages, make sure backend is running:

```powershell
cd D:\项目汇总\projects\apps\backend
npm install
npm start
```

Then verify backend health:

`http://127.0.0.1:3000/healthz` should return `{"ok":true,"db":"up"}`.

For real-device debugging:

- Do NOT use `127.0.0.1` in mini program API base URL.
- Use your PC LAN address, for example:
  - `http://172.23.96.36:3000/api`
- Keep phone and PC on the same Wi-Fi/LAN.

Also verify login route:

`POST http://127.0.0.1:3000/api/auth/login`

If this route returns `404`, the process on port `3000` is likely an old backend instance.
Restart backend in `apps/backend` and retry.

## Login

Mini program now uses a unified role login page:

- Path: `pages/auth/login/index`
- All roles share the same login UI.
- Super admin has all permissions by default.

Demo accounts:

- `admin / admin123` -> 超级管理员
- `dispatcher / 123456` -> 采购/调度员
- `onsite / 123456` -> 现场/过驳专员
- `sales / 123456` -> 销售经理/销售员
- `finance / 123456` -> 财务/管理层

## Project structure

```text
app.js / app.json / app.wxss
components/common/   # shared UI skeleton components
styles/              # design tokens and base styles
pages/
  index/
  voyage/
  alerts/
  ui-kit/            # component preview page
config/
  env.js
utils/
  request.js
```

## Notes

- This scaffold is intentionally lightweight and ready for incremental feature development.
- It already includes:
  - page navigation
  - shared request utility
  - API base URL environment config
  - shared UI component skeleton
  - unified commercial button component system (`sl-button`)
  - design token system for stable visual consistency
