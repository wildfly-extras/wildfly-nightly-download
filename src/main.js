import https from "https";
import http from "http";
import fs from "fs";
import path from "path";
import os from "os";
import {pipeline} from "stream/promises";
import * as core from "@actions/core";
import * as tc from "@actions/tool-cache";

// The name of the downloaded archive and of the archive nested inside it
const archiveName = "wildfly-maven-repository.tar.gz";

export const defaultDownloadPath = path.join(os.tmpdir(), archiveName);

export function createDirectory(dir) {
    const parent = path.dirname(dir);
    if (!fs.existsSync(parent)) {
        createDirectory(parent);
    }

    fs.mkdirSync(dir, {recursive: true});
}

/**
 * @param {string} uri the URI to send a GET request to
 * @returns {Promise<import("http").IncomingMessage>} the response
 */
function get(uri) {
    return new Promise((resolve, reject) => {
        const request = (uri.startsWith("https") ? https : http).get(uri, resolve);
        request.on("error", reject);
    });
}

export async function download(downloadPath = defaultDownloadPath) {
    const downloadUri = core.getInput("uri");

    const response = await get(downloadUri);

    // Nothing has been written yet on these paths, the socket just needs draining
    const {statusCode} = response;
    if (statusCode !== 200) {
        response.resume();
        throw new Error(`Failed to download ${downloadUri}\nStatus Code: ${statusCode}`);
    }
    const contentType = response.headers["content-type"];
    if (!/^application\/x-gzip/.test(contentType)) {
        response.resume();
        throw new Error(`Invalid content type of ${contentType} for ${downloadUri}`);
    }

    try {
        await pipeline(response, fs.createWriteStream(downloadPath));
    } catch (err) {
        // pipeline has already destroyed both streams, so only the partial file is left to clean up
        await fs.promises.rm(downloadPath, {force: true});
        throw err;
    }

    console.log(`Successfully downloaded ${downloadUri}`);
    return downloadPath;
}

export async function extract(tarName, target) {
    console.log(`Extracting ${tarName} to ${target}`);
    return await tc
        .extractTar(tarName, target)
        .then(() => {
            console.log("Extraction complete");
        })
        .catch(err => {
            console.debug("Failed to extract file", err);
            throw new Error(`Failed to extract file ${tarName}`);
        });
}

export async function extractDownload(target, downloadPath = defaultDownloadPath) {
    await extract(downloadPath, target);
    const nested = path.join(target, archiveName);
    await extract(nested, target);
    // Delete both the nested TAR extracted into the target and the downloaded TAR
    fs.rmSync(nested, {force: true});
    fs.rmSync(downloadPath, {force: true});
    const data = await fs.promises.readFile(target + "/version.txt").catch(err => {
        console.debug(`Failed to read ${target}/version.txt`, err);
        throw new Error(`Failed to read ${target}/version.txt`);
    });
    const version = data.toString().trim();
    core.setOutput("wildfly-version", version);
    console.log(`Downloaded and extracted Maven Repository for WildFly ${version}`);
}

export async function run() {
    try {
        const target = core.getInput("path") || path.join(os.homedir(), ".m2", "repository");
        if (!fs.existsSync(target)) {
            console.debug(`Creating directory ${target}`);
            createDirectory(target);
        }

        // A file left from a previous failed run may be truncated, so always start fresh
        fs.rmSync(defaultDownloadPath, {force: true});
        await extractDownload(target, await download());
    } catch (error) {
        core.setFailed(error.message);
    }
}
