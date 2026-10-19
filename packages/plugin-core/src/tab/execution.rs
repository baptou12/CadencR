//! `commands` and `backend`: what a tab may run beyond its page.
//!
//! A command is a program Cadencr runs for the tab, without a shell, in the
//! conversation's folder. Listing one names *which* program, not what it does
//! with its arguments, so the general-purpose launchers (shells, interpreters,
//! package runners, privilege tools) are refused outright: allowing `bash` or
//! `node` would allow everything. A backend is a native process the tab ships
//! and Cadencr starts; it runs with the user's rights and is not limited here
//! beyond the shape of its launch line.

use std::collections::BTreeSet;

use super::issues::{TabFindings, TabIssueCode as Code};
use super::manifest::{BackendTarget, TabBackend, TabCommand};
use super::validate::{is_clean_relative_path, text_within};

pub const MAX_COMMANDS: usize = 16;
pub const MAX_REASONING_CHARS: usize = 280;
pub const MAX_BACKEND_ARGS: usize = 32;
pub const MAX_BACKEND_ARG_CHARS: usize = 4096;
const MAX_PROGRAM_CHARS: usize = 64;

/// Programs that run whatever they are handed. Compared case-insensitively,
/// without a Windows executable suffix, and without a version suffix too
/// (`python3.12`, `node18`, `php-8.2` are their interpreters).
pub const DENIED_PROGRAMS: &[&str] = &[
    // shells
    "sh",
    "bash",
    "zsh",
    "fish",
    "dash",
    "ksh",
    "csh",
    "tcsh",
    "ash",
    "nu",
    "pwsh",
    "powershell",
    "cmd",
    "wsl",
    "osascript",
    // interpreters and runtimes
    "node",
    "nodejs",
    "deno",
    "bun",
    "python",
    "python2",
    "python3",
    "py",
    "pypy",
    "pypy3",
    "ruby",
    "irb",
    "perl",
    "php",
    "lua",
    "luajit",
    "java",
    "jshell",
    "tclsh",
    "wish",
    "rscript",
    "julia",
    "dotnet",
    // package runners
    "npx",
    "npm",
    "pnpm",
    "yarn",
    "bunx",
    "corepack",
    "uv",
    "uvx",
    "pipx",
    "pip",
    "pip3",
    // launchers and privilege tools
    "env",
    "sudo",
    "doas",
    "su",
    "runas",
    "xargs",
    "nohup",
    "nice",
    "timeout",
    "time",
    "watch",
    "exec",
    "open",
    "start",
    "launchctl",
    "systemd-run",
    "script",
];

/// `^[A-Za-z0-9][A-Za-z0-9._+-]{0,63}$`: a file name, never a path.
pub fn is_valid_program_name(program: &str) -> bool {
    let bytes = program.as_bytes();
    let allowed =
        |byte: &u8| byte.is_ascii_alphanumeric() || matches!(byte, b'.' | b'_' | b'+' | b'-');
    !bytes.is_empty()
        && bytes.len() <= MAX_PROGRAM_CHARS
        && bytes[0].is_ascii_alphanumeric()
        && bytes.iter().all(allowed)
}

/// Whether `program` is a general-purpose launcher a tab may never list.
pub fn is_denied_program(program: &str) -> bool {
    let lower = program.to_ascii_lowercase();
    let stem = [".exe", ".cmd", ".bat", ".com", ".ps1"]
        .iter()
        .find_map(|suffix| lower.strip_suffix(suffix))
        .unwrap_or(&lower);
    let unversioned =
        stem.trim_end_matches(|c: char| c.is_ascii_digit() || matches!(c, '.' | '-' | '_'));
    DENIED_PROGRAMS.contains(&stem) || DENIED_PROGRAMS.contains(&unversioned)
}

pub(super) fn validate_commands(commands: &[TabCommand], findings: &mut TabFindings) {
    if commands.len() > MAX_COMMANDS {
        findings.error(
            Code::CommandsTooMany,
            "commands",
            format!("at most {MAX_COMMANDS} commands"),
        );
    }
    let mut seen = BTreeSet::new();
    for (index, command) in commands.iter().enumerate() {
        let field = format!("commands[{index}]");
        let program = command.program.as_str();
        if !is_valid_program_name(program) {
            findings.error(
                Code::CommandInvalid,
                format!("{field}.program"),
                "must be a bare program name such as `git`, without a path or arguments",
            );
        } else if is_denied_program(program) {
            findings.error(
                Code::CommandNotAllowed,
                format!("{field}.program"),
                format!("`{program}` runs arbitrary code; a tab that needs it must ship a backend"),
            );
        } else if !seen.insert(program.to_ascii_lowercase()) {
            findings.error(
                Code::CommandDuplicate,
                format!("{field}.program"),
                format!("`{program}` is listed twice"),
            );
        }
        if !reasoning_ok(command.reasoning.as_deref()) {
            findings.error(
                Code::CommandReasoningRequired,
                format!("{field}.reasoning"),
                format!("explain in 1–{MAX_REASONING_CHARS} characters why the tab runs it; it is shown at consent time"),
            );
        }
    }
}

