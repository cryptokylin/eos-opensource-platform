const config = require('./config.json');
const fs = require('fs');
const http = require('http');
const exec = require('child_process').exec;
const fileUpload = require('express-fileupload');
const express = require('express');
const app = express();
const mkdirp = require('mkdirp');
const extract = require('extract-zip');
const crypto = require('crypto');

// config server
var server = http.createServer(app).listen(config.server.port, function () { });
console.log('start on:' + config.server.port);
server.timeout = 240000;

app.use(fileUpload());

app.post('/upload', function (req, res) {
    if (!req.files) {
        return res.status(400).send('No files were uploaded.');
    }

    let sourceFile = req.files.sourceFile;
    let sourceFileName = sourceFile.name.split(".");
    if (sourceFileName.length < 2) {
        return res.status(500).send("file name error!");
    }
    let type = sourceFileName[sourceFileName.length - 1];
    //support upload single cpp file or project in zip
    if (type != "cpp" && type != 'zip') {
        return res.status(500).send("file type error!");
    }
    let contractName = sourceFileName[0];
    for (let i = 1; i < sourceFileName.length - 1; i++) {
        contractName = contractName + '.' + sourceFileName[i];
    }

    let contractsDir = __dirname + '/contracts/' + contractName;

    mkdirp(contractsDir, (err) => {
        if (err) {
            return res.status(500).send(err);
        }
        //move upload file to a dir
        sourceFile.mv(contractsDir + '/' + sourceFile.name)
            .then(() => {
                if (type == "cpp") {
                    let compileCmd = getCmd(contractsDir, contractName);
                    return execfunc(compileCmd);
                } else {
                    //type = zip
                    //extract zip 
                    return new Promise((resolve, reject) => {
                        extract(contractsDir + '/' + sourceFile.name, { dir: contractsDir }, function (err) {
                            // extraction is complete. make sure to handle the err
                            if (err) {
                                reject(err);
                            }
                            resolve();
                        })
                    }).then(() => {
                        let compileCmd = getCmd(contractsDir, contractName);
                        return execfunc(compileCmd);
                    })
                }
            }, err => {
                res.status(500).send(err);
            }).then(stdout => {
                console.log(stdout);
                //shasum 
                return getHash(contractsDir + "/" + contractName + ".wasm");
            }, err => {
                res.status(500).send(err);
            }).then(hash => {
                res.send('Contract code hash:' + hash);
            });
    });
});

function execfunc(cmd) {
    return new Promise((resolve, reject) => {
        exec(cmd, function (error, stdout, stderr) {
            if (error) {
                reject(stderr);
            }
            resolve(stdout);
        });
    });
}

function getHash(file) {
    return new Promise((resolve, reject) => {
        let algo = 'sha256';
        let shasum = crypto.createHash(algo);

        let s = fs.ReadStream(file);
        s.on('data', function (d) { shasum.update(d); });
        s.on('end', function () {
            let d = shasum.digest('hex');
            console.log(d);
            resolve(d);
        });
    });
}

function getCmd(path, name) {
    if (config.compiler.dockerFlag) {
        let dir = "/opt/contracts/" + name + '/';
        return "docker exec " + config.compiler.container + "-" + config.compiler.version
            + " eosiocpp -o " + dir + name + ".wast " + dir + name + ".cpp";
    } else {
        return "eosiocpp -o " + path + '/' + name + ".wast " + path + '/' + name + ".cpp";
    }
}