const express = require("express");
const http = require("http");
const WebSocket = require("ws");
const { execFile } = require("child_process");
const path = require("path");
const multer = require("multer");
const cors = require("cors");
const fs = require("fs").promises;
const config = require("./config");
const repairEngine = require("./repairEngine");
const fileAnalyzer = require("./analyzers/fileAnalyzer");
const historyStore = require("./historyStore");
const repairQueue = require("./repairQueue");

const dirs = [config.uploadDir, config.repairedDir, config.logsDir, config.tempDir];
for (const dir of dirs) {
    fs.mkdir(dir, { recursive: true }).catch(console.error);
}

historyStore.init().catch(console.error);

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, "../public")));

const supportedExtensions = [
    ...config.supportedTypes.video,
    ...config.supportedTypes.pdf,
    ...config.supportedTypes.word,
    ...config.supportedTypes.excel,
    ...config.supportedTypes.image,
    ...config.supportedTypes.archive,
    ...config.supportedTypes.document
];

const storage = multer.diskStorage({
    destination: (req, file, cb) => cb(null, config.uploadDir),
    filename: (req, file, cb) => {
        const uniqueSuffix = `${Date.now()}-${Math.round(Math.random() * 1e9)}`;
        cb(null, uniqueSuffix + path.extname(file.originalname));
    }
});

const upload = multer({
    storage,
    limits: { fileSize: config.maxFileSize },
    fileFilter: (req, file, cb) => {
        const ext = path.extname(file.originalname).toLowerCase();
        if (supportedExtensions.includes(ext)) {
            cb(null, true);
            return;
        }

        cb(new Error("Type de fichier non supporte"));
    }
});

const repairsProgress = new Map();

function getUploadedFilePath(fileId, fileName) {
    return path.join(config.uploadDir, fileId + path.extname(fileName));
}

async function ensureFileExists(filePath) {
    await fs.access(filePath);
    return filePath;
}

async function buildAnalysisResponse(filePath) {
    const analysis = await fileAnalyzer.analyze(filePath);
    const report = fileAnalyzer.generateReport(analysis);
    return { analysis, report };
}

async function buildComparisonResponse(originalPath, repairedPath) {
    const comparison = await fileAnalyzer.compareFiles(originalPath, repairedPath);
    const repairedAnalysis = await buildAnalysisResponse(repairedPath);
    return { comparison, repairedAnalysis };
}

function getQueueMeta() {
    return repairQueue.getSnapshot();
}

async function recordAnalysisHistory(fileId, fileName, analysisResult) {
    const { analysis } = analysisResult;
    await historyStore.append({
        id: `analysis-${fileId}`,
        kind: "analysis",
        status: "success",
        fileName,
        fileType: analysis.resolvedCategory,
        detectedType: analysis.detectedType,
        corruptionLevel: analysis.corruptionLevel,
        repairable: analysis.repairable,
        issuesCount: analysis.issues.length,
        size: analysis.size,
        details: analysisResult.report
    });
}

async function recordRepairHistory({ fileId, fileName, result, durationMs, queueMeta, comparisonResult, error }) {
    const success = !error;
    await historyStore.append({
        id: `repair-${fileId}-${Date.now()}`,
        kind: "repair",
        status: success ? "success" : "failed",
        fileName,
        fileType: success ? result.category : "unknown",
        detectedType: success ? result.detectedType : "unknown",
        corruptionLevel: success ? result.corruptionLevel : "unknown",
        repairable: success,
        issuesCount: success ? result.issues.length : 0,
        size: 0,
        durationMs,
        outputFile: success ? path.basename(result.outputPath) : null,
        queueMeta,
        comparison: success ? comparisonResult.comparison : null,
        details: success ? comparisonResult.repairedAnalysis.report : { error: error.message }
    });
}

app.post("/api/upload", upload.single("file"), async (req, res) => {
    if (!req.file) {
        return res.status(400).json({ error: "Aucun fichier uploade" });
    }

    res.json({
        success: true,
        fileId: path.parse(req.file.filename).name,
        originalName: req.file.originalname,
        path: req.file.path,
        size: req.file.size
    });
});

app.post("/api/analyze", async (req, res) => {
    const { fileId, fileName } = req.body;
    if (!fileId || !fileName) {
        return res.status(400).json({ error: "fileId et fileName requis" });
    }

    const filePath = getUploadedFilePath(fileId, fileName);

    try {
        await ensureFileExists(filePath);
        const result = await buildAnalysisResponse(filePath);
        await recordAnalysisHistory(fileId, fileName, result);
        res.json({
            success: true,
            fileId,
            fileName,
            queue: getQueueMeta(),
            ...result
        });
    } catch (error) {
        res.status(404).json({ error: error.message || "Analyse impossible" });
    }
});

