const fs = require('fs').promises;
const fscore = require('fs');
const path = require('path');
const crypto = require('crypto');

class Utils {
    /**
     * Génère un ID unique
     */
    generateId() {
        return crypto.randomBytes(16).toString('hex');
    }
    
    /**
     * Formate la taille d'un fichier
     */
    formatFileSize(bytes) {
        if (bytes === 0) return '0 Bytes';
        const k = 1024;
        const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
    }
    
    /**
     * Nettoie les chemins de fichiers
     */
    sanitizePath(filePath) {
        return path.normalize(filePath).replace(/^(\.\.(\/|\\|$))+/, '');
    }
    
    /**
     * Vérifie si un fichier existe
     */
    async fileExists(filePath) {
        try {
            await fs.access(filePath);
            return true;
        } catch {
            return false;
        }
    }
    
    /**
     * Crée un dossier récursivement s'il n'existe pas
     */
    async ensureDir(dirPath) {
        try {
            await fs.mkdir(dirPath, { recursive: true });
        } catch (error) {
            if (error.code !== 'EEXIST') throw error;
        }
    }
    
    /**
     * Extrait l'extension d'un nom de fichier
     */
    getExtension(filename) {
        return path.extname(filename).toLowerCase();
    }
    
    /**
     * Génère un nom de fichier unique
     */
    getUniqueFilename(originalName, outputDir) {
        const ext = this.getExtension(originalName);
        const baseName = path.basename(originalName, ext);
        const timestamp = Date.now();
        const random = Math.round(Math.random() * 10000);
        return `${baseName}_repaired_${timestamp}_${random}${ext}`;
    }
    
    /**
     * Calcule le hash MD5 d'un fichier
     */
    async calculateMD5(filePath) {
        return new Promise((resolve, reject) => {
            const hash = crypto.createHash('md5');
            const stream = fscore.createReadStream(filePath);
            
            stream.on('error', reject);
            stream.on('data', chunk => hash.update(chunk));
            stream.on('end', () => resolve(hash.digest('hex')));
        });
    }
    
    /**
     * Supprime un fichier de manière sécurisée
     */
    async safeDelete(filePath) {
        try {
            if (await this.fileExists(filePath)) {
                await fs.unlink(filePath);
            }
        } catch (error) {
            console.error(`Erreur suppression ${filePath}:`, error);
        }
    }
    
    /**
     * Copie un fichier avec progression
     */
    async copyFileWithProgress(source, destination, onProgress) {
        const stats = await fs.stat(source);
        const totalSize = stats.size;
        let copiedSize = 0;
        
        const readStream = fscore.createReadStream(source);
        const writeStream = fscore.createWriteStream(destination);
        
        return new Promise((resolve, reject) => {
            readStream.on('data', (chunk) => {
                copiedSize += chunk.length;
                if (onProgress) {
                    const progress = (copiedSize / totalSize) * 100;
                    onProgress(progress);
                }
            });
            
            readStream.on('error', reject);
            writeStream.on('error', reject);
            writeStream.on('finish', resolve);
            
            readStream.pipe(writeStream);
        });
    }
    
    /**
     * Lit les N premiers octets d'un fichier
     */
    async readFirstBytes(filePath, bytes = 256) {
        const buffer = Buffer.alloc(bytes);
        const fd = await fs.open(filePath, 'r');
        try {
            const { bytesRead } = await fd.read(buffer, 0, bytes, 0);
            return buffer.slice(0, bytesRead);
        } finally {
            await fd.close();
        }
    }
    
    /**
     * Convertit une chaîne en hexadécimal
     */
    stringToHex(str) {
        return Buffer.from(str, 'utf8').toString('hex');
    }
    
    /**
     * Convertit un buffer en hexadécimal lisible
     */
    bufferToHex(buffer, maxLength = 32) {
        const hex = buffer.toString('hex');
        if (hex.length > maxLength) {
            return hex.substring(0, maxLength) + '...';
        }
        return hex;
    }
    
    /**
     * Délai (promesse)
     */
    delay(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }
    
    /**
     * Retourne un timestamp formaté
     */
    getTimestamp() {
        return new Date().toISOString().replace(/[:.]/g, '-');
    }
    
    /**
     * Extrait le texte d'un buffer binaire
     */
    extractTextFromBinary(buffer, minLength = 4) {
        let text = '';
        let currentString = '';
        
        for (let i = 0; i < buffer.length; i++) {
            // Caractères ASCII imprimables
            if (buffer[i] >= 32 && buffer[i] <= 126) {
                currentString += String.fromCharCode(buffer[i]);
            } else {
                if (currentString.length >= minLength) {
                    text += currentString + '\n';
                }
                currentString = '';
            }
        }
        
        if (currentString.length >= minLength) {
            text += currentString;
        }
        
        return text;
    }
    
    /**
     * Recherche un pattern dans un buffer
     */
    findPattern(buffer, pattern, start = 0) {
        const patternBuffer = Buffer.from(pattern);
        for (let i = start; i <= buffer.length - patternBuffer.length; i++) {
            let found = true;
            for (let j = 0; j < patternBuffer.length; j++) {
                if (buffer[i + j] !== patternBuffer[j]) {
                    found = false;
                    break;
                }
            }
            if (found) return i;
        }
        return -1;
    }
    
    /**
     * Extrait une section d'un buffer entre deux patterns
     */
    extractBetween(buffer, startPattern, endPattern) {
        const start = this.findPattern(buffer, startPattern);
        if (start === -1) return null;
        
        const end = this.findPattern(buffer, endPattern, start + startPattern.length);
        if (end === -1) return null;
        
        return buffer.slice(start, end + endPattern.length);
    }
}

module.exports = new Utils();
