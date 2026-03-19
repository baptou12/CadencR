use std::collections::{BTreeMap, HashMap};
use std::path::{Path, PathBuf};
use std::process::Command;

use anyhow::{bail, Context, Result};
use chrono::NaiveDate;
use clap::Parser;
use colored::*;
use tokei::{Config, Languages};

/// Show the evolution of lines of code over time, day by day, as ASCII bar charts.
#[derive(Parser)]
#[command(name = "cadence-loc")]
struct Cli {
    /// Start date (YYYY-MM-DD). Defaults to the first commit.
    #[arg(long)]
    from: Option<NaiveDate>,
    /// End date (YYYY-MM-DD). Defaults to the latest commit.
    #[arg(long)]
    to: Option<NaiveDate>,
}

/// Per-day snapshot of LOC by language.
type DaySnapshot = BTreeMap<String, u64>;

const COLORS: &[(u8, u8, u8)] = &[
    (97, 175, 239),  // blue
    (152, 195, 121), // green
    (229, 192, 123), // yellow
    (224, 108, 117), // red
    (198, 120, 221), // purple
    (86, 182, 194),  // cyan
    (209, 154, 102), // orange
    (190, 80, 70),   // dark red
    (127, 132, 142), // gray
    (255, 255, 255), // white
];

fn main() -> Result<()> {
    let cli = Cli::parse();

    // Open the repo at cwd
    let repo_path = std::env::current_dir()?;
    let repo = git2::Repository::open(&repo_path)
        .context("Not a git repository. Run this from the monorepo root.")?;

    // Collect one commit per day within the date range
    let day_commits = collect_daily_commits(&repo, cli.from, cli.to)?;
    if day_commits.is_empty() {
        bail!("No commits found in the given date range.");
    }

    println!(
        "{}",
        format!(
            "Analyzing {} days of history ({} → {})",
            day_commits.len(),
            day_commits.first().unwrap().0,
            day_commits.last().unwrap().0,
        )
        .bold()
    );

    // Create a worktree
    let worktree_path = create_worktree(&repo_path)?;
    println!("Worktree: {}", worktree_path.display().to_string().dimmed());

    // Run analysis
    let result = run_analysis(&worktree_path, &day_commits);

    // Clean up worktree only on success
    match result {
        Ok(snapshots) => {
            remove_worktree(&repo_path, &worktree_path)?;
            render_chart(&day_commits, &snapshots);
            Ok(())
        }
        Err(e) => {
            eprintln!(
                "{} {}",
                "Error:".red().bold(),
                e
            );
            eprintln!(
                "Worktree left at: {} (remove manually with `git worktree remove`)",
                worktree_path.display()
            );
            Err(e)
        }
    }
}

/// Walk the commit history on HEAD and pick the last commit of each calendar day.
fn collect_daily_commits(
    repo: &git2::Repository,
    from: Option<NaiveDate>,
    to: Option<NaiveDate>,
) -> Result<Vec<(NaiveDate, git2::Oid)>> {
    let mut revwalk = repo.revwalk()?;
    revwalk.push_head()?;
    revwalk.set_sorting(git2::Sort::TIME)?;

    let mut per_day: BTreeMap<NaiveDate, git2::Oid> = BTreeMap::new();

    for oid in revwalk {
        let oid = oid?;
        let commit = repo.find_commit(oid)?;
        let time = commit.time();
        let ts = time.seconds();
        let offset = time.offset_minutes();
        let dt = chrono::DateTime::from_timestamp(ts, 0)
            .unwrap()
            .naive_utc()
            + chrono::Duration::minutes(offset as i64);
        let date = dt.date();

        if let Some(from) = from {
            if date < from {
                break; // commits are sorted newest-first, but dates go backward — once we pass `from` we're done
            }
        }
        if let Some(to) = to {
            if date > to {
                continue;
            }
        }

        // Keep only the first (most recent) commit per day
        per_day.entry(date).or_insert(oid);
    }

    Ok(per_day.into_iter().collect())
}

fn create_worktree(repo_path: &Path) -> Result<PathBuf> {
    let worktree_path = std::env::temp_dir().join(format!("cadence-loc-{}", std::process::id()));
    let status = Command::new("git")
        .args([
            "worktree",
            "add",
            worktree_path.to_str().unwrap(),
            "--detach",
            "--no-checkout",
        ])
        .current_dir(repo_path)
        .output()
        .context("Failed to run git worktree add")?;
    if !status.status.success() {
        bail!(
            "git worktree add failed: {}",
            String::from_utf8_lossy(&status.stderr)
        );
    }
    Ok(worktree_path)
}

