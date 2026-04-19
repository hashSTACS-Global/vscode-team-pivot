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
