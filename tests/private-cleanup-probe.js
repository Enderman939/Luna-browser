const path = require('node:path');
const { createPrivateDirectory, watchPrivateCleanup } = require('../src/private-sessions');
const root = path.resolve(process.argv[2]);
createPrivateDirectory(root);
watchPrivateCleanup(root, path.join(__dirname, '../src/native/luna-private-cleanup.exe'));
setTimeout(() => {}, 2000);
