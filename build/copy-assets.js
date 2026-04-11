const fs = require('fs');
const path = require('path');

function copyFile(src, dest) {
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.copyFileSync(src, dest);
  console.log(`Copied: ${src} -> ${dest}`);
}

(function main() {
  const projectRoot = path.resolve(__dirname, '..');
  const srcPs = path.join(projectRoot, 'src', 'server', 'windowsAutomation.ps1');
  const destPs = path.join(projectRoot, 'dist', 'server', 'windowsAutomation.ps1');

  if (!fs.existsSync(srcPs)) {
    console.error('Source PowerShell script not found:', srcPs);
    process.exit(1);
  }

  copyFile(srcPs, destPs);
})();
