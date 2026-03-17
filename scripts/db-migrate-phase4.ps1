param(
  [string]$DbHost = "127.0.0.1",
  [int]$Port = 3306,
  [string]$User = "root",
  [string]$Database = "sand_logistics",
  [string]$Password = ""
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$root = Split-Path -Parent $PSScriptRoot
$sqlPath = Join-Path $root "infra/mysql/migrations/20260316_003_phase4_procurement_dispatch_up.sql"
$sqlRelative = "infra/mysql/migrations/" + (Split-Path -Leaf $sqlPath)
if (-not (Test-Path $sqlPath)) {
  throw "Migration file not found: $sqlPath"
}

if ($Password) {
  $env:MYSQL_PWD = $Password
}

mysql --default-character-set=utf8mb4 -h $DbHost -P $Port -u $User $Database --execute="source `"$sqlRelative`";"

if ($LASTEXITCODE -ne 0) {
  throw "Phase 4 migration failed."
}

Write-Host "Phase 4 migration completed."





