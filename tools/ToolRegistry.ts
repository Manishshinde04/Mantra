import { ToolDefinition, ToolExecutionResult } from "./types";
import { CalculatorTool } from "./CalculatorTool";
import { WebSearchTool } from "./WebSearchTool";

export class ToolRegistry {
  private static instance: ToolRegistry;
  private tools: Map<string, ToolDefinition> = new Map();

  private constructor() {
    this.registerTool(new CalculatorTool());
    this.registerTool(new WebSearchTool());
  }

  public static getInstance(): ToolRegistry {
    if (!ToolRegistry.instance) {
      ToolRegistry.instance = new ToolRegistry();
    }
    return ToolRegistry.instance;
  }

  public registerTool(tool: ToolDefinition): void {
    this.tools.set(tool.name, tool);
  }

  public getTool(name: string): ToolDefinition | undefined {
    return this.tools.get(name);
  }

  public getAllTools(): ToolDefinition[] {
    return Array.from(this.tools.values());
  }

  public async executeTool(
    name: string,
    params: Record<string, any>,
    signal?: AbortSignal
  ): Promise<ToolExecutionResult> {
    const tool = this.tools.get(name);
    if (!tool) {
      return {
        success: false,
        result: null,
        error: `Tool '${name}' is not registered.`,
      };
    }
    return tool.execute(params, signal);
  }
}
