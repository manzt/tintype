import * as NodeChildProcess from "node:child_process";
import * as NodeProcess from "node:process";

import { z } from "zod";

let Author = z.object({ login: z.string() });
let Label = z.object({ name: z.string() });
let PullRequest = z.object({
  number: z.number(),
  title: z.string(),
  author: Author,
  labels: z.array(Label),
  body: z.string().nullable(),
  mergedAt: z.string().nullable(),
});
type PullRequest = z.infer<typeof PullRequest>;

interface Commit {
  sha: string;
  message: string;
  prNumber: number | null;
}

interface Entry {
  commit: Commit;
  pr: PullRequest | null;
}

interface Section {
  category: string;
  heading: string;
  entries: ReadonlyArray<Entry>;
}

let CATEGORIES = [
  { label: "breaking", heading: "## 🚨 Breaking changes" },
  { label: "enhancement", heading: "## ✨ Enhancements" },
  { label: "bug", heading: "## 🐛 Bug fixes" },
  { label: "documentation", heading: "## 📚 Documentation" },
] as const;

let REPO = "manzt/tintype";

function getCommitsSinceTag(sinceTag: string): ReadonlyArray<Commit> {
  let output: string = NodeChildProcess.execSync(
    `git log ${sinceTag}..HEAD --format="%H %s" --first-parent main`,
    { encoding: "utf-8" },
  );
  return output
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      let [sha, ...rest] = line.split(" ");
      let message = rest.join(" ");
      let match = message.match(/#(\d+)/);
      return {
        sha,
        message,
        prNumber: match ? Number(match[1]) : null,
      };
    });
}

function getMergedPRs(limit = 100): Map<number, PullRequest> {
  let output = NodeChildProcess.execSync(
    `gh pr list --repo ${REPO} --base main --state merged --limit ${limit} --json number,title,author,labels,body,mergedAt`,
    { encoding: "utf-8" },
  );
  let prs = z.array(PullRequest).parse(JSON.parse(output));
  return new Map(prs.map((pr) => [pr.number, pr]));
}

function isVersionCommit(commit: Commit): boolean {
  return /^v?\d+\.\d+\.\d+/.test(commit.message);
}

function stripConventionalPrefix(title: string): string {
  let match = title.match(/^\w+(?:\([^)]+\))?:\s*(.+)/);
  if (match) {
    return match[1][0].toUpperCase() + match[1].slice(1);
  }
  return title;
}

function formatEntry(entry: Entry): string {
  if (entry.pr) {
    let title = stripConventionalPrefix(entry.pr.title);
    return `* ${title} ([#${entry.pr.number}](https://github.com/${REPO}/pull/${entry.pr.number}))`;
  }
  let title = stripConventionalPrefix(entry.commit.message);
  return `* ${title} (${entry.commit.sha.slice(0, 7)})`;
}

function categorizeEntries(entries: ReadonlyArray<Entry>): ReadonlyArray<Section> {
  let other: Entry[] = [];
  let buckets = new Map<string, Entry[]>(CATEGORIES.map((c) => [c.label, []]));

  for (let entry of entries) {
    if (isVersionCommit(entry.commit)) {
      continue;
    }

    if (!entry.pr) {
      other.push(entry);
      continue;
    }

    let labels = new Set(entry.pr.labels.map((l) => l.name));
    if (labels.has("internal")) {
      continue;
    }

    let placed = false;
    for (let { label } of CATEGORIES) {
      if (labels.has(label)) {
        buckets.get(label)!.push(entry);
        placed = true;
        break;
      }
    }
    if (!placed) {
      other.push(entry);
    }
  }

  let sections: Array<Section> = CATEGORIES.filter((c) => buckets.get(c.label)!.length > 0).map(
    (c) => ({
      category: c.label,
      heading: c.heading,
      entries: buckets.get(c.label)!,
    }),
  );

  if (other.length > 0) {
    sections.push({
      category: "other",
      heading: "## 📝 Other changes",
      entries: other,
    });
  }

  return sections;
}

function getContributors(entries: Entry[]): string[] {
  let logins = new Set<string>();
  for (let entry of entries) {
    if (entry.pr) logins.add(entry.pr.author.login);
  }
  return [...logins].sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase()));
}

function generateReleaseNotes(sinceTag: string, currentTag: string): string {
  let commits = getCommitsSinceTag(sinceTag);
  let prMap = getMergedPRs();

  let entries: Entry[] = commits.map((commit) => ({
    commit,
    pr: commit.prNumber ? (prMap.get(commit.prNumber) ?? null) : null,
  }));

  let sections = categorizeEntries(entries);
  let lines = ["## What's Changed\n"];

  for (let section of sections) {
    lines.push(section.heading);
    for (let entry of section.entries) {
      lines.push(formatEntry(entry));
    }
    lines.push("");
  }

  let contributors = getContributors(entries);
  if (contributors.length > 0) {
    lines.push("## Contributors");
    lines.push(
      `Thanks to all contributors who made this release possible: @${contributors.join(", @")}`,
    );
  }

  lines.push(
    `\n**Full Changelog**: https://github.com/${REPO}/compare/${sinceTag}...${currentTag}`,
  );

  return lines.join("\n");
}

let [sinceTag, currentTag] = NodeProcess.argv.slice(2);
if (!sinceTag || !currentTag) {
  console.error(
    "Usage: node --experimental-strip-types scripts/generate-release-notes.ts <since-tag> <current-tag>",
  );
  NodeProcess.exit(1);
}
console.log(generateReleaseNotes(sinceTag, currentTag));
