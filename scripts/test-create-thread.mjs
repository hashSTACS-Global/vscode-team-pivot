#!/usr/bin/env node
// scripts/test-create-thread.mjs
//
// 端到端验证 POST /api/threads 和 GET /api/categories 是否可用。
// 绕过 VS Code 扩展，直接对服务端发请求，快速确认发帖链路端到端通。
//
// Usage:
//   PIVOT_TOKEN=pvt_xxx node scripts/test-create-thread.mjs [--dry-run] [--categories-only]
//
// Env:
//   PIVOT_SERVER  服务端地址，默认 https://pivot.enclaws.ai
//   PIVOT_TOKEN   必填。Personal Access Token（pvt_ 开头）
//
// Flags:
//   --dry-run          只打印将要发的请求体，不真的发
//   --categories-only  只验证 GET /api/categories，不发新帖（推荐先这么跑）

import { argv, env, exit } from "node:process";

const SERVER = (env.PIVOT_SERVER ?? "https://pivot.enclaws.ai").replace(/\/+$/, "");
const TOKEN = env.PIVOT_TOKEN;
const DRY = argv.includes("--dry-run");
const CATEGORIES_ONLY = argv.includes("--categories-only");

if (!TOKEN) {
  console.error("❌ PIVOT_TOKEN env required (pvt_xxx)");
  exit(1);
}

async function get(pathname) {
  const res = await fetch(`${SERVER}${pathname}`, {
    headers: { Authorization: `Bearer ${TOKEN}` },
  });
  const body = await res.json().catch(() => null);
  return { status: res.status, body };
}

async function post(pathname, payload) {
  const res = await fetch(`${SERVER}${pathname}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${TOKEN}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });
  const body = await res.json().catch(() => null);
  return { status: res.status, body };
}

async function main() {
  console.log(`Server : ${SERVER}`);
  console.log(`Mode   : ${DRY ? "dry-run" : "live"}${CATEGORIES_ONLY ? " (categories-only)" : ""}`);
  console.log("");

  // 1) GET /api/categories
  console.log("▶ GET /api/categories");
  const cat = await get("/api/categories");
  console.log(`  status: ${cat.status}`);
  if (cat.status !== 200) {
    console.error("❌ categories request failed:", cat.body);
    exit(1);
  }
  const items = cat.body?.items ?? [];
  console.log(`  items: ${items.length}`);
  if (items.length > 0) {
    console.log("  sample:");
    for (const it of items.slice(0, 3)) {
      console.log(`    - ${it.name} · ${it.post_count} 个帖子 · last_updated=${it.last_updated ?? "null"}`);
    }
  }
  for (const it of items) {
    if (typeof it.name !== "string") {
      console.error(`❌ invalid item (no .name):`, it);
      exit(1);
    }
    if (typeof it.post_count !== "number") {
      console.error(`❌ invalid item (.post_count not number):`, it);
      exit(1);
    }
  }
  console.log("✅ /api/categories shape OK\n");

  if (CATEGORIES_ONLY) {
    console.log("--categories-only set, skipping thread creation.");
    return;
  }

  // 2) POST /api/threads
  const payload = {
    category: "vscode-ext-smoke",
    title: `smoke ${new Date().toISOString()}`,
    body: "# Smoke\n\n这是 vscode-team-pivot 扩展发帖连通性测试。看到此帖可安全删除。",
  };
  console.log("▶ POST /api/threads");
  console.log("  payload:", JSON.stringify(payload, null, 2));

  if (DRY) {
    console.log("\n--dry-run set, NOT sending.");
    return;
  }

  const create = await post("/api/threads", payload);
  console.log(`  status: ${create.status}`);
  console.log("  response:", create.body);
  if (create.status !== 200) {
    console.error("❌ create thread failed");
    exit(1);
  }
  const { category, slug, filename } = create.body ?? {};
  if (!category || !slug || !filename) {
    console.error("❌ response missing category/slug/filename");
    exit(1);
  }
  console.log(`✅ createThread OK: ${category}/${slug} · filename=${filename}\n`);
}

main().catch((e) => {
  console.error("❌ error:", e);
  exit(1);
});