fn remove_worktree(repo_path: &Path, worktree_path: &Path) -> Result<()> {
    let status = Command::new("git")
        .args([
            "worktree",
            "remove",
            "--force",
            worktree_path.to_str().unwrap(),
        ])
        .current_dir(repo_path)
        .output()
        .context("Failed to remove worktree")?;
    if !status.status.success() {
        bail!(
            "git worktree remove failed: {}",
            String::from_utf8_lossy(&status.stderr)
        );
    }
    println!("{}", "Worktree cleaned up.".dimmed());
    Ok(())
}

fn run_analysis(
    worktree_path: &Path,
    day_commits: &[(NaiveDate, git2::Oid)],
) -> Result<Vec<DaySnapshot>> {
    let mut snapshots = Vec::with_capacity(day_commits.len());

    for (i, (date, oid)) in day_commits.iter().enumerate() {
        eprint!(
            "\r{} [{}/{}] {}",
            "Scanning".cyan(),
            i + 1,
            day_commits.len(),
            date,
        );

        // Checkout this commit in the worktree
        let output = Command::new("git")
            .args(["checkout", &oid.to_string()])
            .current_dir(worktree_path)
            .output()
            .context("Failed to git checkout in worktree")?;
        if !output.status.success() {
            bail!(
                "git checkout {} failed: {}",
                oid,
                String::from_utf8_lossy(&output.stderr)
            );
        }

        // Run tokei
        let snapshot = run_tokei(worktree_path)?;
        snapshots.push(snapshot);
    }
    eprintln!(); // newline after progress
    Ok(snapshots)
}

fn run_tokei(worktree: &Path) -> Result<DaySnapshot> {
    let excluded: &[&str] = &["node_modules", "target", ".git"];
    let config = Config {
        hidden: Some(false),
        ..Config::default()
    };

    let packages_dir = worktree.join("packages");
    let mut snapshot = BTreeMap::new();

    if packages_dir.is_dir() {
        // Scan each package separately
        let entries: Vec<_> = std::fs::read_dir(&packages_dir)?
            .filter_map(|e| e.ok())
            .filter(|e| e.path().is_dir())
            .collect();

        for entry in entries {
            let pkg_name = entry.file_name().to_string_lossy().to_string();
            let pkg_path = entry.path();

            let mut languages = Languages::new();
            languages.get_statistics(&[pkg_path.to_str().unwrap()], excluded, &config);

            for (lang_type, language) in &languages {
                let code = language.code;
                if code > 0 {
                    let key = format!("{pkg_name}/{lang_type}");
                    *snapshot.entry(key).or_default() += code as u64;
                }
            }
        }
    }

    // Also scan root-level files (outside packages/)
    // We scan the whole worktree and subtract what's in packages/
    let mut root_languages = Languages::new();
    root_languages.get_statistics(&[worktree.to_str().unwrap()], excluded, &config);

    let mut root_total_by_lang: BTreeMap<String, u64> = BTreeMap::new();
    for (lang_type, language) in &root_languages {
        let code = language.code;
        if code > 0 {
            root_total_by_lang.insert(format!("{lang_type}"), code as u64);
        }
    }
    // Subtract package LOC from total to get root-only LOC per language
    // Build a per-language sum from packages
    let mut pkg_by_lang: HashMap<String, u64> = HashMap::new();
    for (key, &val) in &snapshot {
        // key is "pkg/Lang", extract lang part
        if let Some(lang) = key.split('/').nth(1) {
            *pkg_by_lang.entry(lang.to_string()).or_default() += val;
        }
    }
    for (lang, total) in &root_total_by_lang {
        let in_pkg = pkg_by_lang.get(lang).copied().unwrap_or(0);
        let root_only = total.saturating_sub(in_pkg);
        if root_only > 0 {
            snapshot.insert(format!("root/{lang}"), root_only);
        }
    }

    Ok(snapshot)
}

