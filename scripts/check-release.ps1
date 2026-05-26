param(
    [string]$Version = "0.1.4"
)

$ErrorActionPreference = "Stop"
$RootDir = Split-Path $PSScriptRoot -Parent
$ManifestPath = Join-Path $RootDir "extension\manifest.json"
$ReadmePath = Join-Path $RootDir "README.md"
$ProjectStructurePath = Join-Path $RootDir "PROJECT_STRUCTURE.md"

$manifest = Get-Content -Raw -Path $ManifestPath | ConvertFrom-Json
if ($manifest.version -ne $Version) {
    throw "Manifest version '$($manifest.version)' does not match release version '$Version'."
}

$readme = Get-Content -Raw -Path $ReadmePath
if ($readme -notmatch [regex]::Escape($Version)) {
    throw "README.md does not mention release version '$Version'."
}

$structure = Get-Content -Raw -Path $ProjectStructurePath
if ($structure -notmatch [regex]::Escape($Version)) {
    throw "PROJECT_STRUCTURE.md does not mention release version '$Version'."
}

$forbidden = @(
    "vendor/o200k_base",
    "vendor\o200k_base",
    "claude-counter-v0.4.2-latest.zip"
)

foreach ($needle in $forbidden) {
    foreach ($path in @($ReadmePath, $ProjectStructurePath, (Join-Path $RootDir "scripts\build-release.ps1"), $ManifestPath)) {
        if ((Get-Content -Raw -Path $path) -like "*$needle*") {
            throw "Forbidden stale release reference '$needle' found in $path."
        }
    }
}

Write-Host "Release checklist passed for v$Version." -ForegroundColor Green
