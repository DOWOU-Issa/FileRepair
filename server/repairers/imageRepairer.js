const fs = require("fs").promises;
const path = require("path");
const sharp = require("sharp");

class ImageRepairer {
    async repair(inputPath, outputPath, onProgress) {
        try {
            onProgress(20, "Analyse de l'image...");

            const extension = path.extname(inputPath).toLowerCase();
            let buffer = await fs.readFile(inputPath);

            onProgress(45, "Tentative de reconstruction...");

            let repairedBuffer;

            switch (extension) {
                case ".jpg":
                case ".jpeg":
                    repairedBuffer = await this.repairJPEG(buffer);
                    break;
                case ".png":
                    repairedBuffer = await this.repairPNG(buffer);
                    break;
                case ".gif":
                    repairedBuffer = await this.repairGIF(buffer);
                    break;
                case ".bmp":
                case ".tif":
                case ".tiff":
                case ".webp":
                    repairedBuffer = await this.repairWithSharp(buffer, extension);
                    break;
                default:
                    repairedBuffer = await this.repairGeneric(buffer);
                    break;
            }

            onProgress(82, "Sauvegarde de l'image reparee...");
            await fs.writeFile(outputPath, repairedBuffer);

            onProgress(100, "Image reparee avec succes !");
            return { success: true, path: outputPath };
        } catch (error) {
            onProgress(0, `Erreur: ${error.message}`);
            throw error;
        }
    }

    async repairJPEG(buffer) {
        if (buffer[0] !== 0xff || buffer[1] !== 0xd8) {
            const soiIndex = this.findMarker(buffer, Buffer.from([0xff, 0xd8]));
            buffer = soiIndex !== -1 ? buffer.slice(soiIndex) : Buffer.concat([Buffer.from([0xff, 0xd8]), buffer]);
        }

        if (buffer[buffer.length - 2] !== 0xff || buffer[buffer.length - 1] !== 0xd9) {
            buffer = Buffer.concat([buffer, Buffer.from([0xff, 0xd9])]);
        }

        return this.repairWithSharp(buffer, ".jpg");
    }

    async repairPNG(buffer) {
        const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

        if (!buffer.slice(0, 8).equals(signature)) {
            const sigIndex = this.findMarker(buffer, signature);
            buffer = sigIndex !== -1 ? buffer.slice(sigIndex) : Buffer.concat([signature, buffer]);
        }

        return this.repairWithSharp(buffer, ".png");
    }

    async repairGIF(buffer) {
        const gif87a = Buffer.from("GIF87a");
        const gif89a = Buffer.from("GIF89a");

        const index87a = this.findMarker(buffer, gif87a);
        const index89a = this.findMarker(buffer, gif89a);
        const bestIndex = [index87a, index89a].filter((index) => index !== -1).sort((a, b) => a - b)[0];

        if (bestIndex !== undefined) {
            buffer = buffer.slice(bestIndex);
        } else {
            buffer = Buffer.concat([gif89a, buffer]);
        }

        return this.repairWithSharp(buffer, ".gif");
    }

    async repairWithSharp(buffer, extension) {
        try {
            const image = sharp(buffer, { failOn: "none" });
            await image.metadata();

            switch (extension) {
                case ".png":
                    return image.png().toBuffer();
                case ".gif":
                    return image.gif().toBuffer();
                case ".webp":
                    return image.webp().toBuffer();
                case ".bmp":
                    return image.bmp().toBuffer();
                case ".tif":
                case ".tiff":
                    return image.tiff().toBuffer();
                default:
                    return image.jpeg().toBuffer();
            }
        } catch {
            return this.repairGeneric(buffer);
        }
    }

    async repairGeneric(buffer) {
        const cropped = this.cropToKnownSignature(buffer);
        const image = sharp(cropped, { failOn: "none" });
        const metadata = await image.metadata();

        switch (metadata.format) {
            case "png":
                return image.png().toBuffer();
            case "gif":
                return image.gif().toBuffer();
            case "webp":
                return image.webp().toBuffer();
            case "tiff":
                return image.tiff().toBuffer();
            case "bmp":
                return image.bmp().toBuffer();
            default:
                return image.jpeg().toBuffer();
        }
    }

    cropToKnownSignature(buffer) {
        const signatures = [
            Buffer.from([0xff, 0xd8, 0xff]),
            Buffer.from([0x89, 0x50, 0x4e, 0x47]),
            Buffer.from("GIF8"),
            Buffer.from("BM")
        ];

        const indexes = signatures
            .map((signature) => this.findMarker(buffer, signature))
            .filter((index) => index !== -1)
            .sort((a, b) => a - b);

        if (indexes.length === 0) {
            return buffer;
        }

        return buffer.slice(indexes[0]);
    }

    findMarker(buffer, marker) {
        return buffer.indexOf(marker);
    }
}

module.exports = new ImageRepairer();
