import { NextResponse } from "next/server";
import { execFile } from "node:child_process";

export const dynamic = "force-dynamic";

const FETCH_TIMEOUT_MS = 20_000;
const SHELL_KEY_TIMEOUT_MS = 5_000;

interface ProviderEntry {
  baseUrl?: string;
  apiKey?: string;
  headers?: Record<string, string>;
}

interface RemoteModelEntry {
  id?: unknown;
  display_name?: unknown;
  name?: unknown;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function buildModelsUrl(baseUrl: string): string {
  const url = new URL(baseUrl.trim());
  const pathname = url.pathname.replace(/\/+$/, "");
  url.pathname = `${pathname}/models`;
  url.search = "";
  url.hash = "";
  return url.toString();
}

function runApiKeyCommand(command: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const shell = process.platform === "win32" ? "cmd.exe" : "/bin/sh";
    const args = process.platform === "win32" ? ["/d", "/s", "/c", command] : ["-lc", command];
    const child = execFile(shell, args, { timeout: SHELL_KEY_TIMEOUT_MS }, (error, stdout) => {
      if (error) {
        reject(error);
        return;
      }
      resolve(stdout.trim());
    });
    child.stdin?.end();
  });
}

async function resolveApiKey(raw: string | undefined): Promise<string> {
  const value = raw?.trim() ?? "";
  if (!value) return "";
  if (value.startsWith("!")) return runApiKeyCommand(value.slice(1).trim());
  return process.env[value] ?? value;
}

export async function POST(req: Request) {
  try {
    const body = await req.json() as { provider?: unknown };
    if (!isRecord(body.provider)) {
      return NextResponse.json({ ok: false, error: "provider is required" }, { status: 400 });
    }

    const provider = body.provider as ProviderEntry;
    const baseUrl = typeof provider.baseUrl === "string" ? provider.baseUrl.trim() : "";
    if (!baseUrl) {
      return NextResponse.json({ ok: false, error: "Base URL is required" }, { status: 400 });
    }

    let url: string;
    try {
      url = buildModelsUrl(baseUrl);
    } catch {
      return NextResponse.json({ ok: false, error: "Base URL is invalid" }, { status: 400 });
    }

    const apiKey = await resolveApiKey(provider.apiKey);
    if (!apiKey) {
      return NextResponse.json({ ok: false, error: "API key is required" }, { status: 400 });
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    let response: Response;
    try {
      response = await fetch(url, {
        method: "GET",
        headers: {
          ...(provider.headers ?? {}),
          Authorization: `Bearer ${apiKey}`,
          Accept: "application/json",
        },
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timeout);
    }

    const text = await response.text();
    if (!response.ok) {
      return NextResponse.json({
        ok: false,
        error: `Model list request failed with HTTP ${response.status}`,
        status: response.status,
        responseText: text.slice(0, 500),
      });
    }

    let data: unknown;
    try {
      data = JSON.parse(text);
    } catch {
      return NextResponse.json({ ok: false, error: "Model list response is not valid JSON", status: response.status });
    }

    const items = isRecord(data) && Array.isArray(data.data) ? data.data : [];
    const models = items
      .filter(isRecord)
      .map((item: RemoteModelEntry) => {
        const id = typeof item.id === "string" ? item.id.trim() : "";
        if (!id) return null;
        const displayName = typeof item.display_name === "string" && item.display_name.trim()
          ? item.display_name.trim()
          : typeof item.name === "string" && item.name.trim()
            ? item.name.trim()
            : id;
        return { id, name: displayName };
      })
      .filter((model): model is { id: string; name: string } => model !== null);

    return NextResponse.json({ ok: true, models, status: response.status });
  } catch (error) {
    return NextResponse.json({ ok: false, error: errorMessage(error) }, { status: 500 });
  }
}
