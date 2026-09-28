import { execSync } from "node:child_process";

const port = process.argv[2] || "3000";

try {
  if (process.platform === "win32") {
    // Windows: find and terminate any process listening on the port
    const output = execSync(
      `powershell -NoProfile -Command "Get-NetTCPConnection -LocalPort ${port} -ErrorAction SilentlyContinue | Select-Object -ExpandProperty OwningProcess -Unique"`,
      { encoding: "utf8" }
    ).trim();

    if (output) {
      const pids = output
        .split(/\r?\n/)
        .map((p) => Number.parseInt(p.trim(), 10))
        .filter((p) => !Number.isNaN(p) && p > 0 && p !== process.pid);

      for (const pid of pids) {
        try {
          execSync(`powershell -NoProfile -Command "Stop-Process -Id ${pid} -Force -ErrorAction SilentlyContinue"`);
          console.log(`[kill-port] Cleaned up stale process ${pid} on port ${port}`);
        } catch {
          // ignore if process already exited
        }
      }
    }
  } else {
    // Unix/macOS
    try {
      execSync(`lsof -ti :${port} | xargs kill -9 2>/dev/null`);
    } catch {
      // ignore
    }
  }
} catch {
  // silent fallback if net connection query fails
}
