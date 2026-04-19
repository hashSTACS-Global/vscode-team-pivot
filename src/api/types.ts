export interface ThreadMeta {
  category: string;
  slug: string;
  title: string;
  author: string;
  author_display: string;
  status: string;
  last_updated: string;
  post_count: number;
  unread_count: number;
}

export interface ThreadListResponse {
  items: ThreadMeta[];
}

export interface PostMention {
  author_id?: string;
  author_display?: string;
  comments?: string;
  open_ids?: string[];
}

export interface Post {
  filename: string;
  frontmatter: Record<string, unknown>;
  body: string;
  author_display: string;
  mentions: PostMention[];
}

export interface ThreadDetail {
  meta: ThreadMeta;
  posts: Post[];
}

export interface Contact {
  open_id: string;
  name: string;
  en_name?: string;
  avatar_url?: string;
}

export interface ContactsResponse {
  items: Contact[];
  total: number;
}

export interface Me {
  open_id: string;
  name: string;
  avatar_url?: string;
  pinyin?: string;
  github_username?: string;
}

export interface Draft {
  id: string;
  type: "proposal" | "reply";
  title: string | null;
  category: string | null;
  body_md: string;
  thread_key: string | null;
  mentions: { open_ids: string[]; comments: string } | null;
  reply_to: string | null;
  references: string[];
  created_at: number;
  updated_at: number;
}

export interface DraftsListResponse {
  items: Draft[];
}

export interface CreateDraftBody {
  type: "proposal" | "reply";
  title?: string;
  category?: string;
  body_md?: string;
  thread_key?: string;
  mentions?: { open_ids: string[]; comments: string };
  reply_to?: string;
  references?: string[];
}

export interface UpdateDraftBody {
  title?: string;
  category?: string;
  body_md?: string;
  thread_key?: string;
  mentions?: { open_ids: string[]; comments: string };
  reply_to?: string;
  references?: string[];
}
