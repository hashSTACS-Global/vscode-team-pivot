import * as fs from "node:fs/promises";
import * as path from "node:path";
import { parse as parseYaml } from "yaml";

export interface LocalPost {
  filename: string;
  frontmatter: Record<string, unknown>;
  body: string;
}

const FRONTMATTER_RE = /^---\n([\s\S]*?)\n---\n([\s\S]*)$/;
const EXTRA_FRONTMATTER_RE = /^\s*---\n([\s\S]*?)\n---\n/;

export async function readPost(filePath: string): Promise<LocalPost> {
  const content = await fs.readFile(filePath, "utf8");
  const match = FRONTMATTER_RE.exec(content);
  if (!match) {
    return { filename: path.basename(filePath), frontmatter: {}, body: content };
  }

  const [, fmText, bodyText] = match;
  const frontmatter = normalizeFrontmatter(parseRecord(fmText));
  const extra = EXTRA_FRONTMATTER_RE.exec(bodyText);
  if (!extra) {
    return { filename: path.basename(filePath), frontmatter, body: bodyText };
  }

  const merged = {
    ...normalizeFrontmatter(parseRecord(extra[1])),
    ...frontmatter,
  };
  return {
    filename: path.basename(filePath),
    frontmatter: merged,
    body: bodyText.slice(extra[0].length),
  };
}

function parseRecord(input: string): Record<string, unknown> {
  try {
    const parsed = parseYaml(input);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

function normalizeFrontmatter(
  frontmatter: Record<string, unknown>,
): Record<string, unknown> {
  if ("summary" in frontmatter && !("auto-summary" in frontmatter)) {
    const { summary, ...rest } = frontmatter;
    return { ...rest, "auto-summary": summary };
  }
  return frontmatter;
}
