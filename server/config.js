const path = require('path');
const dotenv = require('dotenv');

dotenv.config();

module.exports = {
    // Chemins
    uploadDir: path.join(__dirname, '../uploads'),
    repairedDir: path.join(__dirname, '../repaired'),
    logsDir: path.join(__dirname, '../logs'),
    tempDir: path.join(__dirname, '../temp'),
    
    // FFmpeg pour vidéos
    ffmpegPath: process.env.FFMPEG_PATH || 'ffmpeg',
    ffprobePath: process.env.FFPROBE_PATH || 'ffprobe',
    
    // Limites
    maxFileSize: 5 * 1024 * 1024 * 1024, // 5GB
    maxConcurrentRepairs: 3,
    
    // Types de fichiers supportés
    supportedTypes: {
        video: ['.mp4', '.avi', '.mov', '.mkv', '.flv', '.wmv', '.m4v', '.3gp'],
        pdf: ['.pdf'],
        word: ['.doc', '.docx'],
        excel: ['.xls', '.xlsx'],
        image: ['.jpg', '.jpeg', '.png', '.gif', '.bmp', '.tiff', '.tif', '.webp'],
        archive: ['.zip', '.rar', '.7z'],
        document: ['.txt', '.csv', '.json', '.xml', '.html', '.htm', '.log', '.md']
    },
    
    // Stratégies de réparation par type
    repairStrategies: {
        video: ['copy', 'reencode', 'fixmoov', 'repairindex'],
        pdf: ['repair', 'reconstruct', 'extract'],
        office: ['repair', 'recover', 'extract'],
        image: ['fixheader', 'reconstruct', 'convert'],
        archive: ['rebuild', 'extract'],
        document: ['sanitize', 'rebuild', 'recover']
    },
    
    // Serveur
    port: process.env.PORT || 8080,
    host: 'localhost'
};
