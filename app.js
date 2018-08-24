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
//const jsondiff = require('deep-diff').diff;
const mongo = require('mongodb');
const Grid = require('gridfs-stream');

//包装为 Promise 接口
global.Promise = require("bluebird");
const rimrafPromise = Promise.promisify(rimraf, rimraf);
const mkdirpPromise = Promise.promisify(mkdirp, mkdirp);
const readdirPromise = Promise.promisify(fs.readdir, fs);

const ipfsAgent = require('./ipfsAgent');


// create or use an existing mongodb-native db instance
//var db = new mongo.Db('test', new mongo.Server(config.mongodb.server, config.mongodb.port));
var db, gfs;
mongo.MongoClient.connect(config.mongodb.url, { useNewUrlParser: true }, function (err, database) {
    if (err) {
        console.error("mongodb error", err);
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
    res.header("Access-Control-Allow-Origin", "*");
    if (!req.files) {
        return res.status(400).send('No files were uploaded.');
    }

    //genabi = true means to deploy
    let _genabi = false;
    if (req.body.genabi) {
        _genabi = true;
    }

    let _hash = null;
    if (req.body.hash) {
        _hash = req.body.hash;
    }

    let _account = null;
    if (req.body.account) {
        _account = req.body.account;
    }

    let _version = config.compiler.versions[0];
    if (req.body.version) {
        _version = req.body.version;
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
    var returnObj = {};

    //删除目录
    rimrafPromise(contractsDir).then(() => { //新建目录
        return mkdirpPromise(contractsDir);
    }).then(() => { //移动上传的源代码到指定目录
        return sourceFile.mv(contractsDir + '/' + sourceFile.name)
    }).then(() => { //执行编译脚本
        if (type == "cpp") {
            let compileCmd = getCmd(contractName, _version);
            return execfunc(compileCmd);
        } else {
            //type = zip
            //extract zip 
            return new Promise((resolve, reject) => {
                extract(contractsDir + '/' + sourceFile.name, { dir: contractsDir }, function (err) {
                    // extraction is complete. make sure to handle the err
                    if (err) {
                        reject(err);
                    } else {
                        resolve();
                    }
                })
            }).then(() => {
                let compileCmd = getCmd(contractName, _version);
                return execfunc(compileCmd);
            })
        }
    }).then(stdout => { //生成abi
        console.log(stdout);
        if (!_genabi) {
            return null;
        }
        // if project file include abi
        if (fs.existsSync(contractsDir + "/" + contractName + ".abi")) {
            return null;
        }
        //gen abi
        let genabiCmd = getGenabiCmd(contractName, _version);
        return execfunc(genabiCmd);
    }).then(stdout => { //获取wasm hash
        console.log(stdout);
        //shasum 
        return getHash(contractsDir + "/" + contractName + ".wasm");
    }).then(hash => {  //构造返回结果
        let abi = null;
        if (fs.existsSync(contractsDir + "/" + contractName + ".abi")) {
            let abiFile = fs.readFileSync(contractsDir + "/" + contractName + ".abi");
            abi = JSON.parse(abiFile.toString());
        }
        returnObj.codeHash = hash;
        if (abi) {
            returnObj.abi = abi;
        }
        if (_hash) {
            returnObj.hashMatch = (_hash == hash);
        }
        //检查是否需要向存储文件
        if (_hash && !returnObj.hashMatch) {
            return false;
        } else {
            return getContracts(_account, hash).then(docs => {
                if (docs.length > 0) {
                    //exist
                    return false;
                } else {
                    return true;
                }
            })
        }
        //if exsit , not save
        //if input eos account and hash match  , save the contract
    }).then(storeFlag => { //存储数据和文件
        if (!storeFlag) {
            return;
        } else {
            return readdirPromise(contractsDir).then((files) => {
                let ipfsFiles = [];
                files.forEach(file => {
                    ipfsFiles.push({
                        "path": contractsDir + '/' + file,
                        "content": fs.createReadStream(contractsDir + '/' + file)
                    })
                })
                return ipfsAgent.pushFiles(ipfsFiles);
            }).then((files) => {

                files.forEach(file => {
                    let splited = file.path.split('/');
                    file.name = splited[splited.length - 1];
                });

                returnObj.files = JSON.parse(JSON.stringify(files)); // deep copy

                let ipfsMap = {};

                returnObj.files.forEach(file => {
                    ipfsMap[file.name] = file.hash;
                    file.ipfs = file.hash;
                    delete file.hash;
                    delete file.size;
                    delete file.path;
                });

                return new Promise((resolve, reject) => {
                    let size = files.length;
                    let fileInfos = [];
                    let i = 0;
                    if (!_account || !_hash) { //不需要存储在本地，没输入合约账户或没输入hash
                        resolve(null);
                    } else {
                        files.forEach(file => {
                            let writestream = gfs.createWriteStream({
                                filename: file.name,
                                metadata: {
                                    contractAccount: _account
                                }
                            });
                            writestream.on('close', function (resultObj) {
                                let fileInfo = { id: resultObj._id, name: resultObj.filename, ipfs: ipfsMap[resultObj.filename] };
                                if (resultObj.filename == contractName + ".wasm" ||
                                    resultObj.filename == contractName + ".wast" ||
                                    resultObj.filename == contractName + ".zip") {
                                    //put to ipfs
                                    fileInfo.forDisplay = false;
                                } else {
                                    fileInfo.forDisplay = true;
                                }
                                fileInfos.push(fileInfo);
                                if (++i == size) {
                                    resolve(fileInfos);
                                }
                            });
                            writestream.on('error', function (error) {
                                throw reject(error);
                            });

                            fs.createReadStream(file.path).pipe(writestream);
                        });
                    }
                });
            }).then(files => {
                if (files) {
                    let object = {
                        account: _account,
                        files: files,
                        version: _version,
                        hash: returnObj.codeHash,
                        timestamp: new Date()
                    }
                    let collection = db.collection("contracts");
                    collection.insertOne(object, function (err, result) {
                        if (err) {
                            throw new Error(err);
                        } else {
                            return;
                        }
                    });
                }
            }).catch(err => {
                throw new Error(err);
            });
        }
    }).then(() => { //返回交易结果
        res.json(returnObj);
    }).catch(err => {
        console.error(err);
        res.status(500).json({ error: err, message: err.message });
    });
});

app.get('/code/:account', function (req, res) {
    res.header("Access-Control-Allow-Origin", "*");
    let account = req.params.account;
    if (!account) {
        res.status(400).json({ error: 'contract account  is null' })
    }
    getContracts(account, null).then(result => {
        res.json(result);
    }, err => {
        res.status(500).json({ error: err });
    })
})

app.get('/file/:id', function (req, res) {
    res.header("Access-Control-Allow-Origin", "*");
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

app.get('/versions', function (req, res) {
    res.header("Access-Control-Allow-Origin", "*");
    res.json(config.compiler.versions);
})

// get open source contract list
app.get('/contracts', function (req, res) {
    res.header("Access-Control-Allow-Origin", "*");
    let collection = db.collection("contracts");
    let aggregate = [{ $group: { _id: { account: "$account" }, count: { $sum: 1 } } }];
    collection.aggregate(aggregate).toArray(function (err, result) {
        if (err) {
            res.status(500).send(err);
        } else {
            let arr = [];
            result.forEach(doc => {
                arr.push(doc._id.account);
            })
            res.json(arr);
        }
    });
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

function getCmd(name, version) {
    if (!version) {
        version = config.compiler.versions[0];
    }

    let dir = "/opt/contracts/" + name + '/';
    return "docker exec " + config.compiler.container + "-" + version
        + " eosiocpp -o " + dir + name + ".wast " + dir + name + ".cpp";

}

function getGenabiCmd(name, version) {
    if (!version) {
        version = config.compiler.versions[0];
    }

    let dir = "/opt/contracts/" + name + '/';
    return "docker exec " + config.compiler.container + "-" + version
        + " eosiocpp -g " + dir + name + ".abi " + dir + name + ".cpp";

}

function getContracts(account, hash) {
    return new Promise((resolve, reject) => {
        if (!account) {
            resolve({});
        }
        let collection = db.collection("contracts");
        let condition = {
            account: account
        }
        if (hash) {
            condition.hash = hash;
        }
        let sort = { "timestamp": -1 };
        collection.find(condition).sort(sort).toArray(function (err, docs) {
            if (err) {
                reject(err);
            } else {
                resolve(docs);
            }
        });
    });
}