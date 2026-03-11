import express from 'express';
import { createServer as createViteServer } from 'vite';
import Database from 'better-sqlite3';
import { v4 as uuidv4 } from 'uuid';
import AdmZip from 'adm-zip';
import { GoogleGenAI, Type } from '@google/genai';

const app = express();
const PORT = 3000;

app.use(express.json());

const db = new Database('repo.db');

db.exec(`
  CREATE TABLE IF NOT EXISTS repos (
    id TEXT PRIMARY KEY,
    url TEXT,
    owner TEXT,
    name TEXT,
    overview TEXT,
    architecture TEXT,
    status TEXT,
    error TEXT
  );
  CREATE TABLE IF NOT EXISTS files (
    id TEXT PRIMARY KEY,
    repo_id TEXT,
    path TEXT,
    description TEXT
  );
  CREATE TABLE IF NOT EXISTS chunks (
    id TEXT PRIMARY KEY,
    repo_id TEXT,
    file_path TEXT,
    content TEXT,
    embedding TEXT
  );
`);

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

function cosineSimilarity(a: number[], b: number[]) {
  let dotProduct = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    dotProduct += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
}

function chunkText(text: string, chunkSize = 1000, overlap = 200) {
  const chunks = [];
  let i = 0;
  while (i < text.length) {
    chunks.push(text.slice(i, i + chunkSize));
    i += chunkSize - overlap;
  }
  return chunks;
}

const IGNORED_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.gif', '.svg', '.ico', '.woff', '.woff2', '.ttf', '.eot', '.mp4', '.webm', '.pdf', '.zip', '.tar', '.gz', '.lock']);
const IGNORED_DIRS = new Set(['node_modules', 'dist', 'build', '.git', '.github', 'coverage', 'public', 'assets']);

async function processRepo(repoId: string, url: string, owner: string, name: string) {
  try {
    let zipBuffer: ArrayBuffer | null = null;
    const branches = ['main', 'master'];
    for (const branch of branches) {
      const zipUrl = `https://github.com/${owner}/${name}/archive/refs/heads/${branch}.zip`;
      const response = await fetch(zipUrl);
      if (response.ok) {
        zipBuffer = await response.arrayBuffer();
        break;
      }
    }

    if (!zipBuffer) {
      throw new Error("Could not download repository zip. Please check the URL and ensure the repository is public.");
    }

    const zip = new AdmZip(Buffer.from(zipBuffer));
    const zipEntries = zip.getEntries();

    const files: { path: string; content: string }[] = [];
    let readmeContent = '';
    const fileTree: string[] = [];

    for (const entry of zipEntries) {
      if (entry.isDirectory) continue;

      // Remove the top-level directory name (e.g., repo-main/)
      const parts = entry.entryName.split('/');
      parts.shift();
      const relativePath = parts.join('/');

      if (!relativePath) continue;

      const dirName = parts[0];
      if (IGNORED_DIRS.has(dirName)) continue;

      const ext = relativePath.substring(relativePath.lastIndexOf('.')).toLowerCase();
      if (IGNORED_EXTENSIONS.has(ext)) continue;

      fileTree.push(relativePath);

      const content = entry.getData().toString('utf8');
      
      if (relativePath.toLowerCase() === 'readme.md') {
        readmeContent = content;
      }

      // Only process code files for chunking to save time/tokens
      if (['.ts', '.tsx', '.js', '.jsx', '.py', '.go', '.rs', '.java', '.c', '.cpp', '.h', '.cs', '.md', '.json'].includes(ext)) {
        files.push({ path: relativePath, content });
      }
    }

    // 1. Generate Overview and Architecture
    const prompt = `
Analyze the following GitHub repository.
Owner: ${owner}
Repo: ${name}

File Tree:
${fileTree.slice(0, 5000).join('\n')}

README:
${readmeContent.slice(0, 10000)}

Provide a JSON response with the following structure:
{
  "overview": "A high-level overview of what this project does.",
  "architecture": "An explanation of the project's architecture and tech stack.",
  "keyFiles": [
    {
      "path": "src/main.ts",
      "description": "The entry point of the application."
    }
  ]
}
`;

    const response = await ai.models.generateContent({
      model: 'gemini-3.1-pro-preview',
      contents: prompt,
      config: {
        responseMimeType: 'application/json',
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            overview: { type: Type.STRING },
            architecture: { type: Type.STRING },
            keyFiles: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  path: { type: Type.STRING },
                  description: { type: Type.STRING }
                }
              }
            }
          }
        }
      }
    });

    const analysis = JSON.parse(response.text || '{}');

    db.prepare(`UPDATE repos SET overview = ?, architecture = ?, status = 'ready' WHERE id = ?`)
      .run(analysis.overview || 'No overview available.', analysis.architecture || 'No architecture available.', repoId);

    if (analysis.keyFiles && Array.isArray(analysis.keyFiles)) {
      const insertFile = db.prepare(`INSERT INTO files (id, repo_id, path, description) VALUES (?, ?, ?, ?)`);
      for (const file of analysis.keyFiles) {
        insertFile.run(uuidv4(), repoId, file.path, file.description);
      }
    }

    // 2. Chunk and Embed (Limit to top 50 files by size to avoid rate limits)
    files.sort((a, b) => b.content.length - a.content.length);
    const topFiles = files.slice(0, 50);
    
    const insertChunk = db.prepare(`INSERT INTO chunks (id, repo_id, file_path, content, embedding) VALUES (?, ?, ?, ?, ?)`);

    for (const file of topFiles) {
      const chunks = chunkText(file.content);
      for (const chunk of chunks) {
        try {
          const embedResult = await ai.models.embedContent({
            model: 'gemini-embedding-2-preview',
            contents: chunk,
          });
          
          if (embedResult.embeddings && embedResult.embeddings[0] && embedResult.embeddings[0].values) {
             insertChunk.run(uuidv4(), repoId, file.path, chunk, JSON.stringify(embedResult.embeddings[0].values));
          }
        } catch (e) {
          console.error(`Failed to embed chunk for ${file.path}`, e);
          // Continue with other chunks
        }
      }
    }

  } catch (error: any) {
    console.error("Error processing repo:", error);
    db.prepare(`UPDATE repos SET status = 'error', error = ? WHERE id = ?`).run(error.message, repoId);
  }
}

