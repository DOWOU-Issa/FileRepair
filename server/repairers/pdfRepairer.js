const fs = require("fs").promises;
const { PDFDocument, StandardFonts, rgb } = require("pdf-lib");

class PDFRepairer {
    async repair(inputPath, outputPath, onProgress) {
        try {
            onProgress(32, "Lecture du PDF...");
            let data = await fs.readFile(inputPath);

            onProgress(46, "Nettoyage des octets parasites...");
            data = this.trimNullPadding(data);

            onProgress(60, "Reconstruction de la structure PDF...");
            const pdfStart = data.indexOf(Buffer.from("%PDF"));

            if (pdfStart !== -1) {
                data = data.slice(pdfStart);
            } else if (this.looksLikePdfStructure(data)) {
                data = Buffer.concat([Buffer.from("%PDF-1.4\n"), data]);
            } else {
                throw new Error("Ce fichier ne contient pas de structure PDF exploitable");
            }

            onProgress(78, "Verification des objets et de la fin du document...");

            if (!data.toString("latin1").includes("obj")) {
                throw new Error("Objets PDF introuvables");
            }

            const tail = data.slice(Math.max(0, data.length - 64)).toString("latin1");
            if (!tail.includes("%%EOF")) {
                data = Buffer.concat([data, Buffer.from("\n%%EOF\n")]);
            }

            onProgress(92, "Generation d'un PDF ouvrable...");
            const repairedPdf = await this.buildOpenablePdf(data);
            await fs.writeFile(outputPath, repairedPdf);

            const stats = await fs.stat(outputPath);
            if (stats.size === 0) {
                throw new Error("Fichier repare vide");
            }

            await this.validatePdf(repairedPdf);

            onProgress(100, "Reparation PDF terminee !");
            return { success: true, path: outputPath };
        } catch (error) {
            onProgress(0, `Erreur: ${error.message}`);
            throw error;
        }
    }

    trimNullPadding(data) {
        let start = 0;
        let end = data.length;

        while (start < end && data[start] === 0x00) start++;
        while (end > start && data[end - 1] === 0x00) end--;

        return data.slice(start, end);
    }

    looksLikePdfStructure(data) {
        const content = data.toString("latin1");
        return content.includes("obj") && content.includes("endobj");
    }

    async buildOpenablePdf(data) {
        try {
            const loaded = await PDFDocument.load(data, {
                ignoreEncryption: true,
                throwOnInvalidObject: false,
                updateMetadata: false
            });

            if (loaded.getPageCount() > 0) {
                return Buffer.from(await loaded.save());
            }
        } catch {
            // fallback below
        }

        return this.createRecoveryReportPdf(data);
    }

    async createRecoveryReportPdf(data) {
        const pdf = await PDFDocument.create();
        const page = pdf.addPage([595.28, 841.89]);
        const font = await pdf.embedFont(StandardFonts.Helvetica);
        const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
        const margin = 50;
        let cursorY = page.getHeight() - 60;

        page.drawText("PDF repare partiellement", {
            x: margin,
            y: cursorY,
            size: 20,
            font: bold,
            color: rgb(0.13, 0.36, 0.21)
        });

        cursorY -= 34;

        const intro = [
            "Le document source etait trop corrompu pour reconstruire un PDF complet avec ses pages d'origine.",
            "Ce fichier reste ouvrable afin de confirmer la recuperation, mais le contenu initial n'a pas pu etre restaure integralement."
        ];

        for (const line of intro) {
            cursorY = this.drawWrappedText(page, line, font, 11, margin, cursorY, 495, 16);
            cursorY -= 6;
        }

        cursorY -= 14;
        page.drawText("Extrait brut detecte :", {
            x: margin,
            y: cursorY,
            size: 12,
            font: bold,
            color: rgb(0.12, 0.1, 0.09)
        });

        cursorY -= 22;

        const snippet = this.extractPrintableSnippet(data);
        cursorY = this.drawWrappedText(page, snippet, font, 10, margin, cursorY, 495, 14);

        return Buffer.from(await pdf.save());
    }

    extractPrintableSnippet(data) {
        const content = data
            .toString("latin1")
            .replace(/[^\x20-\x7E\r\n\t]+/g, " ")
            .replace(/\s+/g, " ")
            .trim();

        if (!content) {
            return "Aucun contenu textuel exploitable n'a ete retrouve dans le fichier source.";
        }

        const snippet = content.slice(0, 900);
        return snippet.length < content.length ? `${snippet}...` : snippet;
    }

    drawWrappedText(page, text, font, size, x, startY, maxWidth, lineHeight) {
        const words = text.split(/\s+/);
        const lines = [];
        let current = "";

        for (const word of words) {
            const candidate = current ? `${current} ${word}` : word;
            const width = font.widthOfTextAtSize(candidate, size);

            if (width <= maxWidth) {
                current = candidate;
                continue;
            }

            if (current) {
                lines.push(current);
            }
            current = word;
        }

        if (current) {
            lines.push(current);
        }

        let y = startY;
        for (const line of lines) {
            page.drawText(line, {
                x,
                y,
                size,
                font,
                color: rgb(0.2, 0.18, 0.16)
            });
            y -= lineHeight;
        }

        return y;
    }

    async validatePdf(buffer) {
        const loaded = await PDFDocument.load(buffer, {
            ignoreEncryption: true,
            throwOnInvalidObject: false,
            updateMetadata: false
        });

        if (loaded.getPageCount() === 0) {
            throw new Error("Le PDF repare reste inutilisable");
        }
    }
}

module.exports = new PDFRepairer();
