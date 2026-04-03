const fs = require("fs").promises;
const path = require("path");
const { looksLikeText } = require("./magicBytes");

class CorruptionDetector {
    async detectIssues(filePath, fileType, extension) {
        const issues = [];

        try {
            const stats = await fs.stat(filePath);

            if (stats.size === 0) {
                issues.push("Fichier vide");
                return issues;
            }

            const headSize = Math.min(4096, stats.size);
            const tailSize = Math.min(2048, stats.size);

            const [headBuffer, endBuffer] = await Promise.all([
                this.readRange(filePath, 0, headSize),
                this.readRange(filePath, Math.max(0, stats.size - tailSize), tailSize)
            ]);

            switch (fileType) {
                case "pdf":
                    this.detectPDFIssues(headBuffer, endBuffer, issues);
                    break;
                case "video":
                    this.detectVideoIssues(headBuffer, issues);
                    break;
                case "word":
                case "excel":
                    this.detectOfficeIssues(headBuffer, extension, issues);
                    break;
                case "image":
                    this.detectImageIssues(headBuffer, endBuffer, extension, issues);
                    break;
                case "archive":
                    this.detectArchiveIssues(headBuffer, extension, issues);
                    break;
                case "document":
                    this.detectDocumentIssues(headBuffer, endBuffer, extension, issues);
                    break;
                default:
                    if (this.hasMostlyNullBytes(headBuffer)) {
                        issues.push("Contenu binaire fortement degrade");
                    }
                    break;
            }

            if (this.hasTrailingNulls(endBuffer)) {
                issues.push("Fin de fichier suspecte ou tronquee");
            }
        } catch (error) {
            issues.push(`Erreur d'analyse: ${error.message}`);
        }

        return [...new Set(issues)];
    }

    async readRange(filePath, start, length) {
        const buffer = Buffer.alloc(length);
        const handle = await fs.open(filePath, "r");

        try {
            const { bytesRead } = await handle.read(buffer, 0, length, start);
            return buffer.slice(0, bytesRead);
        } finally {
            await handle.close();
        }
    }

    detectPDFIssues(headBuffer, endBuffer, issues) {
        if (!headBuffer.toString("ascii", 0, 4).startsWith("%PDF")) {
            issues.push("En-tete PDF manquant ou corrompu");
        }

        const headContent = headBuffer.toString("latin1");
        const endContent = endBuffer.toString("latin1");

        if (!endContent.includes("%%EOF")) {
            issues.push("Marqueur de fin %%EOF manquant");
        }

        if (!headContent.includes("obj")) {
            issues.push("Objets PDF introuvables");
        }
    }

    detectVideoIssues(buffer, issues) {
        const header = buffer.toString("hex", 0, 16);
        const riffType = buffer.toString("ascii", 8, 12);
        const mp4Brand = buffer.toString("ascii", 4, 8);

        const isMkv = header.startsWith("1a45dfa3");
        const isAvi = header.startsWith("52494646") && riffType === "AVI ";
        const isMp4Family = mp4Brand === "ftyp";

        if (!isMkv && !isAvi && !isMp4Family) {
            issues.push("Format video non reconnu ou entete degrade");
        }

        if (this.hasMostlyNullBytes(buffer)) {
            issues.push("Presence anormale de donnees nulles");
        }
    }

    detectOfficeIssues(buffer, extension, issues) {
        if (extension === ".docx" || extension === ".xlsx") {
            if (!(buffer[0] === 0x50 && buffer[1] === 0x4B)) {
                issues.push("Structure ZIP corrompue (Office moderne)");
            }
        } else if (extension === ".doc" || extension === ".xls") {
            if (!(buffer[0] === 0xD0 && buffer[1] === 0xCF)) {
                issues.push("Structure OLE corrompue (ancien format Office)");
            }
        }
    }

