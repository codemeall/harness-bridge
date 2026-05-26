export type Cadence = "checkpoint" | "lazy" | "aggressive";

export interface BridgeFrontmatter {
  schema: "harness-bridge/v1";
  generated_by: string;
  generated_at: string;
  last_updated: string;
  cadence: Cadence;
  repo: string;
  branch: string;
  head: string;
  dirty: boolean;
  [key: string]: unknown;
}

export interface BridgeDocument {
  frontmatter: BridgeFrontmatter;
  title: string;
  sections: Record<string, string>;
}

export interface GitState {
  repo: string;
  branch: string;
  head: string;
  dirty: boolean;
  root: string;
}

export interface ValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
}

export interface StatusResult {
  exists: boolean;
  path: string;
  validation?: ValidationResult;
  bridge?: BridgeDocument;
  git: GitState;
  discrepancies: string[];
  gitLogSinceBridgeHead?: string;
  fileGrounding?: FileGrounding[];
}

export interface FileGrounding {
  file: string;
  diffFromBridgeHead: string;
  status: string;
}

export interface InitOptions {
  cwd: string;
  generatedBy: string;
  title: string;
  goal: string;
  plan?: string;
  nextAction?: string;
  cadence?: Cadence;
}

export interface CheckpointOptions {
  cwd: string;
  generatedBy: string;
  title?: string;
  goal?: string;
  plan?: string;
  nextAction?: string;
  decisionsToAppend?: string[];
  openQuestions?: string;
  filesTouched?: string;
  notes?: string;
  cadence?: Cadence;
}
