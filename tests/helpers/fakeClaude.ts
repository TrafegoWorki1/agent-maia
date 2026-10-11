import { vi } from "vitest";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";

// Filho falso do `claude -p`: emite as linhas do stream-json e encerra, sem chamar a API nem gastar.
export function fakeSpawn(lines: string[], opts: { code?: number; stderr?: string; hang?: boolean } = {}) {
  const calls: { cmd: string; args: string[]; options: Record<string, unknown>; stdin: string }[] = [];
  const impl = vi.fn((cmd: string, args: string[], options: Record<string, unknown>) => {
    const child = new EventEmitter() as EventEmitter & { stdout: PassThrough; stderr: PassThrough; stdin: PassThrough; pid: number; exitCode: number | null; kill: () => void };
    child.stdout = new PassThrough(); child.stderr = new PassThrough(); child.stdin = new PassThrough();
    child.pid = 0; child.exitCode = null;
    const record = { cmd, args, options, stdin: "" };
    calls.push(record);
    child.stdin.on("data", (c: Buffer) => { record.stdin += c.toString(); });
    const finish = (code: number) => { child.exitCode = code; child.stdout.end(); child.emit("close", code); };
    child.kill = () => finish(137);
    child.stdin.on("end", () => {
      if (opts.hang) return;
      setImmediate(() => {
        for (const line of lines) child.stdout.write(`${line}\n`);
        if (opts.stderr) child.stderr.write(opts.stderr);
        setImmediate(() => finish(opts.code ?? 0));
      });
    });
    return child as never;
  });
  return { impl: impl as never, calls };
}
