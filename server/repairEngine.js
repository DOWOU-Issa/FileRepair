const fs = require("fs").promises;
const path = require("path");
const { v4: uuidv4 } = require("uuid");
const config = require("./config");
const utils = require("./utils");
const magicBytes = require("./analyzers/magicBytes");
const corruptionDetector = require("./analyzers/corruptionDetector");

const videoRepairer = require("./repairers/videoRepairer");
const pdfRepairer = require("./repairers/pdfRepairer");
const officeRepairer = require("./repairers/officeRepairer");
const imageRepairer = require("./repairers/imageRepairer");
const archiveRepairer = require("./repairers/archiveRepairer");
const documentRepairer = require("./repairers/documentRepairer");

class RepairEngine {
    constructor() {
        this.activeRepairs = new Map();
    }

    async repairFile(filePath, originalName, onProgress = () => {}) {
        const repairId = uuidv4();
        const outputFileName = utils.getUniqueFilename(originalName, config.repairedDir);
        const outputPath = path.join(config.repairedDir, outputFileName);

        this.activeRepairs.set(repairId, {
            id: repairId,
            inputPath: filePath,
            outputPath,
            status: "analyzing"
        });

        try {
            onProgress(5, "Analyse du fichier...");

            const buffer = await utils.readFirstBytes(filePath, 4096);
            const extension = path.extname(originalName).toLowerCase();
            const detectedType = magicBytes.detectFileType(buffer);
            const categoryFromExtension = magicBytes.getCategoryFromExtension(extension);
            const categoryFromDetectedType = magicBytes.getCategoryFromDetectedType(detectedType);
            const category = this.resolveCategory(categoryFromExtension, categoryFromDetectedType);

            onProgress(12, `Type detecte: ${category} (${detectedType})`);

            const issues = await corruptionDetector.detectIssues(filePath, category, extension);
            const corruptionLevel = corruptionDetector.estimateCorruptionLevel(issues);

            onProgress(18, `Corruption: ${corruptionLevel} (${issues.length} probleme(s))`);

            const repairer = this.getRepairer(category);
            if (!repairer) {
                throw new Error(`Aucun reparateur disponible pour ${extension || detectedType}`);
            }

            this.activeRepairs.set(repairId, {
                ...this.activeRepairs.get(repairId),
                status: "repairing",
                category,
                detectedType,
                issues
            });

            const primaryResult = await this.runRepairer(
                repairer,
                filePath,
                outputPath,
                onProgress,
                category,
                detectedType
            );

            const validatedPath = await this.ensureUsableOutput(
                primaryResult.path || outputPath,
                filePath,
                extension,
                category
            );

            this.activeRepairs.set(repairId, {
                ...this.activeRepairs.get(repairId),
                status: "completed",
                result: primaryResult,
                outputPath: validatedPath
            });

            return {
                repairId,
                outputPath: validatedPath,
                success: true,
                issues,
                corruptionLevel,
                category,
                detectedType
            };
        } catch (error) {
            this.activeRepairs.set(repairId, {
                ...this.activeRepairs.get(repairId),
                status: "failed",
                error: error.message
            });

            throw error;
        }
    }

    resolveCategory(categoryFromExtension, categoryFromDetectedType) {
        if (categoryFromExtension !== "unknown") {
            return categoryFromExtension;
        }

        if (categoryFromDetectedType !== "unknown") {
            return categoryFromDetectedType;
        }

        return "document";
    }

    getRepairer(category) {
        switch (category) {
            case "video":
                return videoRepairer;
            case "pdf":
                return pdfRepairer;
            case "word":
            case "excel":
                return officeRepairer;
            case "image":
                return imageRepairer;
            case "archive":
                return archiveRepairer;
            case "document":
                return documentRepairer;
            default:
                return null;
        }
    }

    async runRepairer(repairer, filePath, outputPath, onProgress, category, detectedType) {
        try {
            return await repairer.repair(filePath, outputPath, onProgress, category, detectedType);
        } catch (primaryError) {
            if (category === "document") {
                throw primaryError;
            }

            onProgress(70, "Reparateur principal en echec, tentative de recuperation generique...");
            return this.runGenericFallback(filePath, outputPath, onProgress, category, primaryError);
        }
    }

    async runGenericFallback(filePath, outputPath, onProgress, category, primaryError) {
        const data = await fs.readFile(filePath);
        const trimmed = this.trimCorruptedEdges(data, category);

        if (!trimmed || trimmed.length === 0) {
            throw primaryError;
        }

        await fs.writeFile(outputPath, trimmed);
        onProgress(92, "Recuperation generique terminee");
        return { success: true, path: outputPath, fallback: true, reason: primaryError.message };
    }

    trimCorruptedEdges(data, category) {
        const signatures = {
            pdf: Buffer.from("%PDF"),
            image: [Buffer.from([0xff, 0xd8, 0xff]), Buffer.from([0x89, 0x50, 0x4e, 0x47]), Buffer.from("GIF8"), Buffer.from("BM")],
            archive: [Buffer.from([0x50, 0x4b]), Buffer.from("Rar!"), Buffer.from([0x37, 0x7a])],
            word: [Buffer.from([0x50, 0x4b]), Buffer.from([0xd0, 0xcf, 0x11, 0xe0])],
            excel: [Buffer.from([0x50, 0x4b]), Buffer.from([0xd0, 0xcf, 0x11, 0xe0])],
            video: [Buffer.from("ftyp"), Buffer.from("RIFF"), Buffer.from([0x1a, 0x45, 0xdf, 0xa3])]
        };

        const candidates = signatures[category];
        let start = 0;

        if (candidates) {
            const list = Array.isArray(candidates) ? candidates : [candidates];
            const indices = list
                .map((signature) => data.indexOf(signature))
                .filter((index) => index !== -1);

            if (indices.length > 0) {
                start = Math.min(...indices);
            }
        }

        let end = data.length;
        while (end > start && data[end - 1] === 0x00) {
            end--;
        }

        return data.slice(start, end);
    }

    async ensureUsableOutput(outputPath, inputPath, extension, category) {
        let stats;

        try {
            stats = await fs.stat(outputPath);
        } catch {
            throw new Error("Aucun fichier repare n'a ete genere");
        }

        if (stats.size === 0) {
            throw new Error("Le fichier repare est vide");
        }

        if ((category === "word" || category === "excel") && !path.extname(outputPath)) {
            const renamed = `${outputPath}${extension}`;
            await fs.rename(outputPath, renamed);
            return renamed;
        }

        return outputPath;
    }

    getRepairStatus(repairId) {
        return this.activeRepairs.get(repairId);
    }

    async cleanup(filePath) {
        try {
            await fs.unlink(filePath);
        } catch (error) {
            console.error("Erreur nettoyage:", error);
        }
    }
}

module.exports = new RepairEngine();
