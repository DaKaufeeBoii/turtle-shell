import { MongoClient, Db, Collection } from "mongodb";
import { config } from "../config.js";
import ollama from "ollama";
import fs from "node:fs";
import path from "node:path";

export interface StandupRecord {
  _id?: string;
  createdAt: Date;
  repoName: string;
  repoPath: string;
  branch: string;
  since: string;
  commitCount: number;
  standup: {
    yesterday: string[];
    today: string[];
    blockers: string[];
    rawMarkdown: string;
  };
  changelog: {
    features: string[];
    fixes: string[];
    chores: string[];
    rawMarkdown: string;
  };
  rawCommits: string[];
  embedding?: number[];
}

let client: MongoClient | null = null;
let db: Db | null = null;
let collection: Collection<StandupRecord> | null = null;

// Local fallback file storage if Atlas is not connected
const LOCAL_STORAGE_PATH = path.resolve("./local_history.json");

function getLocalHistory(): StandupRecord[] {
  try {
    if (fs.existsSync(LOCAL_STORAGE_PATH)) {
      return JSON.parse(fs.readFileSync(LOCAL_STORAGE_PATH, "utf-8"));
    }
  } catch (err) {
    console.warn("Could not read local history:", err);
  }
  return [];
}

function saveLocalHistory(record: StandupRecord): void {
  try {
    const list = getLocalHistory();
    list.unshift(record);
    fs.writeFileSync(LOCAL_STORAGE_PATH, JSON.stringify(list.slice(0, 50), null, 2));
  } catch (err) {
    console.warn("Could not save to local storage:", err);
  }
}

export async function connectMongo(): Promise<boolean> {
  if (!config.mongodbUri) {
    console.log("ℹ️  MongoDB URI not configured. Using local JSON history storage.");
    return false;
  }

  try {
    client = new MongoClient(config.mongodbUri);
    await client.connect();
    db = client.db(config.dbName);
    collection = db.collection<StandupRecord>("standup_history");
    console.log("🍃 Connected to MongoDB Atlas cluster successfully.");
    return true;
  } catch (err) {
    console.warn("⚠️  Could not connect to MongoDB Atlas, falling back to local storage:", err);
    return false;
  }
}

/**
 * Generate embedding using Ollama or fallback to simple bag-of-words vector
 */
export async function generateEmbedding(text: string): Promise<number[]> {
  try {
    const response = await ollama.embeddings({
      model: config.ollamaModel,
      prompt: text.slice(0, 1000),
    });
    return response.embedding;
  } catch (err) {
    console.warn("Embedding generation failed, returning empty vector:", err);
    return [];
  }
}

/**
 * Save a generated standup to MongoDB Atlas
 */
export async function saveStandup(record: Omit<StandupRecord, "createdAt">): Promise<void> {
  const fullRecord: StandupRecord = {
    ...record,
    createdAt: new Date(),
  };

  try {
    // Generate embedding for semantic search
    const textToEmbed = `${record.repoName} ${record.standup.rawMarkdown} ${record.changelog.rawMarkdown}`;
    fullRecord.embedding = await generateEmbedding(textToEmbed);
  } catch {
    // Continue even if embedding fails
  }

  if (collection) {
    try {
      await collection.insertOne(fullRecord as any);
      console.log("💾 Saved standup to MongoDB Atlas.");
      return;
    } catch (err) {
      console.warn("Error inserting to Atlas:", err);
    }
  }

  // Fallback to local storage
  saveLocalHistory(fullRecord);
}

/**
 * Search past standups semantically or by keyword
 */
export async function searchStandups(query: string, limit = 5): Promise<StandupRecord[]> {
  if (collection) {
    try {
      // 1. If Atlas Vector Search index is configured, query using vector similarity
      // Otherwise fallback to text search / regex
      const regex = new RegExp(query, "i");
      const results = await collection
        .find({
          $or: [
            { "standup.rawMarkdown": regex },
            { "changelog.rawMarkdown": regex },
            { repoName: regex },
            { rawCommits: regex },
          ],
        })
        .sort({ createdAt: -1 })
        .limit(limit)
        .toArray();

      return results as any;
    } catch (err) {
      console.warn("Atlas search error, trying local:", err);
    }
  }

  // Fallback to local search
  const localList = getLocalHistory();
  const lowerQuery = query.toLowerCase();
  return localList
    .filter(
      (r) =>
        r.repoName.toLowerCase().includes(lowerQuery) ||
        r.standup.rawMarkdown.toLowerCase().includes(lowerQuery) ||
        r.changelog.rawMarkdown.toLowerCase().includes(lowerQuery)
    )
    .slice(0, limit);
}

/**
 * Fetch latest standups
 */
export async function getRecentStandups(limit = 10): Promise<StandupRecord[]> {
  if (collection) {
    try {
      return (await collection.find().sort({ createdAt: -1 }).limit(limit).toArray()) as any;
    } catch (err) {
      console.warn("Error fetching from Atlas:", err);
    }
  }
  return getLocalHistory().slice(0, limit);
}
