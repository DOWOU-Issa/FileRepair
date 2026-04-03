const { execFile } = require("child_process");
const config = require("../config");

class VideoRepairer {
    async repair(inputPath, outputPath, onProgress) {
        return new Promise((resolve, reject) => {
            onProgress(10, "Verification de FFmpeg...");

            execFile(config.ffmpegPath, ["-version"], (error) => {
                if (error) {
                    onProgress(0, "FFmpeg non installe ou chemin incorrect");
                    reject(new Error("FFmpeg non trouve"));
                    return;
                }

                onProgress(20, "Analyse de la video...");

                const args = [
                    "-y",
                    "-i", inputPath,
                    "-c", "copy",
                    "-movflags", "faststart",
                    "-err_detect", "ignore_err",
                    outputPath
                ];

                const ffmpeg = execFile(config.ffmpegPath, args);
                let progress = 20;

                ffmpeg.stderr.on("data", (data) => {
                    const output = data.toString();
                    const timeMatch = output.match(/time=(\d{2}):(\d{2}):(\d{2})/);

                    if (timeMatch && progress < 88) {
                        progress = Math.min(88, progress + 2);
                        onProgress(progress, `Reparation video... ${progress}%`);
                    }

                    if (output.includes("moov atom not found")) {
                        onProgress(32, "Atom moov manquant, tentative de reparation...");
                    }
                });

                ffmpeg.on("close", async (code) => {
                    if (code === 0) {
                        onProgress(100, "Video reparee avec succes !");
                        resolve({ success: true, path: outputPath });
                        return;
                    }

                    try {
                        onProgress(40, "Premiere tentative echouee, re-encodage...");
                        await this.reencodeVideo(inputPath, outputPath, onProgress);
                        resolve({ success: true, path: outputPath, fallback: true });
                    } catch (error) {
                        onProgress(0, "Echec de la reparation video");
                        reject(error);
                    }
                });
            });
        });
    }

    async reencodeVideo(inputPath, outputPath, onProgress) {
        return new Promise((resolve, reject) => {
            const args = [
                "-y",
                "-i", inputPath,
                "-c:v", "libx264",
                "-c:a", "aac",
                "-preset", "fast",
                "-crf", "23",
                "-movflags", "faststart",
                "-err_detect", "ignore_err",
                outputPath
            ];

            const ffmpeg = execFile(config.ffmpegPath, args);
            let progress = 40;

            ffmpeg.stderr.on("data", (data) => {
                const output = data.toString();
                const timeMatch = output.match(/time=(\d{2}):(\d{2}):(\d{2})/);

                if (timeMatch && progress < 95) {
                    progress = Math.min(95, progress + 1);
                    onProgress(progress, `Re-encodage video... ${progress}%`);
                }
            });

            ffmpeg.on("close", (code) => {
                if (code === 0) {
                    onProgress(100, "Video reparee avec succes !");
                    resolve();
                } else {
                    reject(new Error("Echec du re-encodage video"));
                }
            });
        });
    }
}

module.exports = new VideoRepairer();
