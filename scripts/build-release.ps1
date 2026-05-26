# Build Release Script for Claude Counter
# Creates distributable ZIP files for Chrome/Edge and Firefox

param(
    [string]$Version = "0.1.4"
)

$ErrorActionPreference = "Stop"
$RootDir = Split-Path $PSScriptRoot -Parent
$DistDir = "$RootDir\dist"
$ExtensionDir = "$RootDir\extension"

Write-Host "Building Claude Counter v$Version..." -ForegroundColor Cyan
Write-Host ""

& "$PSScriptRoot\check-release.ps1" -Version $Version
Write-Host ""

# Ensure dist directory exists
if (!(Test-Path $DistDir)) {
    New-Item -ItemType Directory -Path $DistDir -Force | Out-Null
}

# Clean old builds
Get-ChildItem $DistDir -Filter "*.zip" | Remove-Item -Force
Get-ChildItem $DistDir -Filter "*.xpi" | Remove-Item -Force

Write-Host "0. Compiling fully functional userscript version..." -ForegroundColor Yellow
$UserscriptHeader = @"
// ==UserScript==
// @name         Claude Counter
// @namespace    https://github.com/rishavm003/claude-counter
// @version      $Version
// @description  Shows token count, cache timer, and usage bars on claude.ai
// @author       rishavm003
// @match        https://claude.ai/*
// @grant        none
// @run-at       document-start
// ==/UserScript==

"@

$Shim = @"
(function() {
    'use strict';
    
    // Chrome Extension API shim for Userscript context
    if (typeof chrome === 'undefined' || !chrome.storage) {
        globalThis.chrome = globalThis.chrome || {};
        globalThis.chrome.storage = {
            local: {
                get: function(keys) {
                    return new Promise(function(resolve) {
                        var res = {};
                        var keyList = Array.isArray(keys) ? keys : [keys];
                        keyList.forEach(function(key) {
                            var val = localStorage.getItem('cc_' + key);
                            res[key] = val ? JSON.parse(val) : undefined;
                        });
                        resolve(res);
                    });
                },
                set: function(obj) {
                    return new Promise(function(resolve) {
                        for (var key in obj) {
                            if (obj.hasOwnProperty(key)) {
                                localStorage.setItem('cc_' + key, JSON.stringify(obj[key]));
                            }
                        }
                        resolve();
                    });
                }
            }
        };
        globalThis.chrome.runtime = {
            onMessage: { addListener: function() {} },
            sendMessage: function() {},
            // Return empty string — bridge is already inlined, never fetch a file.
            getURL: function(path) { return ''; }
        };
    }

    // In userscript mode, bridge.js is concatenated inline above, so it is
    // already running. Mark its sentinel element so injectBridgeOnce() detects
    // it as already loaded and skips the <script src="..."> injection.
    (function markBridgeInjected() {
        var id = (globalThis.ClaudeCounter && globalThis.ClaudeCounter.DOM && globalThis.ClaudeCounter.DOM.BRIDGE_SCRIPT_ID) || 'cc-bridge-script';
        if (!document.getElementById(id)) {
            var sentinel = document.createElement('meta');
            sentinel.id = id;
            (document.head || document.documentElement).appendChild(sentinel);
        }
    })();

"@

# Read CSS and create style injector
$CssContent = Get-Content -Raw -Path "$ExtensionDir\src\styles.css"
$CssInjector = @"
    // Inject CSS
    (function() {
        var style = document.createElement('style');
        style.textContent = `$CssContent`;
        (document.head || document.documentElement).appendChild(style);
    })();
"@

# Read scripts in userscript-specific load order.
# The page bridge is inlined instead of injected via web_accessible_resources.
$JsFiles = @(
    "src\content\constants.js",
    "src\injected\bridge.js",
    "src\content\bridge-client.js",
    "src\content\tokens.js",
    "src\content\ui.js",
    "src\content\main.js"
)

$ConcatJs = ""
foreach ($file in $JsFiles) {
    $ConcatJs += Get-Content -Raw -Path "$ExtensionDir\$file"
    $ConcatJs += "`n"
}

$UserscriptContent = $UserscriptHeader + $Shim + $CssInjector + $ConcatJs + "`n})();"
Set-Content -Path "$RootDir\userscript\claude-counter.user.js" -Value $UserscriptContent -Encoding utf8
Write-Host "   Created: $RootDir\userscript\claude-counter.user.js" -ForegroundColor Green
Copy-Item -Path "$RootDir\userscript\claude-counter.user.js" -Destination "$DistDir\claude-counter-$Version.user.js" -Force
Write-Host "   Copied: $DistDir\claude-counter-$Version.user.js" -ForegroundColor Green
Write-Host ""

Write-Host "1. Creating Chrome/Edge extension ZIP..." -ForegroundColor Yellow
$ChromeZip = "$DistDir\claude-counter-$Version.zip"
Compress-Archive -Path "$ExtensionDir\*" -DestinationPath $ChromeZip -Force
Write-Host "   Created: $ChromeZip" -ForegroundColor Green

Write-Host ""
Write-Host "2. Creating Firefox XPI (unsigned)..." -ForegroundColor Yellow
# Firefox XPI is essentially a ZIP with .xpi extension
$FirefoxXpi = "$DistDir\claude-counter-$Version.xpi"
$FirefoxZipTemp = "$DistDir\claude-counter-$Version-temp-ff.zip"
if (Test-Path $FirefoxZipTemp) { Remove-Item $FirefoxZipTemp -Force }
if (Test-Path $FirefoxXpi) { Remove-Item $FirefoxXpi -Force }
Compress-Archive -Path "$ExtensionDir\*" -DestinationPath $FirefoxZipTemp -Force
Rename-Item -Path $FirefoxZipTemp -NewName "claude-counter-$Version.xpi"
Write-Host "   Created: $FirefoxXpi" -ForegroundColor Green
Write-Host "   Note: For Firefox Add-ons store, you need to sign this with Mozilla" -ForegroundColor DarkYellow

Write-Host ""
Write-Host "3. Creating source code ZIP..." -ForegroundColor Yellow
$SourceZip = "$DistDir\claude-counter-$Version-source.zip"
Compress-Archive -Path @(
    "$RootDir\extension",
    "$RootDir\assets",
    "$RootDir\docs",
    "$RootDir\scripts",
    "$RootDir\.github",
    "$RootDir\README.md",
    "$RootDir\PROJECT_STRUCTURE.md",
    "$RootDir\.gitignore"
) -DestinationPath $SourceZip -Force
Write-Host "   Created: $SourceZip" -ForegroundColor Green

Write-Host ""
Write-Host "Build complete! Files in dist/ folder:" -ForegroundColor Cyan
Get-ChildItem $DistDir | ForEach-Object {
    $size = [math]::Round($_.Length / 1KB, 2)
    Write-Host "  - $($_.Name) (${size} KB)" -ForegroundColor White
}

Write-Host ""
Write-Host "Next steps:" -ForegroundColor Cyan
Write-Host "  1. Test the extension by loading dist/ folder in Chrome" -ForegroundColor White
Write-Host "  2. Create a GitHub release and upload these files:" -ForegroundColor White
Write-Host "     https://github.com/rishavm003/claude-counter/releases/new" -ForegroundColor Blue
Write-Host "  3. Or push a tag to trigger automatic release:" -ForegroundColor White
Write-Host "     git tag v$Version" -ForegroundColor DarkGray
Write-Host "     git push origin v$Version" -ForegroundColor DarkGray