pub(super) fn validate_backend(backend: &TabBackend, findings: &mut TabFindings) {
    let launchable = match backend.target() {
        BackendTarget::FolderFile(path) => is_clean_relative_path(path),
        BackendTarget::Program(program) => is_valid_program_name(program),
    };
    if !launchable {
        findings.error(
            Code::BackendCommandInvalid,
            "backend.command",
            "must be a path inside the tab folder (`bin/backend`) or a bare program name (`node`)",
        );
    }
    let bad_arg = backend
        .args
        .iter()
        .any(|arg| arg.contains('\0') || arg.chars().count() > MAX_BACKEND_ARG_CHARS);
    if backend.args.len() > MAX_BACKEND_ARGS || bad_arg {
        findings.error(
            Code::BackendArgsInvalid,
            "backend.args",
            format!(
                "at most {MAX_BACKEND_ARGS} arguments of at most {MAX_BACKEND_ARG_CHARS} characters, without NUL"
            ),
        );
    }
    if !reasoning_ok(backend.reasoning.as_deref()) {
        findings.error(
            Code::BackendReasoningRequired,
            "backend.reasoning",
            format!("explain in 1–{MAX_REASONING_CHARS} characters what the backend does; it is shown at consent time"),
        );
    }
}

fn reasoning_ok(reasoning: Option<&str>) -> bool {
    reasoning.is_some_and(|text| text_within(text, MAX_REASONING_CHARS))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::tab::test_support::codes;

    fn command(program: &str, reasoning: Option<&str>) -> TabCommand {
        TabCommand {
            program: program.into(),
            reasoning: reasoning.map(str::to_string),
        }
    }

    fn check_commands(commands: &[TabCommand]) -> TabFindings {
        let mut findings = TabFindings::default();
        validate_commands(commands, &mut findings);
        findings
    }

    fn check_backend(command: &str, args: &[&str], reasoning: Option<&str>) -> TabFindings {
        let mut findings = TabFindings::default();
        validate_backend(
            &TabBackend {
                command: command.into(),
                args: args.iter().map(|arg| arg.to_string()).collect(),
                reasoning: reasoning.map(str::to_string),
            },
            &mut findings,
        );
        findings
    }

    #[test]
    fn plain_tools_with_reasoning_are_valid() {
        let findings = check_commands(&[
            command("git", Some("history")),
            command("kubectl", Some("pods")),
            command("clang-format", Some("format")),
            command("g++", Some("compile")),
        ]);
        assert!(findings.is_valid(), "{findings:?}");
    }

    #[test]
    fn launchers_are_refused_whatever_their_spelling() {
        for program in [
            "bash",
            "Node",
            "python3",
            "npx",
            "PowerShell.exe",
            "cmd.EXE",
            "sudo",
        ] {
            assert_eq!(
                codes(&check_commands(&[command(program, Some("r"))]).errors),
                ["COMMAND_NOT_ALLOWED"],
                "{program}"
            );
        }
        for versioned in [
            "python3.12",
            "node18",
            "ruby3.2",
            "perl5.36",
            "php-8.2",
            "lua5.4",
            "Python3.11.EXE",
        ] {
            assert!(is_denied_program(versioned), "{versioned}");
        }
        assert!(!is_denied_program("gitk"));
        assert!(!is_denied_program("nodemon-free"));
    }

    #[test]
    fn programs_are_bare_names_and_unique() {
        for program in [
            "",
            "/usr/bin/git",
            "bin/git",
            "git status",
            "-rf",
            "..",
            "git;rm",
        ] {
            assert_eq!(
                codes(&check_commands(&[command(program, Some("r"))]).errors),
                ["COMMAND_INVALID"],
                "{program:?}"
            );
        }
        let duplicate = check_commands(&[command("git", Some("a")), command("GIT", Some("b"))]);
        assert_eq!(codes(&duplicate.errors), ["COMMAND_DUPLICATE"]);
        let unexplained = check_commands(&[command("git", None), command("jq", Some(" "))]);
        assert_eq!(
            codes(&unexplained.errors),
            ["COMMAND_REASONING_REQUIRED", "COMMAND_REASONING_REQUIRED"]
        );
        let many: Vec<TabCommand> = (0..17)
            .map(|n| command(&format!("t{n}"), Some("r")))
            .collect();
        assert_eq!(codes(&check_commands(&many).errors), ["COMMANDS_TOO_MANY"]);
    }

    #[test]
    fn backends_launch_a_folder_path_or_a_program() {
        assert!(check_backend("bin/backend", &[], Some("r")).is_valid());
        assert!(check_backend("node", &["backend/server.mjs"], Some("r")).is_valid());
        for command in [
            "../escape",
            "/usr/bin/node",
            "bin\\x.exe",
            "node server.mjs",
            "",
        ] {
            assert_eq!(
                codes(&check_backend(command, &[], Some("r")).errors),
                ["BACKEND_COMMAND_INVALID"],
                "{command:?}"
            );
        }
        assert_eq!(
            codes(&check_backend("node", &["a\0b"], None).errors),
            ["BACKEND_ARGS_INVALID", "BACKEND_REASONING_REQUIRED"]
        );
        let many = vec!["x"; 33];
        assert_eq!(
            codes(&check_backend("node", &many, Some("r")).errors),
            ["BACKEND_ARGS_INVALID"]
        );
    }
}
