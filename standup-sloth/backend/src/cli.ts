import { runStandupSloth } from "./agent/slothAgent.js";
import { exec } from "node:child_process";
import path from "node:path";

async function main() {
  const args = process.argv.slice(2);
  const repoPath = args[0] || path.resolve("../..");
  const since = args[1] || "24 hours ago";

  console.log(`\n🦥 ============================================`);
  console.log(`   STANDUPSLOTH: Slow and Steady Git Janitor`);
  console.log(`============================================\n`);
  console.log(`📁 Inspecting: ${repoPath}`);
  console.log(`⏱️  Timeframe:  ${since}`);
  console.log(`🤖 Model:      Gemma 2 9B (Local Ollama)\n`);

  try {
    const result = await runStandupSloth(repoPath, since, (step, detail) => {
      console.log(`[Step] ${step}: ${detail || ""}`);
    });

    console.log(`\n✨ ============================================`);
    console.log(`   EXECUTIVE SUMMARY`);
    console.log(`============================================`);
    console.log(`${result.summary}\n`);

    console.log(`📋 ============================================`);
    console.log(`   DAILY STANDUP (Ready for Slack/Discord)`);
    console.log(`============================================`);
    console.log(result.standup.rawMarkdown);

    console.log(`\n🚀 ============================================`);
    console.log(`   CHANGELOG PREVIEW`);
    console.log(`============================================`);
    console.log(result.changelog.rawMarkdown);

    console.log(`\n⚡ Analyzed ${result.commitCount} commits across ${result.stats.filesChanged} files (+${result.stats.insertions} / -${result.stats.deletions} lines) in ${(result.executionTimeMs / 1000).toFixed(2)}s.`);

    // Auto-copy to clipboard on Windows
    const textToCopy = result.standup.rawMarkdown.replace(/"/g, '\\"');
    exec(`powershell -command "Set-Clipboard -Value \\"${textToCopy}\\""`, (err) => {
      if (!err) {
        console.log(`\n📋 Successfully copied Daily Standup to your clipboard! 🦥`);
      }
    });
  } catch (err: any) {
    console.error(`\n❌ Error running StandupSloth:`, err.message || err);
  }
}

main();
