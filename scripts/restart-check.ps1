# Requires the Postgres container and the named volume reactiv_pg.
# Stops and starts the config-service process only. Does not run docker compose down, and does not delete the volume.

$ErrorActionPreference = "Stop"
$ProgressPreference = "SilentlyContinue"
Add-Type -AssemblyName System.Net.Http

$RepoRoot = Split-Path -Parent $PSScriptRoot
$ServicePort = 4019
$VolumeName = "reactiv_pg"

<#
.SYNOPSIS
Reads KEY=value lines from the repo .env file.

Purpose: give the config-service process the settings it does not read from disk itself.
Inputs: Path, the env file.
Side effects: none. The values are not written to the host.
#>
function Read-DotEnvFile {
  param([string]$Path)
  # A missing file cannot boot the service. The message does not invent values.
  if (-not (Test-Path -LiteralPath $Path)) {
    throw "Missing $Path"
  }
  $values = @{}
  foreach ($line in Get-Content -LiteralPath $Path) {
    # Comments and blank lines are not settings.
    $trimmed = $line.Trim()
    if ($trimmed -eq "" -or $trimmed.StartsWith("#")) {
      continue
    }
    $separator = $trimmed.IndexOf("=")
    if ($separator -le 0) {
      continue
    }
    $key = $trimmed.Substring(0, $separator).Trim()
    $value = $trimmed.Substring($separator + 1).Trim()
    if ($key -ne "") {
      # The first equals sign ends the name. The value is not printed.
      $values[$key] = $value
    }
  }
  return $values
}

<#
.SYNOPSIS
Copies one env-file value into this process when the shell left it unset.

Purpose: migrate, seed, and the service share the file without printing it.
Inputs: Values, the parsed file. Name, the variable to copy.
Side effects: sets the process environment when that name is unset.
#>
function Set-EnvFromFileWhenMissing {
  param($Values, [string]$Name)
  # A shell assignment stays, including a blank one. The file fills only an unset name.
  if (Test-Path -LiteralPath "Env:$Name") {
    return
  }
  if (-not $Values.ContainsKey($Name)) {
    return
  }
  Set-Item -Path "Env:$Name" -Value $Values[$Name]
}

<#
.SYNOPSIS
Writes a log file with connection strings and the service token removed.

Purpose: a failed boot can be read without copying DATABASE_URL or the bearer token into the note.
Inputs: Path, the log file. Secret, the token text to hide.
Side effects: writes matching lines to the host output.
#>
function Write-RedactedLog {
  param([string]$Path, [string]$Secret)
  if (-not (Test-Path -LiteralPath $Path)) {
    return
  }
  foreach ($line in Get-Content -LiteralPath $Path) {
    $redacted = $line
    if ($Secret -ne "" -and $redacted.Contains($Secret)) {
      # The token is replaced. The rest of the line can still name the failure.
      $redacted = $redacted.Replace($Secret, "[redacted]")
    }
    if ($redacted -match "postgres://") {
      # A driver error can include the database URL. That URL stays off the output.
      Write-Output "[redacted log line]"
      continue
    }
    Write-Output $redacted
  }
}

<#
.SYNOPSIS
Starts one config-service process on the restart-check port.

Purpose: the process uses the same DATABASE_URL as the named volume, on a port this script owns.
Inputs: StdoutPath and StderrPath, the logs for this start.
Side effects: starts cmd.exe, which starts pnpm and the service. The caller stops that process.
#>
function Start-OwnedConfigService {
  param([string]$StdoutPath, [string]$StderrPath)
  # PORT wins over CONFIG_SERVICE_PORT so this check does not bind the editor's usual port.
  $env:HOST = "127.0.0.1"
  $env:PORT = "$ServicePort"
  # cmd owns the pnpm child. taskkill /T stops that tree.
  return Start-Process -FilePath "cmd.exe" -ArgumentList "/c pnpm --dir apps/config-service exec tsx src/index.ts" -WorkingDirectory $RepoRoot -PassThru -WindowStyle Hidden -RedirectStandardOutput $StdoutPath -RedirectStandardError $StderrPath
}

<#
.SYNOPSIS
Stops the config-service process this script started.

