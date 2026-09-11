const { fork } = require("node:child_process");
const path = require("node:path");

/** A sequential worker. timeout: 0 disables both deadline and duration checks. */
class EvaluatorProcess {
    constructor(mode, { timeout = 10000, worker } = {}) {
        this.mode = mode;
        this.timeout = timeout;
        if (!Number.isSafeInteger(timeout) || timeout < 0)
            throw new Error("timeout must be a nonnegative integer");
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
                    // resvg owns native allocations whose lifetime can exceed a
                    // mask calculation. Untimed workers collect completed
                    // render batches before those allocations exhaust RAM.
                    execArgv: this.timeout === 0 ? ["--expose-gc"] : [],
                    env: {
                        ...process.env,
                        PATH_BOOL_UNTIMED: this.timeout === 0 ? "1" : "0",
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
            const timer =
                this.timeout === 0
                    ? undefined
                    : setTimeout(() => {
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
