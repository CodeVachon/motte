# motte installer for Windows — https://github.com/CodeVachon/motte
#
#   irm https://raw.githubusercontent.com/CodeVachon/motte/main/install.ps1 | iex
#
# Installs a single self-contained binary. There is no runtime prerequisite.
#
#   %USERPROFILE%\.motte\versions\v<X.Y.Z>\bin\motte.exe   the binary
#   %USERPROFILE%\.motte\current                           junction to the active version
#   the user PATH gains %USERPROFILE%\.motte\current\bin
#
# Environment:
#   MOTTE_VERSION         install a specific version (default: latest release)
#   MOTTE_INSTALL_DIR     root instead of %USERPROFILE%\.motte
#   MOTTE_NO_MODIFY_PATH  set to skip the PATH change
#   MOTTE_DOWNLOAD_BASE   where to fetch assets from, for a mirror or for testing this script
#                         against a local build. Must contain <asset>.gz and checksums.txt.
#
# Deliberately mirrors install.sh: same versioned layout, same two-step version lookup, same
# MOTTE_VERSION / MOTTE_INSTALL_DIR / MOTTE_NO_MODIFY_PATH / MOTTE_DOWNLOAD_BASE. Where the two disagree
# on any of that, one of them is wrong.
#
# One deliberate divergence: there is no MOTTE_BIN_DIR. install.sh links a single file into ~/.local/bin
# because that is already on PATH on Unix; Windows has no equivalent convention, so the PATH entry points
# at the `current` junction instead and there is no second link to place.
#
# No `param()` block on purpose. This is designed to be run as `irm ... | iex`, which evaluates the
# script as a statement block — a parameter block there either binds nothing or errors, so every input
# arrives through the environment instead.

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
# TLS 1.2 is not the default on older Windows PowerShell, and GitHub requires it.
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

$Repo = 'CodeVachon/motte'

function Get-MotteEnv {
    param([string] $Name, [string] $Default = '')

    # Get-Item on env: throws under StrictMode when the variable is absent, so go through the provider
    # value directly and treat empty as unset — matching `${VAR:-default}` in the shell script.
    $value = [Environment]::GetEnvironmentVariable($Name)
    if ([string]::IsNullOrWhiteSpace($value)) { return $Default }
    return $value
}

$InstallDir = Get-MotteEnv 'MOTTE_INSTALL_DIR' (Join-Path $env:USERPROFILE '.motte')

function Write-Info { param([string] $Message) Write-Host $Message -ForegroundColor DarkGray }
function Write-Ok { param([string] $Message) Write-Host "$([char]0x2713) $Message" -ForegroundColor Green }

function Stop-Motte {
    param([string] $Message)

    Write-Host "$([char]0x2717) $Message" -ForegroundColor Red
    exit 1
}

# --- what are we running on? -------------------------------------------------

function Get-MotteTarget {
    # Only one Windows build is published, so an ARM64 machine would otherwise fail later with a
    # confusing 404 rather than here with an explanation. x64 binaries do run under emulation on
    # ARM64 Windows, so this is a note rather than a refusal.
    $arch = $env:PROCESSOR_ARCHITECTURE
    if ($arch -eq 'ARM64') {
        Write-Info 'no native arm64 build yet — installing the x64 build, which Windows will emulate'
    }
    elseif ($arch -ne 'AMD64') {
        Stop-Motte "unsupported architecture: $arch"
    }

    return 'motte-windows-x64.exe'
}

# --- version resolution ------------------------------------------------------

function Invoke-GitHubApi {
    param([string] $Url)

    # The body is wanted even on an error status, so rate limiting can be reported as rate limiting
    # rather than as a generic network failure. Invoke-WebRequest throws on 4xx/5xx, so the body has to
    # be recovered from the exception.
    try {
        $response = Invoke-WebRequest -Uri $Url -Headers @{
            Accept       = 'application/vnd.github+json'
            'User-Agent' = 'motte'
        } -UseBasicParsing
        return $response.Content
    }
    catch {
        $result = $_.Exception.Response
        if ($null -eq $result) { return '' }

        try {
            $stream = $result.GetResponseStream()
            $reader = New-Object System.IO.StreamReader($stream)
            return $reader.ReadToEnd()
        }
        catch {
            return ''
        }
    }
}

