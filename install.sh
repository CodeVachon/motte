#!/bin/sh
# motte installer — https://github.com/CodeVachon/motte
#
#   curl -fsSL https://raw.githubusercontent.com/CodeVachon/motte/main/install.sh | sh
#
# Installs a single self-contained binary. There is no runtime prerequisite.
#
#   ~/.motte/versions/v<X.Y.Z>/bin/motte   the binary
#   ~/.motte/current -> versions/v<X.Y.Z>  the active version
#   ~/.local/bin/motte -> current/bin/motte  what lands on PATH
#
# Environment:
#   MOTTE_VERSION      install a specific version (default: latest release)
#   MOTTE_INSTALL_DIR  root instead of ~/.motte
#   MOTTE_BIN_DIR      symlink directory instead of ~/.local/bin
#   MOTTE_NO_MODIFY_PATH  set to skip the PATH advice
#   MOTTE_DOWNLOAD_BASE   where to fetch assets from, for a mirror or for testing this script
#                         against a local build. Must contain <asset>.gz and checksums.txt.
#
# POSIX sh on purpose: this has to run under dash and busybox, not just bash.

set -eu

REPO="CodeVachon/motte"
INSTALL_DIR="${MOTTE_INSTALL_DIR:-$HOME/.motte}"
BIN_DIR="${MOTTE_BIN_DIR:-$HOME/.local/bin}"

RED=''
GREEN=''
DIM=''
BOLD=''
RESET=''
if [ -t 1 ] && [ -z "${NO_COLOR:-}" ]; then
    RED='\033[31m'
    GREEN='\033[32m'
    DIM='\033[2m'
    BOLD='\033[1m'
    RESET='\033[0m'
fi

say() { printf '%b\n' "$1"; }
ok() { say "${GREEN}✓${RESET} $1"; }
info() { say "${DIM}$1${RESET}"; }

die() {
    say "${RED}✗${RESET} $1" >&2
    exit 1
}

need() {
    command -v "$1" >/dev/null 2>&1 || die "$1 is required but was not found on PATH"
}

# --- what are we running on? -------------------------------------------------

detect_target() {
    os="$(uname -s)"
    arch="$(uname -m)"

    case "$os" in
        Darwin) os_name="darwin" ;;
        Linux) os_name="linux" ;;
        MINGW* | MSYS* | CYGWIN*)
            die "on Windows use PowerShell instead:\n  irm https://raw.githubusercontent.com/$REPO/main/install.ps1 | iex"
            ;;
        *) die "unsupported operating system: $os" ;;
    esac

    case "$arch" in
        x86_64 | amd64) arch_name="x64" ;;
        arm64 | aarch64) arch_name="arm64" ;;
        *) die "unsupported architecture: $arch" ;;
    esac

    # Only the four combinations the release workflow actually builds.
    case "$os_name-$arch_name" in
        darwin-arm64 | darwin-x64 | linux-x64 | linux-arm64) ;;
        *) die "no build available for $os_name-$arch_name" ;;
    esac

    printf 'motte-%s-%s' "$os_name" "$arch_name"
}

# --- version resolution ------------------------------------------------------

github_api() {
    # No -f: the response body is wanted even on an error status, so rate limiting can be reported
    # as rate limiting rather than as a generic network failure.
    if command -v curl >/dev/null 2>&1; then
        curl -sSL -H "Accept: application/vnd.github+json" "$1" 2>/dev/null
    else
        wget -qO- --header="Accept: application/vnd.github+json" "$1" 2>/dev/null
    fi
}

first_tag() {
    # Splitting on commas puts each JSON field on its own line, which is enough to pick the first
    # tag_name without requiring jq. GitHub returns releases newest first.
    printf '%s' "$1" | tr ',' '\n' | grep '"tag_name"' | head -1 |
        sed 's/.*"tag_name": *"\([^"]*\)".*/\1/'
}

