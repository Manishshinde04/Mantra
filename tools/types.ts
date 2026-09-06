export interface ToolParameter {
  name: string;
  type: "string" | "number" | "boolean";
  description: string;
  required?: boolean;
}

export interface ToolDefinition {
  name: string;
  description: string;
  parameters?: ToolParameter[];
  execute: (params: Record<string, any>, signal?: AbortSignal) => Promise<ToolExecutionResult>;
}

export interface ToolExecutionResult {
  success: boolean;
  result: any;
  error?: string;
  source?: string;
}
