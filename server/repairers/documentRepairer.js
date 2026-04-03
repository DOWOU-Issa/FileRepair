const fs = require("fs").promises;

class DocumentRepairer {
    async repair(inputPath, outputPath, onProgress) {
        onProgress(20, "Lecture du document...");

        const source = await fs.readFile(inputPath);
        const sanitized = this.sanitizeBuffer(source);
        const originalText = sanitized.toString("utf8");
        const extension = this.getExtension(outputPath);

        onProgress(55, "Reconstruction du contenu...");

        let repairedText = originalText;

        switch (extension) {
            case ".json":
                repairedText = this.repairJson(originalText);
                break;
            case ".xml":
                repairedText = this.repairXml(originalText);
                break;
            case ".html":
            case ".htm":
                repairedText = this.repairHtml(originalText);
                break;
            case ".csv":
                repairedText = this.repairCsv(originalText);
                break;
            default:
                repairedText = this.repairPlainText(originalText);
                break;
        }

        onProgress(85, "Sauvegarde du document repare...");
        await fs.writeFile(outputPath, repairedText, "utf8");

        onProgress(100, "Document repare avec succes !");
        return { success: true, path: outputPath };
    }

    sanitizeBuffer(buffer) {
        const result = [];

        for (const byte of buffer) {
            if (byte === 0x09 || byte === 0x0A || byte === 0x0D || byte >= 0x20) {
                result.push(byte);
            }
        }

        return Buffer.from(result);
    }

    repairPlainText(text) {
        return text
            .replace(/\uFEFF/g, "")
            .replace(/[^\S\r\n]+\n/g, "\n")
            .replace(/\r\n/g, "\n")
            .trim();
    }

    repairCsv(text) {
        const lines = this.repairPlainText(text)
            .split("\n")
            .map((line) => line.trim())
            .filter(Boolean);

        const maxColumns = lines.reduce((max, line) => Math.max(max, line.split(",").length), 0);

        return lines
            .map((line) => {
                const columns = line.split(",");
                while (columns.length < maxColumns) {
                    columns.push("");
                }
                return columns.join(",");
            })
            .join("\n");
    }

    repairJson(text) {
        const cleaned = this.repairPlainText(text)
            .replace(/,\s*([}\]])/g, "$1")
            .trim();

        try {
            return `${JSON.stringify(JSON.parse(cleaned), null, 2)}\n`;
        } catch {
            const extracted = this.extractBalancedJson(cleaned);
            if (!extracted) {
                return cleaned;
            }

            try {
                return `${JSON.stringify(JSON.parse(extracted), null, 2)}\n`;
            } catch {
                return extracted;
            }
        }
    }

    extractBalancedJson(text) {
        const stack = [];
        let start = -1;

        for (let i = 0; i < text.length; i++) {
            const char = text[i];

            if (char === "{" || char === "[") {
                if (start === -1) start = i;
                stack.push(char);
            } else if (char === "}" || char === "]") {
                const expected = char === "}" ? "{" : "[";
                if (stack[stack.length - 1] === expected) {
                    stack.pop();
                    if (stack.length === 0 && start !== -1) {
                        return text.slice(start, i + 1);
                    }
                }
            }
        }

        return null;
    }

    repairXml(text) {
        let repaired = this.repairPlainText(text);

        if (!repaired.startsWith("<?xml")) {
            repaired = `<?xml version="1.0" encoding="UTF-8"?>\n${repaired}`;
        }

        repaired = repaired.replace(/&(?![a-zA-Z]+;|#\d+;)/g, "&amp;");

        const rootMatch = repaired.match(/<([a-zA-Z_][\w:.-]*)[^>]*>/);
        if (rootMatch) {
            const rootTag = rootMatch[1];
            if (!new RegExp(`</${rootTag}>\\s*$`).test(repaired)) {
                repaired += `\n</${rootTag}>`;
            }
        }

        return `${repaired}\n`;
    }

    repairHtml(text) {
        let repaired = this.repairPlainText(text);

        if (!/<html[\s>]/i.test(repaired)) {
            repaired = `<html><body>\n${repaired}\n</body></html>`;
        }

        if (!/<\/body>/i.test(repaired)) {
            repaired = repaired.replace(/<\/html>/i, "</body></html>");
        }

        if (!/<\/html>/i.test(repaired)) {
            repaired += "\n</html>";
        }

        return `${repaired}\n`;
    }

    getExtension(filePath) {
        const index = filePath.lastIndexOf(".");
        return index === -1 ? "" : filePath.slice(index).toLowerCase();
    }
}

module.exports = new DocumentRepairer();
