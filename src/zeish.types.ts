export interface ZeishExternalIdentity {
  organizationId: string;
  userId: string;
}

export interface ZeishConfig {
  apiKey: string;
  baseUrl?: string;
  externalIdentity?: ZeishExternalIdentity;
}

export interface ZeishSandbox {
  id: string;
  status: string;
  createdAt: string;
  config: ZeishConfig;
  access?: ZeishAccess;
}

export interface ZeishAccess {
  sandboxUrl: string;
  sandboxRpcUrl: string;
  token: string;
  expiresAt: string;
}

export interface ZeishSnapshot {
  id: string;
  displayName: string;
  status: string;
  createdAt: string;
}

export interface ZeishFileEntry {
  name: string;
  path: string;
  is_dir: boolean;
  size: number;
  modified: string;
}

export interface ZeishFileList {
  entries: ZeishFileEntry[];
}

export interface ZeishFileStat {
  exists: boolean;
}
