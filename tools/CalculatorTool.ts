import { ToolDefinition, ToolExecutionResult } from "./types";

export class CalculatorTool implements ToolDefinition {
  public name = "calculator";
  public description = "Perform exact mathematical and arithmetic calculations (addition, subtraction, multiplication, division, exponentiation, modulo).";
  public parameters = [
    {
      name: "expression",
      type: "string" as const,
      description: "Mathematical expression to evaluate (e.g. '38291 * 729' or 'sqrt(144) + 15^2')",
      required: true,
    },
  ];

  public async execute(params: Record<string, any>): Promise<ToolExecutionResult> {
    try {
      const rawExpr = params?.expression;
      if (!rawExpr || typeof rawExpr !== "string") {
        return { success: false, result: null, error: "Empty mathematical expression provided." };
      }

      // Sanitize expression: allow only numbers, operators, parens, decimal points, and safe Math functions
      const cleanExpr = rawExpr
        .replace(/\s+/g, "")
        .replace(/×/g, "*")
        .replace(/÷/g, "/")
        .replace(/\^/g, "**");

      // Strict validation for allowed tokens
      if (!/^[0-9+\-*/().%**eMath.sqrtcopsinla]+$/i.test(cleanExpr)) {
        return {
          success: false,
          result: null,
          error: "Invalid characters in mathematical expression.",
        };
      }

      // Safe evaluation using Function with isolated Math context
      const compute = new Function("Math", `"use strict"; return (${cleanExpr});`);
      const val = compute(Math);

      if (typeof val !== "number" || isNaN(val)) {
        return { success: false, result: null, error: "Expression did not evaluate to a valid number." };
      }

      return {
        success: true,
        result: val,
        source: "VOXFLOW Exact Calculator Engine",
      };
    } catch (err: any) {
      return {
        success: false,
        result: null,
        error: err?.message || "Failed to evaluate mathematical calculation.",
      };
    }
  }
}
