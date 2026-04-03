class RepairWebSocket {
    constructor() {
        this.ws = null;
        this.callbacks = {};
        this.isConnecting = false;
        this.messageQueue = [];
        this.currentRepairId = null;
    }

    connect() {
        if (this.isConnecting || (this.ws && this.ws.readyState === WebSocket.OPEN)) {
            return;
        }

        this.isConnecting = true;
        const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
        const wsUrl = `${protocol}//${window.location.host}`;
        this.ws = new WebSocket(wsUrl);

        this.ws.onopen = () => {
            this.isConnecting = false;

            while (this.messageQueue.length > 0) {
                const message = this.messageQueue.shift();
                this.send(message);
            }

            if (this.callbacks.onConnect) {
                this.callbacks.onConnect();
            }
        };

        this.ws.onmessage = (event) => {
            try {
                const data = JSON.parse(event.data);
                this.handleMessage(data);
            } catch (error) {
                console.error("Erreur parsing message:", error);
            }
        };

        this.ws.onerror = (error) => {
            console.error("WebSocket error:", error);
        };

        this.ws.onclose = () => {
            this.isConnecting = false;
            if (!this.currentRepairId) {
                setTimeout(() => {
                    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
                        this.connect();
                    }
                }, 3000);
            }
        };
    }

    handleMessage(data) {
        switch (data.type) {
            case "queued":
                if (this.callbacks.onQueued) {
                    this.callbacks.onQueued(data.fileName, data);
                }
                break;
            case "progress":
                if (this.callbacks.onProgress) {
                    this.callbacks.onProgress(data.fileName, data.progress, data.status, data);
                }
                break;
            case "complete":
                this.currentRepairId = null;
                if (this.callbacks.onComplete) {
                    this.callbacks.onComplete(data.fileName, data.outputFile, data);
                }
                break;
            case "error":
                this.currentRepairId = null;
                if (this.callbacks.onError) {
                    this.callbacks.onError(new Error(data.error));
                }
                break;
            default:
                break;
        }
    }

    send(data) {
        if (this.ws && this.ws.readyState === WebSocket.OPEN) {
            const message = typeof data === "string" ? data : JSON.stringify(data);
            this.ws.send(message);
            return true;
        }

        this.messageQueue.push(data);
        if (!this.isConnecting) {
            this.connect();
        }
        return false;
    }

    repairFile(fileId, fileName) {
        this.currentRepairId = fileId;
        this.send({
            type: "repair",
            fileId,
            fileName
        });
    }

    on(event, callback) {
        this.callbacks[event] = callback;
    }
}

window.wsClient = new RepairWebSocket();
