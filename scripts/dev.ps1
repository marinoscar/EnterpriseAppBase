<#
.SYNOPSIS
    EnterpriseAppBase Development Script for Windows

.DESCRIPTION
    Manages the EnterpriseAppBase development environment using Docker Compose.
    Supports starting, stopping, rebuilding, viewing logs, running tests, and Prisma operations.

.PARAMETER Action
    The action to perform: start, stop, restart, rebuild, logs, status, clean, test, prisma, help

.PARAMETER Service
    Optional: Specific service to target (api, web, db, nginx)
    For test action: api, web, all, coverage, e2e
    For prisma action: generate, migrate, studio, reset

.PARAMETER Otel
    Switch to include OpenTelemetry observability stack

.EXAMPLE
    .\dev.ps1 start
    Starts all services

.EXAMPLE
    .\dev.ps1 start -Otel
    Starts all services with OpenTelemetry observability stack

.EXAMPLE
    .\dev.ps1 rebuild
    Rebuilds and restarts all services

.EXAMPLE
    .\dev.ps1 logs api
    Shows logs for the API service

.EXAMPLE
    .\dev.ps1 test
    Runs all tests (API + Web)

.EXAMPLE
    .\dev.ps1 test api
    Runs API tests only

.EXAMPLE
    .\dev.ps1 test web ui
    Opens Vitest UI for frontend tests

.EXAMPLE
    .\dev.ps1 prisma migrate
    Runs Prisma migrations

.EXAMPLE
    .\dev.ps1 clean
    Stops services and removes volumes (resets database)
#>

param(
    [Parameter(Position = 0)]
    [ValidateSet("start", "stop", "restart", "rebuild", "logs", "status", "clean", "test", "prisma", "help")]
    [string]$Action = "help",

    [Parameter(Position = 1)]
    [string]$Service = "",

    [Parameter(Position = 2)]
    [string]$ExtraArg = "",

    [switch]$Otel
)

$ErrorActionPreference = "Stop"

# Colors for output
function Write-Info { Write-Host $args -ForegroundColor Cyan }
function Write-Success { Write-Host $args -ForegroundColor Green }
function Write-Warn { Write-Host $args -ForegroundColor Yellow }
function Write-Err { Write-Host $args -ForegroundColor Red }

# Get the repository root (parent of scripts folder)
$RepoRoot = Split-Path -Parent $PSScriptRoot
$ComposeDir = Join-Path $RepoRoot "infra\compose"
$BaseCompose = Join-Path $ComposeDir "base.compose.yml"
$DevCompose = Join-Path $ComposeDir "dev.compose.yml"
$OtelCompose = Join-Path $ComposeDir "otel.compose.yml"
$TestCompose = Join-Path $ComposeDir "test.compose.yml"
$ApiDir = Join-Path $RepoRoot "apps\api"
$WebDir = Join-Path $RepoRoot "apps\web"

# Verify compose files exist
if (-not (Test-Path $BaseCompose)) {
    Write-Err "ERROR: Base compose file not found at $BaseCompose"
    Write-Err "Make sure you're running this script from the EnterpriseAppBase repository."
    exit 1
}

function Show-Help {
    Write-Host ""
    Write-Info "EnterpriseAppBase Development Script"
    Write-Host "====================================="
    Write-Host ""
    Write-Host "Usage: .\dev.ps1 <action> [service/option] [-Otel]"
    Write-Host ""
    Write-Host "Actions:"
    Write-Host "  start     Start all services (or specific service)"
    Write-Host "  stop      Stop all services (or specific service)"
    Write-Host "  restart   Restart all services (or specific service)"
    Write-Host "  rebuild   Rebuild and restart all services (or specific service)"
    Write-Host "  logs      Show logs (follow mode). Optionally specify service"
    Write-Host "  status    Show status of all services"
    Write-Host "  test      Run tests. Options: api, web, all, coverage, e2e"
    Write-Host "  prisma    Prisma operations. Options: generate, migrate, studio, reset"
    Write-Host "  clean     Stop services and remove volumes (resets database)"
    Write-Host "  help      Show this help message"
    Write-Host ""
    Write-Host "Flags:"
    Write-Host "  -Otel     Include OpenTelemetry observability stack (Uptrace)"
    Write-Host ""
    Write-Host "Services: api, web, db, nginx"
    Write-Host ""
    Write-Host "Test Options:"
    Write-Host "  .\dev.ps1 test                 # Run all tests (API + Web)"
    Write-Host "  .\dev.ps1 test api             # Run API tests (Jest)"
    Write-Host "  .\dev.ps1 test api watch       # Run API tests in watch mode"
    Write-Host "  .\dev.ps1 test api coverage    # Run API tests with coverage"
    Write-Host "  .\dev.ps1 test web             # Run Web tests (Vitest)"
    Write-Host "  .\dev.ps1 test web ui          # Open Vitest UI for Web tests"
    Write-Host "  .\dev.ps1 test web coverage    # Run Web tests with coverage"
    Write-Host "  .\dev.ps1 test e2e             # Run E2E tests"
    Write-Host ""
    Write-Host "Prisma Options:"
    Write-Host "  .\dev.ps1 prisma generate      # Generate Prisma client"
    Write-Host "  .\dev.ps1 prisma migrate       # Run pending migrations (dev)"
    Write-Host "  .\dev.ps1 prisma migrate deploy # Apply migrations (production)"
    Write-Host "  .\dev.ps1 prisma studio        # Open Prisma Studio"
    Write-Host "  .\dev.ps1 prisma reset         # Reset database (destroys data)"
    Write-Host ""
    Write-Host "Examples:"
    Write-Host "  .\dev.ps1 start               # Start all services"
    Write-Host "  .\dev.ps1 start -Otel         # Start with observability stack"
    Write-Host "  .\dev.ps1 rebuild             # Rebuild and start all services"
    Write-Host "  .\dev.ps1 rebuild api         # Rebuild only the API service"
    Write-Host "  .\dev.ps1 logs api            # Follow API logs"
    Write-Host "  .\dev.ps1 test web ui         # Open Vitest UI in browser"
    Write-Host "  .\dev.ps1 status              # Show service status"
    Write-Host "  .\dev.ps1 clean               # Reset everything (destroys data)"
    Write-Host ""
    Write-Host "URLs (after start):"
    Write-Host "  Application:    http://localhost"
    Write-Host "  API:            http://localhost/api"
    Write-Host "  Swagger UI:     http://localhost/api/docs"
    Write-Host "  API Health:     http://localhost/api/health/live"
    Write-Host "  Uptrace:        http://localhost:14318 (with -Otel flag)"
    Write-Host ""
}