Purpose: the restart closes that process and leaves Postgres running.
Inputs: Process, the cmd process from Start-OwnedConfigService.
Side effects: taskkill of that process tree. Does not stop Docker.
#>
function Stop-OwnedConfigService {
  param($Process)
  if ($null -eq $Process) {
    return
  }
  if ($Process.HasExited) {
    return
  }
  # /T ends pnpm and the node process. /F does not wait for a graceful HTTP close.
  & taskkill.exe /PID $Process.Id /T /F | Out-Null
  $null = $Process.WaitForExit(15000)
}

<#
.SYNOPSIS
Waits until GET /health returns ok.

Purpose: the next configuration call runs only after this process is listening.
Inputs: none. The port is $ServicePort.
Side effects: none. Throws when the deadline passes.
#>
function Wait-ServiceHealth {
  $deadline = (Get-Date).AddSeconds(40)
  do {
    try {
      # Health does not open Postgres and does not require the bearer token.
      $response = Invoke-WebRequest -Uri "http://127.0.0.1:$ServicePort/health" -UseBasicParsing -TimeoutSec 2
      if ($response.StatusCode -eq 200 -and $response.Content -match '"status"\s*:\s*"ok"') {
        return
      }
    } catch {
      # The process is still binding, or it has not been started yet.
    }
    Start-Sleep -Milliseconds 300
  } while ((Get-Date) -lt $deadline)
  throw "The configuration service did not answer /health on port $ServicePort."
}

<#
.SYNOPSIS
Waits until nothing accepts connections on the service port.

Purpose: the restart must observe a stopped process before the next start.
Inputs: none. The port is $ServicePort.
Side effects: none. Throws when the port stays open.
#>
function Wait-ServicePortClosed {
  $deadline = (Get-Date).AddSeconds(20)
  do {
    $client = New-Object System.Net.Sockets.TcpClient
    try {
      $client.Connect("127.0.0.1", $ServicePort)
      # A successful connect means the old process, or another process, is still listening.
      $open = $true
    } catch {
      $open = $false
    } finally {
      $client.Dispose()
    }
    if (-not $open) {
      return
    }
    Start-Sleep -Milliseconds 300
  } while ((Get-Date) -lt $deadline)
  throw "Port $ServicePort stayed open after the config-service process was stopped."
}

<#
.SYNOPSIS
Reports whether a TCP port accepts connections.

Purpose: the restart check refuses to kill a process it did not start.
Inputs: Port, the TCP port.
Side effects: opens and closes one socket.
#>
function Test-PortOpen {
  param([int]$Port)
  $client = New-Object System.Net.Sockets.TcpClient
  try {
    $client.Connect("127.0.0.1", $Port)
    return $true
  } catch {
    return $false
  } finally {
    $client.Dispose()
  }
}

<#
.SYNOPSIS
Calls the configuration service with HttpClient.

Purpose: GET and PUT keep the strong ETag quotes without a shell, and do not print the bearer token.
Inputs: Method, the HTTP method. Url, the configuration URL. BodyFile, the JSON file for PUT.
IfMatch, the strong ETag. Work, the directory for the response body.
Side effects: writes the response body. Does not write the token.
#>
function Invoke-ConfigRequest {
  param(
    [string]$Method,
    [string]$Url,
    [string]$BodyFile,
    [string]$IfMatch,
    [string]$Work
  )
  $outputFile = Join-Path $Work "body-$Method.json"
  $client = New-Object System.Net.Http.HttpClient
  $client.Timeout = [TimeSpan]::FromSeconds(20)
  try {
    # The method is GET or PUT. The URL is the demo configuration on this script's port.
    $message = New-Object System.Net.Http.HttpRequestMessage ([System.Net.Http.HttpMethod]::new($Method), $Url)
    $null = $message.Headers.TryAddWithoutValidation("Authorization", "Bearer $($env:CONFIG_SERVICE_TOKEN)")
    $null = $message.Headers.TryAddWithoutValidation("Accept", "application/json")
    if ($IfMatch) {
      # The quotes stay in the header value. Example: "1".
      $null = $message.Headers.TryAddWithoutValidation("If-Match", $IfMatch)
    }
    if ($BodyFile) {
      # UTF-8 JSON. charset is allowed on application/json.
      $json = [System.IO.File]::ReadAllText($BodyFile)
      $message.Content = New-Object System.Net.Http.StringContent ($json, [System.Text.Encoding]::UTF8, "application/json")
    }
    $response = $client.SendAsync($message).GetAwaiter().GetResult()
    $body = $response.Content.ReadAsStringAsync().GetAwaiter().GetResult()
    [System.IO.File]::WriteAllText($outputFile, $body)
    $etag = $null
    if ($null -ne $response.Headers.ETag) {
      # ToString includes the quotes on a strong tag.
      $etag = $response.Headers.ETag.ToString()
    }
    return @{ Code = [int]$response.StatusCode; BodyFile = $outputFile; Etag = $etag }
  } finally {
    if ($null -ne $message) {
      $message.Dispose()
    }
    if ($null -ne $client) {
      $client.Dispose()
    }
  }
}

