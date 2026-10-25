import { execFile } from "node:child_process";
import { promisify } from "node:util";
import path from "node:path";
import fs from "node:fs";

const execFileAsync = promisify(execFile);

export interface GitCommit {
  hash: string;
  author: string;
  date: string;
  message: string;
}

export interface GitStats {
  filesChanged: number;
  insertions: number;
  deletions: number;
  files: string[];
}

export interface GitExtractionResult {
  repoPath: string;
  repoName: string;
  currentBranch: string;
  since: string;
  commits: GitCommit[];
  stats: GitStats;
  filteredDiff: string;
  uncommittedChanges?: string;
}

/**
 * Filter out noisy files from diff output (lockfiles, generated files, binaries)
 */
function shouldIgnoreFile(filePath: string): boolean {
  const noisyPatterns = [
    /package-lock\.json$/i,
    /pnpm-lock\.yaml$/i,
    /yarn\.lock$/i,
    /\.min\.(js|css)$/i,
    /\.(png|jpe?g|gif|webp|svg|ico|pdf|zip|tar|gz)$/i,
    /dist\//i,
    /build\//i,
    /\.next\//i,
    /node_modules\//i,
    /\.system_generated\//i
  ];
  return noisyPatterns.some((pattern) => pattern.test(filePath));
}

/**
 * Inspect a git repository and extract commits, stats, and sanitized diffs
 */
export async function extractGitWork(
  repoPath: string = process.cwd(),
  since: string = "24 hours ago",
  includeUncommitted: boolean = true
): Promise<GitExtractionResult> {
  const resolvedPath = path.resolve(repoPath);

  if (!fs.existsSync(resolvedPath)) {
    throw new Error(`Directory does not exist: ${resolvedPath}`);
  }

  // 1. Verify it's a git repo & get branch
  let currentBranch = "unknown";
  try {
    const { stdout } = await execFileAsync("git", ["rev-parse", "--abbrev-ref", "HEAD"], {
      cwd: resolvedPath,
    });
    currentBranch = stdout.trim();
  } catch (err) {
    throw new Error(`Not a git repository: ${resolvedPath}`);
  }

  const repoName = path.basename(resolvedPath);

  // 2. Fetch commits within timeframe
  const gitLogFormat = "%H|||%an|||%ad|||%s";
  let commits: GitCommit[] = [];
  try {
    const { stdout } = await execFileAsync(
      "git",
      ["log", `--since=${since}`, `--pretty=format:${gitLogFormat}`, "--date=relative"],
      { cwd: resolvedPath }
    );

    if (stdout.trim()) {
      commits = stdout
        .trim()
        .split("\n")
        .map((line) => {
          const [hash, author, date, message] = line.split("|||");
          return {
            hash: (hash || "").slice(0, 7),
            author: author || "Unknown",
            date: date || "",
            message: message || "No commit message",
          };
        });
    }
  } catch (err) {
    console.warn("Could not retrieve git log:", err);
  }

  // 3. Fetch file change statistics
  const stats: GitStats = {
    filesChanged: 0,
    insertions: 0,
    deletions: 0,
    files: [],
  };

  try {
    const { stdout } = await execFileAsync(
      "git",
      ["log", `--since=${since}`, "--numstat", "--pretty=format:"],
      { cwd: resolvedPath }
    );

    const lines = stdout.trim().split("\n");
    for (const line of lines) {
      if (!line.trim()) continue;
      const [ins, del, file] = line.split(/\s+/);
      if (file && !shouldIgnoreFile(file)) {
        if (!stats.files.includes(file)) stats.files.push(file);
        stats.insertions += parseInt(ins, 10) || 0;
        stats.deletions += parseInt(del, 10) || 0;
      }
    }
    stats.filesChanged = stats.files.length;
  } catch (err) {
    console.warn("Could not retrieve numstat:", err);
  }

  // 4. Fetch diff with patch
  let filteredDiff = "";
  try {
    const { stdout } = await execFileAsync(
      "git",
      ["log", `-p`, `--since=${since}`, "--unified=2"],
      { cwd: resolvedPath, maxBuffer: 10 * 1024 * 1024 }
    );

    // Sanitize and limit diff length to avoid blowing up context window
    const rawChunks = stdout.split("diff --git ");
    const cleanChunks: string[] = [];

    for (const chunk of rawChunks) {
      if (!chunk.trim()) continue;
      const firstLine = chunk.split("\n")[0];
      const match = firstLine.match(/a\/(.*?)\s+b\/(.*)/);
      const filePath = match ? match[1] : "";

      if (filePath && shouldIgnoreFile(filePath)) {
        continue;
      }

      // Keep only first 120 lines of any single file diff
      const chunkLines = chunk.split("\n");
      if (chunkLines.length > 120) {
        cleanChunks.push(
          chunkLines.slice(0, 120).join("\n") +
            `\n... [diff truncated for brevity - ${chunkLines.length - 120} more lines]`
        );
      } else {
        cleanChunks.push(chunk);
      }
    }

    filteredDiff = cleanChunks.slice(0, 15).join("\n\n"); // Max 15 files
  } catch (err) {
    console.warn("Could not retrieve diff:", err);
  }

  // 5. Optional uncommitted changes
  let uncommittedChanges = "";
  if (includeUncommitted) {
    try {
      const { stdout: statusOut } = await execFileAsync("git", ["status", "--short"], {
        cwd: resolvedPath,
      });
      if (statusOut.trim()) {
        uncommittedChanges = statusOut.trim();
      }
    } catch {
      // Ignore
    }
  }

  return {
    repoPath: resolvedPath,
    repoName,
    currentBranch,
    since,
    commits,
    stats,
    filteredDiff,
    uncommittedChanges,
  };
}
