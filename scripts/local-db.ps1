param(
    [ValidateSet('Start', 'Stop')][string]$Action = 'Start',
    [string]$PgBin = 'C:\Program Files\PostgreSQL\16\bin'
)
$ErrorActionPreference = 'Stop'
$backendRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$localRoot = Join-Path $backendRoot '.local'
$dataPath = Join-Path $localRoot 'postgres'
$envPath = Join-Path $backendRoot '.env'
$pgCtl = Join-Path $PgBin 'pg_ctl.exe'
if (-not (Test-Path -LiteralPath $pgCtl)) { throw "PostgreSQL binaries not found in $PgBin" }

if ($Action -eq 'Stop') {
    if (Test-Path -LiteralPath (Join-Path $dataPath 'PG_VERSION')) {
        & $pgCtl -D $dataPath status *> $null
        if ($LASTEXITCODE -eq 0) {
            & $pgCtl -D $dataPath -m fast -w stop
            if ($LASTEXITCODE -ne 0) { throw 'Could not stop the local PostgreSQL instance.' }
        }
    }
    exit 0
}

if (-not (Test-Path -LiteralPath (Join-Path $dataPath 'PG_VERSION'))) {
    if (Test-Path -LiteralPath $envPath) {
        throw 'A .env already exists. Use that database, or move that file yourself before creating this isolated database.'
    }
    New-Item -ItemType Directory -Path $localRoot -Force | Out-Null
    $randomBytes = New-Object byte[] 48
    $rng = [Security.Cryptography.RandomNumberGenerator]::Create()
    $rng.GetBytes($randomBytes)
    $dbPassword = [Convert]::ToBase64String($randomBytes).Replace('+', '-').Replace('/', '_').TrimEnd('=')
    $rng.GetBytes($randomBytes)
    $jwtSecret = [Convert]::ToBase64String($randomBytes).Replace('+', '-').Replace('/', '_').TrimEnd('=')
    $rng.Dispose()
    $passwordFile = Join-Path $localRoot 'initdb-password'
    [IO.File]::WriteAllText($passwordFile, $dbPassword, [Text.UTF8Encoding]::new($false))
    try {
        & (Join-Path $PgBin 'initdb.exe') -D $dataPath -U gamification --auth=scram-sha-256 --encoding=UTF8 --locale=C --pwfile=$passwordFile
        if ($LASTEXITCODE -ne 0) { throw 'Could not initialize the isolated PostgreSQL instance.' }
    } finally {
        Remove-Item -LiteralPath $passwordFile -ErrorAction SilentlyContinue
    }
    $content = [IO.File]::ReadAllText((Join-Path $backendRoot '.env.example'))
    $content = $content.Replace('YOUR_LOCAL_PASSWORD', $dbPassword).Replace('localhost:5432', '127.0.0.1:55432')
    $content = $content.Replace('REPLACE_WITH_A_RANDOM_SECRET_OF_AT_LEAST_32_CHARACTERS', $jwtSecret)
    [IO.File]::WriteAllText($envPath, $content, [Text.UTF8Encoding]::new($false))
    $testContent = $content.Replace('NODE_ENV=development', 'NODE_ENV=test').Replace('/gamification?schema', '/gamification_test?schema')
    [IO.File]::WriteAllText((Join-Path $backendRoot '.env.test'), $testContent, [Text.UTF8Encoding]::new($false))
}

if (-not (Test-Path -LiteralPath $envPath)) { throw 'Local cluster exists but .env is missing. Restore its local credentials.' }
& $pgCtl -D $dataPath status *> $null
if ($LASTEXITCODE -ne 0) {
    & $pgCtl -D $dataPath -l (Join-Path $localRoot 'postgres.log') -o '-h 127.0.0.1 -p 55432' -w start
    if ($LASTEXITCODE -ne 0) { throw 'Could not start local PostgreSQL. Check .local/postgres.log and port 55432.' }
}

$urlLine = Get-Content -LiteralPath $envPath | Where-Object { $_.StartsWith('MIGRATION_DATABASE_URL=') } | Select-Object -First 1
if (-not $urlLine) { $urlLine = Get-Content -LiteralPath $envPath | Where-Object { $_.StartsWith('DATABASE_URL=') } | Select-Object -First 1 }
if (-not $urlLine) { throw 'DATABASE_URL missing from .env.' }
$databaseUri = [Uri]($urlLine.Substring($urlLine.IndexOf('=') + 1))
if ($databaseUri.Host -ne '127.0.0.1' -or $databaseUri.Port -ne 55432) { throw 'The .env does not refer to this local database.' }
$previousPassword = $env:PGPASSWORD
try {
    $env:PGPASSWORD = [Uri]::UnescapeDataString($databaseUri.UserInfo.Split(':', 2)[1])
    foreach ($databaseName in @('gamification', 'gamification_test')) {
        $exists = & (Join-Path $PgBin 'psql.exe') -h 127.0.0.1 -p 55432 -U gamification -d postgres -tAc "SELECT 1 FROM pg_database WHERE datname = '$databaseName'"
        if ($LASTEXITCODE -ne 0) { throw 'Could not connect to the local database.' }
        if ($exists -ne '1') {
            & (Join-Path $PgBin 'createdb.exe') -h 127.0.0.1 -p 55432 -U gamification $databaseName
            if ($LASTEXITCODE -ne 0) { throw "Could not create $databaseName" }
        }
    }
} finally {
    $env:PGPASSWORD = $previousPassword
}
Write-Output 'Local PostgreSQL ready on 127.0.0.1:55432. Credentials are only in ignored .env files.'
