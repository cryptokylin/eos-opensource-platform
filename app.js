//const contract_name = "test";
const config = require('./config.json');
//const fs = require('fs');
const http = require('http');
const exec = require('child_process').exec;
const fileUpload = require('express-fileupload');
const express = require('express');
const app = express();
const mkdirp = require('mkdirp');


// config server
var server = http.createServer(app).listen(config.server.port, function () { });
console.log('start on:' + config.server.port);
server.timeout = 240000;

app.use(fileUpload());

app.post('/upload', function (req, res) {
    if (!req.files)
        return res.status(400).send('No files were uploaded.');

    // The name of the input field (i.e. "sampleFile") is used to retrieve the uploaded file
    let sourceFile = req.files.sourceFile;
    let sourceFileName = sourceFile.name.split(".");
    if (sourceFileName.length > 2) {
        return res.status(500).send("file name error!");
    }
    let type = sourceFileName[1];
    if (type != "cpp") {
        //return res.status(500).send("file type error!");
    }
    let contractName = sourceFileName[0];
    let contractsDir = __dirname + '/contracts/' + contractName;

    mkdirp(contractsDir, (err) => {
        if (err) {
            return res.status(500).send(err);
        }
        sourceFile.mv(contractsDir + '/' + sourceFile.name)
            .then(res => {
                let path = contractsDir + '/';
                let compileCmd = "eosiocpp -o " + path + contractName + ".wast " + path + contractName + ".cpp";
                return execfunc(compileCmd);
            }, err => {
                res.status(500).send(err);
            }).then(stdout => {
                console.log(stdout);
                res.send('File comopiled!');
            }, err => {
                res.status(500).send(err);
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
