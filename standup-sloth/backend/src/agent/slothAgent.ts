import ollama from "ollama";
import { config, Sentry } from "../config.js";
import { extractGitWork, GitExtractionResult } from "../tools/gitTool.js";
import { saveStandup, StandupRecord } from "../memory/mongoMemory.js";

export interface SlothExecutionResponse {
  success: boolean;
  repoName: string;
  repoPath: string;
  branch: string;
  since: string;
  commitCount: number;
  stats: {
    filesChanged: number;
    insertions: number;
    deletions: number;
    files: string[];
  };
  summary: string;
  standup: {
    yesterday: string[];
    today: string[];
    blockers: string[];
    rawMarkdown: string;
  };
  changelog: {
    features: string[];
    fixes: string[];
    chores: string[];
    rawMarkdown: string;
  };
  rawCommits: string[];
  sentryTraceId?: string;
  executionTimeMs: number;
}

export type StepCallback = (step: string, detail?: string) => void;

/**
 * Clean and parse JSON from LLM markdown code blocks
 */
function cleanJsonOutput(raw: string): any {
  let cleaned = raw.trim();
  if (cleaned.startsWith("```json")) {
    cleaned = cleaned.replace(/^```json\s*/, "").replace(/\s*```$/, "");
  } else if (cleaned.startsWith("```")) {
    cleaned = cleaned.replace(/^```\s*/, "").replace(/\s*```$/, "");
  }
  return JSON.parse(cleaned);
}

/**
 * Execute the StandupSloth Agent
 */