function Get-FirstTag {
    param([string] $Body)

    if ([string]::IsNullOrWhiteSpace($Body)) { return '' }

    # Matching the field directly rather than parsing the whole payload, so a rate-limit body or an
    # error object does not have to be a valid release shape. GitHub returns releases newest first.
    $match = [regex]::Match($Body, '"tag_name"\s*:\s*"([^"]+)"')
    if ($match.Success) { return $match.Groups[1].Value }
    return ''
}

function Resolve-MotteVersion {
    # Prefer a stable release. GitHub's /releases/latest deliberately excludes prereleases, so while
    # motte is pre-1.0 and every release is a prerelease, this returns 404 and the fallback below is
    # the only path that finds anything. After 1.0 this becomes the normal path again.
    $tag = Get-FirstTag (Invoke-GitHubApi "https://api.github.com/repos/$Repo/releases/latest")
    if (-not [string]::IsNullOrWhiteSpace($tag)) { return $tag }

    $body = Invoke-GitHubApi "https://api.github.com/repos/$Repo/releases"

    if ($body -match 'rate limit') {
        Stop-Motte ("GitHub API rate limit reached. Retry later, or set MOTTE_VERSION to skip the " +
            "lookup:`n  `$env:MOTTE_VERSION = 'v0.2.0'")
    }

    # Newest release of any kind, prereleases included. A draft would also appear here, but drafts have
    # no downloadable assets, so the download below fails with a clear message rather than installing
    # something wrong.
    $tag = Get-FirstTag $body
    if ([string]::IsNullOrWhiteSpace($tag)) {
        Stop-Motte "could not find a release for $Repo. Set MOTTE_VERSION to install a specific version."
    }

    return $tag
}

# --- download and verify -----------------------------------------------------

function Save-MotteFile {
    param([string] $Url, [string] $Destination)

    try {
        Invoke-WebRequest -Uri $Url -OutFile $Destination -UseBasicParsing
    }
    catch {
        Stop-Motte "could not download $Url`n  $($_.Exception.Message)"
    }
}

function Assert-Checksum {
    param([string] $Path, [string] $AssetName, [string] $ChecksumsPath)

    $line = Get-Content $ChecksumsPath | Where-Object { $_ -match "\s$([regex]::Escape($AssetName))$" }
    if (-not $line) { Stop-Motte "$AssetName is not listed in checksums.txt" }

    $expected = ([string]$line -split '\s+')[0]
    $actual = (Get-FileHash -Path $Path -Algorithm SHA256).Hash

    if ($expected -ine $actual) {
        Stop-Motte "checksum mismatch for $AssetName`n  expected $expected`n  actual   $actual"
    }
}

function Expand-Gzip {
    param([string] $Path, [string] $Destination)

    # PowerShell has no gunzip, and Expand-Archive only handles zip.
    $input_ = [System.IO.File]::OpenRead($Path)
    try {
        $output = [System.IO.File]::Create($Destination)
        try {
            $gzip = New-Object System.IO.Compression.GZipStream(
                $input_, [System.IO.Compression.CompressionMode]::Decompress)
            try { $gzip.CopyTo($output) } finally { $gzip.Dispose() }
        }
        finally { $output.Dispose() }
    }
    finally { $input_.Dispose() }
}

# --- install -----------------------------------------------------------------

function Set-MotteJunction {
    param([string] $Link, [string] $Target)

    # A junction rather than a symlink: symlinks need administrator rights or developer mode on
    # Windows, junctions do not. Directory-only, which is why `current` points at the version
    # directory and the PATH entry reaches through it, instead of linking the exe itself.
    if (Test-Path $Link) {
        $existing = Get-Item $Link -Force
        if ($existing.LinkType) { $existing.Delete() }
        else { Remove-Item $Link -Recurse -Force }
    }

    New-Item -ItemType Junction -Path $Link -Target $Target | Out-Null
}

