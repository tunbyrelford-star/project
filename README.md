# Sand Logistics Project Environment Bootstrap

This repository provides the baseline runtime environment required by the SRS v3.2.1:

- Separate database and object storage
- Attachment files stored in S3-compatible storage
- Ready-to-use local services for backend integration

## 1) Prerequisites

- Docker Desktop (with Docker Compose v2)
- PowerShell 7+ (or Windows PowerShell)

Optional for app development:

- Node.js 20 LTS
- pnpm 9+
- Java 17 (if backend is built with Spring Boot)

## 2) Start the environment

From repository root:

```powershell
.\scripts\dev-up.ps1
```

This script will:

1. Create `.env` from `.env.example` if missing
2. Start MySQL, Redis, MinIO, and MinIO bucket initialization
3. Print service endpoints

## 3) Service endpoints

- MySQL: `localhost:3306`
- Redis: `localhost:6379`
- MinIO API: `http://localhost:9000`
- MinIO Console: `http://localhost:9001`

Default MinIO bucket for attachments: `sand-attachments`

## 4) Stop and inspect

```powershell
.\scripts\dev-status.ps1
.\scripts\dev-down.ps1
```

## 5) Configuration

Edit `.env` to change ports or credentials:

- `MYSQL_*`
- `REDIS_PORT`
- `MINIO_*`

## 6) Suggested app layout

```
apps/
  backend/      # API service (Token auth, RBAC, audit trail)
  admin-web/    # Back-office web
  mobile/       # H5/mini-program/mobile client
infra/
  mysql/init/
scripts/
```

## 7) Mapping to SRS requirements

- SRS 9.3 deployment requirement ("DB and object storage separated"): covered by MySQL + MinIO split services
- SRS 10.2 attachment storage ("OSS/S3"): covered by MinIO S3-compatible service
- SRS 9.1 performance support (cache): Redis included

