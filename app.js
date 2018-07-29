//const contract_name = "test";
const config = require('./config.json');
const http = require('http');
const exec = require('child_process').exec;
const fileUpload = require('express-fileupload');
const express = require('express');
const app = express();


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

    // Use the mv() method to place the file somewhere on your server
    sourceFile.mv(__dirname + '/uploads/' + sourceFile.name, function (err) {
        if (err) {
            return res.status(500).send(err);
        }
        compile(contractName).then(stdout => {
            console.log(stdout);
            res.send('File comopiled!');
        });
    });
});

function genabi(contract) {
    let genabiCmd = "eosiocpp -g " + contract + ".abi " + contract + ".cpp";
    return new Promise((resolve, reject) => {
        exec(genabiCmd, function (error, stdout, stderr) {
            if (error) {
                reject(stderr);
            }
            resolve(stdout);
        });
    });
}

function compile(contract) {
    let compileCmd = "cd uploads;eosiocpp -o " + contract + ".wast " + contract + ".cpp";
    return new Promise((resolve, reject) => {
        exec(compileCmd, function (error, stdout, stderr) {
            if (error) {
                reject(stderr);
            }
            resolve(stdout);
        });
    });
}