function Add-ToUserPath {
    param([string] $Directory)

    $current = [Environment]::GetEnvironmentVariable('Path', 'User')
    $entries = @()
    if (-not [string]::IsNullOrWhiteSpace($current)) {
        $entries = $current -split ';' | Where-Object { $_ -ne '' }
    }

    if ($entries -contains $Directory) {
        Write-Info "$Directory is already on your PATH"
        return $false
    }

    [Environment]::SetEnvironmentVariable('Path', (($entries + $Directory) -join ';'), 'User')
    # This process keeps its inherited PATH, so make the new binary reachable in this session too.
    $env:Path = "$env:Path;$Directory"
    return $true
}

function Install-Motte {
    $target = Get-MotteTarget

    $version = Get-MotteEnv 'MOTTE_VERSION'
    if ([string]::IsNullOrWhiteSpace($version)) {
        Write-Info 'finding the latest release...'
        $version = Resolve-MotteVersion
    }
    # Accept "0.1.0" as well as "v0.1.0".
    if (-not $version.StartsWith('v')) { $version = "v$version" }

    $asset = "$target.gz"
    $base = Get-MotteEnv 'MOTTE_DOWNLOAD_BASE' "https://github.com/$Repo/releases/download/$version"

    $versionDir = Join-Path (Join-Path $InstallDir 'versions') $version
    $binDir = Join-Path $versionDir 'bin'
    $temp = Join-Path ([System.IO.Path]::GetTempPath()) ("motte-" + [System.Guid]::NewGuid().ToString('N'))
    New-Item -ItemType Directory -Path $temp -Force | Out-Null

    try {
        Write-Info "downloading motte $version for windows-x64..."
        Save-MotteFile "$base/$asset" (Join-Path $temp $asset)
        Save-MotteFile "$base/checksums.txt" (Join-Path $temp 'checksums.txt')

        Assert-Checksum (Join-Path $temp $asset) $asset (Join-Path $temp 'checksums.txt')
        Write-Ok 'checksum verified'

        New-Item -ItemType Directory -Path $binDir -Force | Out-Null
        $exe = Join-Path $binDir 'motte.exe'
        Expand-Gzip (Join-Path $temp $asset) $exe
    }
    finally {
        Remove-Item $temp -Recurse -Force -ErrorAction SilentlyContinue
    }

    Set-MotteJunction (Join-Path $InstallDir 'current') $versionDir

    $installed = ''
    try {
        $installed = (& $exe --version 2>$null | Out-String).Trim()
    }
    catch {
        $installed = ''
    }

    if ([string]::IsNullOrWhiteSpace($installed)) {
        Stop-Motte 'the downloaded binary did not run — this build may not match your platform'
    }

    Write-Ok "motte $installed installed to $versionDir"

    $pathEntry = Join-Path (Join-Path $InstallDir 'current') 'bin'
    if ([string]::IsNullOrWhiteSpace((Get-MotteEnv 'MOTTE_NO_MODIFY_PATH'))) {
        if (Add-ToUserPath $pathEntry) { Write-Ok "added $pathEntry to your PATH" }
    }
    else {
        Write-Info "PATH not modified. Add this yourself:`n  $pathEntry"
    }

    Write-Host ''
    Write-Info 'Open a new terminal for the PATH change to apply, then:'
    Write-Info '  motte init        set up a project'
    Write-Info '  motte --help      everything else'
}

# Dot-sourcing this file with MOTTE_SOURCE_ONLY set loads the functions without installing anything,
# which is how the tests exercise the pure ones.
if ([string]::IsNullOrWhiteSpace((Get-MotteEnv 'MOTTE_SOURCE_ONLY'))) {
    Install-Motte
}
