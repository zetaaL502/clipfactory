import youtubedl from "youtube-dl-exec";
import { GoogleGenAI } from "@google/genai";
import fs from "fs/promises";
import path from "path";
import pLimit from "p-limit";

// Constants
const CLIPS_DIR = path.join(process.cwd(), "clips");
const TEMP_DIR = path.join(process.cwd(), "trashed_144p");
const MAX_CONCURRENT_UPLOADS = 5;
const MAX_CONCURRENT_ANALYSIS = 5;
const GEMINI_RPM_LIMIT = 15;
const MODEL_NAME = "gemini-1.5-flash";

const uploadLimit = pLimit(MAX_CONCURRENT_UPLOADS);
const analysisLimit = pLimit(MAX_CONCURRENT_ANALYSIS);

class RateLimiter {
  private intervalMs: number;
  private lastCallTime: number = 0;
  private queue: Promise<void> = Promise.resolve();

  constructor(rpm: number) {
    this.intervalMs = (60 / rpm) * 1000;
  }

  async wait(): Promise<void> {
    const now = Date.now();
    const timeToWait = Math.max(0, this.lastCallTime + this.intervalMs - now);
    this.lastCallTime = now + timeToWait;
    
    if (timeToWait > 0) {
      this.queue = this.queue.then(() => new Promise(resolve => setTimeout(resolve, timeToWait)));
    }
    return this.queue;
  }
}

const geminiRateLimiter = new RateLimiter(GEMINI_RPM_LIMIT);

async function log(level: string, message: string) {
  const logMessage = `${new Date().toISOString()} - ${level} - ${message}\n`;
  console.log(message);
  await fs.appendFile("pipeline.log", logMessage, "utf-8");
}

function sanitizeFilename(text: string): string {
  return text.replace(/[^a-zA-Z0-9_]/g, "_").replace(/^_+|_+$/g, "");
}

async function downloadLowRes(url: string, outputPath: string): Promise<boolean> {
  const retries = 3;
  for (let i = 0; i < retries; i++) {
    await log("INFO", `Downloading 144p: ${url} (Attempt ${i + 1})`);
    try {
      await youtubedl(url, {
        format: "worstvideo[height<=144]+worstaudio/worst[height<=144]",
        mergeOutputFormat: "mp4",
        output: outputPath
      });
      return true;
    } catch (e: any) {
      await log("WARNING", `Failed to download 144p for ${url}: ${e.message}`);
      await new Promise(r => setTimeout(r, Math.pow(2, i) * 1000));
    }
  }
  return false;
}

async function download4kClip(url: string, startTime: number, duration: number, outputPath: string): Promise<boolean> {
  const safeStart = Math.max(0, startTime - 2);
  const endTime = startTime + duration + 2;
  const section = `*${safeStart}-${endTime}`;

  const retries = 3;
  for (let i = 0; i < retries; i++) {
    await log("INFO", `Downloading 4K clip: ${url} at ${safeStart}s (Attempt ${i + 1})`);
    try {
      await youtubedl(url, {
        downloadSections: section,
        format: "bestvideo[height<=2160]+bestaudio/best",
        mergeOutputFormat: "mp4",
        output: outputPath
      });
      return true;
    } catch (e: any) {
      await log("WARNING", `Failed to download 4K clip for ${url}: ${e.message}`);
      await new Promise(r => setTimeout(r, Math.pow(2, i) * 1000));
    }
  }
  return false;
}

