import * as fs from "node:fs/promises";
import * as path from "node:path";
import { parse as parseYaml } from "yaml";

export interface LocalThreadIndex {
  status: string | null;
  last_updated: string | null;
}

export interface LocalMentionEntry {
  time?: string;
  author_id?: string;
  author_display?: string;
  comments?: string;
  open_ids?: string[];
}

export async function readThreadIndex(
  indexDir: string,
  slug: string,
): Promise<LocalThreadIndex | null> {
  const data = await readIndexYaml(indexDir, slug);
  if (!data) return null;
  const discussions = Array.isArray(data.discussions) ? data.discussions : [];
  const first = discussions[0];
  const status =
    first && typeof first === "object" && first && "status" in first
      ? stringOrNull((first as Record<string, unknown>).status)
      : null;
  return {
    status,
    last_updated: stringOrNull(data.last_updated),
  };
}

export async function getMentionsByFile(
  indexDir: string,
  slug: string,
): Promise<Record<string, LocalMentionEntry[]>> {
  const data = await readIndexYaml(indexDir, slug);
  if (!data) return {};
  const timeline = Array.isArray(data.timeline) ? data.timeline : [];
  const result: Record<string, LocalMentionEntry[]> = {};
  for (const item of timeline) {
    if (!item || typeof item !== "object") continue;
    const entry = item as Record<string, unknown>;
    if (!entry.mention || typeof entry.file !== "string") continue;
    const mention = entry.mention as Record<string, unknown>;
    const users = Array.isArray(mention.users) ? mention.users : [];
    const open_ids = users
      .map((u) =>
        u && typeof u === "object" && "open_id" in u
          ? stringOrNull((u as Record<string, unknown>).open_id)
          : null,
      )
      .filter((v): v is string => Boolean(v));
    const names = users
      .map((u) =>
        u && typeof u === "object" && "user" in u
          ? stringOrNull((u as Record<string, unknown>).user)
          : null,
      )
      .filter((v): v is string => Boolean(v));
    const authorId = typeof entry.event === "string" ? entry.event.split(" ")[0] : undefined;
    const filename = path.basename(entry.file);
    result[filename] ??= [];
    result[filename].push({
      time: stringOrNull(entry.time) ?? undefined,
      author_id: authorId,
      author_display: authorId,
      comments: stringOrNull(mention.comments) ?? undefined,
      open_ids,
      ...(names.length > 0 ? { author_display: names.join("、") } : {}),
    });
  }
  return result;
}

async function readIndexYaml(
  indexDir: string,
  slug: string,
): Promise<Record<string, unknown> | null> {
  const filePath = path.join(indexDir, `${slug}-discuss.index.yaml`);
  try {
    const content = await fs.readFile(filePath, "utf8");
    const parsed = parseYaml(content);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

function stringOrNull(value: unknown): string | null {
  return typeof value === "string" && value ? value : null;
}
