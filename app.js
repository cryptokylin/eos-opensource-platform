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
const rimraf = require('rimraf');
const jsondiff = require('deep-diff').diff;
const mongo = require('mongodb');
const Grid = require('gridfs-stream');


// create or use an existing mongodb-native db instance
//var db = new mongo.Db('test', new mongo.Server(config.mongodb.server, config.mongodb.port));
var db, gfs;
mongo.MongoClient.connect(config.mongodb.url, { useNewUrlParser: true }, function (err, database) {
    if (err) {
        logger.error("mongodb error", err);
    }
    db = database.db(config.mongodb.dbName);
    gfs = Grid(db, mongo);
});


// config server
var server = http.createServer(app).listen(config.server.port, function () { });
console.log('start on:' + config.server.port);
server.timeout = 240000;

app.use(fileUpload());

app.post('/upload', function (req, res) {
    if (!req.files) {
        return res.status(400).send('No files were uploaded.');
    }

    let _abi = null;
    if (req.body.abi) {
        _abi = JSON.parse(req.body.abi);
    }

    let _hash = null;
    if (req.body.hash) {
        _hash = req.body.hash;
    }

    let _account = null;
    if (req.body.account) {
        _account = req.body.account;
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

    rimraf(contractsDir, (err) => {
        if (err) {
            return res.status(500).send(err);
        }
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
                                fs.unlink(contractsDir + '/' + sourceFile.name, (err) => {
                                    if (err) {
                                        reject(err);
                                    }
                                    resolve();
                                });
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
                    //gen abi
                    if (fs.existsSync(contractsDir + "/" + contractName + ".abi")) {
                        return null;
                    }
                    let genabiCmd = getGenabiCmd(contractsDir, contractName);
                    return execfunc(genabiCmd);
                }, err => {
                    res.status(500).send(err);
                }).then(stdout => {
                    console.log(stdout);
                    //shasum 
                    return getHash(contractsDir + "/" + contractName + ".wasm");
                }, err => {
                    res.status(500).send(err);
                }).then(hash => {
                    fs.unlinkSync(contractsDir + "/" + contractName + ".wasm");
                    fs.unlinkSync(contractsDir + "/" + contractName + ".wast");
                    fs.readFile(contractsDir + "/" + contractName + ".abi", (err, data) => {
                        if (err || !data) {
                            return res.status(500).send(err + "\nabi is null!");
                        }
                        let abi = JSON.parse(data.toString());
                        let obj = {
                            codeHash: hash
                        }
                        if (_hash) {
                            obj.hashMatch = (_hash == hash);
                        }
                        if (_abi) {
                            obj.abiDiff = jsondiff(_abi, abi);
                        } else {
                            obj.abi = abi;
                        }
                        //if input eos account , save the contract
                        if (_account) {
                            fs.readdir(contractsDir, (err, files) => {
                                if (err) {
                                    res.status(500).send(err);
                                }
                                new Promise((resolve, reject) => {
                                    let size = files.length;
                                    let ids = [];
                                    let i = 0;
                                    files.forEach(file => {
                                        let writestream = gfs.createWriteStream({
                                            filename: file,
                                            metadata: {
                                                contractAccount: _account
                                            }
                                        });
                                        writestream.on('close', function (file) {
                                            ids.push(file._id);
                                            if (++i == size) {
                                                resolve(ids);
                                            }
                                        });
                                        writestream.on('error', function (file) {
                                            reject(error);
                                        });

                                        fs.createReadStream(contractsDir + '/' + file).pipe(writestream);
                                    });
                                }).then(ids => {
                                    let object = {
                                        account: _account,
                                        files: ids,
                                        version: config.compiler.version,
                                        hash: hash,
                                        timestamp: new Date()
                                    }
                                    let collection = db.collection("contracts");
                                    collection.insertOne(object, function (err, result) {
                                        if (err) {
                                            res.status(500).send(err);
                                        } else {
                                            res.json(obj);
                                        }
                                    });
                                }, err => {
                                    res.status(500).send(err);
                                });
                            });
                        } else {
                            res.json(obj);
                        }
                    });
                });
        });
    });

});

app.get('/code/:account', function (req, res) {
    let account = req.params.account;
    if (!account) {
        res.status(400).json({ error: 'contract account  is null' })
    }
    let collection = db.collection("contracts");
    /*     collection.findOne(object, function (err, result) {
            if (err) {
                res.status(500).send(err);
            } else {
                res.json(obj);
            }
        }); */
    let condition = { "account": account };
    let sort = { "timestamp": -1 };
    collection.find(condition).sort(sort).toArray(function (err, docs) {
        if (err) {
            res.status(500).json({ error: err });
        }
        res.json(docs);
    });
})

app.get('/file/:id', function (req, res) {
    let file = req.params.id;
    if (!file) {
        res.status(400).json({ error: 'file is is null' })
    }
    let readstream = gfs.createReadStream({
        _id: file
    });

    //error handling, e.g. file does not exist
    readstream.on('error', function (err) {
        console.log('An error occurred!', err);
        res.status(500).json({ error: err })
    });

    readstream.pipe(res);

})

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

function getGenabiCmd(path, name) {
    if (config.compiler.dockerFlag) {
        let dir = "/opt/contracts/" + name + '/';
        return "docker exec " + config.compiler.container + "-" + config.compiler.version
            + " eosiocpp -g " + dir + name + ".abi " + dir + name + ".cpp";
    } else {
        return "eosiocpp -g " + path + '/' + name + ".abi " + path + '/' + name + ".cpp";
    }
}