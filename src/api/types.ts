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
  favorite: boolean;
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

export interface MentionBlock {
  open_ids: string[];
  comments: string;
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

export interface WorkspaceMirrorInfo {
  repo_url: string;
  visibility: "public" | "private" | string;
  branch: string;
  repo_name: string;
  provider: "github" | string;
  readonly: boolean;
  git_username: string | null;
  git_token: string | null;
  head: string | null;
}

export interface CreateThreadResponse {
  category: string;
  slug: string;
  filename: string;
}

export interface CategoryEntry {
  name: string;
  post_count: number;
  last_updated: string | null;
}

export interface ListCategoriesResponse {
  items: CategoryEntry[];
}

export interface UpdateSnapshot {
  state:
    | "unknown"
    | "not_configured"
    | "checking"
    | "up_to_date"
    | "update_available"
    | "upgrade_required"
    | "check_failed";
  blocked: boolean;
  currentVersion: string;
  latestVersion?: string;
  minimumSupported?: string;
  message: string;
  downloadUrl?: string;
  sha256?: string;
  checkedAt?: string;
}
