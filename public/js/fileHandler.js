class FileHandler {
    constructor() {
        this.uploadQueue = [];
        this.currentUpload = null;
    }
    
    async uploadFile(file, onProgress) {
        const formData = new FormData();
        formData.append('file', file);
        
        return new Promise((resolve, reject) => {
            const xhr = new XMLHttpRequest();
            
            xhr.upload.addEventListener('progress', (e) => {
                if (e.lengthComputable && onProgress) {
                    const percent = (e.loaded / e.total) * 100;
                    onProgress(percent);
                }
            });
            
            xhr.addEventListener('load', () => {
                if (xhr.status === 200) {
                    try {
                        const response = JSON.parse(xhr.responseText);
                        resolve(response);
                    } catch (error) {
                        reject(new Error('Réponse invalide du serveur'));
                    }
                } else {
                    reject(new Error(`Erreur upload: ${xhr.status}`));
                }
            });
            
            xhr.addEventListener('error', () => {
                reject(new Error('Erreur de connexion'));
            });
            
            xhr.open('POST', '/api/upload');
            xhr.send(formData);
        });
    }
    
    async downloadFile(filename) {
        window.location.href = `/api/download/${filename}`;
    }
    
    formatFileSize(bytes) {
        if (bytes === 0) return '0 Bytes';
        const k = 1024;
        const sizes = ['Bytes', 'KB', 'MB', 'GB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
    }
    
    getFileType(extension) {
        const types = {
            'mp4': 'video', 'avi': 'video', 'mov': 'video', 'mkv': 'video',
            'pdf': 'pdf',
            'doc': 'word', 'docx': 'word',
            'xls': 'excel', 'xlsx': 'excel',
            'jpg': 'image', 'jpeg': 'image', 'png': 'image', 'gif': 'image',
            'zip': 'archive', 'rar': 'archive', '7z': 'archive'
        };
        return types[extension.toLowerCase()] || 'unknown';
    }
}

const fileHandler = new FileHandler();