import { NextRequest } from "next/server";
import { ToolRegistry } from "@/tools";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => null);
    if (!body || typeof body.name !== "string") {
      return new Response(
        JSON.stringify({ error: "Invalid payload. 'name' string required." }),
        { status: 400, headers: { "Content-Type": "application/json" } }
      );
    }

    const registry = ToolRegistry.getInstance();
    const result = await registry.executeTool(body.name, body.params || {}, req.signal);

    return new Response(JSON.stringify(result), {
      status: result.success ? 200 : 400,
      headers: { "Content-Type": "application/json" },
    });
  } catch (error: any) {
    return new Response(
      JSON.stringify({ error: error?.message || "Tool execution failed" }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }
}