async function analyzeVideo(ai: GoogleGenAI, videoPath: string, prompt: string): Promise<number | null> {
  let file: any = null;
  
  const uploadSuccess = await uploadLimit(async () => {
    await log("INFO", `Uploading ${path.basename(videoPath)} to Gemini...`);
    try {
      file = await ai.files.upload({ file: videoPath });
      
      while (file.state === "PROCESSING") {
        await new Promise(r => setTimeout(r, 5000));
        file = await ai.files.get({ name: file.name });
      }

      if (file.state !== "ACTIVE") {
        await log("ERROR", `File upload failed for ${path.basename(videoPath)}: ${file.state}`);
        return false;
      }
      return true;
    } catch (e: any) {
      await log("ERROR", `Upload exception: ${e.message}`);
      return false;
    }
  });

  if (!uploadSuccess || !file) {
    if (file) {
      try { await ai.files.delete({ name: file.name }); } catch(e) {}
    }
    return null;
  }

  return await analysisLimit(async () => {
    await geminiRateLimiter.wait();
    await log("INFO", `Analyzing ${path.basename(videoPath)} for prompt: ${prompt}`);

    const systemInstruction = 
      "You are a video analysis expert. Given a video and a visual prompt, " +
      "identify the exact second (timestamp) where the action starts. " +
      "Return ONLY the number in seconds, nothing else. If not found, return 'NOT_FOUND'.";

    try {
      const response = await ai.models.generateContent({
        model: MODEL_NAME,
        contents: [
          file,
          `Visual prompt: ${prompt}`
        ],
        config: {
          systemInstruction
        }
      });
      
      const text = response.text?.trim() || "";
      await log("INFO", `Gemini response for ${path.basename(videoPath)}: ${text}`);

      const match = text.match(/(\d+(\.\d+)?)/);
      if (match) {
        return parseFloat(match[1]);
      }
      return null;
    } catch (e: any) {
      await log("ERROR", `Error during Gemini analysis: ${e.message}`);
      return null;
    } finally {
      if (file) {
        try { await ai.files.delete({ name: file.name }); } catch(e) {}
      }
    }
  });
}

async function processEntry(ai: GoogleGenAI, index: number, url: string, duration: number, prompt: string) {
  const tempFile = path.join(TEMP_DIR, `temp_${index}.mp4`);
  const sanitized = sanitizeFilename(prompt);
  const outputFile = path.join(CLIPS_DIR, `${sanitized}_${index}.mp4`);

  await log("INFO", `Processing ${index}: ${prompt.substring(0, 30)}...`);

  try {
    const success = await downloadLowRes(url, tempFile);
    if (!success) {
      await log("ERROR", `Failed to download 144p for ${url}`);
      return;
    }

    const timestamp = await analyzeVideo(ai, tempFile, prompt);

    try { await fs.unlink(tempFile); } catch(e) {}

    if (timestamp === null) {
      await log("WARNING", `No timestamp found for ${url} with prompt '${prompt}'`);
      return;
    }

    await log("INFO", `Processing ${index}: ${prompt.substring(0, 30)} found at ${timestamp}s, trimming 4K...`);
    const clipSuccess = await download4kClip(url, timestamp, duration, outputFile);
    
    if (clipSuccess) {
      await log("INFO", `Successfully saved clip: ${outputFile}`);
    } else {
      await log("ERROR", `Failed to save 4K clip for ${url}`);
    }
  } catch (e: any) {
    await log("ERROR", `Unexpected error processing ${url}: ${e.message}`);
  }
}

async function main() {
  await fs.mkdir(CLIPS_DIR, { recursive: true });
  await fs.mkdir(TEMP_DIR, { recursive: true });

  let apiKey = process.env.GOOGLE_API_KEY;
  try {
    const configData = await fs.readFile("config.json", "utf-8");
    const config = JSON.parse(configData);
    if (config.GOOGLE_API_KEY) {
      apiKey = config.GOOGLE_API_KEY;
    }
  } catch (e) {}

  if (!apiKey) {
    await log("ERROR", "GOOGLE_API_KEY environment variable not set, and not found in config.json.");
    return;
  }

  const ai = new GoogleGenAI({ apiKey });

  let lines: string[] = [];
  try {
    const feedData = await fs.readFile("feed.txt", "utf-8");
    lines = feedData.split("\n").filter(l => l.trim().length > 0);
  } catch (e) {
    await log("ERROR", "feed.txt not found.");
    return;
  }

  const tasks: Promise<void>[] = [];
  
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const parts = line.split("|").map(p => p.trim());
    
    if (parts.length < 3) {
      await log("WARNING", `Skipping malformed line: ${line}`);
      continue;
    }

    const url = parts[0];
    const durationStr = parts[1];
    const prompt = parts[2];
    
    const duration = parseInt(durationStr, 10);
    if (isNaN(duration)) {
      await log("WARNING", `Invalid duration in line: ${line}`);
      continue;
    }

    tasks.push(processEntry(ai, i + 1, url, duration, prompt));
  }

  await Promise.all(tasks);
  await log("INFO", "Batch processing complete.");
}

main().catch(e => {
  log("ERROR", `Fatal error in main: ${e.message}`);
});
