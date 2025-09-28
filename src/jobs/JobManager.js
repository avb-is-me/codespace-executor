const fs = require('fs');
const path = require('path');
const { randomBytes } = require('crypto');
const SecureExecutor = require('../secure/SecureExecutor');

class JobManager {
    constructor(options = {}) {
        this.jobs = new Map();
        this.workers = new Map();
        this.maxConcurrentJobs = options.maxConcurrentJobs || 5;
        this.jobTTL = options.jobTTL || 24 * 60 * 60 * 1000; // 24 hours default
        this.persistenceFile = options.persistenceFile || path.join(__dirname, '../../data/jobs.json');
        this.enablePersistence = options.enablePersistence !== false;
        this.secureExecutor = new SecureExecutor({
            timeout: 1800000, // 30 minutes for background jobs
            tempDir: path.join(__dirname, '../../temp/jobs')
        });
        
        // Ensure data directory exists
        if (this.enablePersistence) {
            const dataDir = path.dirname(this.persistenceFile);
            if (!fs.existsSync(dataDir)) {
                fs.mkdirSync(dataDir, { recursive: true });
            }
            this.loadPersistedJobs();
        }
        
        // Start cleanup interval
        this.cleanupInterval = setInterval(() => {
            this.cleanupExpiredJobs();
        }, 60000); // Run every minute
    }

    generateJobId() {
        return randomBytes(16).toString('hex');
    }

    createJob(payload, options = {}) {
        const jobId = this.generateJobId();
        const job = {
            id: jobId,
            status: 'PENDING',
            payload: payload,
            options: options,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
            startedAt: null,
            completedAt: null,
            result: null,
            error: null,
            progress: 0
        };

        this.jobs.set(jobId, job);
        this.persistJob(job);
        
        // Try to start job immediately if worker slots available
        this.processNextJob();
        
        return jobId;
    }

    getJob(jobId) {
        return this.jobs.get(jobId);
    }

    getAllJobs(options = {}) {
        const { status, limit = 100, offset = 0 } = options;
        let jobs = Array.from(this.jobs.values());
        
        if (status) {
            jobs = jobs.filter(job => job.status === status);
        }
        
        // Sort by creation date (newest first)
        jobs.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
        
        return {
            jobs: jobs.slice(offset, offset + limit),
            total: jobs.length,
            hasMore: jobs.length > offset + limit
        };
    }

    updateJobStatus(jobId, status, data = {}) {
        const job = this.jobs.get(jobId);
        if (!job) {
            throw new Error(`Job ${jobId} not found`);
        }

        job.status = status;
        job.updatedAt = new Date().toISOString();
        
        if (status === 'RUNNING') {
            job.startedAt = new Date().toISOString();
        } else if (status === 'COMPLETED' || status === 'FAILED') {
            job.completedAt = new Date().toISOString();
        }
        
        // Update additional data
        Object.assign(job, data);
        
        this.jobs.set(jobId, job);
        this.persistJob(job);
        
        return job;
    }

    updateJobProgress(jobId, progress, message = null) {
        const job = this.jobs.get(jobId);
        if (job && job.status === 'RUNNING') {
            job.progress = Math.min(100, Math.max(0, progress));
            job.updatedAt = new Date().toISOString();
            if (message) {
                job.progressMessage = message;
            }
            this.jobs.set(jobId, job);
            this.persistJob(job);
        }
    }

    cancelJob(jobId) {
        const job = this.jobs.get(jobId);
        if (!job) {
            throw new Error(`Job ${jobId} not found`);
        }

        if (job.status === 'RUNNING') {
            // Kill the worker process if it exists
            const worker = this.workers.get(jobId);
            if (worker && worker.kill) {
                worker.kill('SIGTERM');
                this.workers.delete(jobId);
            }
        }

        this.updateJobStatus(jobId, 'CANCELLED');
        return job;
    }

    deleteJob(jobId) {
        const job = this.jobs.get(jobId);
        if (!job) {
            throw new Error(`Job ${jobId} not found`);
        }

        // Cancel if running
        if (job.status === 'RUNNING') {
            this.cancelJob(jobId);
        }

        this.jobs.delete(jobId);
        this.removePersistedJob(jobId);
        
        return true;
    }

    processNextJob() {
        // Check if we have available worker slots
        if (this.workers.size >= this.maxConcurrentJobs) {
            return false;
        }

        // Find next pending job
        const pendingJob = Array.from(this.jobs.values())
            .find(job => job.status === 'PENDING');
        
        if (!pendingJob) {
            return false;
        }

        this.startJobExecution(pendingJob);
        return true;
    }