latest_version() {
    # Prefer a stable release. GitHub's /releases/latest deliberately excludes prereleases, so while
    # motte is pre-1.0 and every release is a prerelease, this returns 404 and the fallback below is
    # the only path that finds anything. After 1.0 this becomes the normal path again.
    tag="$(first_tag "$(github_api "https://api.github.com/repos/$REPO/releases/latest")")"
    if [ -n "$tag" ]; then
        printf '%s' "$tag"
        return
    fi

    body="$(github_api "https://api.github.com/repos/$REPO/releases")"

    case "$body" in
        *"rate limit"*)
            die "GitHub API rate limit reached. Retry later, or set MOTTE_VERSION to skip the lookup:\n  MOTTE_VERSION=v0.1.0 sh install.sh"
            ;;
    esac

    # Newest release of any kind, prereleases included. A draft would also appear here, but drafts
    # have no downloadable assets, so the download below fails with a clear message rather than
    # installing something wrong.
    tag="$(first_tag "$body")"
    [ -n "$tag" ] ||
        die "could not find a release for $REPO. Set MOTTE_VERSION to install a specific version."

    printf '%s' "$tag"
}

fetch() {
    # fetch <url> <destination>
    if command -v curl >/dev/null 2>&1; then
        curl -fsSL "$1" -o "$2"
    else
        wget -qO "$2" "$1"
    fi
}

# --- checksum verification ---------------------------------------------------

sha256_of() {
    if command -v sha256sum >/dev/null 2>&1; then
        sha256sum "$1" | cut -d' ' -f1
    elif command -v shasum >/dev/null 2>&1; then
        shasum -a 256 "$1" | cut -d' ' -f1
    else
        # Refusing is better than installing an unverified binary from the internet.
        die "neither sha256sum nor shasum was found, so the download cannot be verified"
    fi
}

verify() {
    # verify <file> <asset-name> <checksums-file>
    expected="$(grep " $2\$" "$3" | cut -d' ' -f1)"
    [ -n "$expected" ] || die "$2 is not listed in checksums.txt"

    actual="$(sha256_of "$1")"
    [ "$expected" = "$actual" ] || die "checksum mismatch for $2\n  expected $expected\n  actual   $actual"
}

# --- install -----------------------------------------------------------------

main() {
    need uname
    need mkdir
    need ln
    command -v curl >/dev/null 2>&1 || command -v wget >/dev/null 2>&1 ||
        die "either curl or wget is required"
    command -v gunzip >/dev/null 2>&1 || die "gunzip is required"

    target="$(detect_target)"

    version="${MOTTE_VERSION:-}"
    if [ -z "$version" ]; then
        info "finding the latest release..."
        version="$(latest_version)"
        [ -n "$version" ] || die "could not determine the latest version"
    fi
    # Accept "0.1.0" as well as "v0.1.0".
    case "$version" in v*) ;; *) version="v$version" ;; esac

    asset="$target.gz"
    base="${MOTTE_DOWNLOAD_BASE:-https://github.com/$REPO/releases/download/$version}"

    version_dir="$INSTALL_DIR/versions/$version"
    tmp="$(mktemp -d)"
    # shellcheck disable=SC2064
    trap "rm -rf '$tmp'" EXIT INT TERM

    info "downloading motte $version for ${target#motte-}..."
    fetch "$base/$asset" "$tmp/$asset" || die "could not download $base/$asset"
    fetch "$base/checksums.txt" "$tmp/checksums.txt" ||
        die "could not download checksums.txt for $version"

    verify "$tmp/$asset" "$asset" "$tmp/checksums.txt"
    ok "checksum verified"

    mkdir -p "$version_dir/bin"
    gunzip -c "$tmp/$asset" > "$version_dir/bin/motte" || die "could not decompress $asset"
    chmod +x "$version_dir/bin/motte"

    # Repoint both symlinks. `ln -sfn` rather than `-sf` so an existing symlink to a directory is
    # replaced rather than followed into.
    ln -sfn "$version_dir" "$INSTALL_DIR/current"
    mkdir -p "$BIN_DIR"
    ln -sfn "$INSTALL_DIR/current/bin/motte" "$BIN_DIR/motte"

    installed="$("$version_dir/bin/motte" --version 2>/dev/null)" ||
        die "the downloaded binary did not run — this build may not match your platform"

    ok "motte $installed installed to $version_dir"
    ok "linked $BIN_DIR/motte"

    if [ -z "${MOTTE_NO_MODIFY_PATH:-}" ]; then
        case ":$PATH:" in
            *":$BIN_DIR:"*) ;;
            *)
                say ""
                say "${BOLD}$BIN_DIR is not on your PATH.${RESET} Add this to your shell profile:"
                say "  export PATH=\"$BIN_DIR:\$PATH\""
                ;;
        esac
    fi

    say ""
    info "This does not change your current shell — open a new terminal, then:"
    info "  motte init        set up a project"
    info "  motte --help      everything else"
}

main "$@"