app.post("/api/repair", async (req, res) => {
    const { fileId, fileName } = req.body;
    if (!fileId || !fileName) {
        return res.status(400).json({ error: "fileId et fileName requis" });
    }

    const filePath = getUploadedFilePath(fileId, fileName);
    const repairId = Date.now().toString();

    try {
        await ensureFileExists(filePath);
    } catch {
        return res.status(404).json({ error: "Fichier non trouve" });
    }

    const queuedSnapshot = getQueueMeta();
    repairsProgress.set(repairId, {
        progress: 0,
        status: "Ajoute a la file de reparation...",
        fileName,
        repairId,
        filePath,
        queue: queuedSnapshot
    });

    repairQueue.enqueue(async ({ jobId, queuedAt, snapshot }) => {
        const startedAt = Date.now();
        const queueMeta = {
            ...snapshot,
            jobId,
            queuedAt,
            startedAt: new Date().toISOString()
        };

        try {
            const sendProgress = (progress, status) => {
                const current = repairsProgress.get(repairId);
                if (!current) return;
                repairsProgress.set(repairId, {
                    ...current,
                    progress,
                    status,
                    fileName,
                    repairId,
                    queue: {
                        ...getQueueMeta(),
                        jobId,
                        queuedAt
                    }
                });
            };

            sendProgress(4, "Reparation demarree...");
            const result = await repairEngine.repairFile(filePath, fileName, sendProgress);
            const comparisonResult = await buildComparisonResponse(filePath, result.outputPath);
            const durationMs = Date.now() - startedAt;

            repairsProgress.set(repairId, {
                progress: 100,
                status: "Reparation terminee avec succes !",
                fileName,
                repairId,
                outputFile: path.basename(result.outputPath),
                repairedFile: path.basename(result.outputPath),
                outputPath: result.outputPath,
                analysis: {
                    category: result.category,
                    detectedType: result.detectedType,
                    corruptionLevel: result.corruptionLevel,
                    issues: result.issues
                },
                comparison: comparisonResult.comparison,
                repairedAnalysis: comparisonResult.repairedAnalysis,
                queue: {
                    ...getQueueMeta(),
                    ...queueMeta,
                    durationMs
                }
            });

            await recordRepairHistory({
                fileId,
                fileName,
                result,
                durationMs,
                queueMeta,
                comparisonResult
            });

            setTimeout(async () => {
                try {
                    await repairEngine.cleanup(filePath);
                } catch (cleanError) {
                    console.error("Erreur nettoyage:", cleanError);
                }
            }, 10000);
        } catch (error) {
            const durationMs = Date.now() - startedAt;
            repairsProgress.set(repairId, {
                progress: 0,
                status: `Erreur: ${error.message}`,
                fileName,
                repairId,
                error: error.message,
                queue: {
                    ...getQueueMeta(),
                    ...queueMeta,
                    durationMs
                }
            });

            await recordRepairHistory({
                fileId,
                fileName,
                durationMs,
                queueMeta,
                error
            });
        }
    }).catch((error) => {
        repairsProgress.set(repairId, {
            progress: 0,
            status: `Erreur file: ${error.message}`,
            fileName,
            repairId,
            error: error.message,
            queue: getQueueMeta()
        });
    });

    res.json({
        repairId,
        fileName,
        queue: {
            ...queuedSnapshot,
            pendingAfterEnqueue: queuedSnapshot.pending + 1
        }
    });
});

app.get("/api/progress/:repairId", (req, res) => {
    const repairId = req.params.repairId;
    const progress = repairsProgress.get(repairId);

    if (progress) {
        return res.json(progress);
    }

    res.json({
        progress: 0,
        status: "Recherche de la progression...",
        repairId,
        queue: getQueueMeta()
    });
});

app.get("/api/history", async (req, res) => {
    const limit = Number(req.query.limit || 50);
    const items = await historyStore.list(limit, {
        q: req.query.q || "",
        kind: req.query.kind || "",
        status: req.query.status || "",
        fileType: req.query.fileType || ""
    });
    res.json({
        items,
        queue: getQueueMeta()
    });
});

app.get("/api/dashboard", async (req, res) => {
    const dashboard = await historyStore.getDashboard();
    res.json({
        ...dashboard,
        queue: getQueueMeta()
    });
});

app.get("/api/download/:filename", async (req, res) => {
    const filename = req.params.filename;
    const filePath = path.join(config.repairedDir, filename);

    try {
        await fs.access(filePath);
        res.download(filePath, filename, (err) => {
            if (err && !res.headersSent) {
                res.status(500).json({ error: "Erreur lors du telechargement" });
            }
        });
    } catch {
        res.status(404).json({ error: "Fichier non trouve" });
    }
});

app.post("/api/open-repaired-folder", async (req, res) => {
    const filename = req.body?.filename;
    const repairedDir = config.repairedDir;

    try {
        if (process.platform === "win32") {
            if (filename) {
                const targetPath = path.join(repairedDir, path.basename(filename));
                await fs.access(targetPath);
                execFile("explorer.exe", ["/select,", targetPath]);
            } else {
                execFile("explorer.exe", [repairedDir]);
            }
        } else if (process.platform === "darwin") {
            execFile("open", [repairedDir]);
        } else {
            execFile("xdg-open", [repairedDir]);
        }

        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ error: error.message || "Impossible d'ouvrir le dossier" });
    }
});

