// Signatures magiques et heuristiques de detection
const magicBytes = {
    pdf: { signature: [0x25, 0x50, 0x44, 0x46], offset: 0 },
    jpg: { signature: [0xFF, 0xD8, 0xFF], offset: 0 },
    png: { signature: [0x89, 0x50, 0x4E, 0x47], offset: 0 },
    gif: { signature: [0x47, 0x49, 0x46, 0x38], offset: 0 },
    bmp: { signature: [0x42, 0x4D], offset: 0 },
    tiff_le: { signature: [0x49, 0x49, 0x2A, 0x00], offset: 0 },
    tiff_be: { signature: [0x4D, 0x4D, 0x00, 0x2A], offset: 0 },
    webp: { signature: [0x57, 0x45, 0x42, 0x50], offset: 8 },
    avi: { signature: [0x52, 0x49, 0x46, 0x46], offset: 0 },
    mp4: { signature: [0x66, 0x74, 0x79, 0x70], offset: 4 },
    mov: { signature: [0x66, 0x74, 0x79, 0x70], offset: 4 },
    mkv: { signature: [0x1A, 0x45, 0xDF, 0xA3], offset: 0 },
    zip: { signature: [0x50, 0x4B, 0x03, 0x04], offset: 0 },
    zip_empty: { signature: [0x50, 0x4B, 0x05, 0x06], offset: 0 },
    zip_spanned: { signature: [0x50, 0x4B, 0x07, 0x08], offset: 0 },
    rar: { signature: [0x52, 0x61, 0x72, 0x21], offset: 0 },
    "7z": { signature: [0x37, 0x7A, 0xBC, 0xAF], offset: 0 },
    ole: { signature: [0xD0, 0xCF, 0x11, 0xE0], offset: 0 }
};

const extensionCategories = {
    video: [".mp4", ".avi", ".mov", ".mkv", ".flv", ".wmv", ".m4v", ".3gp"],
    pdf: [".pdf"],
    word: [".doc", ".docx"],
    excel: [".xls", ".xlsx"],
    image: [".jpg", ".jpeg", ".png", ".gif", ".bmp", ".tiff", ".tif", ".webp"],
    archive: [".zip", ".rar", ".7z"],
    document: [".txt", ".csv", ".json", ".xml", ".html", ".htm", ".log", ".md"]
};

function matchesAtOffset(buffer, signature, offset = 0) {
    if (!buffer || offset + signature.length > buffer.length) {
        return false;
    }

    for (let i = 0; i < signature.length; i++) {
        if (buffer[offset + i] !== signature[i]) {
            return false;
        }
    }

    return true;
}

function looksLikeText(buffer) {
    if (!buffer || buffer.length === 0) {
        return false;
    }

    let printable = 0;
    for (const byte of buffer) {
        if (byte === 0) {
            return false;
        }

        if (
            byte === 0x09 ||
            byte === 0x0A ||
            byte === 0x0D ||
            (byte >= 0x20 && byte <= 0x7E)
        ) {
            printable++;
        }
    }

    return printable / buffer.length > 0.85;
}

function detectZipFamily(buffer) {
    if (
        matchesAtOffset(buffer, magicBytes.zip.signature, magicBytes.zip.offset) ||
        matchesAtOffset(buffer, magicBytes.zip_empty.signature, magicBytes.zip_empty.offset) ||
        matchesAtOffset(buffer, magicBytes.zip_spanned.signature, magicBytes.zip_spanned.offset)
    ) {
        const headerText = buffer.toString("utf8", 0, Math.min(buffer.length, 256));

        if (headerText.includes("word/")) return "docx";
        if (headerText.includes("xl/")) return "xlsx";
        return "zip";
    }

    return null;
}

function detectFileType(buffer) {
    const zipType = detectZipFamily(buffer);
    if (zipType) {
        return zipType;
    }

    if (matchesAtOffset(buffer, magicBytes.ole.signature, magicBytes.ole.offset)) {
        return "doc";
    }

    if (matchesAtOffset(buffer, magicBytes.pdf.signature, magicBytes.pdf.offset)) return "pdf";
    if (matchesAtOffset(buffer, magicBytes.jpg.signature, magicBytes.jpg.offset)) return "jpg";
    if (matchesAtOffset(buffer, magicBytes.png.signature, magicBytes.png.offset)) return "png";
    if (matchesAtOffset(buffer, magicBytes.gif.signature, magicBytes.gif.offset)) return "gif";
    if (matchesAtOffset(buffer, magicBytes.bmp.signature, magicBytes.bmp.offset)) return "bmp";
    if (matchesAtOffset(buffer, magicBytes.tiff_le.signature, magicBytes.tiff_le.offset)) return "tiff";
    if (matchesAtOffset(buffer, magicBytes.tiff_be.signature, magicBytes.tiff_be.offset)) return "tiff";
    if (matchesAtOffset(buffer, magicBytes.webp.signature, magicBytes.webp.offset)) return "webp";
    if (matchesAtOffset(buffer, magicBytes.mkv.signature, magicBytes.mkv.offset)) return "mkv";
    if (matchesAtOffset(buffer, magicBytes.rar.signature, magicBytes.rar.offset)) return "rar";
    if (matchesAtOffset(buffer, magicBytes["7z"].signature, magicBytes["7z"].offset)) return "7z";

    if (matchesAtOffset(buffer, magicBytes.avi.signature, magicBytes.avi.offset)) {
        const riffType = buffer.toString("ascii", 8, 12);
        if (riffType === "AVI ") return "avi";
        if (riffType === "WEBP") return "webp";
    }

    if (matchesAtOffset(buffer, magicBytes.mp4.signature, magicBytes.mp4.offset)) {
        const brand = buffer.toString("ascii", 8, 12).toLowerCase();
        if (brand.includes("qt")) return "mov";
        return "mp4";
    }

    if (looksLikeText(buffer)) return "text";

    return "unknown";
}

function getCategoryFromExtension(extension) {
    const normalizedExtension = extension.toLowerCase();

    for (const [category, extensions] of Object.entries(extensionCategories)) {
        if (extensions.includes(normalizedExtension)) {
            return category;
        }
    }

    return "unknown";
}

function getCategoryFromDetectedType(detectedType) {
    const typeToCategory = {
        mp4: "video",
        avi: "video",
        mov: "video",
        mkv: "video",
        pdf: "pdf",
        doc: "word",
        docx: "word",
        xls: "excel",
        xlsx: "excel",
        jpg: "image",
        png: "image",
        gif: "image",
        bmp: "image",
        tiff: "image",
        webp: "image",
        zip: "archive",
        rar: "archive",
        "7z": "archive",
        text: "document"
    };

    return typeToCategory[detectedType] || "unknown";
}

module.exports = {
    magicBytes,
    detectFileType,
    getCategoryFromExtension,
    getCategoryFromDetectedType,
    looksLikeText
};
