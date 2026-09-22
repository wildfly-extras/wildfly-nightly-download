import {run} from "./main.js";

// Deliberately not a top-level await: that cannot be represented if ncc ever emits a CommonJS bundle.
// run() reports its own failures via core.setFailed, so this catch is only a last resort.
run().catch(err => {
    console.error(err);
    process.exitCode = 1;
});
