#!/bin/sh
# install.sh — unofficial third-party installer for omp-unlazy-guard
#
# This is NOT part of Leonxlnx/unlazy and is NOT an official Unlazy companion.
# It only copies this repo's omp extension into the local omp extensions dir.
#
# Pin rule: refuse floating refs (main, master, HEAD, latest, short SHAs,
# branch names). Require a full 40-char commit SHA or a vMAJOR.MINOR.PATCH tag.
# Typical failure this exists to prevent: curl|bash from main.
#
# Inspect-then-confirm: this script always prints the payload (source URL or
# file, dest, sha256, unified diff, write commands) before it writes. Writing
# requires --yes, or an interactive "yes" after that printout.
#
# Scope: Linux and macOS only. Windows is not supported.

set -eu

REPO="${UNLAZY_GUARD_REPO:-joshuaswarren/omp-unlazy-guard}"
RAW_BASE="https://raw.githubusercontent.com/${REPO}"
EXTENSION_NAME="unlazy-guard.ts"

usage() {
	cat <<'EOF'
install.sh — unofficial third-party omp-unlazy-guard installer

Not affiliated with, endorsed by, or part of Leonxlnx/unlazy.
Not an official Unlazy companion.

Usage:
  install.sh --pin <40-hex-sha|vX.Y.Z> [--inspect]
  install.sh --pin <40-hex-sha|vX.Y.Z> --yes
  install.sh --pin <40-hex-sha|vX.Y.Z> --from-file PATH [--dest PATH] [--yes]
  install.sh --pin <40-hex-sha|vX.Y.Z> --uninstall [--yes]
  install.sh --help

Required:
  --pin REF     Immutable pin. Full 40-char lowercase/uppercase commit SHA,
                or a vMAJOR.MINOR.PATCH tag. Floating refs are refused:
                main, master, HEAD, latest, develop, short SHAs, branch names.

Confirm:
  (default)     Inspect only: print source, dest, sha256, diff, commands.
                Does not write. Non-TTY exits 0 after the printout.
  --inspect     Same as default.
  --yes         Print the payload, then write (or uninstall). This is the
                confirm step after you have read the inspect output.

Optional:
  --from-file P Use a local file you already inspected instead of downloading.
                Still requires --pin so the recorded identity is immutable.
  --dest PATH   Override destination file (default: omp extensions dir).
  --uninstall   Remove the destination file after inspect-then-confirm.

Pinned fetch URL (when not using --from-file):
  https://raw.githubusercontent.com/joshuaswarren/omp-unlazy-guard/<PIN>/unlazy-guard.ts

Do not curl this script from main. Fetch it from the same --pin:
  curl -fsSL https://raw.githubusercontent.com/joshuaswarren/omp-unlazy-guard/<PIN>/scripts/install.sh -o /tmp/omp-unlazy-guard-install.sh
  sh /tmp/omp-unlazy-guard-install.sh --pin <PIN>          # inspect
  sh /tmp/omp-unlazy-guard-install.sh --pin <PIN> --yes    # confirm

Platform:
  Supported: Linux, macOS (POSIX sh, omp coding hosts).
  Not supported: Windows (including Git Bash / MSYS / Cygwin as an install target).

Transcripts (after install; this installer does not write session files):
  Default: ~/.omp/agent/sessions/<encoded-cwd>/<timestamp>_<sessionId>.jsonl
  Profile: ~/.omp/profiles/<name>/agent/sessions/...  (OMP_PROFILE / PI_PROFILE)
  Override: $PI_CODING_AGENT_DIR/sessions/...
  Linux XDG after `omp config migrate`: $XDG_DATA_HOME/omp/sessions/...
  Retention: omp does not auto-delete these JSONL files; they persist until
  you remove them. This extension does not add a second transcript store.

EOF
}

err() {
	printf 'install.sh: %s\n' "$1" >&2
	exit 2
}

is_windows() {
	if [ "${OS:-}" = "Windows_NT" ]; then
		return 0
	fi
	case "$(uname -s 2>/dev/null || echo unknown)" in
		MINGW*|MSYS*|CYGWIN*|Windows_NT) return 0 ;;
		*) return 1 ;;
	esac
}

