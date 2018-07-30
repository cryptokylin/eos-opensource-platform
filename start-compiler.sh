echo "install jq tool first."

image=`cat config.json | jq .compiler.image |sed 's/\"//g' `
version=`cat config.json | jq .compiler.version |sed 's/\"//g' `
container=`cat config.json | jq .compiler.container |sed 's/\"//g' `

echo $image
echo $version
echo $container

docker run -d -v `pwd`/contracts:/opt/contracts --name=$container-$version $image:$version /bin/sh -c "while true; do echo running; sleep 1; done"