    async startJobExecution(job) {
        try {
            this.updateJobStatus(job.id, 'RUNNING');

            // Use SecureExecutor for background job execution
            const result = await this.secureExecutor.executeCode(job.payload, job.payload.headerEnvVars || {});

            // Handle successful execution
            if (result.success) {
                // Prepare result data with security filtering already applied
                let jobResult = {
                    stdout: result.data.stdout,
                    stderr: result.data.stderr,
                    code: result.data.code || 0,
                    executionTime: result.data.executionTime || Date.now(),
                    executionMode: result.data.executionMode,
                    securityFiltered: result.data.securityFiltered
                };

                // Add AI analysis if available
                if (result.data.aiAnalysis) {
                    jobResult.aiAnalysis = result.data.aiAnalysis;
                }

                // Add code analysis info
                if (result.data.codeAnalysis) {
                    jobResult.codeAnalysis = result.data.codeAnalysis;
                }

                this.updateJobStatus(job.id, 'COMPLETED', { result: jobResult });
            } else {
                // Handle execution failure
                this.updateJobStatus(job.id, 'FAILED', {
                    error: {
                        message: result.error || 'Job execution failed',
                        type: result.details || 'EXECUTION_ERROR',
                        executionMode: result.executionMode || 'unknown',
                        stdout: result.stdout || '',
                        stderr: result.stderr || ''
                    }
                });
            }

        } catch (error) {
            console.error('❌ Job execution error:', error);
            this.updateJobStatus(job.id, 'FAILED', {
                error: {
                    message: error.message || 'Unknown execution error',
                    type: error.constructor.name,
                    details: error.details,
                    executionMode: error.executionMode || 'unknown'
                }
            });
        }

        // Always try to process next job
        this.processNextJob();
    }

    cleanupExpiredJobs() {
        const now = Date.now();
        const expiredJobs = [];
        
        for (const [jobId, job] of this.jobs.entries()) {
            const jobAge = now - new Date(job.createdAt).getTime();
            if (jobAge > this.jobTTL && ['COMPLETED', 'FAILED', 'CANCELLED'].includes(job.status)) {
                expiredJobs.push(jobId);
            }
        }
        
        expiredJobs.forEach(jobId => {
            this.jobs.delete(jobId);
            this.removePersistedJob(jobId);
        });
        
        if (expiredJobs.length > 0) {
            console.log(`🧹 Cleaned up ${expiredJobs.length} expired jobs`);
        }
    }

    persistJob(job) {
        if (!this.enablePersistence) return;
        
        try {
            const jobs = this.loadJobsFromFile();
            jobs[job.id] = job;
            fs.writeFileSync(this.persistenceFile, JSON.stringify(jobs, null, 2));
        } catch (error) {
            console.error('❌ Failed to persist job:', error.message);
        }
    }

    removePersistedJob(jobId) {
        if (!this.enablePersistence) return;
        
        try {
            const jobs = this.loadJobsFromFile();
            delete jobs[jobId];
            fs.writeFileSync(this.persistenceFile, JSON.stringify(jobs, null, 2));
        } catch (error) {
            console.error('❌ Failed to remove persisted job:', error.message);
        }
    }

    loadJobsFromFile() {
        try {
            if (fs.existsSync(this.persistenceFile)) {
                const data = fs.readFileSync(this.persistenceFile, 'utf8');
                return JSON.parse(data);
            }
        } catch (error) {
            console.error('❌ Failed to load jobs from file:', error.message);
        }
        return {};
    }

    loadPersistedJobs() {
        try {
            const persistedJobs = this.loadJobsFromFile();
            
            for (const [jobId, job] of Object.entries(persistedJobs)) {
                // Reset running jobs to pending on startup
                if (job.status === 'RUNNING') {
                    job.status = 'PENDING';
                    job.startedAt = null;
                    job.updatedAt = new Date().toISOString();
                }
                
                this.jobs.set(jobId, job);
            }
            
            console.log(`📂 Loaded ${Object.keys(persistedJobs).length} persisted jobs`);
            
            // Process any pending jobs
            this.processNextJob();
        } catch (error) {
            console.error('❌ Failed to load persisted jobs:', error.message);
        }
    }

    getStats() {
        const stats = {
            total: this.jobs.size,
            pending: 0,
            running: 0,
            completed: 0,
            failed: 0,
            cancelled: 0,
            activeWorkers: this.workers.size,
            maxConcurrentJobs: this.maxConcurrentJobs
        };

        for (const job of this.jobs.values()) {
            stats[job.status.toLowerCase()]++;
        }

        return stats;
    }

    shutdown() {
        // Cancel all running jobs
        for (const [jobId, worker] of this.workers.entries()) {
            if (worker && worker.kill) {
                worker.kill('SIGTERM');
            }
        }
        
        // Clear cleanup interval
        if (this.cleanupInterval) {
            clearInterval(this.cleanupInterval);
        }
        
        console.log('🛑 JobManager shutdown complete');
    }
}

module.exports = JobManager;