is_supported_os() {
	if is_windows; then
		return 1
	fi
	case "$(uname -s 2>/dev/null || echo unknown)" in
		Linux|Darwin) return 0 ;;
		*) return 1 ;;
	esac
}

is_floating_ref() {
	_ref=$1
	case "$_ref" in
		main|master|HEAD|head|latest|develop|dev|trunk|origin/*|refs/heads/*)
			return 0
			;;
	esac
	# short or mid-length hex: not a full SHA
	if printf '%s' "$_ref" | grep -Eq '^[0-9a-fA-F]{1,39}$'; then
		return 0
	fi
	return 1
}

is_immutable_pin() {
	_ref=$1
	if printf '%s' "$_ref" | grep -Eq '^[0-9a-fA-F]{40}$'; then
		return 0
	fi
	if printf '%s' "$_ref" | grep -Eq '^v[0-9]+\.[0-9]+\.[0-9]+$'; then
		return 0
	fi
	return 1
}

default_dest() {
	if [ -n "${UNLAZY_GUARD_DEST:-}" ]; then
		printf '%s\n' "$UNLAZY_GUARD_DEST"
		return
	fi
	_home=${HOME:-}
	[ -n "$_home" ] || err "HOME is unset"
	_profile=${OMP_PROFILE:-${PI_PROFILE:-}}
	if [ -n "${PI_CODING_AGENT_DIR:-}" ] && [ -z "$_profile" ]; then
		printf '%s\n' "${PI_CODING_AGENT_DIR%/}/extensions/${EXTENSION_NAME}"
		return
	fi
	if [ -n "$_profile" ]; then
		_root=${PI_CONFIG_DIR:-${_home}/.omp}
		printf '%s\n' "${_root%/}/profiles/${_profile}/agent/extensions/${EXTENSION_NAME}"
		return
	fi
	printf '%s\n' "${_home}/.omp/agent/extensions/${EXTENSION_NAME}"
}

sha256_file() {
	if command -v sha256sum >/dev/null 2>&1; then
		sha256sum "$1" | awk '{print $1}'
		return
	fi
	if command -v shasum >/dev/null 2>&1; then
		shasum -a 256 "$1" | awk '{print $1}'
		return
	fi
	err "need sha256sum or shasum to display the payload digest"
}

PIN=""
FROM_FILE=""
DEST=""
DO_YES=0
DO_INSPECT=0
DO_UNINSTALL=0

while [ "$#" -gt 0 ]; do
	case "$1" in
		--help|-h)
			usage
			exit 0
			;;
		--pin)
			[ "$#" -ge 2 ] || err "--pin needs a value"
			PIN=$2
			shift 2
			;;
		--from-file)
			[ "$#" -ge 2 ] || err "--from-file needs a path"
			FROM_FILE=$2
			shift 2
			;;
		--dest)
			[ "$#" -ge 2 ] || err "--dest needs a path"
			DEST=$2
			shift 2
			;;
		--yes)
			DO_YES=1
			shift
			;;
		--inspect)
			DO_INSPECT=1
			shift
			;;
		--uninstall)
			DO_UNINSTALL=1
			shift
			;;
		*)
			err "unknown argument: $1 (see --help)"
			;;
	esac
done

if ! is_supported_os; then
	err "unsupported OS ($(uname -s 2>/dev/null || echo unknown)). Linux and macOS only; Windows is not supported."
fi

[ -n "$PIN" ] || err "missing --pin (full commit SHA or vX.Y.Z). Floating refs such as main are refused."

if is_floating_ref "$PIN"; then
	err "refusing floating pin '$PIN'. Use a 40-char commit SHA or vMAJOR.MINOR.PATCH. Not main/master/HEAD/latest/short SHA."
fi

if ! is_immutable_pin "$PIN"; then
	err "refusing pin '$PIN'. Accepted: 40-char commit SHA, or vMAJOR.MINOR.PATCH tag."
fi

if [ -z "$DEST" ]; then
	DEST=$(default_dest)
fi

TMPDIR_INSTALL=${TMPDIR:-/tmp}
PAYLOAD="${TMPDIR_INSTALL%/}/omp-unlazy-guard.${PIN}.$$.$EXTENSION_NAME"
CLEANUP_PAYLOAD=0
SOURCE_LABEL=""

cleanup() {
	if [ "$CLEANUP_PAYLOAD" -eq 1 ] && [ -f "$PAYLOAD" ]; then
		rm -f "$PAYLOAD"
	fi
}
trap cleanup EXIT

if [ "$DO_UNINSTALL" -eq 1 ]; then
	SOURCE_LABEL="(uninstall — no download)"
else
	if [ -n "$FROM_FILE" ]; then
		[ -f "$FROM_FILE" ] || err "--from-file not a file: $FROM_FILE"
		PAYLOAD=$FROM_FILE
		SOURCE_LABEL="local file $FROM_FILE (pin recorded as $PIN)"
	else
		SOURCE_LABEL="${RAW_BASE}/${PIN}/${EXTENSION_NAME}"
		CLEANUP_PAYLOAD=1
		if ! command -v curl >/dev/null 2>&1; then
			err "curl is required to fetch the pinned extension"
		fi
		curl -fsSL "$SOURCE_LABEL" -o "$PAYLOAD" || err "failed to fetch $SOURCE_LABEL"
	fi
	[ -s "$PAYLOAD" ] || err "payload is empty"
fi

echo "=============================================="
echo "omp-unlazy-guard — unofficial third-party installer"
echo "Not part of Leonxlnx/unlazy. Not an official companion."
echo "=============================================="
echo "pin:        $PIN"
echo "action:     $([ "$DO_UNINSTALL" -eq 1 ] && echo uninstall || echo install)"
echo "source:     ${SOURCE_LABEL}"
echo "dest:       $DEST"
if [ "$DO_UNINSTALL" -eq 0 ]; then
	echo "sha256:     $(sha256_file "$PAYLOAD")"
	echo "bytes:      $(wc -c < "$PAYLOAD" | tr -d ' ')"
fi
echo

if [ "$DO_UNINSTALL" -eq 1 ]; then
	if [ -e "$DEST" ]; then
		echo "uninstall would remove:"
		echo "  rm -f \"$DEST\""
		echo
		echo "----- current dest (head) -----"
		sed -n '1,40p' "$DEST"
		echo "----- end head -----"
	else
		echo "dest does not exist; uninstall is a no-op."
	fi
else
	echo "commands that will run if you confirm:"
	echo "  mkdir -p \"$(dirname "$DEST")\""
	echo "  cp \"$PAYLOAD\" \"$DEST\""
	echo
	if [ -e "$DEST" ]; then
		echo "----- unified diff vs existing dest -----"
		diff -u "$DEST" "$PAYLOAD" || true
		echo "----- end diff -----"
	else
		echo "----- payload (full; dest does not exist yet) -----"
		cat "$PAYLOAD"
		echo
		echo "----- end payload -----"
	fi
fi

echo
echo "Inspect the payload above before confirming."
echo "Confirm with --yes on a second invocation, or type yes below if this is a TTY."
echo

if [ "$DO_YES" -eq 0 ]; then
	if [ -t 0 ]; then
		printf 'Type yes to confirm: '
		read -r answer
		case "$answer" in
			yes|YES) DO_YES=1 ;;
			*)
				echo "aborted (no write)."
				exit 0
				;;
		esac
	else
		echo "inspect-only (no --yes, not a TTY). Nothing written."
		exit 0
	fi
fi

# --inspect plus --yes still writes: inspect happened in this same process.
# --inspect without --yes already returned above unless the TTY confirmed.
if [ "$DO_INSPECT" -eq 1 ] && [ "$DO_YES" -eq 0 ]; then
	echo "inspect-only. Nothing written."
	exit 0
fi

if [ "$DO_UNINSTALL" -eq 1 ]; then
	if [ -e "$DEST" ]; then
		rm -f "$DEST"
		echo "removed $DEST"
	else
		echo "nothing to remove at $DEST"
	fi
	exit 0
fi

mkdir -p "$(dirname "$DEST")"
cp "$PAYLOAD" "$DEST"
echo "installed $DEST"
echo "Restart long-lived omp panes so the extension reloads."
echo "This remains an unofficial third-party omp plugin."
