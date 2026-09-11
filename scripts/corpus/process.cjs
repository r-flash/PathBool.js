const { fork } = require("node:child_process");
const path = require("node:path");

/** A persistent sequential worker; a hung job kills it, and the next starts fresh. */
class EvaluatorProcess {
    constructor(mode, { timeout = 10000, worker } = {}) {
        this.mode = mode;
        this.timeout = timeout;
        this.worker =
            worker ?? path.resolve(`.cache/path-bool/build/${mode}.mjs`);
        this.queue = Promise.resolve();
    }
    evaluate(job) {
        const result = this.queue.then(() => this.run(job));
        this.queue = result.catch(() => {});
        return result;
    }
    run(job) {
        return new Promise((resolve) => {
            if (!this.child)
                this.child = fork(this.worker, [], {
                    stdio: ["ignore", "ignore", "pipe", "ipc"],
                    execArgv: [],
                    env: {
                        ...process.env,
                        NODE_ENV: this.mode,
                        PATH_BOOL_DEV_ASSERTS:
                            this.mode === "development" ? "1" : "0",
                    },
                });
            const child = this.child;
            const start = performance.now();
            let stderr = "";
            const capture = (chunk) => {
                stderr = (stderr + chunk).slice(-4000);
            };
            const finish = (result) => {
                clearTimeout(timer);
                child.off("message", message);
                child.off("exit", exited);
                child.off("error", errored);
                child.stderr.off("data", capture);
                resolve({ ...result, elapsedMs: performance.now() - start });
            };
            const message = (result) => finish(result);
            const exited = (code, signal) => {
                this.child = null;
                finish({
                    failure: `worker exited (${code ?? signal}): ${stderr}`,
                    kind: "worker",
                });
            };
            const errored = (error) => {
                this.close();
                finish({ failure: error.message, kind: "worker" });
            };
            const timer = setTimeout(() => {
                finish({
                    failure: `timeout: exceeded ${this.timeout}ms`,
                    kind: "timeout",
                });
                this.close();
            }, this.timeout);
            child.on("message", message);
            child.once("exit", exited);
            child.once("error", errored);
            child.stderr.on("data", capture);
            child.send(job);
        });
    }
    close() {
        this.child?.kill("SIGKILL");
        this.child = null;
    }
}

exports.EvaluatorProcess = EvaluatorProcess;