app.post('/api/repo', async (req, res) => {
  const { url } = req.body;
  if (!url) {
    return res.status(400).json({ error: 'URL is required' });
  }

  const match = url.match(/github\.com\/([^\/]+)\/([^\/]+)/);
  if (!match) {
    return res.status(400).json({ error: 'Invalid GitHub URL' });
  }

  const owner = match[1];
  const name = match[2].replace('.git', '');

  // Check if already processing/processed
  const existing = db.prepare(`SELECT id, status FROM repos WHERE owner = ? AND name = ?`).get(owner, name) as any;
  if (existing) {
    return res.json({ id: existing.id, status: existing.status });
  }

  const repoId = uuidv4();
  db.prepare(`INSERT INTO repos (id, url, owner, name, status) VALUES (?, ?, ?, ?, 'processing')`)
    .run(repoId, url, owner, name);

  // Start background processing
  processRepo(repoId, url, owner, name);

  res.json({ id: repoId, status: 'processing' });
});

app.get('/api/repo/:id', (req, res) => {
  const repo = db.prepare(`SELECT * FROM repos WHERE id = ?`).get(req.params.id) as any;
  if (!repo) {
    return res.status(404).json({ error: 'Repo not found' });
  }

  const files = db.prepare(`SELECT * FROM files WHERE repo_id = ?`).all(req.params.id);
  
  res.json({ ...repo, keyFiles: files });
});

app.post('/api/chat', async (req, res) => {
  const { repoId, message } = req.body;
  
  if (!repoId || !message) {
    return res.status(400).json({ error: 'repoId and message are required' });
  }

  const repo = db.prepare(`SELECT * FROM repos WHERE id = ?`).get(repoId) as any;
  if (!repo) {
    return res.status(404).json({ error: 'Repo not found' });
  }

  try {
    const embedResult = await ai.models.embedContent({
      model: 'gemini-embedding-2-preview',
      contents: message,
    });

    const queryEmbedding = embedResult.embeddings?.[0]?.values;
    if (!queryEmbedding) {
      throw new Error("Failed to generate embedding for query");
    }

    const chunks = db.prepare(`SELECT file_path, content, embedding FROM chunks WHERE repo_id = ?`).all(repoId) as any[];
    
    // Calculate similarities
    const scoredChunks = chunks.map(chunk => {
      const chunkEmbedding = JSON.parse(chunk.embedding);
      const score = cosineSimilarity(queryEmbedding, chunkEmbedding);
      return { ...chunk, score };
    });

    scoredChunks.sort((a, b) => b.score - a.score);
    const topChunks = scoredChunks.slice(0, 5);

    const prompt = `
You are an AI assistant explaining a codebase.
Repository: ${repo.owner}/${repo.name}

Context from the codebase:
${topChunks.map(c => `File: ${c.file_path}\n${c.content}`).join('\n\n')}

User Question: ${message}

Answer the question based on the context. If the context doesn't contain the answer, say so, but try to be helpful based on your general knowledge of the repository's tech stack.
`;

    const response = await ai.models.generateContent({
      model: 'gemini-3.1-pro-preview',
      contents: prompt,
    });

    res.json({ text: response.text, sources: topChunks.map(c => c.file_path) });

  } catch (error: any) {
    console.error("Chat error:", error);
    res.status(500).json({ error: error.message });
  }
});

async function startServer() {
  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    app.use(express.static('dist'));
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
