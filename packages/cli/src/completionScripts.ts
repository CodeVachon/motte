/**
 * Completion scripts for the shells yargs has no template for.
 *
 * yargs ships bash and zsh, and `motte completion` still hands those out untouched. fish and PowerShell
 * are written here — PowerShell because Windows is a supported install target via `install.ps1`, and fish
 * because it is common enough that its absence reads as the tool not supporting it.
 *
 * Both call the same `--get-yargs-completions` protocol the bash and zsh scripts use, so there is one
 * completion implementation and three transports. Both announce which shell they are, because neither can
 * be sniffed: fish sets `SHELL` only for a login shell, and PowerShell does not set it at all.
 */

export const COMPLETION_SHELLS = ["bash", "zsh", "fish", "powershell"] as const;
export type CompletionShell = (typeof COMPLETION_SHELLS)[number];

export function isCompletionShell(value: string): value is CompletionShell {
    return (COMPLETION_SHELLS as readonly string[]).includes(value);
}

/**
 * fish.
 *
 * `commandline -opc` is every completed word on the line, `-ct` the partial one. The protocol wants the
 * program name first, then the words, then the partial — the same order the zsh template sends.
 *
 * `-f` because motte takes no filenames anywhere; without it fish offers the directory listing alongside
 * every issue title, which buries the useful half.
 */
export function fishScript(command = "motte"): string {
    return `# ${command} completion for fish
#
# Installation:
#   ${command} completion fish > ~/.config/fish/completions/${command}.fish
#
# Completes commands, flags, and — from the project in the current directory — issue references by title
# fragment, states, assignees and labels.

function __${command}_completions
    set -l words (commandline -opc)
    set -l current (commandline -ct)

    # The candidates come back as "value<tab>description", which is what fish's -a expects.
    MOTTE_COMPLETION_SHELL=fish command ${command} --get-yargs-completions $words $current 2>/dev/null
end

complete -c ${command} -f -a '(__${command}_completions)'
`;
}

/**
 * PowerShell.
 *
 * A native argument completer, which is the form that works for an external executable rather than a
 * cmdlet. `$commandAst.CommandElements` is the parsed line; its extents are the words as typed.
 *
 * Written for PowerShell 5.1 as well as 7, since 5.1 is what a stock Windows has: no null-coalescing, no
 * ternary operator, and `Where-Object` rather than `.Where{}`.
 */
export function powershellScript(command = "motte"): string {
    return `# ${command} completion for PowerShell
#
# Installation:
#   ${command} completion powershell >> $PROFILE
#
# Completes commands, flags, and — from the project in the current directory — issue references by title
# fragment, states, assignees and labels.

Register-ArgumentCompleter -Native -CommandName ${command} -ScriptBlock {
    param($wordToComplete, $commandAst, $cursorPosition)

    $words = @()
    foreach ($element in $commandAst.CommandElements) {
        $words += $element.Extent.Text
    }

    # The partial word is sent separately, so it must not also appear among the completed ones.
    if ($words.Count -gt 0 -and $words[-1] -eq $wordToComplete) {
        $words = $words[0..($words.Count - 2)]
    }

    # Scoped to this invocation: the completer must not leave a variable behind in the session.
    $previous = $env:MOTTE_COMPLETION_SHELL
    $env:MOTTE_COMPLETION_SHELL = 'powershell'

    try {
        $replies = & ${command} --get-yargs-completions @words $wordToComplete 2>$null
    }
    catch {
        # A completer that throws breaks every subsequent TAB in the session.
        $replies = @()
    }
    finally {
        if ($null -eq $previous) {
            Remove-Item Env:MOTTE_COMPLETION_SHELL -ErrorAction SilentlyContinue
        }
        else {
            $env:MOTTE_COMPLETION_SHELL = $previous
        }
    }

    foreach ($reply in $replies) {
        if ([string]::IsNullOrWhiteSpace($reply)) { continue }

        $parts = $reply -split "\`t", 2
        $value = $parts[0]
        if ($parts.Count -gt 1) { $tooltip = $parts[1] } else { $tooltip = $value }

        # Quoted when it contains a space, or the shell would read one candidate as two arguments.
        if ($value -match '\\s') { $text = "'" + $value.Replace("'", "''") + "'" } else { $text = $value }

        [System.Management.Automation.CompletionResult]::new(
            $text,
            $value,
            'ParameterValue',
            $tooltip
        )
    }
}
`;
}

/** The script for a shell motte writes itself, or undefined for the two yargs already handles. */
export function completionScript(shell: CompletionShell, command = "motte"): string | undefined {
    if (shell === "fish") return fishScript(command);
    if (shell === "powershell") return powershellScript(command);

    return undefined;
}
