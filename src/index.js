import https from "https";
import http from "http";
import fs from "fs";
import path from "path";
import os from "os";
import core from "@actions/core";
import * as tc from "@actions/tool-cache";

const downloadPath = `${os.tmpdir}/wildfly-maven-repository.tar.gz`;

function createDirectory(dir) {
    const parent = path.dirname(dir);
    if (!fs.existsSync(parent)) {
        createDirectory(parent);
    }

    fs.mkdirSync(dir, {recursive: true});
}

async function download(callback) {
    const downloadUri = core.getInput("uri");
    //const downloadUri =
    //    "https://ci.wildfly.org/guestAuth/repository/download/WF_Nightly/latest.lastSuccessful/wildfly-maven-repository.tar.gz";

    const file = fs.createWriteStream(downloadPath);
    const handler = response => {
        const {statusCode} = response;
        if (statusCode !== 200) {
            throw new Error(`Failed to download ${downloadUri}\nStatus Code: ${statusCode}`);
        }
        const contentType = response.headers["content-type"];
        if (!/^application\/x-gzip/.test(contentType)) {
            throw new Error(`Invalid content type of ${contentType} for ${downloadUri}`);
        }

        response.pipe(file);
        file.on("finish", () => {
            file.close(() => {
                console.log(`Successfully downloaded ${downloadUri}`);
                // Success, invoke the callback
                callback();
            });
        }).on("error", err => {
            fs.unlink(file, () => {
                console.debug(`Failed to dowload ${downloadPath}`, err);
                throw new Error(`Failed to download ${downloadUri}`);
            });
        });
    };
    if (downloadUri.startsWith("https")) {
        https.get(downloadUri, handler);
    } else {
        http.get(downloadUri, handler);
    }
}

async function extract(tarName, target) {
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

function extractDownload(target) {
    extract(downloadPath, target).then(() => {
        extract(target + "/" + path.basename(downloadPath), target).then(() => {
            // Delete the old TAR
            fs.unlinkSync(downloadPath);
            fs.readFile(target + "/version.txt", (err, data) => {
                if (err) {
                    console.debug(`Failed to read ${target}/version.txt`, err);
                    throw new Error(`Failed to read ${target}/version.txt`);
                } else {
                    const version = data.toString().trim();
                    core.setOutput("wildfly-version", version);
                    console.log(`Downloaded and extracted Maven Repository for WildFly ${version}`);
                }
            });
        });
    });
}

try {
    const target = `${os.homedir}/.m2/repository`;
    if (!fs.existsSync(target)) {
        console.debug(`Creating directory ${target}`);
        createDirectory(target);
    }

    if (!fs.existsSync(downloadPath)) {
        download(() => {
            extractDownload(target);
        });
    } else {
        extractDownload(target);
    }
} catch (error) {
    core.setFailed(error.message);
}
