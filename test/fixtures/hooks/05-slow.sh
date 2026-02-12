#!/bin/sh
trap 'exit 1' TERM INT
sleep 30 &
wait $!
echo "should not reach here"