<#
.SYNOPSIS
Runs the document helper and returns its JSON summary.

Purpose: title and revision are read without printing the configuration body.
Inputs: Helper, the node script. Mode, summarize, mutate, restore, or error-code.
Source, the configuration file. Dest, the editable JSON file. Title, the distinctive title.
Side effects: may write Dest. Throws when node exits non-zero.
#>
function Invoke-DocumentHelper {
  param(
    [string]$Helper,
    [string]$Mode,
    [string]$Source,
    [string]$Dest,
    [string]$Title
  )
  $raw = & node $Helper $Mode $Source $Dest $Title
  if ($LASTEXITCODE -ne 0) {
    throw "The configuration document could not be prepared."
  }
  return ($raw | Out-String).Trim() | ConvertFrom-Json
}

<#
.SYNOPSIS
Asserts the named volume and the running Postgres service.

Purpose: the restart evidence is a service process against the same volume, not a deleted database.
Inputs: none. Compose uses the repo compose file.
Side effects: none. Throws when the volume or the container is missing.
#>
function Assert-PostgresVolumeStillUp {
  # inspect exits non-zero when the named volume does not exist.
  & docker volume inspect $VolumeName *> $null
  if ($LASTEXITCODE -ne 0) {
    throw "Named volume $VolumeName is not present."
  }
  $services = & docker compose ps --status running --services
  if ($LASTEXITCODE -ne 0) {
    throw "docker compose ps failed."
  }
  if (@($services) -notcontains "postgres") {
    throw "The Postgres container is not running."
  }
}

Set-Location $RepoRoot
$envFile = Join-Path $RepoRoot ".env"
$fileValues = Read-DotEnvFile -Path $envFile
foreach ($name in @("CONFIG_SERVICE_TOKEN", "DATABASE_URL", "DEMO_TENANT_ID", "DEMO_CONFIGURATION_ID")) {
  # Unset names come from the file. Values already in the process stay.
  Set-EnvFromFileWhenMissing -Values $fileValues -Name $name
}
if (-not $env:CONFIG_SERVICE_TOKEN -or $env:CONFIG_SERVICE_TOKEN.Trim() -eq "" -or $env:CONFIG_SERVICE_TOKEN.Trim() -eq "replace-me") {
  throw "CONFIG_SERVICE_TOKEN is missing or still the example placeholder."
}
if (-not $env:DATABASE_URL -or $env:DATABASE_URL.Trim() -eq "") {
  throw "DATABASE_URL is missing."
}
if (-not $env:DEMO_TENANT_ID -or $env:DEMO_TENANT_ID.Trim() -eq "") {
  throw "DEMO_TENANT_ID is missing."
}
if (-not $env:DEMO_CONFIGURATION_ID -or $env:DEMO_CONFIGURATION_ID.Trim() -eq "") {
  throw "DEMO_CONFIGURATION_ID is missing."
}
if (Test-PortOpen -Port $ServicePort) {
  throw "Port $ServicePort is already in use. This script will not stop a process it did not start."
}