fn render_chart(day_commits: &[(NaiveDate, git2::Oid)], snapshots: &[DaySnapshot]) {
    // Determine top 10 languages by total LOC across all days
    let mut totals: HashMap<String, u64> = HashMap::new();
    for snap in snapshots {
        for (lang, &loc) in snap {
            *totals.entry(lang.clone()).or_default() += loc;
        }
    }
    let mut sorted_langs: Vec<_> = totals.into_iter().collect();
    sorted_langs.sort_by(|a, b| b.1.cmp(&a.1));
    let top_langs: Vec<String> = sorted_langs.iter().take(10).map(|x| x.0.clone()).collect();

    // Find max total LOC for scaling
    let max_loc: u64 = snapshots
        .iter()
        .map(|s| s.values().sum::<u64>())
        .max()
        .unwrap_or(1);

    let num_days = day_commits.len();
    let col_width = 6; // width of each bar column in chars
    let gap = 1; // gap between columns
    let chart_height = 30; // rows for the chart
    let y_label_width = 8; // space for Y-axis labels

    println!();
    println!("{}", "Lines of Code Evolution".bold().underline());
    println!();

    // Build a 2D grid: grid[row][col] = Option<color_index>
    // row 0 = top of chart, row chart_height-1 = bottom
    // For each day (column), compute the stacked segments scaled to chart_height
    let mut grid: Vec<Vec<Option<usize>>> = vec![vec![None; num_days]; chart_height];
    let mut col_totals: Vec<u64> = Vec::with_capacity(num_days);

    for (col, snap) in snapshots.iter().enumerate() {
        let total: u64 = snap.values().sum();
        col_totals.push(total);
        let total_height =
            ((total as f64 / max_loc as f64) * chart_height as f64).round() as usize;

        // Build segments bottom-up: top langs first (bottom of bar), then other
        let mut segments: Vec<(usize, usize)> = Vec::new(); // (color_index, height)
        let mut accum = 0usize;

        for (lang_idx, lang) in top_langs.iter().enumerate() {
            let loc = snap.get(lang).copied().unwrap_or(0);
            if loc == 0 {
                continue;
            }
            let h = ((loc as f64 / max_loc as f64) * chart_height as f64).round() as usize;
            if h > 0 {
                segments.push((lang_idx, h));
                accum += h;
            }
        }

        // "Other"
        let other_h = total_height.saturating_sub(accum);
        if other_h > 0 {
            segments.push((COLORS.len(), other_h)); // sentinel for "other"
        }

        // Fill the grid bottom-up
        let mut row = chart_height; // starts at bottom
        for (color_idx, h) in &segments {
            for _ in 0..*h {
                if row == 0 {
                    break;
                }
                row -= 1;
                grid[row][col] = Some(*color_idx);
            }
        }
    }

    // Render rows top to bottom
    for row in 0..chart_height {
        // Y-axis label: show LOC value at certain rows
        let y_label = if row == 0 {
            format_loc(max_loc)
        } else if row == chart_height / 2 {
            format_loc(max_loc / 2)
        } else if row == chart_height - 1 {
            "0".to_string()
        } else {
            String::new()
        };

        let mut line = format!("{:>width$} │", y_label, width = y_label_width - 2);

        for col in 0..num_days {
            let cell = match grid[row][col] {
                Some(idx) if idx < COLORS.len() => {
                    let (r, g, b) = COLORS[idx];
                    "█".repeat(col_width).truecolor(r, g, b).to_string()
                }
                Some(_) => "░".repeat(col_width).dimmed().to_string(), // other
                None => " ".repeat(col_width),
            };
            line.push_str(&cell);
            if col < num_days - 1 {
                line.push_str(&" ".repeat(gap));
            }
        }
        println!("{line}");
    }

    // X-axis line
    let axis_len = num_days * (col_width + gap);
    println!(
        "{:>width$} └{}",
        "",
        "─".repeat(axis_len),
        width = y_label_width - 2,
    );

    // Date labels on X-axis (horizontal, centered under each bar)
    let mut date_line = format!("{:>width$}  ", "", width = y_label_width - 2);
    for (col, (date, _)) in day_commits.iter().enumerate() {
        let label = date.format("%m/%d").to_string();
        let padded = format!("{:^width$}", label, width = col_width);
        date_line.push_str(&padded.dimmed().to_string());
        if col < num_days - 1 {
            date_line.push_str(&" ".repeat(gap));
        }
    }
    println!("{date_line}");

    // Total LOC labels under each bar
    let mut totals_line = format!("{:>width$}  ", "", width = y_label_width - 2);
    for (col, total) in col_totals.iter().enumerate() {
        let label = format_loc(*total);
        let padded = format!("{:^width$}", label, width = col_width);
        totals_line.push_str(&padded.dimmed().to_string());
        if col < num_days - 1 {
            totals_line.push_str(&" ".repeat(gap));
        }
    }
    println!("{totals_line}");

    // Legend
    println!();
    println!("{}", "Legend:".bold());
    for (i, lang) in top_langs.iter().enumerate() {
        let (r, g, b) = COLORS[i % COLORS.len()];
        let loc_last: u64 = snapshots
            .last()
            .and_then(|s| s.get(lang).copied())
            .unwrap_or(0);
        println!(
            "  {} {} {}",
            "██".truecolor(r, g, b),
            lang,
            format!("({})", format_loc(loc_last)).dimmed(),
        );
    }
    println!("  {} Other", "░░".dimmed());
}

fn format_loc(loc: u64) -> String {
    if loc >= 1_000_000 {
        format!("{:.1}M", loc as f64 / 1_000_000.0)
    } else if loc >= 1_000 {
        format!("{:.1}k", loc as f64 / 1_000.0)
    } else {
        format!("{loc}")
    }
}
