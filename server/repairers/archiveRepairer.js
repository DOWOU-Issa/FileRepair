const fs = require("fs").promises;
const path = require("path");
const AdmZip = require("adm-zip");

class ArchiveRepairer {
    async repair(inputPath, outputPath, onProgress) {
        const extension = path.extname(inputPath).toLowerCase();

        onProgress(20, `Analyse de l'archive ${extension}...`);

        if (extension === ".zip") {
            return this.repairZip(inputPath, outputPath, onProgress);
        }

        if (extension === ".rar" || extension === ".7z") {
            return this.salvageBinaryArchive(inputPath, outputPath, onProgress, extension);
        }

        throw new Error(`Format d'archive non supporte: ${extension}`);
    }

    async repairZip(inputPath, outputPath, onProgress) {
        try {
            const data = await fs.readFile(inputPath);

            onProgress(42, "Recherche de la structure ZIP...");
            const entries = this.findZipEntries(data);
            onProgress(58, `${entries.length} entrees trouvees`);

            if (entries.length === 0) {
                throw new Error("Aucune entree ZIP valide trouvee");
            }

            const newZip = new AdmZip();
            for (const entry of entries) {
                if (!entry.name || entry.name.endsWith("/")) {
                    continue;
                }

                try {
                    newZip.addFile(entry.name, entry.data);
                } catch (error) {
                    console.error(`Erreur ajout fichier ${entry.name}:`, error);
                }
            }

            onProgress(88, "Sauvegarde de l'archive reparee...");
            newZip.writeZip(outputPath);

            onProgress(100, "Archive reparee avec succes !");
            return { success: true, path: outputPath };
        } catch {
            await this.extractZipContents(inputPath, outputPath, onProgress);
            onProgress(100, "Archive partiellement reconstruite");
            return { success: true, path: outputPath, partial: true };
        }
    }

    async salvageBinaryArchive(inputPath, outputPath, onProgress, extension) {
        const data = await fs.readFile(inputPath);
        const signatures = {
            ".rar": Buffer.from("Rar!"),
            ".7z": Buffer.from([0x37, 0x7a, 0xbc, 0xaf, 0x27, 0x1c])
        };

        const signature = signatures[extension];
        const start = data.indexOf(signature);
        let end = data.length;

        while (end > 0 && data[end - 1] === 0x00) {
            end--;
        }

        if (start === -1 || end <= start) {
            throw new Error(`Impossible de recuperer l'archive ${extension}`);
        }

        onProgress(80, "Reconstruction binaire de l'archive...");
        await fs.writeFile(outputPath, data.slice(start, end));
        onProgress(100, "Archive sauvegardee");
        return { success: true, path: outputPath, fallback: true };
    }

    findZipEntries(data) {
        const entries = [];
        const localHeader = Buffer.from([0x50, 0x4b, 0x03, 0x04]);
        let cursor = 0;

        while (cursor < data.length - 30) {
            const index = data.indexOf(localHeader, cursor);
            if (index === -1) break;

            const fileNameLength = data.readUInt16LE(index + 26);
            const extraFieldLength = data.readUInt16LE(index + 28);
            const compressedSize = data.readUInt32LE(index + 18);

            const nameStart = index + 30;
            const nameEnd = nameStart + fileNameLength;
            const dataStart = nameEnd + extraFieldLength;
            const dataEnd = dataStart + compressedSize;

            if (nameEnd <= data.length && dataEnd <= data.length) {
                const name = data.slice(nameStart, nameEnd).toString("utf8");
                const fileData = data.slice(dataStart, dataEnd);

                if (name && !name.includes("..")) {
                    entries.push({ name, data: fileData, offset: index });
                }
            }

            cursor = index + 4;
        }

        return entries;
    }

    async extractZipContents(inputPath, outputPath, onProgress) {
        const data = await fs.readFile(inputPath);
        const entries = this.findZipEntries(data);

        if (entries.length === 0) {
            throw new Error("Extraction impossible");
        }

        const extractDir = outputPath.replace(/\.zip$/i, "_extracted");
        await fs.mkdir(extractDir, { recursive: true });

        for (let i = 0; i < entries.length; i++) {
            const entry = entries[i];
            const filePath = path.join(extractDir, entry.name);
            const fileDir = path.dirname(filePath);

            await fs.mkdir(fileDir, { recursive: true });
            await fs.writeFile(filePath, entry.data);

            onProgress(45 + Math.floor((i / entries.length) * 35), `Extraction: ${entry.name}`);
        }

        const newZip = new AdmZip();
        await this.addDirectoryToZip(newZip, extractDir);
        newZip.writeZip(outputPath);

        await fs.rm(extractDir, { recursive: true, force: true });
    }

    async addDirectoryToZip(zip, dirPath, basePath = "") {
        const entries = await fs.readdir(dirPath, { withFileTypes: true });

        for (const entry of entries) {
            const fullPath = path.join(dirPath, entry.name);
            const zipPath = path.join(basePath, entry.name);

            if (entry.isDirectory()) {
                await this.addDirectoryToZip(zip, fullPath, zipPath);
            } else {
                const data = await fs.readFile(fullPath);
                zip.addFile(zipPath, data);
            }
        }
    }
}

module.exports = new ArchiveRepairer();
