import fs from 'fs';

const content = fs.readFileSync('client/app.js', 'utf8');
const lines = content.split('\n');
lines.forEach((line, idx) => {
  if (line.includes('sendSheetUpdate') || line.includes('update-record')) {
    console.log(`${idx + 1}: ${line.trim()}`);
  }
});