# Postgres and the named volume stay up for the whole check. The service container profile is not started.
& docker compose up -d postgres
if ($LASTEXITCODE -ne 0) {
  throw "docker compose up postgres failed."
}
$readyDeadline = (Get-Date).AddSeconds(60)
do {
  # pg_isready does not print the database URL.
  & docker compose exec -T postgres pg_isready -U reactiv -d reactiv *> $null
  if ($LASTEXITCODE -eq 0) {
    break
  }
  if ((Get-Date) -gt $readyDeadline) {
    throw "Postgres did not become ready."
  }
  Start-Sleep -Seconds 1
} while ($true)
Assert-PostgresVolumeStillUp

& pnpm db:migrate
if ($LASTEXITCODE -ne 0) {
  throw "db:migrate failed."
}
& pnpm db:seed
if ($LASTEXITCODE -ne 0) {
  throw "db:seed failed."
}

$work = Join-Path $env:TEMP "reactiv-restart-check"
New-Item -ItemType Directory -Force -Path $work | Out-Null
$helper = Join-Path $work "restart-document.mjs"
$helperSource = @'
import { readFileSync, writeFileSync } from "node:fs";

/**
 * Reads the first text section.
 *
 * Purpose: the restart check compares that section's title.
 * Inputs: document, a configuration or an editable document.
 * Side effects: none.
 */
function firstText(document) {
  // The seed and a later edit both keep at least one text section.
  const sections = document?.data?.sections;
  if (!Array.isArray(sections)) {
    return undefined;
  }
  return sections.find((section) => section && section.type === "text");
}

/**
 * Writes one JSON summary or an editable document.
 *
 * Purpose: PowerShell compares title and revision without printing the body or the token.
 * Inputs: argv mode, source path, destination path, and the distinctive title.
 * Side effects: may write the destination file. Prints one JSON object.
 */
function main() {
  // mode is summarize, mutate, restore, or error-code.
  const mode = process.argv[2];
  const sourcePath = process.argv[3];
  const destPath = process.argv[4];
  const title = process.argv[5];
  const document = JSON.parse(readFileSync(sourcePath, "utf8"));
  if (mode === "error-code") {
    // The code is the contract field. The body is not printed.
    const code = document?.error?.code ?? "unreadable";
    process.stdout.write(String(code));
    return;
  }
  const section = firstText(document);
  if (section === undefined || typeof section.title !== "string" || typeof document.revision !== "number") {
    process.stderr.write("The configuration has no text title or revision.\n");
    process.exit(1);
  }
  if (mode === "summarize") {
    process.stdout.write(JSON.stringify({ title: section.title, revision: document.revision }));
    return;
  }
  if (mode === "mutate") {
    // The source file stays the original document. The destination is the PUT body.
    const previousTitle = section.title;
    section.title = title;
    writeFileSync(destPath, JSON.stringify({ schemaVersion: document.schemaVersion, data: document.data }));
    process.stdout.write(JSON.stringify({ previousTitle, title: section.title, revision: document.revision }));
    return;
  }
  if (mode === "restore") {
    // schemaVersion and data are the editable document. id and revision are not sent.
    writeFileSync(destPath, JSON.stringify({ schemaVersion: document.schemaVersion, data: document.data }));
    process.stdout.write(JSON.stringify({ title: section.title, revision: document.revision }));
    return;
  }
  process.stderr.write("Unknown mode.\n");
  process.exit(1);
}

main();
'@
$utf8 = New-Object System.Text.UTF8Encoding $false
[System.IO.File]::WriteAllText($helper, $helperSource, $utf8)