app.get("/api/repaired", async (req, res) => {
    try {
        const files = await fs.readdir(config.repairedDir);
        const repairedFiles = [];

        for (const file of files) {
            const filePath = path.join(config.repairedDir, file);
            const stats = await fs.stat(filePath);
            repairedFiles.push({
                name: file,
                size: stats.size,
                sizeFormatted: formatFileSize(stats.size),
                date: stats.mtime
            });
        }

        res.json(repairedFiles);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.delete("/api/repaired/:filename", async (req, res) => {
    const filename = req.params.filename;
    const filePath = path.join(config.repairedDir, filename);

    try {
        await fs.access(filePath);
        await fs.unlink(filePath);
        res.json({ success: true });
    } catch {
        res.status(404).json({ error: "Fichier non trouve" });
    }
});

wss.on("connection", (ws) => {
    ws.on("message", async (message) => {
        try {
            const data = JSON.parse(message);
            if (data.type !== "repair") {
                return;
            }

            const filePath = getUploadedFilePath(data.fileId, data.fileName);
            try {
                await ensureFileExists(filePath);
            } catch {
                ws.send(JSON.stringify({
                    type: "error",
                    error: "Fichier non trouve sur le serveur",
                    fileName: data.fileName
                }));
                return;
            }

            const repairId = Date.now().toString();
            const queuedSnapshot = getQueueMeta();

            ws.send(JSON.stringify({
                type: "queued",
                fileName: data.fileName,
                fileId: data.fileId,
                repairId,
                queue: {
                    ...queuedSnapshot,
                    pendingAfterEnqueue: queuedSnapshot.pending + 1
                }
            }));

            repairQueue.enqueue(async ({ jobId, queuedAt, snapshot }) => {
                const startedAt = Date.now();
                const queueMeta = {
                    ...snapshot,
                    jobId,
                    queuedAt,
                    startedAt: new Date().toISOString()
                };

                const sendProgress = (progress, status) => {
                    ws.send(JSON.stringify({
                        type: "progress",
                        progress,
                        status,
                        fileName: data.fileName,
                        fileId: data.fileId,
                        repairId,
                        queue: {
                            ...getQueueMeta(),
                            jobId,
                            queuedAt
                        }
                    }));
                };

                try {
                    sendProgress(4, "Reparation demarree...");
                    const result = await repairEngine.repairFile(filePath, data.fileName, sendProgress);
                    const comparisonResult = await buildComparisonResponse(filePath, result.outputPath);
                    const durationMs = Date.now() - startedAt;

                    ws.send(JSON.stringify({
                        type: "complete",
                        success: true,
                        outputFile: path.basename(result.outputPath),
                        fileName: data.fileName,
                        fileId: data.fileId,
                        repairId,
                        originalName: data.fileName,
                        comparison: comparisonResult.comparison,
                        repairedAnalysis: comparisonResult.repairedAnalysis,
                        queue: {
                            ...getQueueMeta(),
                            ...queueMeta,
                            durationMs
                        }
                    }));

                    await recordRepairHistory({
                        fileId: data.fileId,
                        fileName: data.fileName,
                        result,
                        durationMs,
                        queueMeta,
                        comparisonResult
                    });

                    setTimeout(async () => {
                        try {
                            await repairEngine.cleanup(filePath);
                        } catch (cleanError) {
                            console.error("Erreur nettoyage:", cleanError);
                        }
                    }, 5000);
                } catch (repairError) {
                    const durationMs = Date.now() - startedAt;
                    ws.send(JSON.stringify({
                        type: "error",
                        error: repairError.message || "Erreur lors de la reparation",
                        fileName: data.fileName,
                        fileId: data.fileId,
                        queue: {
                            ...getQueueMeta(),
                            ...queueMeta,
                            durationMs
                        }
                    }));

                    await recordRepairHistory({
                        fileId: data.fileId,
                        fileName: data.fileName,
                        durationMs,
                        queueMeta,
                        error: repairError
                    });
                }
            }).catch((error) => {
                ws.send(JSON.stringify({
                    type: "error",
                    error: `Erreur file: ${error.message}`,
                    fileName: data.fileName,
                    queue: getQueueMeta()
                }));
            });
        } catch (error) {
            ws.send(JSON.stringify({
                type: "error",
                error: `Message invalide: ${error.message}`
            }));
        }
    });

    ws.on("error", (error) => {
        console.error("WebSocket error:", error);
    });
});

function formatFileSize(bytes) {
    if (bytes === 0) return "0 Bytes";
    const k = 1024;
    const sizes = ["Bytes", "KB", "MB", "GB"];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return `${parseFloat((bytes / Math.pow(k, i)).toFixed(2))} ${sizes[i]}`;
}

process.on("uncaughtException", (error) => {
    console.error("Uncaught Exception:", error);
});

process.on("unhandledRejection", (reason) => {
    console.error("Unhandled Rejection:", reason);
});

server.listen(config.port, config.host, () => {
    console.log(`FileRepair Pro disponible sur http://${config.host}:${config.port}`);
});

module.exports = { app, server, wss, repairsProgress };
