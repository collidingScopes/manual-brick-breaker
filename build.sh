#!/bin/bash
cp config.template.js config.js
sed -i "s|%%HIGHSCORE_URL%%|$HIGHSCORE_URL|g" config.js