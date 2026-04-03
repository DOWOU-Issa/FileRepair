const fs = require("fs").promises;
const fsConstants = require("fs").constants;
const path = require("path");
const utils = require("../utils");
const magicBytes = require("./magicBytes");
const corruptionDetector = require("./corruptionDetector");

class FileAnalyzer {
    async analyze(filePath) {
        const stats = await fs.stat(filePath);
        const buffer = await utils.readFirstBytes(filePath, 2048);
        const extension = path.extname(filePath).toLowerCase();
        const detectedType = magicBytes.detectFileType(buffer);
        const declaredType = magicBytes.getCategoryFromExtension(extension);
        const detectedCategory = magicBytes.getCategoryFromDetectedType(detectedType);
        const resolvedCategory = declaredType === "unknown" ? detectedCategory : declaredType;

        const analysis = {
            path: filePath,
            name: path.basename(filePath),
            extension,
            size: stats.size,
            sizeFormatted: utils.formatFileSize(stats.size),
            created: stats.birthtime,
            modified: stats.mtime,
            readable: await this.isReadable(filePath),
            writable: await this.isWritable(filePath),
            detectedType,
            declaredType,
            detectedCategory,
            resolvedCategory,
            typeMatch: declaredType === detectedCategory || (declaredType === "unknown" && detectedType !== "unknown"),
            magicBytes: utils.bufferToHex(buffer.slice(0, 16)),
            header: buffer.toString("hex", 0, 32),
            issues: [],
            corruptionLevel: "none",
            repairable: true,
            metadata: {}
        };

        analysis.issues = await corruptionDetector.detectIssues(filePath, resolvedCategory, extension);
        analysis.corruptionLevel = corruptionDetector.estimateCorruptionLevel(analysis.issues);

        if (analysis.size === 0) {
            analysis.repairable = false;
            analysis.issues.push("Fichier vide, non reparable");
        }

        if (analysis.issues.length > 5 && analysis.corruptionLevel === "severe") {
            analysis.repairable = false;
        }

        switch (resolvedCategory) {
            case "video":
                analysis.metadata = await this.analyzeVideo(filePath);
                break;
            case "pdf":
                analysis.metadata = await this.analyzePDF(filePath);
                break;
            case "image":
                analysis.metadata = await this.analyzeImage(filePath);
                break;
            case "archive":
                analysis.metadata = await this.analyzeArchive(filePath);
                break;
            case "document":
                analysis.metadata = await this.analyzeDocument(filePath);
                break;
            default:
                analysis.metadata = {};
                break;
        }

        return analysis;
    }

    async isReadable(filePath) {
        try {
            await fs.access(filePath, fsConstants.R_OK);
            return true;
        } catch {
            return false;
        }
    }

    async isWritable(filePath) {
        try {
            await fs.access(path.dirname(filePath), fsConstants.W_OK);
            return true;
        } catch {
            return false;
        }
    }

    async analyzeVideo(filePath) {
        const metadata = {
            duration: null,
            width: null,
            height: null,
            codec: null,
            bitrate: null
        };

        try {
            const buffer = await utils.readFirstBytes(filePath, 1024);
            const content = buffer.toString("latin1");

            const durationMatch = content.match(/duration\s*=\s*(\d+)/i);
            if (durationMatch) metadata.duration = parseInt(durationMatch[1], 10);

            const widthMatch = content.match(/width\s*=\s*(\d+)/i);
            if (widthMatch) metadata.width = parseInt(widthMatch[1], 10);

            const heightMatch = content.match(/height\s*=\s*(\d+)/i);
            if (heightMatch) metadata.height = parseInt(heightMatch[1], 10);
        } catch (error) {
            metadata.error = error.message;
        }

        return metadata;
    }

    async analyzePDF(filePath) {
        const metadata = {
            version: null,
            pages: null,
            encrypted: false,
            linearized: false
        };

        try {
            const buffer = await utils.readFirstBytes(filePath, 2048);
            const content = buffer.toString("latin1");

            const versionMatch = content.match(/%PDF-(\d+\.\d+)/);
            if (versionMatch) metadata.version = versionMatch[1];

            const pagesMatch = content.match(/\/Count\s+(\d+)/);
            if (pagesMatch) metadata.pages = parseInt(pagesMatch[1], 10);

            metadata.encrypted = content.includes("/Encrypt");
            metadata.linearized = content.includes("/Linearized");
        } catch (error) {
            metadata.error = error.message;
        }

        return metadata;
    }

    async analyzeImage(filePath) {
        const metadata = {
            width: null,
            height: null,
            format: null,
            colorspace: null
        };

        try {
            const buffer = await utils.readFirstBytes(filePath, 256);

            if (buffer[0] === 0xff && buffer[1] === 0xd8) {
                metadata.format = "JPEG";
                for (let i = 0; i < buffer.length - 10; i++) {
                    if (buffer[i] === 0xff && buffer[i + 1] === 0xc0) {
                        metadata.height = (buffer[i + 5] << 8) | buffer[i + 6];
                        metadata.width = (buffer[i + 7] << 8) | buffer[i + 8];
                        break;
                    }
                }
            } else if (buffer[0] === 0x89 && buffer[1] === 0x50) {
                metadata.format = "PNG";
                metadata.width = buffer.readUInt32BE(16);
                metadata.height = buffer.readUInt32BE(20);
            } else if (buffer[0] === 0x47 && buffer[1] === 0x49) {
                metadata.format = "GIF";
                metadata.width = buffer.readUInt16LE(6);
                metadata.height = buffer.readUInt16LE(8);
            } else if (buffer[0] === 0x42 && buffer[1] === 0x4d) {
                metadata.format = "BMP";
            }
        } catch (error) {
            metadata.error = error.message;
        }

        return metadata;
    }