function Get-ComposeCommand {
    $cmd = "docker compose -f `"$BaseCompose`" -f `"$DevCompose`""
    if ($Otel) {
        $cmd += " -f `"$OtelCompose`""
    }
    return $cmd
}

function Invoke-DockerCompose {
    param([string[]]$Arguments)
    $baseCmd = Get-ComposeCommand
    $cmd = "$baseCmd $($Arguments -join ' ')"
    Write-Info "Running: $cmd"
    Push-Location $ComposeDir
    try {
        Invoke-Expression $cmd
    } finally {
        Pop-Location
    }
}

function Start-Services {
    Write-Info "Starting EnterpriseAppBase services..."
    if ($Otel) {
        Write-Info "Including OpenTelemetry observability stack..."
    }
    if ($Service) {
        Invoke-DockerCompose @("up", "-d", $Service)
    } else {
        Invoke-DockerCompose @("up", "-d")
    }
    Write-Success "Services started!"
    Write-Host ""
    Write-Info "Application:  http://localhost"
    Write-Info "Swagger UI:   http://localhost/api/docs"
    if ($Otel) {
        Write-Info "Uptrace:      http://localhost:14318"
    }
}

function Stop-Services {
    Write-Info "Stopping EnterpriseAppBase services..."
    if ($Service) {
        Invoke-DockerCompose @("stop", $Service)
    } else {
        Invoke-DockerCompose @("down")
    }
    Write-Success "Services stopped!"
}

function Restart-Services {
    Write-Info "Restarting EnterpriseAppBase services..."
    if ($Service) {
        Invoke-DockerCompose @("restart", $Service)
    } else {
        Invoke-DockerCompose @("down")
        Invoke-DockerCompose @("up", "-d")
    }
    Write-Success "Services restarted!"
}

function Rebuild-Services {
    Write-Info "Rebuilding EnterpriseAppBase services..."
    if ($Otel) {
        Write-Info "Including OpenTelemetry observability stack..."
    }
    if ($Service) {
        Invoke-DockerCompose @("up", "-d", "--build", $Service)
    } else {
        Invoke-DockerCompose @("up", "-d", "--build")
    }
    Write-Success "Services rebuilt and started!"
    Write-Host ""
    Write-Info "Application:  http://localhost"
    Write-Info "Swagger UI:   http://localhost/api/docs"
    if ($Otel) {
        Write-Info "Uptrace:      http://localhost:14318"
    }
}

function Show-Logs {
    Write-Info "Showing logs (Ctrl+C to exit)..."
    if ($Service) {
        Invoke-DockerCompose @("logs", "-f", $Service)
    } else {
        Invoke-DockerCompose @("logs", "-f")
    }
}

function Show-Status {
    Write-Info "Service Status:"
    Invoke-DockerCompose @("ps")
}

function Clean-Services {
    Write-Warn "WARNING: This will stop all services and DELETE all data (database, volumes)!"
    $confirmation = Read-Host "Are you sure? Type 'yes' to confirm"
    if ($confirmation -eq "yes") {
        Write-Info "Cleaning up EnterpriseAppBase services and volumes..."
        Invoke-DockerCompose @("down", "-v")
        Write-Success "Cleanup complete! All data has been removed."
    } else {
        Write-Info "Cleanup cancelled."
    }
}

function Run-ApiTests {
    param([string]$Mode = "")

    Push-Location $ApiDir
    try {
        switch ($Mode.ToLower()) {
            "watch" {
                Write-Info "Running API tests in watch mode..."
                npm run test:watch
            }
            "coverage" {
                Write-Info "Running API tests with coverage..."
                npm run test:cov
            }
            "e2e" {
                Write-Info "Running API E2E tests..."
                npm run test:e2e
            }
            "unit" {
                Write-Info "Running API unit tests..."
                npm run test:unit
            }
            default {
                Write-Info "Running API tests..."
                npm test
            }
        }
    } finally {
        Pop-Location
    }
}

function Run-WebTests {
    param([string]$Mode = "")

    Push-Location $WebDir
    try {
        switch ($Mode.ToLower()) {
            "ui" {
                Write-Info "Opening Vitest UI for Web tests..."
                Write-Info "Test UI will be available at: http://localhost:51204/__vitest__/"
                npm run test:ui
            }
            "watch" {
                Write-Info "Running Web tests in watch mode..."
                npm run test:watch
            }
            "coverage" {
                Write-Info "Running Web tests with coverage..."
                npm run test:coverage
            }
            default {
                Write-Info "Running Web tests..."
                npm run test:run
            }
        }
    } finally {
        Pop-Location
    }
}

function Run-E2ETests {
    Write-Info "Running E2E tests..."

    # Start test database
    Write-Info "Starting test database..."
    Push-Location $ComposeDir
    try {
        docker compose -f "$TestCompose" up -d
        Start-Sleep -Seconds 3
    } finally {
        Pop-Location
    }

    # Run E2E tests from API
    Push-Location $ApiDir
    try {
        $env:DATABASE_URL = "postgresql://postgres:postgres@localhost:5433/enterprise_app_test"
        npm run test:e2e
    } finally {
        Pop-Location
    }

    Write-Info "Stopping test database..."
    Push-Location $ComposeDir
    try {
        docker compose -f "$TestCompose" down
    } finally {
        Pop-Location
    }
}

function Run-Tests {
    switch ($Service.ToLower()) {
        "api" {
            Run-ApiTests -Mode $ExtraArg
        }
        "web" {
            Run-WebTests -Mode $ExtraArg
        }
        "e2e" {
            Run-E2ETests
        }
        "coverage" {
            Write-Info "Running all tests with coverage..."
            Run-ApiTests -Mode "coverage"
            Write-Host ""
            Run-WebTests -Mode "coverage"
        }
        default {
            Write-Info "Running all tests..."
            Run-ApiTests
            if ($LASTEXITCODE -eq 0) {
                Write-Host ""
                Run-WebTests
            } else {
                Write-Err "API tests failed. Stopping."
                exit 1
            }
        }
    }
}

function Invoke-Prisma {
    Push-Location $ApiDir
    try {
        switch ($Service.ToLower()) {
            "generate" {
                Write-Info "Generating Prisma client..."
                npx prisma generate
                Write-Success "Prisma client generated!"
            }
            "migrate" {
                if ($ExtraArg.ToLower() -eq "deploy") {
                    Write-Info "Applying migrations (production mode)..."
                    npx prisma migrate deploy
                } else {
                    Write-Info "Running migrations (dev mode)..."
                    npx prisma migrate dev
                }
                Write-Success "Migrations complete!"
            }
            "studio" {
                Write-Info "Opening Prisma Studio..."
                Write-Info "Studio will be available at: http://localhost:5555"
                npx prisma studio
            }
            "reset" {
                Write-Warn "WARNING: This will reset the database and DELETE all data!"
                $confirmation = Read-Host "Are you sure? Type 'yes' to confirm"
                if ($confirmation -eq "yes") {
                    Write-Info "Resetting database..."
                    npx prisma migrate reset --force
                    Write-Success "Database reset complete!"
                } else {
                    Write-Info "Reset cancelled."
                }
            }
            "seed" {
                Write-Info "Seeding database..."
                npx prisma db seed
                Write-Success "Database seeded!"
            }
            default {
                Write-Host ""
                Write-Info "Prisma Commands"
                Write-Host "==============="
                Write-Host ""
                Write-Host "Usage: .\dev.ps1 prisma <command>"
                Write-Host ""
                Write-Host "Commands:"
                Write-Host "  generate       Generate Prisma client after schema changes"
                Write-Host "  migrate        Run pending migrations (interactive, dev mode)"
                Write-Host "  migrate deploy Apply migrations (non-interactive, production)"
                Write-Host "  studio         Open Prisma Studio GUI"
                Write-Host "  reset          Reset database (destroys all data)"
                Write-Host "  seed           Run database seed script"
                Write-Host ""
                Write-Host "Examples:"
                Write-Host "  .\dev.ps1 prisma generate"
                Write-Host "  .\dev.ps1 prisma migrate"
                Write-Host "  .\dev.ps1 prisma studio"
                Write-Host ""
            }
        }
    } finally {
        Pop-Location
    }
}

# Main execution
switch ($Action) {
    "start"   { Start-Services }
    "stop"    { Stop-Services }
    "restart" { Restart-Services }
    "rebuild" { Rebuild-Services }
    "logs"    { Show-Logs }
    "status"  { Show-Status }
    "test"    { Run-Tests }
    "prisma"  { Invoke-Prisma }
    "clean"   { Clean-Services }
    "help"    { Show-Help }
    default   { Show-Help }
}
