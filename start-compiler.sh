echo "install jq tool first."

image=`cat config.json | jq .compiler.image |sed 's/\"//g' `
length=`cat config.json | jq '.compiler.versions | length'`
container=`cat config.json | jq .compiler.container |sed 's/\"//g' `

echo $image
echo $versions
echo $container

for(( i = 0; i <$length; i++ ))
do
    echo $i
    version=`cat config.json | jq .compiler.versions[$i] |sed 's/\"//g'`
    echo $version
    docker run -d -v `pwd`/contracts:/opt/contracts --name=$container-$version $image:$version /bin/sh -c "while true; do echo running; sleep 1; done"
done