$owned = $null
$stdoutLog = Join-Path $work "service-out.txt"
$stderrLog = Join-Path $work "service-err.txt"
$configUrl = "http://127.0.0.1:$ServicePort/v1/configurations/$($env:DEMO_CONFIGURATION_ID)"
try {
  $owned = Start-OwnedConfigService -StdoutPath $stdoutLog -StderrPath $stderrLog
  try {
    Wait-ServiceHealth
  } catch {
    Write-RedactedLog -Path $stderrLog -Secret $env:CONFIG_SERVICE_TOKEN
    throw
  }
  $loaded = Invoke-ConfigRequest -Method "GET" -Url $configUrl -Work $work
  if ($loaded.Code -ne "200") {
    $code = "unreadable"
    if (Test-Path -LiteralPath $loaded.BodyFile) {
      $code = (& node $helper error-code $loaded.BodyFile "" "").Trim()
    }
    throw "GET before the save returned $($loaded.Code) $code."
  }
  Copy-Item -LiteralPath $loaded.BodyFile -Destination (Join-Path $work "original.json") -Force
  $stamp = (Get-Date).ToUniversalTime().ToString("yyyy-MM-ddTHH:mm:ss.fffZ")
  $distinctive = "P05 restart $stamp"
  $mutated = Invoke-DocumentHelper -Helper $helper -Mode "mutate" -Source (Join-Path $work "original.json") -Dest (Join-Path $work "put.json") -Title $distinctive
  $etag = $loaded.Etag
  if (-not $etag) {
    throw "GET did not return an ETag."
  }
  $saved = Invoke-ConfigRequest -Method "PUT" -Url $configUrl -BodyFile (Join-Path $work "put.json") -IfMatch $etag -Work $work
  if ($saved.Code -ne "200") {
    $code = (& node $helper error-code $saved.BodyFile "" "").Trim()
    throw "PUT returned $($saved.Code) $code."
  }
  $stored = Invoke-DocumentHelper -Helper $helper -Mode "summarize" -Source $saved.BodyFile -Dest "" -Title ""
  if ($stored.title -ne $distinctive) {
    throw "PUT did not store the distinctive title."
  }
  Write-Output "Saved title=$($stored.title) revision=$($stored.revision)"
  Stop-OwnedConfigService -Process $owned
  $owned = $null
  Wait-ServicePortClosed
  Assert-PostgresVolumeStillUp
  $stdoutLog = Join-Path $work "service-restart-out.txt"
  $stderrLog = Join-Path $work "service-restart-err.txt"
  $owned = Start-OwnedConfigService -StdoutPath $stdoutLog -StderrPath $stderrLog
  try {
    Wait-ServiceHealth
  } catch {
    Write-RedactedLog -Path $stderrLog -Secret $env:CONFIG_SERVICE_TOKEN
    throw
  }
  $afterDir = Join-Path $work "after"
  New-Item -ItemType Directory -Force -Path $afterDir | Out-Null
  $restarted = Invoke-ConfigRequest -Method "GET" -Url $configUrl -Work $afterDir
  if ($restarted.Code -ne "200") {
    $code = "unreadable"
    if (Test-Path -LiteralPath $restarted.BodyFile) {
      $code = (& node $helper error-code $restarted.BodyFile "" "").Trim()
    }
    throw "GET after restart returned $($restarted.Code) $code."
  }
  $after = Invoke-DocumentHelper -Helper $helper -Mode "summarize" -Source $restarted.BodyFile -Dest "" -Title ""
  if ($after.title -ne $stored.title -or $after.revision -ne $stored.revision) {
    throw "Restart mismatch title=$($after.title) revision=$($after.revision) expected title=$($stored.title) revision=$($stored.revision)."
  }
  Write-Output "After restart title=$($after.title) revision=$($after.revision) volume=$VolumeName"
  Assert-PostgresVolumeStillUp
  $restoreBody = Join-Path $work "restore.json"
  $previous = Invoke-DocumentHelper -Helper $helper -Mode "restore" -Source (Join-Path $work "original.json") -Dest $restoreBody -Title ""
  $restartEtag = $restarted.Etag
  if (-not $restartEtag) {
    throw "GET after restart did not return an ETag."
  }
  $restoreDir = Join-Path $work "restore"
  New-Item -ItemType Directory -Force -Path $restoreDir | Out-Null
  $restored = Invoke-ConfigRequest -Method "PUT" -Url $configUrl -BodyFile $restoreBody -IfMatch $restartEtag -Work $restoreDir
  if ($restored.Code -ne "200") {
    $code = (& node $helper error-code $restored.BodyFile "" "").Trim()
    throw "Restore PUT returned $($restored.Code) $code."
  }
  Write-Output "Restored previous title=$($previous.title)"
  Write-Output "P05 behavior passed. The named volume survived the config-service restart. docker compose down -v was not run."
} finally {
  # The process this script started is stopped. The Postgres container is left running.
  if ($null -ne $owned) {
    Stop-OwnedConfigService -Process $owned
  }
}
