# Install the Downpour Chrome native messaging host on Windows.
# Usage: .\install-native-host.ps1 -ExtensionId YOUR_32_CHAR_EXTENSION_ID
param(
    [Parameter(Mandatory = $true)]
    [string]$ExtensionId
)

$ErrorActionPreference = "Stop"

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$Root = Resolve-Path (Join-Path $ScriptDir "..\..")
$SourceHost = Join-Path $ScriptDir "downpour_host.py"
$Template = Join-Path $ScriptDir "com.dtek.downpour.json"

$SupportDir = Join-Path $env:APPDATA "Downpour"
$HostDir = Join-Path $SupportDir "native-host"
$HostPy = Join-Path $HostDir "downpour_host.py"
$YtdlpDest = Join-Path $SupportDir "yt-dlp.py"
$FfmpegDest = Join-Path $SupportDir "ffmpeg"
$Launcher = Join-Path $HostDir "run-downpour-host.bat"
$ManifestPath = Join-Path $HostDir "com.dtek.downpour.json"

if (-not (Test-Path $SourceHost)) {
    Write-Error "downpour_host.py not found at $SourceHost"
}

$ExtensionId = $ExtensionId.Trim()
if ($ExtensionId.Length -lt 16) {
    Write-Error "Extension ID looks invalid. Copy it from chrome://extensions (Developer mode on)."
}

New-Item -ItemType Directory -Force -Path $HostDir | Out-Null
Copy-Item -Force $SourceHost $HostPy

$YtdlpCandidates = @(
    $YtdlpDest,
    (Join-Path $Root "yt-dlp.py"),
    (Join-Path $ScriptDir "..\yt-dlp.py"),
    (Join-Path $ScriptDir "yt-dlp.py")
)
foreach ($candidate in $YtdlpCandidates) {
    if (Test-Path $candidate) {
        if ($candidate -ne $YtdlpDest) {
            Copy-Item -Force $candidate $YtdlpDest
        }
        Write-Host "  yt-dlp helper -> $YtdlpDest"
        break
    }
}

New-Item -ItemType Directory -Force -Path $FfmpegDest | Out-Null
$FfmpegCandidates = @(
    (Join-Path $ScriptDir "ffmpeg\ffmpeg.exe"),
    (Join-Path $SupportDir "ffmpeg\ffmpeg.exe")
)
$ffmpegInstalled = $false
foreach ($candidate in $FfmpegCandidates) {
    if (Test-Path $candidate) {
        Copy-Item -Force $candidate (Join-Path $FfmpegDest "ffmpeg.exe")
        Write-Host "  ffmpeg -> $FfmpegDest\ffmpeg.exe"
        $ffmpegInstalled = $true
        break
    }
}
if (-not $ffmpegInstalled) {
    Write-Warning "Bundled ffmpeg.exe not found. Install ffmpeg and ensure ffmpeg.exe is on PATH, or copy it to $FfmpegDest"
    Write-Warning "  winget install Gyan.FFmpeg"
}

$PythonExe = $null
foreach ($name in @("python", "python3", "py")) {
    $found = Get-Command $name -ErrorAction SilentlyContinue
    if ($found) { $PythonExe = $found.Source; break }
}
if (-not $PythonExe) {
    Write-Error "Python 3 not found. Install from https://www.python.org/downloads/ and enable 'Add python.exe to PATH'."
}

@(
    "@echo off",
    "`"$PythonExe`" `"$HostPy`""
) | Set-Content -Encoding ASCII $Launcher

$LauncherJson = $Launcher -replace '\\', '\\\\'
$Manifest = Get-Content $Template -Raw
$Manifest = $Manifest.Replace("HOST_PATH", $LauncherJson)
$Manifest = $Manifest.Replace("EXTENSION_ID", $ExtensionId)
$Utf8NoBom = New-Object System.Text.UTF8Encoding $false
[System.IO.File]::WriteAllText($ManifestPath, $Manifest, $Utf8NoBom)

$RegPath = "HKCU:\Software\Google\Chrome\NativeMessagingHosts\com.dtek.downpour"
New-Item -Path $RegPath -Force | Out-Null
Set-ItemProperty -Path $RegPath -Name "(default)" -Value $ManifestPath

Write-Host ""
Write-Host "Installed native host:"
Write-Host "  Registry: $RegPath"
Write-Host "  Manifest: $ManifestPath"
Write-Host "  Host:     $HostPy"
Write-Host "  Runner:   $Launcher"
Write-Host ""
Write-Host "Quit Chrome completely and reopen it."