const fs = require("fs").promises;
const path = require("path");
const config = require("./config");

class HistoryStore {
    constructor() {
        this.filePath = path.join(config.logsDir, "history.json");
        this.entries = [];
        this.loaded = false;
        this.maxEntries = 500;
        this.writeChain = Promise.resolve();
    }

    async init() {
        if (this.loaded) {
            return;
        }

        try {
            const raw = await fs.readFile(this.filePath, "utf8");
            const parsed = JSON.parse(raw);
            this.entries = Array.isArray(parsed) ? parsed : [];
        } catch (error) {
            if (error.code !== "ENOENT") {
                console.error("Erreur lecture historique:", error);
            }
            this.entries = [];
        }

        this.loaded = true;
    }

    async append(entry) {
        await this.init();

        const normalized = {
            id: entry.id,
            kind: entry.kind,
            status: entry.status,
            fileName: entry.fileName,
            fileType: entry.fileType || "unknown",
            detectedType: entry.detectedType || "unknown",
            corruptionLevel: entry.corruptionLevel || "unknown",
            repairable: Boolean(entry.repairable),
            issuesCount: Number(entry.issuesCount || 0),
            size: Number(entry.size || 0),
            createdAt: entry.createdAt || new Date().toISOString(),
            durationMs: Number(entry.durationMs || 0),
            outputFile: entry.outputFile || null,
            queueMeta: entry.queueMeta || null,
            comparison: entry.comparison || null,
            details: entry.details || null
        };

        this.entries.unshift(normalized);
        if (this.entries.length > this.maxEntries) {
            this.entries = this.entries.slice(0, this.maxEntries);
        }

        this.writeChain = this.writeChain.then(() =>
            fs.writeFile(this.filePath, JSON.stringify(this.entries, null, 2), "utf8")
        ).catch((error) => {
            console.error("Erreur ecriture historique:", error);
        });

        await this.writeChain;
        return normalized;
    }

    async list(limit = 50, filters = {}) {
        await this.init();

        let items = [...this.entries];

        if (filters.q) {
            const q = String(filters.q).toLowerCase();
            items = items.filter((entry) =>
                (entry.fileName || "").toLowerCase().includes(q) ||
                (entry.fileType || "").toLowerCase().includes(q) ||
                (entry.kind || "").toLowerCase().includes(q) ||
                (entry.status || "").toLowerCase().includes(q)
            );
        }

        if (filters.kind) {
            items = items.filter((entry) => entry.kind === filters.kind);
        }

        if (filters.status) {
            items = items.filter((entry) => entry.status === filters.status);
        }

        if (filters.fileType) {
            items = items.filter((entry) => entry.fileType === filters.fileType);
        }

        return items.slice(0, limit);
    }

    async getDashboard() {
        await this.init();

        const analyses = this.entries.filter((entry) => entry.kind === "analysis");
        const repairs = this.entries.filter((entry) => entry.kind === "repair");
        const successfulRepairs = repairs.filter((entry) => entry.status === "success");

        const byType = {};
        for (const entry of repairs) {
            const type = entry.fileType || "unknown";
            if (!byType[type]) {
                byType[type] = {
                    total: 0,
                    success: 0,
                    failed: 0,
                    avgIssuesFixed: 0,
                    avgDurationMs: 0
                };
            }

            byType[type].total += 1;
            if (entry.status === "success") {
                byType[type].success += 1;
            } else {
                byType[type].failed += 1;
            }

            if (entry.comparison && entry.comparison.improvement) {
                byType[type].avgIssuesFixed += Number(entry.comparison.improvement.issuesFixed || 0);
            }

            byType[type].avgDurationMs += Number(entry.durationMs || 0);
        }

        const typeStats = Object.entries(byType)
            .map(([type, stats]) => ({
                type,
                total: stats.total,
                success: stats.success,
                failed: stats.failed,
                successRate: stats.total ? Number(((stats.success / stats.total) * 100).toFixed(1)) : 0,
                avgIssuesFixed: stats.total ? Number((stats.avgIssuesFixed / stats.total).toFixed(2)) : 0,
                avgDurationMs: stats.total ? Math.round(stats.avgDurationMs / stats.total) : 0
            }))
            .sort((a, b) => b.total - a.total);

        return {
            totals: {
                analyses: analyses.length,
                repairs: repairs.length,
                successfulRepairs: successfulRepairs.length,
                failedRepairs: repairs.length - successfulRepairs.length,
                globalSuccessRate: repairs.length ? Number(((successfulRepairs.length / repairs.length) * 100).toFixed(1)) : 0
            },
            queue: {
                concurrency: config.maxConcurrentRepairs
            },
            byType: typeStats
        };
    }
}

module.exports = new HistoryStore();
