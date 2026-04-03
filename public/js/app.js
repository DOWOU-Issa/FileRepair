class RepairApp {
    constructor() {
        this.activeRepairs = new Map();
        this.init();
    }

    init() {
        this.uploadArea = document.getElementById("uploadArea");
        this.fileInput = document.getElementById("fileInput");
        this.queue = document.getElementById("queue");
        this.repairAllBtn = document.getElementById("repairAllBtn");
        this.analyzeAllBtn = document.getElementById("analyzeAllBtn");
        this.refreshStatsBtn = document.getElementById("refreshStatsBtn");
        this.queueStats = document.getElementById("queueStats");
        this.dashboardCharts = document.getElementById("dashboardCharts");
        this.dashboardTypes = document.getElementById("dashboardTypes");
        this.historyList = document.getElementById("historyList");
        this.historySearch = document.getElementById("historySearch");
        this.historyKind = document.getElementById("historyKind");
        this.historyStatus = document.getElementById("historyStatus");
        this.historyFilterTimeout = null;

        if (!this.uploadArea || !this.fileInput || !this.queue) {
            console.error("Elements DOM manquants");
            return;
        }

        this.setupEventListeners();
        this.setupWebSocket();
        this.refreshToolbarState();
        this.refreshSidebarData();
        this.startSidebarPolling();
    }

    setupEventListeners() {
        this.uploadArea.addEventListener("click", () => {
            this.fileInput.click();
        });

        this.uploadArea.addEventListener("dragover", (event) => {
            event.preventDefault();
            this.uploadArea.classList.add("drag-over");
        });

        this.uploadArea.addEventListener("dragleave", () => {
            this.uploadArea.classList.remove("drag-over");
        });

        this.uploadArea.addEventListener("drop", (event) => {
            event.preventDefault();
            this.uploadArea.classList.remove("drag-over");
            Array.from(event.dataTransfer.files).forEach((file) => this.addToQueue(file));
        });

        this.fileInput.addEventListener("change", (event) => {
            Array.from(event.target.files).forEach((file) => this.addToQueue(file));
            this.fileInput.value = "";
        });

        if (this.repairAllBtn) {
            this.repairAllBtn.addEventListener("click", () => {
                this.repairAll();
            });
        }

        if (this.analyzeAllBtn) {
            this.analyzeAllBtn.addEventListener("click", () => {
                this.reanalyzeAll();
            });
        }

        if (this.refreshStatsBtn) {
            this.refreshStatsBtn.addEventListener("click", () => {
                this.refreshSidebarData();
            });
        }

        if (this.historySearch) {
            this.historySearch.addEventListener("input", () => {
                window.clearTimeout(this.historyFilterTimeout);
                this.historyFilterTimeout = window.setTimeout(() => this.refreshSidebarData(), 250);
            });
        }

        if (this.historyKind) {
            this.historyKind.addEventListener("change", () => this.refreshSidebarData());
        }

        if (this.historyStatus) {
            this.historyStatus.addEventListener("change", () => this.refreshSidebarData());
        }
    }

    setupWebSocket() {
        window.wsClient.on("connect", () => {
            console.log("WebSocket connecte");
        });

        window.wsClient.on("progress", (fileName, progress, status, payload) => {
            const targetId = this.resolveRepairTargetId(fileName, payload);
            if (!targetId) return;

            const repair = this.activeRepairs.get(targetId);
            if (repair && repair.status !== "completed") {
                repair.status = "repairing";
                if (payload?.repairId) {
                    repair.wsRepairId = payload.repairId;
                }
            }

            const visualProgress = this.normalizeRepairProgress(targetId, progress, status);
            this.updateProgress(targetId, visualProgress, status);
            this.updateStageBadge(targetId);

            if (payload?.queue) {
                this.renderQueueStats(payload.queue);
            }
        });

        window.wsClient.on("queued", (fileName, payload) => {
            const targetId = this.resolveRepairTargetId(fileName, payload);
            if (!targetId) return;

            const repair = this.activeRepairs.get(targetId);
            if (repair && repair.status !== "completed") {
                repair.status = "repairing";
                repair.wsRepairId = payload?.repairId || null;
            }

            this.updateProgress(targetId, 10, "Preparation de la reparation...");
            this.updateStatus(targetId, "Preparation de la reparation...");
            if (payload.queue) {
                this.renderQueueStats(payload.queue);
            }
        });

        window.wsClient.on("complete", (fileName, outputFile, payload) => {
            this.markComplete(fileName, outputFile, payload);
        });

        window.wsClient.on("error", (error) => {
            this.showNotification(`Erreur: ${error.message}`, "error");
        });

        window.wsClient.connect();
    }

    async addToQueue(file) {
        const localId = `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
        const fileType = this.getFileType(this.getExtension(file.name));
        const card = this.createCard(localId, file, fileType);
        this.queue.prepend(card);

        this.activeRepairs.set(localId, {
            id: localId,
            file,
            fileName: file.name,
            fileType,
            status: "queued",
            card,
            analysis: null,
            uploadedFileId: null,
            wsRepairId: null,
            progressPoller: null,
            outputFile: null,
            comparison: null,
            repairedAnalysis: null
        });

        try {
            this.setCardBusy(localId, true);
            this.updateStatus(localId, "Upload du fichier...");
            this.updateProgress(localId, 8, "Upload en cours...");

            const uploadResult = await this.uploadFile(file, (progress) => {
                this.updateProgress(localId, Math.max(5, Math.round(progress * 0.35)), `Upload: ${Math.floor(progress)}%`);
            });

            const repair = this.activeRepairs.get(localId);
            if (!repair) return;

            repair.uploadedFileId = uploadResult.fileId;
            repair.status = "uploaded";

            this.updateStatus(localId, "Analyse technique en cours...");
            this.updateProgress(localId, 42, "Analyse du fichier...");

            const analysisResult = await this.analyzeFile(uploadResult.fileId, file.name);
            repair.analysis = analysisResult;
            repair.status = "analyzed";

            this.renderAnalysis(localId, analysisResult);
            this.updateProgress(localId, 100, "Analyse terminee. Pret pour la reparation.");
            this.updateStatus(localId, "Rapport disponible. Tu peux lancer la reparation.");
            this.updateStageBadge(localId);
            this.renderActions(localId);
            this.refreshToolbarState();
            this.showNotification(`${file.name} analyse avec succes`, "success");
            this.refreshSidebarData();
        } catch (error) {
            this.updateProgress(localId, 0, "Analyse impossible");
            this.updateStatus(localId, `Erreur: ${error.message}`, true);
            this.showNotification(`Erreur: ${error.message}`, "error");
        } finally {
            this.setCardBusy(localId, false);
            this.refreshToolbarState();
        }
    }

    async analyzeFile(fileId, fileName) {
        const response = await fetch("/api/analyze", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ fileId, fileName })
        });

        const payload = await response.json();
        if (!response.ok) {
            throw new Error(payload.error || "Analyse impossible");
        }

        return payload;
    }

    async refreshSidebarData() {
        try {
            const historyQuery = new URLSearchParams({
                limit: "8",
                q: this.historySearch?.value || "",
                kind: this.historyKind?.value || "",
                status: this.historyStatus?.value || ""
            });

            const [dashboardResponse, historyResponse] = await Promise.all([
                fetch("/api/dashboard"),
                fetch(`/api/history?${historyQuery.toString()}`)
            ]);

            const dashboard = await dashboardResponse.json();
            const history = await historyResponse.json();

            if (dashboard.queue) {
                this.renderQueueStats(dashboard.queue, dashboard.totals);
            }
            this.renderDashboardCharts(dashboard);
            this.renderDashboardTypes(dashboard.byType || []);
            this.renderHistory(history.items || []);
        } catch (error) {
            console.error("Erreur rafraichissement sidebar:", error);
        }
    }

    startSidebarPolling() {
        this.sidebarInterval = window.setInterval(() => {
            this.refreshSidebarData();
        }, 7000);
    }

    async startRepair(localId) {
        const repair = this.activeRepairs.get(localId);
        if (!repair || !repair.uploadedFileId) {
            return;
        }

        try {
            this.setCardBusy(localId, true);
            repair.status = "repairing";
            repair.wsRepairId = null;
            this.updateProgress(localId, 12, "Reparation en cours...");
            this.updateStatus(localId, "Reparation en cours...");
            this.updateStageBadge(localId);
            this.renderActions(localId);
            this.refreshToolbarState();
            const repairRequest = await this.requestRepair(repair.uploadedFileId, repair.fileName);
            repair.wsRepairId = repairRequest.repairId;

            if (repairRequest.queue) {
                this.renderQueueStats(repairRequest.queue);
            }

            this.startRepairPolling(localId, repairRequest.repairId);
        } catch (error) {
            this.updateStatus(localId, `Erreur: ${error.message}`, true);
            this.showNotification(`Erreur: ${error.message}`, "error");
            this.setCardBusy(localId, false);
            repair.status = "analyzed";
            this.renderActions(localId);
            this.refreshToolbarState();
        }
    }

    async repairAll() {
        const candidates = [...this.activeRepairs.entries()]
            .filter(([, repair]) => repair.uploadedFileId && repair.status !== "repairing" && !repair.outputFile);

        for (const [localId] of candidates) {
            await this.startRepair(localId);
        }
    }

    async reanalyzeAll() {
        const candidates = [...this.activeRepairs.entries()]
            .filter(([, repair]) => repair.uploadedFileId && repair.status !== "repairing");

        for (const [localId] of candidates) {
            await this.refreshAnalysis(localId);
        }
    }

    async uploadFile(file, onProgress) {
        const formData = new FormData();
        formData.append("file", file);

        return new Promise((resolve, reject) => {
            const xhr = new XMLHttpRequest();

            xhr.upload.addEventListener("progress", (event) => {
                if (event.lengthComputable && onProgress) {
                    onProgress((event.loaded / event.total) * 100);
                }
            });

            xhr.addEventListener("load", () => {
                if (xhr.status === 200) {
                    try {
                        resolve(JSON.parse(xhr.responseText));
                    } catch {
                        reject(new Error("Reponse invalide"));
                    }
                    return;
                }

                try {
                    const payload = JSON.parse(xhr.responseText);
                    reject(new Error(payload.error || `Erreur HTTP: ${xhr.status}`));
                } catch {
                    reject(new Error(`Erreur HTTP: ${xhr.status}`));
                }
            });

            xhr.addEventListener("error", () => {
                reject(new Error("Erreur de connexion"));
            });

            xhr.open("POST", "/api/upload");
            xhr.send(formData);
        });
    }

    async requestRepair(fileId, fileName) {
        const response = await fetch("/api/repair", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ fileId, fileName })
        });

        const payload = await response.json();
        if (!response.ok) {
            throw new Error(payload.error || "Reparation impossible");
        }

        return payload;
    }

    startRepairPolling(localId, repairId) {
        const repair = this.activeRepairs.get(localId);
        if (!repair) return;

        this.stopRepairPolling(localId);

        const poll = async () => {
            const currentRepair = this.activeRepairs.get(localId);
            if (!currentRepair || currentRepair.wsRepairId !== repairId) {
                this.stopRepairPolling(localId);
                return;
            }

            try {
                const response = await fetch(`/api/progress/${repairId}`);
                const payload = await response.json();

                if (payload.queue) {
                    this.renderQueueStats(payload.queue);
                }

                if (payload.error || /^Erreur/i.test(payload.status || "")) {
                    this.stopRepairPolling(localId);
                    currentRepair.status = "analyzed";
                    this.setCardBusy(localId, false);
                    this.updateProgress(localId, Math.max(12, payload.progress || 0), payload.status || "Erreur de reparation");
                    this.updateStatus(localId, payload.status || "Erreur de reparation", true);
                    this.renderActions(localId);
                    this.refreshToolbarState();
                    this.showNotification(payload.error || payload.status || "Erreur de reparation", "error");
                    return;
                }

                if (payload.outputFile || payload.repairedFile || payload.progress >= 100) {
                    this.stopRepairPolling(localId);
                    this.markComplete(currentRepair.fileName, payload.outputFile || payload.repairedFile, payload);
                    return;
                }

                currentRepair.status = "repairing";
                const visualProgress = this.normalizeRepairProgress(localId, payload.progress, payload.status);
                this.updateProgress(localId, visualProgress, payload.status || "Reparation en cours...");
                this.updateStageBadge(localId);
            } catch (error) {
                this.stopRepairPolling(localId);
                currentRepair.status = "analyzed";
                this.setCardBusy(localId, false);
                this.updateStatus(localId, `Erreur: ${error.message}`, true);
                this.renderActions(localId);
                this.refreshToolbarState();
                this.showNotification(`Erreur: ${error.message}`, "error");
            }
        };

        repair.progressPoller = window.setInterval(poll, 900);
        poll();
    }

    stopRepairPolling(localId) {
        const repair = this.activeRepairs.get(localId);
        if (!repair?.progressPoller) return;

        window.clearInterval(repair.progressPoller);
        repair.progressPoller = null;
    }

    createCard(id, file, fileType) {
        const card = document.createElement("article");
        card.className = "repair-card";
        card.id = `repair-${id}`;

        card.innerHTML = `
            <div class="repair-header">
                <div>
                    <div class="file-name">${this.escapeHtml(file.name)}</div>
                    <div class="file-meta">
                        <span>${this.formatFileSize(file.size)}</span>
                        <span>${this.getFileTypeLabel(fileType)}</span>
                    </div>
                </div>
                <div class="header-badges">
                    <span class="file-type type-${fileType}">${this.getTypeChipLabel(fileType)}</span>
                    <span class="stage-badge" id="stage-${id}">En attente</span>
                </div>
            </div>

            <div class="progress-container">
                <div class="progress-bar">
                    <div class="progress-fill" id="progress-${id}" style="width: 0%"></div>
                </div>
                <div class="progress-percent" id="percent-${id}">0%</div>
            </div>

            <div class="status" id="status-${id}">En attente de traitement...</div>
            <div class="analysis-panel" id="analysis-${id}"></div>
            <div class="repair-actions" id="actions-${id}"></div>
        `;

        return card;
    }

    renderQueueStats(queue, totals = null) {
        if (!this.queueStats) return;

        const stats = [
            { label: "En cours", value: queue.running ?? 0 },
            { label: "En attente", value: queue.pending ?? 0 },
            { label: "Concurrence", value: queue.concurrency ?? 0 },
            { label: "Reussite globale", value: totals ? `${totals.globalSuccessRate}%` : "-" }
        ];

        this.queueStats.innerHTML = stats.map((stat) => `
            <div class="dashboard-stat">
                <span class="dashboard-stat-label">${this.escapeHtml(stat.label)}</span>
                <span class="dashboard-stat-value">${this.escapeHtml(String(stat.value))}</span>
            </div>
        `).join("");
    }

    renderDashboardCharts(dashboard) {
        if (!this.dashboardCharts) return;

        const totals = dashboard.totals || {};
        const successCount = totals.successfulRepairs || 0;
        const failedCount = totals.failedRepairs || 0;
        const totalRepairs = Math.max(1, (totals.repairs || 0));
        const successWidth = `${(successCount / totalRepairs) * 100}%`;
        const failedWidth = `${(failedCount / totalRepairs) * 100}%`;
        const topTypes = (dashboard.byType || []).slice(0, 4);

        const typeBars = topTypes.length
            ? topTypes.map((item) => `
                <div class="dashboard-row">
                    <div class="dashboard-row-top">
                        <strong>${this.escapeHtml(this.getTypeChipLabel(item.type))}</strong>
                        <span>${this.escapeHtml(String(item.successRate))}%</span>
                    </div>
                    <div class="dashboard-meter">
                        <div class="dashboard-meter-track">
                            <div class="dashboard-meter-fill" style="width:${Math.max(4, item.successRate)}%"></div>
                        </div>
                    </div>
                </div>
            `).join("")
            : `<p class="empty-state">Les graphes apparaitront apres quelques reparations.</p>`;

        this.dashboardCharts.innerHTML = `
            <div class="chart-card">
                <h4>Succes vs echecs</h4>
                <div class="chart-bar-track">
                    <div class="chart-bar-segment chart-success" style="width:${successWidth}"></div>
                    <div class="chart-bar-segment chart-failed" style="width:${failedWidth}"></div>
                </div>
                <div class="chart-label-row">
                    <span>${this.escapeHtml(String(successCount))} succes</span>
                    <span>${this.escapeHtml(String(failedCount))} echecs</span>
                </div>
            </div>
            <div class="chart-card">
                <h4>Top types les plus fiables</h4>
                ${typeBars}
            </div>
        `;
    }

    renderDashboardTypes(items) {
        if (!this.dashboardTypes) return;

        if (!items.length) {
            this.dashboardTypes.innerHTML = `<p class="empty-state">Pas encore assez de donnees pour calculer les taux de reussite.</p>`;
            return;
        }

        this.dashboardTypes.innerHTML = items.map((item) => `
            <div class="dashboard-row">
                <div class="dashboard-row-top">
                    <strong>${this.escapeHtml(this.getTypeChipLabel(item.type))}</strong>
                    <span>${this.escapeHtml(String(item.successRate))}%</span>
                </div>
                <p>${this.escapeHtml(String(item.success))} succes / ${this.escapeHtml(String(item.total))} reparation(s)</p>
                <p>Problemes corriges en moyenne: ${this.escapeHtml(String(item.avgIssuesFixed))}</p>
                <div class="dashboard-meter">
                    <div class="dashboard-meter-track">
                        <div class="dashboard-meter-fill" style="width:${Math.max(4, item.successRate)}%"></div>
                    </div>
                </div>
            </div>
        `).join("");
    }

    renderHistory(items) {
        if (!this.historyList) return;

        if (!items.length) {
            this.historyList.innerHTML = `<p class="empty-state">Aucun historique disponible pour le moment.</p>`;
            return;
        }

        this.historyList.innerHTML = items.map((item) => `
            <div class="history-item">
                <div class="history-top">
                    <strong>${this.escapeHtml(item.fileName)}</strong>
                    <span>${this.escapeHtml(this.historyStatusLabel(item))}</span>
                </div>
                <p>${this.escapeHtml(item.kind)} • ${this.escapeHtml(item.fileType || "unknown")} • ${this.escapeHtml(item.corruptionLevel || "unknown")}</p>
                <p>${this.escapeHtml(this.formatHistoryDate(item.createdAt))}</p>
            </div>
        `).join("");
    }

    renderAnalysis(localId, analysisResult) {
        const container = document.getElementById(`analysis-${localId}`);
        if (!container) return;

        const { analysis, report } = analysisResult;
        const metadataEntries = Object.entries(report.metadata || {})
            .filter(([, value]) => value !== null && value !== "" && value !== false && value !== undefined)
            .slice(0, 8);

        const issuesHtml = report.integrity.issues.length
            ? report.integrity.issues.map((issue) => `<li class="issue-item">${this.escapeHtml(issue)}</li>`).join("")
            : '<li class="issue-item">Aucun probleme majeur detecte</li>';

        const recommendationsHtml = report.recommendations
            .map((item) => `<li class="recommendation-item">${this.escapeHtml(item)}</li>`)
            .join("");

        const metadataHtml = metadataEntries.length
            ? metadataEntries.map(([key, value]) => `<li class="meta-item">${this.escapeHtml(this.humanizeKey(key))}: ${this.escapeHtml(String(value))}</li>`).join("")
            : '<li class="meta-item">Aucune metadonnee exploitable</li>';

        container.innerHTML = `
            <div class="analysis-grid">
                <div class="analysis-stat">
                    <span class="analysis-stat-label">Type declare</span>
                    <span class="analysis-stat-value">${this.escapeHtml(report.file.type || "Inconnu")}</span>
                </div>
                <div class="analysis-stat">
                    <span class="analysis-stat-label">Type detecte</span>
                    <span class="analysis-stat-value">${this.escapeHtml(report.file.detectedType || "unknown")}</span>
                </div>
                <div class="analysis-stat">
                    <span class="analysis-stat-label">Integrite</span>
                    <span class="analysis-stat-value severity severity-${analysis.corruptionLevel}">
                        <span class="severity-dot"></span>${this.escapeHtml(this.getSeverityLabel(analysis.corruptionLevel))}
                    </span>
                </div>
                <div class="analysis-stat">
                    <span class="analysis-stat-label">Reparable</span>
                    <span class="analysis-stat-value">${analysis.repairable ? "Oui" : "Limite"}</span>
                </div>
            </div>

            <div class="analysis-block">
                <h4>Problemes identifies</h4>
                <ul class="issue-list">${issuesHtml}</ul>
            </div>

            <div class="analysis-block">
                <h4>Recommandations</h4>
                <ul class="recommendation-list">${recommendationsHtml}</ul>
            </div>

            <div class="analysis-block">
                <h4>Metadonnees</h4>
                <ul class="meta-list">${metadataHtml}</ul>
            </div>
        `;

        const comparisonNode = document.createElement("div");
        comparisonNode.id = `comparison-${localId}`;
        comparisonNode.className = "comparison-panel";
        container.appendChild(comparisonNode);

        const repair = this.activeRepairs.get(localId);
        if (repair && repair.comparison) {
            this.renderComparison(localId, repair.comparison, repair.repairedAnalysis);
        } else {
            comparisonNode.innerHTML = "";
        }
    }

    renderComparison(localId, comparison, repairedAnalysis) {
        const container = document.getElementById(`comparison-${localId}`);
        if (!container || !comparison) return;

        const success = Boolean(comparison.improvement && comparison.improvement.success);
        const repairedType = repairedAnalysis?.report?.file?.type || comparison.repaired.type || "Inconnu";
        const repair = this.activeRepairs.get(localId);

        container.innerHTML = `
            <div class="comparison-grid">
                <div class="comparison-card">
                    <h4>Avant</h4>
                    <p>Taille: ${this.escapeHtml(comparison.original.size)}</p>
                    <p>Problemes: ${this.escapeHtml(String(comparison.original.issues))}</p>
                    <p>Type: ${this.escapeHtml(comparison.original.type || "Inconnu")}</p>
                </div>
                <div class="comparison-card">
                    <h4>Apres</h4>
                    <p>Taille: ${this.escapeHtml(comparison.repaired.size)}</p>
                    <p>Problemes: ${this.escapeHtml(String(comparison.repaired.issues))}</p>
                    <p>Type: ${this.escapeHtml(repairedType)}</p>
                </div>
                <div class="comparison-card">
                    <h4>Gain</h4>
                    <p>Problemes corriges: ${this.escapeHtml(String(comparison.improvement.issuesFixed))}</p>
                    <p>Delta taille: ${this.escapeHtml(String(comparison.improvement.sizeDiff))} octets</p>
                </div>
            </div>
            <div class="comparison-result ${success ? "success" : "warning"}">
                ${success ? "Le fichier repare presente moins de problemes que l'original." : "La reparation a produit un resultat exploitable, mais l'amelioration reste limitee."}
            </div>
            ${repair?.outputFile ? `
                <div class="output-file-box">
                    <span class="output-file-label">Nom exact du fichier de sortie</span>
                    <div class="output-file-name">${this.escapeHtml(repair.outputFile)}</div>
                </div>
            ` : ""}
        `;
    }

    renderActions(localId) {
        const repair = this.activeRepairs.get(localId);
        const actionsElem = document.getElementById(`actions-${localId}`);
        if (!repair || !actionsElem) return;

        if (repair.status === "repairing") {
            actionsElem.innerHTML = `
                <button class="btn btn-primary" disabled>Reparation en cours...</button>
                <button class="btn btn-secondary" type="button" onclick="window.app.refreshAnalysis('${localId}')">Rafraichir l'analyse</button>
            `;
            return;
        }

        if (repair.outputFile) {
            actionsElem.innerHTML = `
                <button class="btn btn-success btn-download" type="button" onclick="window.app.saveRepairedFile('${repair.outputFile}', '${this.escapeAttribute(repair.fileName)}')">Telecharger le fichier repare</button>
                <button class="btn btn-secondary" type="button" onclick="window.app.saveRepairedFileAs('${repair.outputFile}', '${this.escapeAttribute(repair.fileName)}')">Enregistrer sous</button>
                <button class="btn btn-secondary" type="button" onclick="window.app.openRepairedFolder('${repair.outputFile}')">Ouvrir le dossier</button>
                <button class="btn btn-secondary" type="button" onclick="window.app.refreshAnalysis('${localId}')">Relire le rapport</button>
            `;
            return;
        }

        actionsElem.innerHTML = `
            <button class="btn btn-primary" type="button" onclick="window.app.startRepair('${localId}')">Reparer ce fichier puis telecharger</button>
            <button class="btn btn-secondary" type="button" onclick="window.app.refreshAnalysis('${localId}')">Rafraichir l'analyse</button>
            <div class="action-hint">Le bouton de telechargement apparaitra ici apres la vraie reparation du fichier.</div>
        `;
    }

    async refreshAnalysis(localId) {
        const repair = this.activeRepairs.get(localId);
        if (!repair || !repair.uploadedFileId) return;

        try {
            this.setCardBusy(localId, true);
            this.updateStatus(localId, "Actualisation du rapport...");
            const analysisResult = await this.analyzeFile(repair.uploadedFileId, repair.fileName);
            repair.analysis = analysisResult;
            this.renderAnalysis(localId, analysisResult);
            this.updateStatus(localId, "Rapport actualise.");
            this.showNotification(`Rapport actualise pour ${repair.fileName}`, "info");
            this.refreshSidebarData();
        } catch (error) {
            this.updateStatus(localId, `Erreur: ${error.message}`, true);
            this.showNotification(`Erreur: ${error.message}`, "error");
        } finally {
            this.setCardBusy(localId, false);
            this.renderActions(localId);
            this.refreshToolbarState();
        }
    }

    updateProgress(fileNameOrId, progress, status) {
        const targetId = this.findRepairId(fileNameOrId);
        if (!targetId) return;

        const repair = this.activeRepairs.get(targetId);
        if (repair) {
            repair.progress = progress;
        }

        const progressFill = document.getElementById(`progress-${targetId}`);
        const percentElem = document.getElementById(`percent-${targetId}`);
        const statusElem = document.getElementById(`status-${targetId}`);

        if (progressFill) {
            progressFill.style.width = `${progress}%`;
        }

        if (percentElem) {
            percentElem.textContent = `${Math.floor(progress)}%`;
        }

        if (statusElem) {
            statusElem.textContent = status;
        }
    }

    updateStatus(localId, status, isError = false) {
        const statusElem = document.getElementById(`status-${localId}`);
        if (!statusElem) return;

        statusElem.textContent = status;
        statusElem.classList.toggle("error-status", isError);
        if (!isError) {
            statusElem.classList.remove("success-status");
        }

        this.updateStageBadge(localId);
    }

    markComplete(fileName, outputFile, payload = {}) {
        const targetId = this.resolveRepairTargetId(fileName, payload);
        if (!targetId) return;

        const repair = this.activeRepairs.get(targetId);
        this.stopRepairPolling(targetId);
        repair.status = "completed";
        repair.wsRepairId = payload.repairId || repair.wsRepairId || null;
        repair.outputFile = outputFile;
        repair.comparison = payload.comparison || null;
        repair.repairedAnalysis = payload.repairedAnalysis || null;

        const statusElem = document.getElementById(`status-${targetId}`);
        if (statusElem) {
            statusElem.textContent = `Reparation terminee avec succes. Fichier pret : ${outputFile}`;
            statusElem.classList.add("success-status");
        }

        this.updateProgress(targetId, 100, `Reparation terminee avec succes. Fichier pret : ${outputFile}`);
        if (repair.comparison) {
            this.renderComparison(targetId, repair.comparison, repair.repairedAnalysis);
        } else {
            const comparisonNode = document.getElementById(`comparison-${targetId}`);
            if (comparisonNode) {
                comparisonNode.innerHTML = `
                    <div class="output-file-box">
                        <span class="output-file-label">Nom exact du fichier de sortie</span>
                        <div class="output-file-name">${this.escapeHtml(outputFile)}</div>
                    </div>
                `;
            }
        }
        this.setCardBusy(targetId, false);
        this.updateStageBadge(targetId);
        this.renderActions(targetId);
        this.refreshToolbarState();
        this.showNotification(`${fileName} repare avec succes`, "success");
        if (payload.queue) {
            this.renderQueueStats(payload.queue);
        }
        this.refreshSidebarData();
    }

    updateStageBadge(localId) {
        const repair = this.activeRepairs.get(localId);
        const badge = document.getElementById(`stage-${localId}`);
        if (!repair || !badge) return;

        badge.className = "stage-badge";

        if (repair.outputFile || repair.status === "completed") {
            badge.classList.add("stage-repair");
            badge.textContent = "Reparation terminee";
            return;
        }

        if (repair.status === "repairing") {
            badge.classList.add("stage-analysis");
            badge.textContent = "Reparation en cours";
            return;
        }

        if (repair.analysis || repair.status === "analyzed") {
            badge.classList.add("stage-analysis");
            badge.textContent = "Analyse terminee";
            return;
        }

        badge.textContent = "En attente";
    }

    normalizeRepairProgress(localId, progress, status = "") {
        const repair = this.activeRepairs.get(localId);
        const numericProgress = Number(progress);
        const safeProgress = Number.isFinite(numericProgress) ? numericProgress : 0;
        const isRepairing = repair?.status === "repairing";
        const isError = /^Erreur/i.test(status);

        if (isRepairing && !isError) {
            return Math.min(100, Math.max(12, safeProgress));
        }

        return Math.min(100, Math.max(0, safeProgress));
    }

    resolveRepairTargetId(fileNameOrId, payload = {}) {
        return this.findRepairId(payload.fileId)
            || this.findRepairId(payload.repairId)
            || this.findRepairId(fileNameOrId);
    }

    saveRepairedFile(filename, originalName) {
        const link = document.createElement("a");
        link.href = `/api/download/${filename}`;
        link.download = filename || originalName;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
    }

    async saveRepairedFileAs(filename, originalName) {
        const defaultName = filename || originalName;

        if ("showSaveFilePicker" in window) {
            try {
                const response = await fetch(`/api/download/${filename}`);
                if (!response.ok) {
                    throw new Error("Telechargement impossible");
                }

                const blob = await response.blob();
                const handle = await window.showSaveFilePicker({
                    suggestedName: defaultName
                });

                const writable = await handle.createWritable();
                await writable.write(blob);
                await writable.close();
                this.showNotification(`Fichier enregistre : ${defaultName}`, "success");
                return;
            } catch (error) {
                if (error?.name === "AbortError") {
                    return;
                }
                this.showNotification("Enregistrer sous non disponible, telechargement classique lance.", "info");
            }
        }

        this.saveRepairedFile(filename, originalName);
    }

    async openRepairedFolder(filename = "") {
        try {
            const response = await fetch("/api/open-repaired-folder", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ filename })
            });

            const payload = await response.json();
            if (!response.ok) {
                throw new Error(payload.error || "Impossible d'ouvrir le dossier");
            }

            this.showNotification("Dossier des fichiers repares ouvert.", "success");
        } catch (error) {
            this.showNotification(`Erreur: ${error.message}`, "error");
        }
    }

    setCardBusy(localId, isBusy) {
        const card = document.getElementById(`repair-${localId}`);
        if (!card) return;

        card.dataset.busy = isBusy ? "true" : "false";
        card.querySelectorAll("button").forEach((button) => {
            button.disabled = isBusy;
        });
    }

    refreshToolbarState() {
        const repairs = [...this.activeRepairs.values()];
        const hasRepairable = repairs.some((repair) => repair.uploadedFileId && repair.status !== "repairing" && !repair.outputFile);
        const hasAnalyzable = repairs.some((repair) => repair.uploadedFileId && repair.status !== "repairing");

        if (this.repairAllBtn) {
            this.repairAllBtn.disabled = !hasRepairable;
        }

        if (this.analyzeAllBtn) {
            this.analyzeAllBtn.disabled = !hasAnalyzable;
        }
    }

    findRepairId(fileNameOrId) {
        for (const [id, repair] of this.activeRepairs.entries()) {
            if (
                id === fileNameOrId
                || repair.uploadedFileId === fileNameOrId
                || repair.wsRepairId === fileNameOrId
                || repair.fileName === fileNameOrId
            ) {
                return id;
            }
        }

        return null;
    }

    getExtension(fileName) {
        const parts = fileName.toLowerCase().split(".");
        return parts.length > 1 ? parts.pop() : "";
    }

    getFileType(extension) {
        const types = {
            mp4: "video",
            avi: "video",
            mov: "video",
            mkv: "video",
            flv: "video",
            wmv: "video",
            m4v: "video",
            "3gp": "video",
            pdf: "pdf",
            doc: "word",
            docx: "word",
            xls: "excel",
            xlsx: "excel",
            jpg: "image",
            jpeg: "image",
            png: "image",
            gif: "image",
            bmp: "image",
            tif: "image",
            tiff: "image",
            webp: "image",
            zip: "archive",
            rar: "archive",
            "7z": "archive",
            txt: "document",
            csv: "document",
            json: "document",
            xml: "document",
            html: "document",
            htm: "document",
            log: "document",
            md: "document"
        };

        return types[extension] || "unknown";
    }

    getTypeChipLabel(type) {
        const labels = {
            video: "Video",
            pdf: "PDF",
            word: "Word",
            excel: "Excel",
            image: "Image",
            archive: "Archive",
            document: "Document",
            unknown: "Inconnu",
            analysis: "Analyse",
            repair: "Reparation"
        };

        return labels[type] || "Inconnu";
    }

    getFileTypeLabel(type) {
        const labels = {
            video: "Flux video ou audio",
            pdf: "Document PDF",
            word: "Document bureautique",
            excel: "Classeur ou tableau",
            image: "Image raster",
            archive: "Archive compressee",
            document: "Texte structure ou brut",
            unknown: "Type a verifier"
        };

        return labels[type] || "Type a verifier";
    }

    getSeverityLabel(level) {
        const labels = {
            none: "Stable",
            minor: "Legere",
            moderate: "Moderee",
            severe: "Severe"
        };

        return labels[level] || level;
    }

    humanizeKey(key) {
        return key
            .replace(/([A-Z])/g, " $1")
            .replace(/[_-]+/g, " ")
            .replace(/^\w/, (match) => match.toUpperCase());
    }

    historyStatusLabel(item) {
        if (item.kind === "analysis") {
            return "Analyse";
        }

        return item.status === "success" ? "Succes" : "Echec";
    }

    formatHistoryDate(value) {
        try {
            return new Date(value).toLocaleString("fr-FR");
        } catch {
            return value;
        }
    }

    formatFileSize(bytes) {
        if (bytes === 0) return "0 Bytes";
        const k = 1024;
        const sizes = ["Bytes", "KB", "MB", "GB"];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return `${parseFloat((bytes / Math.pow(k, i)).toFixed(2))} ${sizes[i]}`;
    }

    showNotification(message, type = "info") {
        const existing = document.querySelector(".notification");
        if (existing) existing.remove();

        const notification = document.createElement("div");
        notification.className = `notification notification-${type}`;
        notification.textContent = message;
        document.body.appendChild(notification);

        setTimeout(() => {
            notification.remove();
        }, 3500);
    }

    escapeHtml(text) {
        const div = document.createElement("div");
        div.textContent = text;
        return div.innerHTML;
    }

    escapeAttribute(text) {
        return String(text).replace(/'/g, "\\'");
    }
}

window.app = new RepairApp();
