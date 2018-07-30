const config = require('./config.json');
const exec = require('child_process').exec;

//docker run - d ubuntu: 17.10 / bin / sh - c "while true; do echo running; sleep 1; done"

let cmd = "docker run -d -v " + __dirname + "/contracts:/opt/contracts --name="
    + config.compiler.container + "-" + config.compiler.version + " " + config.compiler.image + ":" + config.compiler.version
    + " /bin/sh -c \"while true; do echo running; sleep 1; done\"";
console.log(cmd);
exec(cmd, function (error, stdout, stderr) {
    if (error) {
        console.error(stderr);
    }
    console.log(stdout);
});