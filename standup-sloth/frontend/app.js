document.addEventListener("DOMContentLoaded", () => {
  // Elements
  const repoPathInput = document.getElementById("repoPathInput");
  const btnCurrentRepo = document.getElementById("btnCurrentRepo");
  const btnWakeSloth = document.getElementById("btnWakeSloth");
  const timeframeContainer = document.getElementById("timeframeContainer");
  const progressContainer = document.getElementById("progressContainer");
  const progressMessage = document.getElementById("progressMessage");
  const toast = document.getElementById("toast");

  // Output Elements
  const executiveSummary = document.getElementById("executiveSummary");
  const listYesterday = document.getElementById("listYesterday");
  const listToday = document.getElementById("listToday");
  const listBlockers = document.getElementById("listBlockers");
  const changelogCode = document.getElementById("changelogCode");
  const rawCommitsContainer = document.getElementById("rawCommitsContainer");
  const rawCommitCount = document.getElementById("rawCommitCount");
  const polishedOrderBox = document.getElementById("polishedOrderBox");
  const metaFiles = document.getElementById("metaFiles");
  const metaLatency = document.getElementById("metaLatency");
  const metaTrace = document.getElementById("metaTrace");
  const btnCopySlack = document.getElementById("btnCopySlack");

  // Status pills
  const pillGemma = document.getElementById("pillGemma");
  const pillMongo = document.getElementById("pillMongo");
  const pillSentry = document.getElementById("pillSentry");

  // Memory Elements
  const memorySearchInput = document.getElementById("memorySearchInput");
  const btnSearchMemory = document.getElementById("btnSearchMemory");
  const memoryResultsContainer = document.getElementById("memoryResultsContainer");

  let currentSince = "24 hours ago";
  let lastGeneratedStandupMarkdown = "";

  // 1. Check Backend Health & Status
  async function checkStatus() {
    try {
      const res = await fetch("/api/status");
      const data = await res.json();

      if (data.ollama && data.ollama.status === "online") {
        pillGemma.innerHTML = `<span class="dot pulse"></span><span>Gemma 2 9B (Ready)</span>`;
      } else {
        pillGemma.innerHTML = `<span class="dot" style="background:#ef4444"></span><span>Gemma (Offline)</span>`;
      }

      if (data.mongodb && data.mongodb.configured) {
        pillMongo.innerHTML = `<span class="dot" style="background:#10b981"></span><span>MongoDB Atlas</span>`;
      } else {
        pillMongo.innerHTML = `<span class="dot" style="background:#f59e0b"></span><span>Local Memory</span>`;
      }

      if (data.sentry && data.sentry.enabled) {
        pillSentry.innerHTML = `<span class="dot" style="background:#8b5cf6"></span><span>Sentry Tracing</span>`;
      } else {
        pillSentry.innerHTML = `<span class="dot" style="background:#6b7280"></span><span>Trace (Local)</span>`;
      }
    } catch (err) {
      console.warn("Backend not ready yet:", err);
    }
  }

  checkStatus();

  // 2. Timeframe Selection
  timeframeContainer.addEventListener("click", (e) => {
    if (e.target.classList.contains("btn-time")) {
      document.querySelectorAll(".btn-time").forEach((b) => b.classList.remove("active"));
      e.target.classList.add("active");
      currentSince = e.target.getAttribute("data-since") || "24 hours ago";
    }
  });

  // Current repo helper
  btnCurrentRepo.addEventListener("click", () => {
    repoPathInput.value = "D:\\Kaufee\\projects\\Hacktoberfest-2026\\challenge-4";
  });

  // 3. Tab Switching
  document.querySelectorAll(".tab-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      document.querySelectorAll(".tab-btn").forEach((b) => b.classList.remove("active"));
      document.querySelectorAll(".tab-content").forEach((c) => {
        c.classList.remove("active");
        c.classList.add("hidden");
      });

      btn.classList.add("active");
      const targetId = btn.getAttribute("data-tab");
      const targetContent = document.getElementById(targetId);
      if (targetContent) {
        targetContent.classList.remove("hidden");
        targetContent.classList.add("active");
      }
    });
  });

  // 4. Trigger Standup Generation
  btnWakeSloth.addEventListener("click", async () => {
    const repoPath = repoPathInput.value.trim() || undefined;

    // UI Loading state
    btnWakeSloth.disabled = true;
    btnWakeSloth.innerHTML = `<span class="btn-icon">💤</span><span class="btn-text">Sloth is Thinking...</span>`;
    progressContainer.classList.remove("hidden");
    progressMessage.innerText = "Extracting git logs and filtering noise...";

    const dot1 = document.getElementById("dot1");
    const dot2 = document.getElementById("dot2");
    const dot3 = document.getElementById("dot3");

    dot1.classList.add("active");
    dot2.classList.remove("active");
    dot3.classList.remove("active");

    const timer = setTimeout(() => {
      dot2.classList.add("active");
      progressMessage.innerText = "Prompting local Gemma 2 9B to summarize chaotic diffs...";
    }, 1500);

    try {
      const response = await fetch("/api/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ repoPath, since: currentSince }),
      });

      const data = await response.json();
      clearTimeout(timer);

      if (!data.success) {
        alert("Failed to generate: " + (data.error || "Unknown error"));
        return;
      }

      dot3.classList.add("active");
      progressMessage.innerText = "Complete! Updates prepared with zero effort.";

      renderStandup(data);
    } catch (err) {
      clearTimeout(timer);
      alert("Error contacting StandupSloth backend. Make sure npm run dev is running!");
      console.error(err);
    } finally {
      btnWakeSloth.disabled = false;
      btnWakeSloth.innerHTML = `<span class="btn-icon">🦥</span><span class="btn-text">Wake the Sloth & Generate</span>`;
      setTimeout(() => {
        progressContainer.classList.add("hidden");
      }, 3000);
    }
  });

  // 5. Render Results
  function renderStandup(data) {
    lastGeneratedStandupMarkdown = data.standup.rawMarkdown;

    // Executive summary
    executiveSummary.innerText = data.summary;

    // Yesterday
    listYesterday.innerHTML = data.standup.yesterday
      .map((item) => `<li>${escapeHtml(item)}</li>`)
      .join("");

    // Today
    listToday.innerHTML = data.standup.today
      .map((item) => `<li>${escapeHtml(item)}</li>`)
      .join("");

    // Blockers
    listBlockers.innerHTML = data.standup.blockers
      .map((item) => `<li>${escapeHtml(item)}</li>`)
      .join("");

    // Changelog
    changelogCode.innerText = data.changelog.rawMarkdown;

    // Chaos vs Order
    rawCommitCount.innerText = `${data.commitCount} commits`;
    if (data.rawCommits.length > 0) {
      rawCommitsContainer.innerHTML = data.rawCommits
        .map((c) => {
          const parts = c.split(" - ");
          const hash = parts[0] || "git";
          const msg = parts.slice(1).join(" - ") || c;
          return `<div class="commit-row"><span class="commit-hash">${escapeHtml(hash)}</span> <span class="commit-msg">${escapeHtml(msg)}</span></div>`;
        })
        .join("");
    } else {
      rawCommitsContainer.innerHTML = `<div class="commit-row"><span class="commit-msg">No raw commits in selected timeframe.</span></div>`;
    }

    polishedOrderBox.innerHTML = `
      <p><strong>Executive Takeaway:</strong> ${escapeHtml(data.summary)}</p>
      <br/>
      <p><strong>What Got Shipped:</strong></p>
      <ul style="padding-left:18px; margin-top:6px;">
        ${data.standup.yesterday.map((y) => `<li>${escapeHtml(y)}</li>`).join("")}
      </ul>
    `;

    // Metrics
    metaFiles.innerText = `${data.stats.filesChanged} files (+${data.stats.insertions} / -${data.stats.deletions})`;
    metaLatency.innerText = `${(data.executionTimeMs / 1000).toFixed(2)}s`;
    metaTrace.innerText = data.sentryTraceId ? data.sentryTraceId.slice(0, 12) + "..." : "local-trace";
  }

  // 6. Copy to Slack
  btnCopySlack.addEventListener("click", () => {
    if (!lastGeneratedStandupMarkdown) {
      showToast("Generate a standup first!");
      return;
    }

    navigator.clipboard.writeText(lastGeneratedStandupMarkdown).then(() => {
      showToast("Copied to Clipboard! 🦥");
    });
  });

  // 7. Memory Search
  btnSearchMemory.addEventListener("click", async () => {
    const q = memorySearchInput.value.trim();
    if (!q) return;

    btnSearchMemory.disabled = true;
    btnSearchMemory.innerText = "Searching...";

    try {
      const res = await fetch(`/api/search?q=${encodeURIComponent(q)}`);
      const data = await res.json();

      if (data.results && data.results.length > 0) {
        memoryResultsContainer.innerHTML = data.results
          .map((r) => {
            const dateStr = new Date(r.createdAt).toLocaleDateString();
            return `
              <div class="memory-card">
                <div class="memory-meta">
                  <span>📁 ${escapeHtml(r.repoName)} (${escapeHtml(r.branch)})</span>
                  <span>📅 ${dateStr}</span>
                </div>
                <div style="font-size:13px; color:#e2e8f0;">${escapeHtml(r.standup.yesterday.join("; "))}</div>
              </div>
            `;
          })
          .join("");
      } else {
        memoryResultsContainer.innerHTML = `<p class="empty-state">No matching standup records found in memory.</p>`;
      }
    } catch (err) {
      console.error(err);
      memoryResultsContainer.innerHTML = `<p class="empty-state" style="color:#ef4444">Error querying memory.</p>`;
    } finally {
      btnSearchMemory.disabled = false;
      btnSearchMemory.innerText = "Search Memory";
    }
  });

  function showToast(msg) {
    toast.innerText = msg;
    toast.classList.remove("hidden");
    setTimeout(() => {
      toast.classList.add("hidden");
    }, 2500);
  }

  function escapeHtml(text) {
    if (!text) return "";
    return text
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }
});
