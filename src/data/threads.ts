import * as fs from "node:fs/promises";
import * as path from "node:path";
import { getMentionsByFile, readThreadIndex } from "./indexFiles";
import { readPost } from "./posts";
import type { ThreadDetail, ThreadMeta } from "../api/types";

export async function listThreadsFromMirror(repoPath: string): Promise<ThreadMeta[]> {
  const discussionsRoot = path.join(repoPath, "discussions");
  const indexDir = path.join(repoPath, "index");
  const categories = await safeDirents(discussionsRoot);
  const results: ThreadMeta[] = [];

  for (const cat of categories.filter((d) => d.isDirectory()).sort(byName)) {
    const categoryPath = path.join(discussionsRoot, cat.name);
    const threads = await safeDirents(categoryPath);
    for (const tdir of threads.filter((d) => d.isDirectory()).sort(byName)) {
      const meta = await readThreadMeta(cat.name, path.join(categoryPath, tdir.name), indexDir);
      if (meta) results.push(meta);
    }
  }

  return results.sort((a, b) => (b.last_updated ?? "").localeCompare(a.last_updated ?? ""));
}

export async function getThreadFromMirror(
  repoPath: string,
  category: string,
  slug: string,
): Promise<ThreadDetail | null> {
  const discussionsRoot = path.join(repoPath, "discussions");
  const indexDir = path.join(repoPath, "index");
  const threadDir = path.join(discussionsRoot, category, slug);
  const meta = await readThreadMeta(category, threadDir, indexDir);
  if (!meta) return null;

  const posts = await listPosts(threadDir);
  const mentionsByFile = await getMentionsByFile(indexDir, slug);
  return {
    meta,
    posts: posts.map((p) => ({
      filename: p.filename,
      frontmatter: p.frontmatter,
      body: p.body,
      author_display: stringValue(p.frontmatter.author) ?? "unknown",
      mentions: mentionsByFile[p.filename] ?? [],
    })),
  };
}

async function readThreadMeta(
  category: string,
  threadDir: string,
  indexDir: string,
): Promise<ThreadMeta | null> {
  const slug = path.basename(threadDir);
  const posts = await listPosts(threadDir);
  if (posts.length === 0) return null;
  const proposal = posts.find((p) => p.frontmatter.type === "proposal");
  if (!proposal) return null;

  const index = await readThreadIndex(indexDir, slug);
  return {
    category,
    slug,
    title:
      stringValue(proposal.frontmatter.title) ??
      extractH1(proposal.body) ??
      deriveTitle(proposal.filename),
    author: stringValue(proposal.frontmatter.author) ?? "",
    author_display: stringValue(proposal.frontmatter.author) ?? "unknown",
    status: index?.status ?? "open",
    last_updated: index?.last_updated ?? stringValue(proposal.frontmatter.created_at) ?? "",
    post_count: posts.length,
    unread_count: 0,
    favorite: false,
  };
}

async function listPosts(threadDir: string) {
  const dirents = await safeDirents(threadDir);
  const files = dirents
    .filter((d) => d.isFile() && d.name.endsWith(".md"))
    .filter((d) => !d.name.startsWith("SUMMARY") && !d.name.startsWith("RESULT"))
    .sort(byName);

  const posts = [];
  for (const file of files) {
    try {
      const post = await readPost(path.join(threadDir, file.name));
      if (post.frontmatter.index_state === "un-indexed") continue;
      posts.push(post);
    } catch {
      // skip malformed files
    }
  }
  return posts;
}

async function safeDirents(dirPath: string) {
  try {
    return await fs.readdir(dirPath, { withFileTypes: true });
  } catch {
    return [];
  }
}

function extractH1(body: string): string | null {
  for (const line of body.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (trimmed.startsWith("# ")) return trimmed.slice(2).trim();
    if (trimmed) return null;
  }
  return null;
}

function deriveTitle(filename: string): string {
  const stem = filename.replace(/\.md$/, "");
  const parts = stem.split("_");
  return parts.length >= 3 ? parts.slice(1, -1).join("_").replace(/-/g, " ") : stem;
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" && value ? value : null;
}

function byName(a: { name: string }, b: { name: string }) {
  return a.name.localeCompare(b.name);
}
