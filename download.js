const fs = require('fs');
const https = require('https');
const { spawnSync } = require('child_process');

console.log('Starting download...');
const file = fs.createWriteStream('repo.zip');
https.get('https://github.com/snajperrrYT/Snajperrr/archive/refs/heads/main.zip', (res) => {
    let target = res;
    if (res.statusCode === 301 || res.statusCode === 302) {
        target = https.get(res.headers.location, (redirectRes) => {
            redirectRes.pipe(file);
            handleFinish(file);
        });
    } else {
        res.pipe(file);
        handleFinish(file);
    }
});

function handleFinish(fileOut) {
    fileOut.on('finish', () => {
        fileOut.close();
        console.log('Download complete. Extracting...');
        // We use npx unzipper to unzip since unzip might not be installed. Alternatively extract-zip.
        const result = spawnSync('npx', ['-y', 'extract-zip-cli', 'repo.zip'], { stdio: 'inherit' });
        console.log('Unzip status:', result.status);
    });
}
