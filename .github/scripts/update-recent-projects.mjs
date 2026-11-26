import { readFile, writeFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";

const USERNAME = process.env.PROFILE_USERNAME || "shentonyan";
const README_URL = new URL("../../README.md", import.meta.url);
const START_MARKER = "<!-- recent-projects:start -->";
const END_MARKER = "<!-- recent-projects:end -->";
const EXCLUDED_REPOSITORIES = new Set([USERNAME, `${USERNAME}.github.io`]);
const LANGUAGE_BADGES = {
  C: ["555555", "c", "white"],
  "C++": ["00599C", "cplusplus", "white"],
  CSS: ["663399", "css", "white"],
  HTML: ["E34F26", "html5", "white"],
  Java: ["ED8B00", "openjdk", "white"],
  JavaScript: ["F1E05A", "javascript", "black"],
  "Jupyter Notebook": ["F37626", "jupyter", "white"],
  Lean: ["000000", "lean", "white"],
  "PowerShell": ["5391FE", "powershell", "white"],
  Python: ["3776AB", "python", "white"],
  Rust: ["000000", "rust", "white"],
  Solidity: ["363636", "solidity", "white"],
  TeX: ["008080", "latex", "white"],
  TypeScript: ["3178C6", "typescript", "white"],
};

function escapeMarkdown(text) {
  return text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replace(/([\\`*_[\]])/g, "\\$1");
}

function repositoryDescription(repository) {
  const description = (repository.description || "")
    .replace(/\s*[·|]\s*Built with Manus\.?\s*$/i, "")
    .replace(/\s+/g, " ")
    .trim();
  return description || "Recent experiments and development.";
}

function languageBadge(language) {
  if (!language) return "";
  const [color, logo, logoColor] = LANGUAGE_BADGES[language] || ["59636E"];
  const logoQuery = logo ? `&logo=${logo}&logoColor=${logoColor}` : "";
  return `![${language}](https://img.shields.io/badge/${encodeURIComponent(language)}-${color}?style=flat${logoQuery})`;
}

function liveDemoUrl(homepage) {
  if (!homepage) return "";
  try {
    const url = new URL(homepage);
    if (url.protocol !== "https:" && url.protocol !== "http:") return "";
    const destination = url.href.replaceAll("(", "%28").replaceAll(")", "%29");
    return `[live demo](${destination})`;
  } catch {
    return "";
  }
}

export function renderRecentProjects(repositories, limit = 6) {
  return repositories
    .filter(
      (repository) =>
        !repository.private &&
        !repository.fork &&
        !repository.archived &&
        !EXCLUDED_REPOSITORIES.has(repository.name),
    )
    .sort(
      (left, right) =>
        new Date(right.pushed_at).getTime() - new Date(left.pushed_at).getTime(),
    )
    .slice(0, limit)
    .map((repository) => {
      const name = escapeMarkdown(repository.name);
      const rawDescription = escapeMarkdown(repositoryDescription(repository));
      const badge = languageBadge(repository.language);
      const demo = liveDemoUrl(repository.homepage);
      const chineseEnding = /[。！？]$/.test(rawDescription);
      const description = demo ? rawDescription.replace(/[.!?。！？]+$/, "") : rawDescription;
      const separator = demo ? (chineseEnding ? "； " : "; ") : "";
      const ending = demo || /[.!?。！？]$/.test(description) ? "" : ".";
      const updated = repository.pushed_at.slice(0, 10);
      return `- [${name}](https://github.com/${USERNAME}/${repository.name}), ${description}${separator}${demo}${ending} ${badge} <sub>updated ${updated}</sub>`;
    })
    .join("\n");
}

export function updateReadme(readme, projects) {
  const start = readme.indexOf(START_MARKER);
  const end = readme.indexOf(END_MARKER);
  if (start === -1 || end === -1 || end < start) {
    throw new Error("Recent-project markers are missing from README.md");
  }
  return `${readme.slice(0, start + START_MARKER.length)}\n${projects}\n${readme.slice(end)}`;
}

async function main() {
  const response = await fetch(
    `https://api.github.com/users/${USERNAME}/repos?per_page=100&sort=pushed`,
    {
      headers: {
        Accept: "application/vnd.github+json",
        "User-Agent": `${USERNAME}-profile-readme`,
        ...(process.env.GITHUB_TOKEN
          ? { Authorization: `Bearer ${process.env.GITHUB_TOKEN}` }
          : {}),
      },
    },
  );
  if (!response.ok) {
    throw new Error(`GitHub API returned ${response.status}: ${await response.text()}`);
  }

  const repositories = await response.json();
  const readme = await readFile(README_URL, "utf8");
  const updated = updateReadme(readme, renderRecentProjects(repositories));
  if (updated !== readme) await writeFile(README_URL, updated);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
