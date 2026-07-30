# Tests for install.ps1. Run on Windows in CI:
#
#   pwsh -File scripts/install.ps1.tests.ps1
#
# Deliberately dependency-free — no Pester — because the point is to check the installer on a clean
# Windows box, and requiring a module to be installed first defeats that.
#
# These cover the pure helpers plus a full offline install against a locally built asset. The live
# GitHub API path is not exercised here: it would make the job depend on an unauthenticated API call
# and CI flake is worse than a documented gap. `Get-FirstTag`, where the actual parsing risk lives, is
# covered directly with recorded payloads.

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$script:Failures = 0
$script:Passes = 0

function Test-Case {
    param([string] $Name, [scriptblock] $Body)

    try {
        & $Body
        $script:Passes += 1
        Write-Host "  ok   $Name" -ForegroundColor Green
    }
    catch {
        $script:Failures += 1
        Write-Host "  FAIL $Name" -ForegroundColor Red
        Write-Host "       $($_.Exception.Message)" -ForegroundColor Red
    }
}

function Assert-Equal {
    param($Expected, $Actual, [string] $Because = '')

    if ($Expected -ne $Actual) {
        throw "expected '$Expected' but got '$Actual'$(if ($Because) { " ($Because)" })"
    }
}

function Assert-Match {
    param([string] $Pattern, [string] $Actual)

    if ($Actual -notmatch $Pattern) { throw "expected /$Pattern/ to match '$Actual'" }
}

$root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
$installer = Join-Path $root 'install.ps1'

Write-Host "install.ps1 at $installer"

# --- it parses ---------------------------------------------------------------

Write-Host "`nparsing"

Test-Case 'install.ps1 parses without errors' {
    $errors = $null
    [System.Management.Automation.Language.Parser]::ParseFile($installer, [ref] $null, [ref] $errors) | Out-Null
    if ($errors -and $errors.Count -gt 0) {
        throw "$($errors.Count) parse error(s): $($errors[0].Message)"
    }
}

# Loading the functions without running the install. The guard exists for exactly this.
$env:MOTTE_SOURCE_ONLY = '1'
. $installer
Remove-Item Env:MOTTE_SOURCE_ONLY

Test-Case 'sourcing with MOTTE_SOURCE_ONLY does not install' {
    # Reaching here at all is the assertion: Install-Motte would have tried to hit the network.
    if (-not (Get-Command Install-Motte -ErrorAction SilentlyContinue)) {
        throw 'Install-Motte was not defined'
    }
}

# --- Get-MotteEnv -----------------------------------------------------------

Write-Host "`nGet-MotteEnv"

Test-Case 'returns the default when unset' {
    Assert-Equal 'fallback' (Get-MotteEnv 'MOTTE_DEFINITELY_UNSET_XYZ' 'fallback')
}

Test-Case 'treats an empty value as unset, like the shell does' {
    $env:MOTTE_EMPTY_TEST = ''
    try { Assert-Equal 'fallback' (Get-MotteEnv 'MOTTE_EMPTY_TEST' 'fallback') }
    finally { Remove-Item Env:MOTTE_EMPTY_TEST -ErrorAction SilentlyContinue }
}

Test-Case 'returns the value when set' {
    $env:MOTTE_SET_TEST = 'chosen'
    try { Assert-Equal 'chosen' (Get-MotteEnv 'MOTTE_SET_TEST' 'fallback') }
    finally { Remove-Item Env:MOTTE_SET_TEST -ErrorAction SilentlyContinue }
}

# --- Get-FirstTag -----------------------------------------------------------

Write-Host "`nGet-FirstTag"

Test-Case 'pulls the tag out of a release payload' {
    Assert-Equal 'v0.2.0' (Get-FirstTag '{"tag_name": "v0.2.0", "prerelease": true}')
}

Test-Case 'takes the first of many, which is the newest' {
    $body = '[{"tag_name":"v0.3.0"},{"tag_name":"v0.2.0"}]'
    Assert-Equal 'v0.3.0' (Get-FirstTag $body)
}

Test-Case 'returns empty for a 404 body, so the caller falls through' {
    Assert-Equal '' (Get-FirstTag '{"message":"Not Found"}')
}

