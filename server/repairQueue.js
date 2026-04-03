const config = require("./config");

class RepairQueue {
    constructor() {
        this.pending = [];
        this.running = 0;
        this.jobCounter = 0;
    }

    enqueue(task) {
        return new Promise((resolve, reject) => {
            const job = {
                id: `job-${Date.now()}-${++this.jobCounter}`,
                createdAt: new Date().toISOString(),
                task,
                resolve,
                reject
            };

            this.pending.push(job);
            this.drain();
        });
    }

    getSnapshot() {
        return {
            running: this.running,
            pending: this.pending.length,
            concurrency: config.maxConcurrentRepairs
        };
    }

    async drain() {
        while (this.running < config.maxConcurrentRepairs && this.pending.length > 0) {
            const job = this.pending.shift();
            this.running += 1;

            Promise.resolve()
                .then(() => job.task({
                    jobId: job.id,
                    queuedAt: job.createdAt,
                    snapshot: this.getSnapshot()
                }))
                .then((result) => {
                    this.running -= 1;
                    job.resolve(result);
                    this.drain();
                })
                .catch((error) => {
                    this.running -= 1;
                    job.reject(error);
                    this.drain();
                });
        }
    }
}

module.exports = new RepairQueue();
