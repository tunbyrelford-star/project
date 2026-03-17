Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$root = Split-Path -Parent $PSScriptRoot
Set-Location $root

if (-not (Test-Path ".env")) {
  Copy-Item ".env.example" ".env"
  Write-Host "Created .env from .env.example"
}

Write-Host "Starting infrastructure containers..."
docker compose --env-file ".env" up -d

Write-Host ""
Write-Host "Service status:"
docker compose --env-file ".env" ps

Write-Host ""
Write-Host "MySQL:  localhost:$((Get-Content .env | Where-Object { $_ -match '^MYSQL_PORT=' }) -replace 'MYSQL_PORT=','')"
Write-Host "Redis:  localhost:$((Get-Content .env | Where-Object { $_ -match '^REDIS_PORT=' }) -replace 'REDIS_PORT=','')"
Write-Host "MinIO API:      http://localhost:$((Get-Content .env | Where-Object { $_ -match '^MINIO_API_PORT=' }) -replace 'MINIO_API_PORT=','')"
Write-Host "MinIO Console:  http://localhost:$((Get-Content .env | Where-Object { $_ -match '^MINIO_CONSOLE_PORT=' }) -replace 'MINIO_CONSOLE_PORT=','')"

