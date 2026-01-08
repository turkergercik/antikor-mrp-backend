# Start Docker Desktop if not running
$dockerProcess = Get-Process "Docker Desktop" -ErrorAction SilentlyContinue

if (-not $dockerProcess) {
    Write-Host "Starting Docker Desktop..." -ForegroundColor Yellow
    Start-Process "C:\Program Files\Docker\Docker\Docker Desktop.exe"
    
    # Wait for Docker to be ready
    Write-Host "Waiting for Docker to start..." -ForegroundColor Yellow
    $maxAttempts = 30
    $attempt = 0
    
    while ($attempt -lt $maxAttempts) {
        $attempt++
        try {
            docker ps | Out-Null
            Write-Host "Docker is ready!" -ForegroundColor Green
            break
        } catch {
            Write-Host "." -NoNewline -ForegroundColor Yellow
            Start-Sleep -Seconds 2
        }
    }
    
    if ($attempt -eq $maxAttempts) {
        Write-Host "`nDocker failed to start in time. Please start it manually." -ForegroundColor Red
        exit 1
    }
} else {
    Write-Host "Docker Desktop is already running." -ForegroundColor Green
}

# Start PostgreSQL container
Write-Host "Starting PostgreSQL container..." -ForegroundColor Cyan
docker compose -f docker-compose.local.yml up -d

if ($LASTEXITCODE -eq 0) {
    Write-Host "PostgreSQL container started successfully!" -ForegroundColor Green
} else {
    Write-Host "Failed to start PostgreSQL container." -ForegroundColor Red
    exit 1
}