    async analyzeArchive(filePath) {
        const metadata = {
            format: null,
            fileCount: 0,
            totalSize: 0,
            entries: []
        };

        try {
            const buffer = await utils.readFirstBytes(filePath, 1024);

            if (buffer[0] === 0x50 && buffer[1] === 0x4b) {
                metadata.format = "ZIP";
                const entries = await this.scanZipEntries(filePath);
                metadata.fileCount = entries.length;
                metadata.entries = entries.slice(0, 10);
            } else if (buffer.toString("ascii", 0, 4).startsWith("Rar!")) {
                metadata.format = "RAR";
            } else if (buffer[0] === 0x37 && buffer[1] === 0x7a) {
                metadata.format = "7Z";
            }
        } catch (error) {
            metadata.error = error.message;
        }

        return metadata;
    }

    async analyzeDocument(filePath) {
        const metadata = {
            lineCount: 0,
            emptyLines: 0,
            printableRatio: 0,
            preview: ""
        };

        try {
            const buffer = await utils.readFirstBytes(filePath, 4096);
            const text = buffer.toString("utf8");
            const lines = text.split(/\r?\n/);
            const printable = [...buffer].filter((byte) =>
                byte === 0x09 || byte === 0x0a || byte === 0x0d || (byte >= 0x20 && byte <= 0x7e)
            ).length;

            metadata.lineCount = lines.length;
            metadata.emptyLines = lines.filter((line) => line.trim().length === 0).length;
            metadata.printableRatio = buffer.length ? Number((printable / buffer.length).toFixed(2)) : 0;
            metadata.preview = lines.slice(0, 4).join("\n").slice(0, 250);
        } catch (error) {
            metadata.error = error.message;
        }

        return metadata;
    }

    async scanZipEntries(filePath) {
        const entries = [];
        const buffer = await fs.readFile(filePath);
        const localHeader = [0x50, 0x4b, 0x03, 0x04];

        for (let i = 0; i < buffer.length - 30; i++) {
            let match = true;
            for (let j = 0; j < 4; j++) {
                if (buffer[i + j] !== localHeader[j]) {
                    match = false;
                    break;
                }
            }

            if (match) {
                const fileNameLength = buffer[i + 26] + (buffer[i + 27] << 8);
                const nameStart = i + 30;
                const nameEnd = nameStart + fileNameLength;

                if (nameEnd <= buffer.length) {
                    const name = buffer.slice(nameStart, nameEnd).toString("utf8");
                    if (name && !name.includes("/") && !entries.includes(name)) {
                        entries.push(name);
                    }
                }
            }
        }

        return entries;
    }

    generateReport(analysis) {
        const report = {
            timestamp: new Date().toISOString(),
            file: {
                name: analysis.name,
                extension: analysis.extension,
                size: analysis.sizeFormatted,
                type: analysis.resolvedCategory || analysis.detectedType,
                detectedType: analysis.detectedType,
                typeMatch: analysis.typeMatch
            },
            integrity: {
                issues: analysis.issues,
                corruptionLevel: analysis.corruptionLevel,
                repairable: analysis.repairable
            },
            access: {
                readable: analysis.readable,
                writable: analysis.writable
            },
            metadata: analysis.metadata,
            recommendations: this.getRecommendations(analysis)
        };

        return report;
    }

    getRecommendations(analysis) {
        const recommendations = [];

        if (!analysis.typeMatch) {
            recommendations.push("Le contenu detecte ne correspond pas completement a l'extension du fichier.");
        }

        if (analysis.issues.some((issue) => issue.toLowerCase().includes("entete"))) {
            recommendations.push("Tenter une reconstruction de l'entete et des premiers blocs.");
        }

        if (analysis.issues.some((issue) => issue.toLowerCase().includes("zip"))) {
            recommendations.push("Essayer une extraction partielle des entrees saines.");
        }

        if (analysis.resolvedCategory === "document") {
            recommendations.push("Nettoyer les caracteres non imprimables avant la reparation.");
        }

        if (analysis.corruptionLevel === "severe") {
            recommendations.push("Utiliser une strategie de recuperation agressive avec resultat possiblement partiel.");
        }

        if (!analysis.repairable) {
            recommendations.push("Le fichier semble difficile a reparer automatiquement. Prevoir une extraction manuelle.");
        }

        if (recommendations.length === 0) {
            recommendations.push("Le fichier semble recuperable avec la strategie standard.");
        }

        return recommendations;
    }

    async compareFiles(originalPath, repairedPath) {
        const original = await this.analyze(originalPath);
        const repaired = await this.analyze(repairedPath);

        return {
            original: {
                size: original.sizeFormatted,
                issues: original.issues.length,
                type: original.resolvedCategory
            },
            repaired: {
                size: repaired.sizeFormatted,
                issues: repaired.issues.length,
                type: repaired.resolvedCategory
            },
            improvement: {
                sizeDiff: original.size - repaired.size,
                issuesFixed: original.issues.length - repaired.issues.length,
                success: repaired.issues.length < original.issues.length
            }
        };
    }
}

module.exports = new FileAnalyzer();
