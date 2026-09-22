import {after, test} from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {execFileSync} from "node:child_process";
import {createDirectory, download, extractDownload} from "../src/main.js";

// Not the shared path the action itself uses, so a test run cannot clobber a real download
const downloadDir = fs.mkdtempSync(path.join(os.tmpdir(), "wfnd-download-"));
const downloadPath = path.join(downloadDir, "wildfly-maven-repository.tar.gz");

after(() => fs.rmSync(downloadDir, {recursive: true, force: true}));

// Sets an environment variable for the duration of one test, restoring it afterwards
function setEnv(t, name, value) {
    const original = process.env[name];
    t.after(() => {
        if (original === undefined) {
            delete process.env[name];
        } else {
            process.env[name] = original;
        }
    });
    process.env[name] = value;
}

test("createDirectory creates nested directories recursively", t => {
    const base = fs.mkdtempSync(path.join(os.tmpdir(), "wfnd-dir-"));
    t.after(() => fs.rmSync(base, {recursive: true, force: true}));
    const nested = path.join(base, "a", "b", "c");

    createDirectory(nested);

    assert.ok(fs.existsSync(nested));
});

test("download saves the response body when the server returns a gzip archive", async t => {
    const body = Buffer.from("fake-gzip-bytes");
    const server = http.createServer((req, res) => {
        res.writeHead(200, {"content-type": "application/x-gzip"});
        res.end(body);
    });
    await new Promise(resolve => server.listen(0, "127.0.0.1", () => resolve()));
    t.after(() => new Promise(resolve => server.close(() => resolve())));
    const {port} = server.address();

    setEnv(t, "INPUT_URI", `http://127.0.0.1:${port}`);

    await download(downloadPath);

    assert.deepStrictEqual(fs.readFileSync(downloadPath), body);
    fs.rmSync(downloadPath);
});

test("extractDownload extracts the nested archive and reports the version output", async t => {
    const buildDir = fs.mkdtempSync(path.join(os.tmpdir(), "wfnd-build-"));
    const target = fs.mkdtempSync(path.join(os.tmpdir(), "wfnd-target-"));
    const outputDir = fs.mkdtempSync(path.join(os.tmpdir(), "wfnd-output-"));
    const outputFile = path.join(outputDir, "output");
    fs.writeFileSync(outputFile, "");
    t.after(() => {
        fs.rmSync(buildDir, {recursive: true, force: true});
        fs.rmSync(target, {recursive: true, force: true});
        fs.rmSync(outputDir, {recursive: true, force: true});
    });

    // The real download contains a nested tar.gz of the same name, which itself
    // contains version.txt at its root - reproduce that shape for the test.
    fs.writeFileSync(path.join(buildDir, "version.txt"), "30.0.0.Final\n");
    execFileSync("tar", ["-czf", "wildfly-maven-repository.tar.gz", "version.txt"], {cwd: buildDir});
    execFileSync("tar", ["-czf", downloadPath, "-C", buildDir, "wildfly-maven-repository.tar.gz"]);

    setEnv(t, "GITHUB_OUTPUT", outputFile);

    await extractDownload(target, downloadPath);

    const contents = fs.readFileSync(outputFile, "utf8");

    const match = contents.match(/wildfly-version<<[\w-]+\r?\n(.*)\r?\n[\w-]+/);
    assert.strictEqual(match && match[1], "30.0.0.Final");
    assert.strictEqual(fs.existsSync(downloadPath), false);
    // The nested archive extracted into the target should be cleaned up too
    assert.strictEqual(fs.existsSync(path.join(target, "wildfly-maven-repository.tar.gz")), false);
});

test("download rejects and leaves no file behind when the status is not 200", async t => {
    const server = http.createServer((req, res) => {
        res.writeHead(404, {"content-type": "text/plain"});
        res.end("not found");
    });
    await new Promise(resolve => server.listen(0, "127.0.0.1", () => resolve()));
    t.after(() => new Promise(resolve => server.close(() => resolve())));
    const {port} = server.address();

    setEnv(t, "INPUT_URI", `http://127.0.0.1:${port}`);

    await assert.rejects(download(downloadPath), /Status Code: 404/);
    assert.strictEqual(fs.existsSync(downloadPath), false);
});

test("download rejects and leaves no file behind on an unexpected content type", async t => {
    const server = http.createServer((req, res) => {
        res.writeHead(200, {"content-type": "text/plain"});
        res.end("not a tarball");
    });
    await new Promise(resolve => server.listen(0, "127.0.0.1", () => resolve()));
    t.after(() => new Promise(resolve => server.close(() => resolve())));
    const {port} = server.address();

    setEnv(t, "INPUT_URI", `http://127.0.0.1:${port}`);

    await assert.rejects(download(downloadPath), /Invalid content type/);
    assert.strictEqual(fs.existsSync(downloadPath), false);
});

test("download rejects when the host refuses the connection", async t => {
    // Bind then immediately release a port so we have one nothing is listening on
    const server = http.createServer();
    await new Promise(resolve => server.listen(0, "127.0.0.1", () => resolve()));
    const {port} = server.address();
    await new Promise(resolve => server.close(() => resolve()));

    setEnv(t, "INPUT_URI", `http://127.0.0.1:${port}`);

    await assert.rejects(download(downloadPath), {code: "ECONNREFUSED"});
});
