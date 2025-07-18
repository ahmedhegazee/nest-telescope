export interface TelescopeEntry {
  id: string;
  type: string;
  familyHash: string;
  content: Record<string, any>;
  tags: string[];
  timestamp: Date;
  sequence: number;
  batchId?: string;
}

export interface TelescopeEntryFilter {
  type?: string;
  tags?: string[];
  dateFrom?: Date;
  dateTo?: Date;
  limit?: number;
  offset?: number;
}

export interface TelescopeEntryResult {
  entries: TelescopeEntry[];
  total: number;
  hasMore: boolean;
}