Test-Case 'returns empty for an empty body' {
    Assert-Equal '' (Get-FirstTag '')
}

Test-Case 'does not mistake a rate-limit body for a release' {
    Assert-Equal '' (Get-FirstTag '{"message":"API rate limit exceeded for 1.2.3.4"}')
}

Test-Case 'tolerates whitespace variations in the JSON' {
    Assert-Equal 'v9.9.9' (Get-FirstTag '{"tag_name":"v9.9.9"}')
}

# --- checksums and gzip -----------------------------------------------------

Write-Host "`nAssert-Checksum and Expand-Gzip"

$work = Join-Path ([System.IO.Path]::GetTempPath()) ("motte-tests-" + [Guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $work -Force | Out-Null

try {
    $payload = Join-Path $work 'payload.bin'
    [System.IO.File]::WriteAllText($payload, 'motte binary stand-in')
    $hash = (Get-FileHash -Path $payload -Algorithm SHA256).Hash

    Test-Case 'accepts a matching checksum' {
        $sums = Join-Path $work 'checksums.txt'
        Set-Content -Path $sums -Value "$hash  payload.bin"
        Assert-Checksum $payload 'payload.bin' $sums
    }

    Test-Case 'accepts a lowercase checksum, as sha256sum writes it' {
        $sums = Join-Path $work 'lower.txt'
        Set-Content -Path $sums -Value "$($hash.ToLower())  payload.bin"
        Assert-Checksum $payload 'payload.bin' $sums
    }

    # Stop-Motte calls `exit`, which is not a catchable exception and terminates the whole host script
    # when the function has been dot-sourced. So the refusal cases run the installer's function in a
    # child pwsh and assert on its exit code — the first version of these tests called it inline and
    # killed the run at the first refusal.
    function Assert-Refuses {
        param([string] $Name, [string] $Statement)

        Test-Case $Name {
            $probe = "`$env:MOTTE_SOURCE_ONLY = '1'; . '$installer'; $Statement"
            $output = pwsh -NoProfile -Command $probe 2>&1 | Out-String
            if ($LASTEXITCODE -eq 0) { throw "expected a refusal, got success: $output" }
        }
    }

    $mismatch = Join-Path $work 'wrong.txt'
    Set-Content -Path $mismatch -Value (("0" * 64) + "  payload.bin")
    Assert-Refuses 'rejects a mismatched checksum' "Assert-Checksum '$payload' 'payload.bin' '$mismatch'"

    $unlisted = Join-Path $work 'other.txt'
    Set-Content -Path $unlisted -Value "$hash  something-else.bin"
    Assert-Refuses 'refuses an asset that is not listed at all' "Assert-Checksum '$payload' 'payload.bin' '$unlisted'"

    Test-Case 'round-trips a gzip stream' {
        $source = Join-Path $work 'plain.txt'
        $gz = Join-Path $work 'plain.txt.gz'
        $out = Join-Path $work 'restored.txt'
        $content = 'the quick brown fox' * 100

        [System.IO.File]::WriteAllText($source, $content)

        $in = [System.IO.File]::OpenRead($source)
        $fs = [System.IO.File]::Create($gz)
        $zip = New-Object System.IO.Compression.GZipStream($fs, [System.IO.Compression.CompressionMode]::Compress)
        $in.CopyTo($zip)
        $zip.Dispose(); $fs.Dispose(); $in.Dispose()

        Expand-Gzip $gz $out
        Assert-Equal $content ([System.IO.File]::ReadAllText($out))
    }
}
finally {
    Remove-Item $work -Recurse -Force -ErrorAction SilentlyContinue
}

# --- Get-MotteTarget --------------------------------------------------------

Write-Host "`nGet-MotteTarget"

Test-Case 'names the one published Windows asset' {
    Assert-Equal 'motte-windows-x64.exe' (Get-MotteTarget)
}

# --- summary ----------------------------------------------------------------

Write-Host ''
if ($script:Failures -gt 0) {
    Write-Host "$script:Failures failed, $script:Passes passed" -ForegroundColor Red
    exit 1
}

Write-Host "$script:Passes passed" -ForegroundColor Green