export async function runStandupSloth(
  repoPath: string = process.cwd(),
  since: string = "24 hours ago",
  onStep?: StepCallback
): Promise<SlothExecutionResponse> {
  const startTime = Date.now();

  return Sentry.startSpan(
    {
      name: "StandupSloth.run",
      op: "agent.workflow",
    },
    async (span) => {
      onStep?.("extracting_git", `Scanning ${repoPath} for commits since '${since}'...`);

      // 1. Git Extraction Span
      const gitData: GitExtractionResult = await Sentry.startSpan(
        {
          name: "git.extract",
          op: "tool.execution",
        },
        async () => {
          return await extractGitWork(repoPath, since);
        }
      );

      onStep?.(
        "git_extracted",
        `Found ${gitData.commits.length} commits and ${gitData.stats.filesChanged} files changed.`
      );

      if (gitData.commits.length === 0 && !gitData.uncommittedChanges) {
        return {
          success: true,
          repoName: gitData.repoName,
          repoPath: gitData.repoPath,
          branch: gitData.currentBranch,
          since,
          commitCount: 0,
          stats: gitData.stats,
          summary: "No commits or changes detected in this timeframe.",
          standup: {
            yesterday: ["No new commits detected in the selected timeframe."],
            today: ["Pick up where we left off on branch " + gitData.currentBranch],
            blockers: ["None"],
            rawMarkdown: `*Yesterday:*\n- No new commits detected in the selected timeframe.\n\n*Today:*\n- Continuing work on branch \`${gitData.currentBranch}\`\n\n*Blockers:*\n- None`,
          },
          changelog: {
            features: [],
            fixes: [],
            chores: [],
            rawMarkdown: "No changes recorded.",
          },
          rawCommits: [],
          executionTimeMs: Date.now() - startTime,
        };
      }

      // 2. Gemma Reasoning Span
      onStep?.("gemma_prompting", `Prompting local Gemma 2 9B to synthesize chaotic git diffs...`);

      const commitListStr = gitData.commits
        .map((c) => `- [${c.hash}] ${c.message} (${c.date})`)
        .join("\n");

      const systemPrompt = `You are StandupSloth, an expert software engineer assistant who rewards laziness.
Your job is to read raw, messy, chaotic git commits and code diffs, and turn them into crystal-clear, professional engineering updates.
Notice the following rules:
1. Ignore trivial WIP or typo messages: cluster related commits into cohesive features.
2. Formulate realistic 'Today' priorities based on the work done yesterday.
3. Classify changes accurately for a changelog: Features, Fixes, Chores.
4. Return ONLY a valid JSON object matching the requested schema. No markdown formatting outside the JSON.`;

      const userPrompt = `Repository: ${gitData.repoName} (Branch: ${gitData.currentBranch})
Timeframe: ${gitData.since}

COMMITS:
${commitListStr || "No committed changes, only working tree modifications."}

STATISTICS:
${gitData.stats.filesChanged} files changed, +${gitData.stats.insertions} / -${gitData.stats.deletions} lines.
Files touched: ${gitData.stats.files.slice(0, 10).join(", ")}

DIFF EXCERPTS:
${gitData.filteredDiff.slice(0, 4000)}

UNCOMMITTED CHANGES:
${gitData.uncommittedChanges || "None"}

Please return JSON with this EXACT structure:
{
  "summary": "1-sentence executive summary of what was accomplished",
  "standup": {
    "yesterday": ["bullet point 1", "bullet point 2"],
    "today": ["bullet point 1", "bullet point 2"],
    "blockers": ["None" or specific blocker]
  },
  "changelog": {
    "features": ["feature 1"],
    "fixes": ["fix 1"],
    "chores": ["chore 1"]
  }
}`;

      let parsed: any;
      await Sentry.startSpan(
        {
          name: "gemma.generate",
          op: "ai.inference",
          attributes: {
            "ai.model": config.ollamaModel,
            "git.commit_count": gitData.commits.length,
          },
        },
        async () => {
          const response = await ollama.chat({
            model: config.ollamaModel,
            messages: [
              { role: "system", content: systemPrompt },
              { role: "user", content: userPrompt },
            ],
            format: "json",
            options: {
              temperature: 0.2,
            },
          });

          onStep?.("gemma_parsed", "Gemma 2 9B completed synthesis. Parsing structured response...");
          parsed = cleanJsonOutput(response.message.content);
        }
      );

      // 3. Assemble formatted Markdown
      const standupMd = `*Yesterday:*
${(parsed.standup?.yesterday || []).map((y: string) => `- ${y}`).join("\n")}

*Today:*
${(parsed.standup?.today || []).map((t: string) => `- ${t}`).join("\n")}

*Blockers:*
${(parsed.standup?.blockers || ["None"]).map((b: string) => `- ${b}`).join("\n")}`;

      const changelogMd = `## Changelog - ${gitData.repoName}

### 🚀 Features
${(parsed.changelog?.features || []).map((f: string) => `- ${f}`).join("\n") || "- None"}

### 🐛 Bug Fixes
${(parsed.changelog?.fixes || []).map((f: string) => `- ${f}`).join("\n") || "- None"}

### 🧹 Chores & Maintenance
${(parsed.changelog?.chores || []).map((c: string) => `- ${c}`).join("\n") || "- None"}`;

      const standupResult = {
        yesterday: parsed.standup?.yesterday || [],
        today: parsed.standup?.today || [],
        blockers: parsed.standup?.blockers || ["None"],
        rawMarkdown: standupMd,
      };

      const changelogResult = {
        features: parsed.changelog?.features || [],
        fixes: parsed.changelog?.fixes || [],
        chores: parsed.changelog?.chores || [],
        rawMarkdown: changelogMd,
      };

      // 4. Memory Persistence Span (MongoDB Atlas)
      onStep?.("memory_saving", "Storing standup and vector embeddings in MongoDB Atlas...");
      await Sentry.startSpan(
        {
          name: "mongodb.store",
          op: "db.insert",
        },
        async () => {
          await saveStandup({
            repoName: gitData.repoName,
            repoPath: gitData.repoPath,
            branch: gitData.currentBranch,
            since,
            commitCount: gitData.commits.length,
            standup: standupResult,
            changelog: changelogResult,
            rawCommits: gitData.commits.map((c) => c.message),
          });
        }
      );

      onStep?.("completed", "StandupSloth finished! Updates ready for your team.");

      const traceId = span?.spanContext().traceId;

      return {
        success: true,
        repoName: gitData.repoName,
        repoPath: gitData.repoPath,
        branch: gitData.currentBranch,
        since,
        commitCount: gitData.commits.length,
        stats: gitData.stats,
        summary: parsed.summary || "Completed engineering tasks across repositories.",
        standup: standupResult,
        changelog: changelogResult,
        rawCommits: gitData.commits.map((c) => `${c.hash} - ${c.message}`),
        sentryTraceId: traceId,
        executionTimeMs: Date.now() - startTime,
      };
    }
  );
}
