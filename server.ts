import express from "express";
import { createServer as createViteServer } from "vite";
import fs from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";
import { spawn } from "child_process";
import archiver from "archiver";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use(express.json());

  // API Routes
  app.get("/api/feed", async (req, res) => {
    try {
      const data = await fs.readFile("feed.txt", "utf-8");
      res.json({ content: data });
    } catch (error) {
      res.status(404).json({ error: "feed.txt not found" });
    }
  });

  app.post("/api/feed", async (req, res) => {
    try {
      const { content } = req.body;
      await fs.writeFile("feed.txt", content, "utf-8");
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ error: "Failed to write feed.txt" });
    }
  });

  app.get("/api/pipeline-status", async (req, res) => {
    try {
      const data = await fs.readFile("pipeline.log", "utf-8");
      res.json({ content: data });
    } catch (error) {
      res.json({ content: "" }); // Log might not exist yet
    }
  });

  app.get("/api/clips", async (req, res) => {
    try {
      const clipsDir = path.join(process.cwd(), "clips");
      await fs.mkdir(clipsDir, { recursive: true });
      const files = await fs.readdir(clipsDir);
      res.json({ files });
    } catch (error) {
      res.status(500).json({ error: "Failed to list clips" });
    }
  });

  app.get("/api/settings", async (req, res) => {
    try {
      const data = await fs.readFile("config.json", "utf-8");
      res.json(JSON.parse(data));
    } catch (error) {
      res.json({});
    }
  });

  app.post("/api/settings", async (req, res) => {
    try {
      const config = req.body;
      await fs.writeFile("config.json", JSON.stringify(config, null, 2), "utf-8");
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ error: "Failed to save settings" });
    }
  });

  let runningProcess: any = null;

  app.post("/api/run", (req, res) => {
    if (runningProcess) {
      return res.status(400).json({ error: "Pipeline is already running" });
    }

    try {
      // Create empty pipeline.log file if it doesn't exist to clear previous runs? 
      // Nah, let python log in append mode as usual. But we can empty it so the UI is fresh.
      fs.writeFile("pipeline.log", "--- Pipeline Started ---\n", "utf-8").catch(() => {});

      runningProcess = spawn("npx", ["tsx", "clip_factory.ts"]);

      runningProcess.on("error", (err: Error) => {
        fs.appendFile("pipeline.log", `\n--- Pipeline Failed to Start: ${err.message}. ---\n`, "utf-8").catch(() => {});
        runningProcess = null;
      });

      runningProcess.on("close", (code: number | null) => {
        fs.appendFile("pipeline.log", `\n--- Pipeline Finished with code ${code} ---\n`, "utf-8").catch(() => {});
        runningProcess = null;
      });

      res.json({ success: true, message: "Pipeline started" });
    } catch (e) {
      runningProcess = null;
      res.status(500).json({ error: "Failed to start pipeline" });
    }
  });

  // Serve static clips
  app.use("/clips", express.static(path.join(process.cwd(), "clips")));

  app.get("/api/download-all", async (req, res) => {
    const clipsDir = path.join(process.cwd(), "clips");
    try {
      await fs.access(clipsDir);
    } catch {
      return res.status(404).json({ error: "Clips directory not found" });
    }

    res.attachment("clips.zip");
    const archive = archiver("zip", { zlib: { level: 9 } });

    archive.on("error", (err) => {
      res.status(500).send({ error: err.message });
    });

    archive.pipe(res);
    archive.directory(clipsDir, false);
    archive.finalize();
  });

  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
