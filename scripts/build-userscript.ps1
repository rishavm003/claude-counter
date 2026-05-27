param(
    [string]$Version = "0.1.4"
)

$ErrorActionPreference = "Stop"
$RootDir = Split-Path $PSScriptRoot -Parent
$DistDir = "$RootDir\dist"
$ExtensionDir = "$RootDir\extension"

if (!(Test-Path $DistDir)) {
    New-Item -ItemType Directory -Path $DistDir -Force | Out-Null
}

Write-Host "Compiling userscript v$Version..." -ForegroundColor Yellow

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
            getURL: function(path) { return ''; }
        };
    }

    (function markBridgeInjected() {
        var id = (globalThis.ClaudeCounter && globalThis.ClaudeCounter.DOM && globalThis.ClaudeCounter.DOM.BRIDGE_SCRIPT_ID) || 'cc-bridge-script';
        if (!document.getElementById(id)) {
            var sentinel = document.createElement('meta');
            sentinel.id = id;
            (document.head || document.documentElement).appendChild(sentinel);
        }
    })();

"@

$CssContent = Get-Content -Raw -Path "$ExtensionDir\src\styles.css"
$CssInjector = @"
    (function() {
        var style = document.createElement('style');
        style.textContent = `$CssContent`;
        (document.head || document.documentElement).appendChild(style);
    })();
"@

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
Copy-Item -Path "$RootDir\userscript\claude-counter.user.js" -Destination "$DistDir\claude-counter-$Version.user.js" -Force

Write-Host "  Created userscript artifacts." -ForegroundColor Green
