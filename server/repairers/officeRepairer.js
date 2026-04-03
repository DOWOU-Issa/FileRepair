const fs = require("fs").promises;
const path = require("path");
const AdmZip = require("adm-zip");
const mammoth = require("mammoth");
const XLSX = require("xlsx");

class OfficeRepairer {
    async repair(inputPath, outputPath, onProgress) {
        try {
            const extension = path.extname(inputPath).toLowerCase();
            let finalPath = outputPath;

            onProgress(20, `Analyse du fichier ${extension}...`);

            if (extension === ".docx" || extension === ".xlsx") {
                finalPath = await this.repairModernOffice(inputPath, outputPath, onProgress, extension);
            } else if (extension === ".doc" || extension === ".xls") {
                finalPath = await this.repairLegacyOffice(inputPath, outputPath, onProgress, extension);
            } else {
                throw new Error(`Format Office non supporte: ${extension}`);
            }

            onProgress(100, "Fichier Office repare avec succes !");
            return { success: true, path: finalPath };
        } catch (error) {
            onProgress(0, `Erreur: ${error.message}`);
            throw error;
        }
    }

    async repairModernOffice(inputPath, outputPath, onProgress, extension) {
        try {
            onProgress(40, "Tentative d'extraction du contenu...");

            let zip;
            try {
                zip = new AdmZip(inputPath);
            } catch {
                onProgress(50, "Reparation de la structure ZIP...");
                const repairedZip = await this.repairZipHeader(inputPath);
                zip = new AdmZip(repairedZip);
            }

            onProgress(70, "Extraction des donnees...");

            if (extension === ".docx") {
                await this.repairDocx(zip, outputPath, onProgress);
            } else {
                await this.repairXlsx(zip, outputPath, onProgress);
            }

            return outputPath;
        } catch {
            onProgress(60, "Tentative de recuperation du contenu texte...");
            return this.extractTextContent(inputPath, outputPath, extension);
        }
    }

    async repairLegacyOffice(inputPath, outputPath, onProgress, extension) {
        onProgress(40, "Analyse de la structure OLE...");

        try {
            const data = await fs.readFile(inputPath);
            const oleMarkers = this.findOLEMarkers(data);

            if (oleMarkers.length === 0) {
                throw new Error("Structure OLE non trouvee");
            }

            onProgress(60, `${oleMarkers.length} structures OLE trouvees`);

            const repaired = this.reconstructOLE(data, oleMarkers);
            await fs.writeFile(outputPath, repaired);
            return outputPath;
        } catch {
            onProgress(50, "Extraction du contenu texte...");
            return this.extractTextFromLegacy(inputPath, outputPath, extension);
        }
    }

    async repairDocx(zip, outputPath, onProgress) {
        let documentXml = null;

        try {
            documentXml = zip.readAsText("word/document.xml");
        } catch {
            const docEntry = zip.getEntries().find((entry) => entry.entryName.includes("document.xml"));
            if (docEntry) {
                documentXml = docEntry.getData().toString("utf8");
            }
        }

        if (!documentXml) {
            throw new Error("document.xml introuvable");
        }

        const repairedXml = this.repairXML(documentXml);
        const newZip = this.cloneZip(zip);
        newZip.addFile("word/document.xml", Buffer.from(repairedXml, "utf8"));
        newZip.writeZip(outputPath);
        onProgress(90, "Document reconstruit");
    }

    async repairXlsx(zip, outputPath, onProgress) {
        let workbookXml = null;

        try {
            workbookXml = zip.readAsText("xl/workbook.xml");
        } catch {
            const workbookEntry = zip.getEntries().find((entry) => entry.entryName.includes("workbook.xml"));
            if (workbookEntry) {
                workbookXml = workbookEntry.getData().toString("utf8");
            }
        }

        if (!workbookXml) {
            throw new Error("workbook.xml introuvable");
        }

        const repairedWorkbook = this.repairXML(workbookXml);
        const newZip = this.cloneZip(zip);
        newZip.addFile("xl/workbook.xml", Buffer.from(repairedWorkbook, "utf8"));
        newZip.writeZip(outputPath);
        onProgress(90, "Classeur reconstruit");
    }

    cloneZip(zip) {
        const newZip = new AdmZip();

        zip.getEntries().forEach((entry) => {
            if (!entry.isDirectory) {
                try {
                    newZip.addFile(entry.entryName, entry.getData());
                } catch {
                    // ignorer les entrees trop corrompues
                }
            }
        });

        return newZip;
    }

    async extractTextContent(inputPath, outputPath, extension) {
        let text = "";

        if (extension === ".docx") {
            try {
                const result = await mammoth.extractRawText({ path: inputPath });
                text = result.value;
            } catch {
                text = "Impossible d'extraire le texte complet.";
            }
        } else if (extension === ".xlsx") {
            try {
                const workbook = XLSX.readFile(inputPath, { cellText: true, cellDates: true });
                const firstSheet = workbook.Sheets[workbook.SheetNames[0]];
                text = XLSX.utils.sheet_to_csv(firstSheet);
            } catch {
                text = "Impossible d'extraire les donnees completes.";
            }
        }

        const recoveredPath = outputPath.replace(/\.(docx|xlsx)$/i, "_recovered.txt");
        await fs.writeFile(recoveredPath, Buffer.from(text, "utf8"));
        return recoveredPath;
    }

    repairXML(xmlString) {
        let repaired = xmlString;

        repaired = repaired.replace(/[^\x09\x0A\x0D\x20-\uD7FF\uE000-\uFFFD]/g, "");
        repaired = repaired.replace(/&(?![a-zA-Z]+;|#\d+;)/g, "&amp;");

        const rootMatch = repaired.match(/<([a-zA-Z_][\w:.-]*)[^>]*>/);
        if (rootMatch) {
            const rootTag = rootMatch[1];
            if (!new RegExp(`</${rootTag}>\\s*$`).test(repaired)) {
                repaired += `</${rootTag}>`;
            }
        }

        return repaired;
    }

    findOLEMarkers(data) {
        const markers = [];
        const oleSig = Buffer.from([0xd0, 0xcf, 0x11, 0xe0]);

        for (let i = 0; i < data.length - 4; i++) {
            if (
                data[i] === oleSig[0] &&
                data[i + 1] === oleSig[1] &&
                data[i + 2] === oleSig[2] &&
                data[i + 3] === oleSig[3]
            ) {
                markers.push(i);
            }
        }

        return markers;
    }

    reconstructOLE(data, markers) {
        if (markers.length > 0) {
            return data.slice(markers[0]);
        }

        return data;
    }

    async repairZipHeader(inputPath) {
        const data = await fs.readFile(inputPath);
        const header = Buffer.from([0x50, 0x4b, 0x03, 0x04]);
        const index = data.indexOf(header);
        return index === -1 ? data : data.slice(index);
    }

    async extractTextFromLegacy(inputPath, outputPath, extension) {
        const data = await fs.readFile(inputPath);
        let text = "";
        let currentString = "";

        for (let i = 0; i < data.length; i++) {
            if (data[i] >= 32 && data[i] <= 126) {
                currentString += String.fromCharCode(data[i]);
            } else {
                if (currentString.length > 3) {
                    text += `${currentString}\n`;
                }
                currentString = "";
            }
        }

        if (currentString.length > 3) {
            text += currentString;
        }

        const recoveredPath = outputPath.replace(new RegExp(`${extension.replace(".", "\\.")}$`, "i"), "_recovered.txt");
        await fs.writeFile(recoveredPath, text);
        return recoveredPath;
    }
}

module.exports = new OfficeRepairer();