    detectImageIssues(headBuffer, endBuffer, extension, issues) {
        switch (extension) {
            case ".jpg":
            case ".jpeg":
                if (!(headBuffer[0] === 0xFF && headBuffer[1] === 0xD8)) {
                    issues.push("En-tete JPEG manquant");
                }
                if (!(endBuffer[endBuffer.length - 2] === 0xFF && endBuffer[endBuffer.length - 1] === 0xD9)) {
                    issues.push("Fin JPEG manquante");
                }
                break;
            case ".png":
                if (!(headBuffer[0] === 0x89 && headBuffer[1] === 0x50)) {
                    issues.push("En-tete PNG manquant");
                }
                break;
            case ".gif":
                if (!headBuffer.toString("ascii", 0, 3).startsWith("GIF")) {
                    issues.push("En-tete GIF manquant");
                }
                break;
            case ".bmp":
                if (!(headBuffer[0] === 0x42 && headBuffer[1] === 0x4D)) {
                    issues.push("En-tete BMP manquant");
                }
                break;
            case ".tif":
            case ".tiff":
                if (!this.isTiff(headBuffer)) {
                    issues.push("En-tete TIFF manquant");
                }
                break;
            case ".webp":
                if (!(headBuffer.toString("ascii", 0, 4) === "RIFF" && headBuffer.toString("ascii", 8, 12) === "WEBP")) {
                    issues.push("En-tete WEBP manquant");
                }
                break;
            default:
                if (this.hasMostlyNullBytes(headBuffer)) {
                    issues.push("Image difficilement exploitable");
                }
                break;
        }
    }

    detectArchiveIssues(buffer, extension, issues) {
        if (extension === ".zip" && !(buffer[0] === 0x50 && buffer[1] === 0x4B)) {
            issues.push("Archive ZIP corrompue");
        }

        if (extension === ".rar" && !buffer.toString("ascii", 0, 4).startsWith("Rar!")) {
            issues.push("Archive RAR corrompue");
        }

        if (extension === ".7z" && !(buffer[0] === 0x37 && buffer[1] === 0x7A)) {
            issues.push("Archive 7Z corrompue");
        }
    }

    detectDocumentIssues(headBuffer, endBuffer, extension, issues) {
        if (!looksLikeText(headBuffer) && extension !== ".json" && extension !== ".xml") {
            issues.push("Document texte partiellement binaire");
        }

        const headText = headBuffer.toString("utf8");
        const tailText = endBuffer.toString("utf8");

        if (extension === ".json") {
            try {
                JSON.parse(`${headText}${tailText}`);
            } catch {
                issues.push("Structure JSON incomplete ou invalide");
            }
        }

        if (extension === ".xml" || extension === ".html" || extension === ".htm") {
            const openCount = (headText.match(/</g) || []).length;
            const closeCount = (tailText.match(/>/g) || []).length;
            if (openCount === 0 || closeCount === 0) {
                issues.push("Balises structurelles manquantes");
            }
        }
    }

    isTiff(buffer) {
        return (
            (buffer[0] === 0x49 && buffer[1] === 0x49 && buffer[2] === 0x2A && buffer[3] === 0x00) ||
            (buffer[0] === 0x4D && buffer[1] === 0x4D && buffer[2] === 0x00 && buffer[3] === 0x2A)
        );
    }

    hasTrailingNulls(buffer) {
        if (!buffer || buffer.length < 16) {
            return false;
        }

        const tail = buffer.slice(Math.max(0, buffer.length - 128));
        let nullCount = 0;

        for (const byte of tail) {
            if (byte === 0) nullCount++;
        }

        return nullCount / tail.length > 0.85;
    }

    hasMostlyNullBytes(buffer) {
        let nullCount = 0;
        for (const byte of buffer) {
            if (byte === 0) nullCount++;
        }

        return buffer.length > 0 && nullCount / buffer.length > 0.5;
    }

    estimateCorruptionLevel(issues) {
        if (issues.length === 0) return "none";
        if (issues.length <= 2) return "minor";
        if (issues.length <= 4) return "moderate";
        return "severe";
    }
}

module.exports = new CorruptionDetector();
