const IPFS = require('ipfs');
const config = require('./config.json');
const fs = require('fs');

// Create the IPFS node instance
const ipfs = new IPFS();
ipfs.on('ready', () => {
    console.log("ipfs start.");
});

function getIpfsFiles(cid) {
    return new Promise((resolve, reject) => {
        ipfs.files.get(cid, (err, files) => {
            if (err) {
                reject(err);
            } else {
                console.log(files[0].content.toString());
            }
        })
    });
}


function pushFiles(files) {
    return new Promise((resolve, reject) => {
        ipfs.files.add(files, function (err, resultFiles) {
            // 'files' will be an array of objects containing paths and the multihashes of the files added
            console.error(err);
            if (err) {
                reject(err);
            } else {
                let returnFiles = [];
                resultFiles.forEach(file => {
                    if (files.findIndex((element) => { return element.path == file.path }) > -1) {
                        returnFiles.push(file);
                    }
                })
                resolve(returnFiles);
            }
        })
    });
}

/* setTimeout(getIpfsFiles, 3000, "QmdsbHJ35St8W3mhSpstP1J9HRT1yyKqn6kG6A3DVVUq9w")
 */

module.exports = {
    pushFiles
}