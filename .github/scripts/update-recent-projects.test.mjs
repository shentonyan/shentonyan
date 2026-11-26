import assert from "node:assert/strict";
import test from "node:test";
import { renderRecentProjects, updateReadme } from "./update-recent-projects.mjs";

const repository = (name, pushed_at, overrides = {}) => ({
  name,
  pushed_at,
  description: `${name} description`,
  homepage: null,
  language: "TypeScript",
  private: false,
  fork: false,
  archived: false,
  ...overrides,
});

test("sorts eligible original repositories by latest push and limits the list", () => {
  const repositories = [
    repository("older", "2026-11-20T00:00:00Z"),
    repository("private", "2026-11-26T00:00:00Z", { private: true }),
    repository("fork", "2026-11-26T00:00:00Z", { fork: true }),
    repository("archived", "2026-11-26T00:00:00Z", { archived: true }),
    repository("shentonyan", "2026-11-26T00:00:00Z"),
    repository("shentonyan.github.io", "2026-11-26T00:00:00Z"),
    repository("newest", "2026-11-25T00:00:00Z"),
    repository("middle", "2026-11-24T00:00:00Z"),
    repository("seventh", "2026-11-23T00:00:00Z"),
  ];

  const rendered = renderRecentProjects(repositories, 3);

  assert.deepEqual(
    [...rendered.matchAll(/^- \[([^\]]+)\]/gm)].map((match) => match[1]),
    ["newest", "middle", "seventh"],
  );
  assert.doesNotMatch(rendered, /\/shentonyan\/(private|archived|shentonyan|fork|older)[),\]]/);
  assert.match(rendered, /updated 2026-11-25/);
  assert.equal(rendered.split("\n").length, 3);
});

test("renders descriptions, language badges, and safe homepage links", () => {
  const rendered = renderRecentProjects([
    repository("demo", "2026-11-26T12:00:00Z", {
      description: "A <script>alert(1)</script> & [demo]. · Built with Manus",
      homepage: "https://example.com/demo_(test)",
      language: "Python",
    }),
  ]);

  assert.match(rendered, /A &lt;script&gt;alert\(1\)&lt;\/script&gt; &amp; \\\[demo\\\]/);
  assert.doesNotMatch(rendered, /Built with Manus/);
  assert.match(rendered, /\\\[demo\\\]; \[live demo\]\(https:\/\/example\.com\/demo_%28test%29\)/);
  assert.doesNotMatch(rendered, /\\\[demo\\\]\.;/);
  assert.match(rendered, /badge\/Python-3776AB/);
  assert.doesNotMatch(rendered, /<script>/);
});

test("uses an honest fallback and avoids duplicated punctuation", () => {
  const rendered = renderRecentProjects([
    repository("new-project", "2026-11-26T12:00:00Z", { description: null }),
    repository("finished", "2026-11-25T12:00:00Z", { description: "Finished。" }),
  ]);

  assert.match(rendered, /Recent experiments and development\./);
  assert.match(rendered, /Finished。/);
  assert.doesNotMatch(rendered, /Finished。\.|Finished\.\./);
});

test("only replaces content inside the project markers", () => {
  const readme = "before\n<!-- recent-projects:start -->\nold\n<!-- recent-projects:end -->\nafter\n";
  const updated = updateReadme(readme, "new");

  assert.equal(
    updated,
    "before\n<!-- recent-projects:start -->\nnew\n<!-- recent-projects:end -->\nafter\n",
  );
  assert.throws(() => updateReadme("without markers", "new"), /markers are missing/);
});
