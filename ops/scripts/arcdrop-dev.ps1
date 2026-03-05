param(
    [Parameter(Mandatory = $false)]
    [ValidateSet("start", "stop", "status")]
    [string]$Command = "start"
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

# Resolve repository root deterministically from script location so the script works from any current directory.
$scriptDirectory = Split-Path -Parent $PSCommandPath
$repositoryRoot = Resolve-Path (Join-Path $scriptDirectory "..\..")

$composeFile = Join-Path $repositoryRoot "ops\docker\docker-compose.yml"
$envFile = Join-Path $repositoryRoot "ops\docker\.env"
$webProject = Join-Path $repositoryRoot "apps\web\ArcDrop.Web\ArcDrop.Web.csproj"
$healthUrl = "http://localhost:8080/health"

function Assert-ToolExists {
    param(
        [Parameter(Mandatory = $true)]
        [string]$ToolName
    )

    # Explicit tool checks fail fast with actionable messages instead of surfacing deep command errors.
    if (-not (Get-Command $ToolName -ErrorAction SilentlyContinue)) {
        throw "Required tool '$ToolName' was not found in PATH."
    }
}

function Assert-EnvHasNoPlaceholders {
    param(
        [Parameter(Mandatory = $true)]
        [string]$EnvFilePath
    )

    $lines = Get-Content -Path $EnvFilePath
    $placeholderMatches = $lines | Where-Object {
        $_ -match "^\s*ARCDROP_(ADMIN_PASSWORD|JWT_SIGNING_KEY|POSTGRES_PASSWORD)=" -and
        ($_ -match "replace-with" -or $_ -match "ChangeThis" -or $_ -match "^\s*ARCDROP_\w+=\s*$")
    }

    if ($placeholderMatches.Count -gt 0) {
        throw "The .env file still contains placeholder or empty secrets for critical ARCDROP values. Update ops/docker/.env before running start."
    }
}

function Start-BackendStack {
    Write-Host "Starting ArcDrop backend containers..." -ForegroundColor Cyan
    Push-Location $repositoryRoot
    try {
        docker compose --env-file $envFile -f $composeFile up -d --build
    }
    finally {
        Pop-Location
    }
}

function Wait-BackendHealth {
    param(
        [int]$MaxAttempts = 30,
        [int]$DelaySeconds = 2
    )

    Write-Host "Waiting for backend health endpoint..." -ForegroundColor Cyan

    # Polling keeps startup deterministic and avoids launching Blazor before API dependencies are available.
    for ($attempt = 1; $attempt -le $MaxAttempts; $attempt++) {
        try {
            $response = Invoke-WebRequest -UseBasicParsing -Uri $healthUrl -TimeoutSec 5
            if ($response.StatusCode -eq 200) {
                Write-Host "Backend is healthy at $healthUrl" -ForegroundColor Green
                return
            }
        }
        catch {
            # No output here by design; transient startup failures are expected while containers warm up.
        }

        Start-Sleep -Seconds $DelaySeconds
    }

    throw "Backend did not become healthy within $($MaxAttempts * $DelaySeconds) seconds."
}

function Start-BlazorHost {
    Write-Host "Starting ArcDrop Blazor host..." -ForegroundColor Cyan
    Push-Location $repositoryRoot
    try {
        dotnet run --project $webProject
    }
    finally {
        Pop-Location
    }
}

function Stop-BackendStack {
    Write-Host "Stopping ArcDrop backend containers..." -ForegroundColor Yellow
    Push-Location $repositoryRoot
    try {
        docker compose --env-file $envFile -f $composeFile down
    }
    finally {
        Pop-Location
    }
}

function Show-Status {
    Write-Host "ArcDrop container status:" -ForegroundColor Cyan
    Push-Location $repositoryRoot
    try {
        docker compose --env-file $envFile -f $composeFile ps
    }
    finally {
        Pop-Location
    }
}

Assert-ToolExists -ToolName "docker"
Assert-ToolExists -ToolName "dotnet"

if (-not (Test-Path -Path $envFile)) {
    throw "Missing environment file '$envFile'. Copy ops/docker/.env.example to ops/docker/.env and configure secrets."
}

switch ($Command) {
    "start" {
        Start-BackendStack
        Wait-BackendHealth
        Start-BlazorHost
        break
    }
    "stop" {
        Stop-BackendStack
        break
    }
    "status" {
        Show-Status
        break
    }
}
