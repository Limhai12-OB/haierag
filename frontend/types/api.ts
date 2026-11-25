/**
 * Public backend API types — mirrors docs/api/contracts.md §1.
 * Keep in sync with the contract; do not add fields the backend does not send.
 */

// ---------- Errors ----------
export type ProblemDetail = {
  type?: string;
  title?: string;
  status?: number;
  detail?: string;
  instance?: string;
  errors?: Record<string, string>;
};

// ---------- Auth ----------
export type SystemRole = "ADMIN" | "USER";

export type User = {
  id: string;
  email: string;
  displayName: string;
  systemRole: SystemRole;
  createdAt: string;
};

export type AuthResponse = {
  accessToken: string;
  tokenType: "Bearer";
  expiresIn: number; // seconds
  user: User;
};

export type LoginRequest = { email: string; password: string };
export type RegisterRequest = { email: string; password: string; displayName: string };
export type UpdateProfileRequest = { displayName: string };

// ---------- Workspaces ----------
export type Role = "OWNER" | "MEMBER" | "VIEWER";

export type Workspace = {
  id: string;
  name: string;
  description: string | null;
  role: Role;
  createdAt: string;
  updatedAt: string;
};

export type WorkspaceRequest = { name: string; description?: string };

export type Member = {
  userId: string;
  email: string;
  displayName: string;
  role: Role;
  joinedAt: string;
};

export type WorkspaceStats = {
  documents: number;
  collections: number;
  chunks: number;
  conversations: number;
  documentsByStatus: Record<DocumentStatus, number>;
};

export type Activity = {
  id: number;
  action: string;
  entityType: string | null;
  entityId: string | null;
  actorName: string | null;
  details: Record<string, unknown>;
  createdAt: string;
};

// ---------- Collections ----------
export type Collection = {
  id: string;
  workspaceId: string;
  name: string;
  description: string | null;
  documentCount: number;
  createdAt: string;
  updatedAt: string;
};

export type CollectionRequest = { name: string; description?: string };

// ---------- Documents ----------
export type DocumentStatus = "UPLOADED" | "QUEUED" | "PROCESSING" | "COMPLETED" | "FAILED";

export const DOCUMENT_STATUSES: DocumentStatus[] = ["UPLOADED", "QUEUED", "PROCESSING", "COMPLETED", "FAILED"];

export type FileType = "PDF" | "DOCX" | "XLSX" | "PPTX" | "TXT" | "MARKDOWN" | "CSV";

export type Document = {
  id: string;
  workspaceId: string;
  collectionId: string | null;
  collectionName: string | null;
  name: string;
  originalFilename: string;
  contentType: string;
  fileType: FileType;
  sizeBytes: number;
  status: DocumentStatus;
  errorMessage: string | null;
  pageCount: number | null;
  chunkCount: number;
  uploadedBy: string | null;
  processedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type DocumentPatch = { name?: string; collectionId?: string | null };

export type ProcessingJob = {
  id: string;
  status: string;
  stage: string | null;
  attempts: number;
  startedAt: string | null;
  finishedAt: string | null;
  metrics: Record<string, unknown>;
};

export type DocumentStatusInfo = {
  documentId: string;
  status: DocumentStatus;
  errorMessage: string | null;
  job: ProcessingJob | null;
};

export type Chunk = {
  id: string;
  chunkIndex: number;
  content: string;
  tokenCount: number;
  pageStart: number | null;
  pageEnd: number | null;
  sectionHeading: string | null;
  metadata: Record<string, unknown>;
};

export type Page<T> = {
  content: T[];
  page: number;
  size: number;
  totalElements: number;
  totalPages: number;
};

// ---------- Conversations & chat ----------
export type ScopeType = "WORKSPACE" | "COLLECTION" | "DOCUMENTS";

export type Conversation = {
  id: string;
  workspaceId: string;
  title: string;
  scopeType: ScopeType;
  collectionId: string | null;
  documentIds: string[];
  createdAt: string;
  updatedAt: string;
};

export type CreateConversationRequest = {
  workspaceId: string;
  title?: string;
  scopeType?: ScopeType;
  collectionId?: string;
  documentIds?: string[];
};

export type Citation = {
  marker: number;
  chunkId: string | null;
  documentId: string | null;
  documentName: string;
  pageNumber: number | null;
  sectionHeading: string | null;
  excerpt: string;
  retrievalScore: number | null;
  rerankScore: number | null;
};

export type MessageRole = "USER" | "ASSISTANT";
export type MessageStatus = "STREAMING" | "COMPLETED" | "FAILED";

export type Message = {
  id: string;
  role: MessageRole;
  content: string;
  status: MessageStatus;
  citations: Citation[];
  metadata: Record<string, unknown>;
  createdAt: string;
};

export type ConversationDetail = Conversation & { messages: Message[] };

// ---------- Chat SSE events ----------
export type RetrievalMeta = {
  retrieval: { candidates: number; passages: number; timingsMs: Record<string, number> };
};

export type ChatStreamEvent =
  | { event: "user_message"; data: Message }
  | { event: "meta"; data: RetrievalMeta }
  | { event: "token"; data: { text: string } }
  | { event: "citations"; data: { citations: Citation[] } }
  | { event: "done"; data: { message: Message } }
  | { event: "error"; data: { code: string; message: string } };

// ---------- System ----------
export type HealthLevel = "ok" | "degraded" | "down";

export type AiComponentName = "ollama" | "llm" | "embedding" | "reranker" | "postgres" | "redis" | "storage";

export type AiComponentHealth = { status: HealthLevel; detail?: string; [k: string]: unknown };

export type AiHealth = {
  status: HealthLevel;
  components: Partial<Record<AiComponentName, AiComponentHealth>>;
};

/** Backend components are reported as a status string ("UP"/"DOWN") or an object with a status. */
export type BackendComponentHealth = string | { status: string; detail?: string; [k: string]: unknown };

export type SystemHealth = {
  backend: string;
  database: BackendComponentHealth;
  redis: BackendComponentHealth;
  storage: BackendComponentHealth;
  aiService: AiHealth | BackendComponentHealth;
};

/** `/admin/jobs` shape is not pinned by the contract; these are the fields we render when present. */
export type AdminJob = {
  id: string;
  documentId?: string | null;
  documentName?: string | null;
  workspaceId?: string | null;
  status: string;
  stage?: string | null;
  attempts?: number;
  errorMessage?: string | null;
  createdAt?: string | null;
  startedAt?: string | null;
  finishedAt?: string | null;
  [k: string]: unknown;
};
