import { Sandbox } from "@vercel/sandbox";
import { nanoid } from "nanoid";

export const runtime = "nodejs";
export const maxDuration = 120;

const AGENT_FILES: { filename: string; content: string }[] = [{"filename":"agent/instructions.md","content":"# Uptime Checker Agent\nYou check whether a website is reachable and report its HTTP status code.\n\n1. Ask the user for the website URL if not provided.\n2. Call the `check_site_status` tool with the URL.\n3. Report the status code and whether the site is up.\n\nA site is considered up if the request returns a 2xx or 3xx status code."},{"filename":"agent/tools/check_site_status.ts","content":"import { defineTool } from \"eve/tools\";\nimport { z } from \"zod\";\n\nexport default defineTool({\n  description: \"Checks whether a website is up and returns its HTTP status code\",\n  inputSchema: z.object({\n    url: z.string().url().describe(\"Full website URL to check, including protocol\"),\n  }),\n  async execute(input) {\n    try {\n      const response = await fetch(input.url, {\n        method: \"HEAD\",\n        redirect: \"follow\",\n      });\n      const up = response.status >= 200 && response.status < 400;\n      return {\n        url: input.url,\n        status_code: response.status,\n        up,\n      };\n    } catch (error) {\n      return {\n        url: input.url,\n        status_code: null,\n        up: false,\n        error: error instanceof Error ? error.message : String(error),\n      };\n    }\n  },\n});"}];

const OPEN_CHANNEL_AUTH = `import { eveChannel } from "eve/channels/eve";
import { none } from "eve/channels/auth";

export default eveChannel({ auth: [none()] });
`;

async function waitForServer(url: string, timeoutMs: number) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(url, { method: "GET" });
      if (res.status < 500) return true;
    } catch {
      // sandbox not accepting connections yet, keep polling
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  return false;
}

function getModelEnv() {
  const env: Record<string, string> = {};
  if (process.env.AI_GATEWAY_API_KEY) env.AI_GATEWAY_API_KEY = process.env.AI_GATEWAY_API_KEY;
  if (process.env.VERCEL_OIDC_TOKEN) env.VERCEL_OIDC_TOKEN = process.env.VERCEL_OIDC_TOKEN;
  if (process.env.ANTHROPIC_API_KEY) env.ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
  if (process.env.OPENAI_API_KEY) env.OPENAI_API_KEY = process.env.OPENAI_API_KEY;
  return env;
}

function getDirectories(files: { filename: string }[]): string[] {
  const dirs = new Set<string>();
  for (const f of files) {
    const parts = f.filename.split("/");
    parts.pop();
    if (parts.length > 0) dirs.add(parts.join("/"));
  }
  return [...dirs];
}

export async function POST() {
  const modelEnv = getModelEnv();

  if (Object.keys(modelEnv).length === 0) {
    return Response.json({
      ok: false,
      needsCredentials: true,
      error:
        "no model credentials set on this project. add AI_GATEWAY_API_KEY (or ANTHROPIC_API_KEY / OPENAI_API_KEY) in this project's vercel settings, then redeploy",
    });
  }

  const sandboxName = `eve-agent-${nanoid(8)}`;
  let sandbox;

  try {
    sandbox = await Sandbox.create({
      name: sandboxName,
      runtime: "node24",
      timeout: 600_000,
      ports: [3000],
      env: modelEnv,
      persistent: false,
    });
  } catch (err) {
    console.error("sandbox create failed:", err);
    return Response.json({
      ok: false,
      error: "couldn't start your agent right now, try again in a moment",
    });
  }

  await Promise.all(
    [...getDirectories(AGENT_FILES), "agent/channels"].map((dir) =>
      sandbox.fs.mkdir(dir, { recursive: true }),
    ),
  );

  await sandbox.writeFiles([
    ...AGENT_FILES.map((f) => ({
      path: f.filename,
      content: Buffer.from(f.content),
    })),
    {
      path: "package.json",
      content: Buffer.from(
        JSON.stringify(
          { name: "deployed-eve-agent", private: true, type: "module", dependencies: { eve: "latest" } },
          null,
          2,
        ),
      ),
    },
    { path: "agent/channels/eve.ts", content: Buffer.from(OPEN_CHANNEL_AUTH) },
  ]);

  const install = await sandbox.runCommand({
    cmd: "npm",
    args: ["install", "--no-audit", "--no-fund"],
  });

  if (install.exitCode !== 0) {
    const err = await install.stderr();
    await sandbox.stop();
    return Response.json({ ok: false, error: `install failed: ${err}` });
  }

  await sandbox.runCommand({
    cmd: "npx",
    args: ["eve", "dev", "--no-ui", "--port", "3000"],
    detached: true,
  });

  const url = sandbox.domain(3000);
  const ready = await waitForServer(url, 45_000);

  if (!ready) {
    await sandbox.stop();
    return Response.json({ ok: false, error: "agent didn't start in time" });
  }

  return Response.json({ ok: true, sandboxName, url });
}
