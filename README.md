# eos-opensource-platform
- validate source code and onchain code
- help opensource dapp to delopy
- more...

## RUN

- npm install
- install jq tool
- run start-compiler.sh to run eos-dev docker container
- node app.js or use pm2 to start server
- user test.html to upload source code to remote server
- user test-local.html to upload source code to local server
- source code support single cpp file or project in zip

## API

### /upload

update cpp file or zip file to server , compiler and compare hash

usage: see test.html

### /code/:account

GET file id related to the code

### /file/:id

GET file by id

### /versions

GET available compiler versions


## TODO
- intergrate with docker image
- support can not compiled with eosiocpp

## DONE
- add genabi
